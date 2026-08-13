import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(app, /const VERSION = "3\.5\.5"/);
assert.match(app, /const IS_ANDROID = \/Android\/i\.test\(navigator\.userAgent \|\| ""\)/);
assert.match(app, /function scheduleAndroidBackgroundAdvance\(\)/);
assert.match(app, /function androidBackgroundHeartbeat\(\)/);
assert.match(app, /function androidPauseEndedFallback\(\)/);
assert.match(app, /preloader\.preload=\(eagerMedia\|\|\(IS_ANDROID&&document\.hidden\)\)\?"auto":"metadata"/);
assert.match(app, /nexttrack:\(\)=>nextTrack\(false,\{systemAction:true\}\)/);
assert.match(app, /startPreparedNextImmediately\(prepared,\{reason:systemAction\?"media-session":"manual-next"\}\)/);
assert.match(app, /if\(IS_ANDROID\)\{try\{audio\.load\(\);\}catch\{\}\}/);
assert.match(app, /remaining<=0\.35/);
assert.match(app, /duration-current<=0\.4/);

const mediaStart = app.indexOf("function setupLibraryMediaSessionHandlers()");
const mediaEnd = app.indexOf("function setupYouTubeMediaSession", mediaStart);
const media = app.slice(mediaStart, mediaEnd);
assert.ok(mediaStart >= 0 && mediaEnd > mediaStart);
assert.doesNotMatch(media, /location\.|window\.open|openNowPlaying/);
assert.match(media, /seekbackward/);
assert.match(media, /seekforward/);
assert.match(media, /seekto/);

const nextStart = app.indexOf("async function nextTrack(fromEnded,{systemAction=false}={})");
const nextEnd = app.indexOf("async function previousTrack", nextStart);
const nextBlock = app.slice(nextStart, nextEnd);
assert.ok(nextBlock.indexOf("startPreparedNextImmediately") < nextBlock.indexOf("await playTrack"), "prepared next must be used before network fallback");

assert.match(html, /app\.js\?v=20-background-lock-fix/);
assert.match(html, /manifest\.webmanifest\?v=3\.5\.5/);
assert.match(sw, /const VERSION = "3\.5\.5"/);
assert.match(sw, /app\.js\?v=20-background-lock-fix/);
assert.equal(pkg.version, "3.5.5");

// v3.5.5: guard against the track-skip race condition — a manual/system "next" (or any
// playTrack call) must always win over an in-flight Android background auto-advance instead
// of being corrupted by its stale play()-promise callback.
assert.match(app, /playbackToken: 0/);
assert.match(app, /const token=\+\+state\.playbackToken;/);
assert.match(app, /const token = \+\+state\.playbackToken;/);
assert.match(app, /if\(token!==state\.playbackToken\)return;/);
assert.match(app, /if \(token !== state\.playbackToken\) return;/);

const playTrackStart = app.indexOf("async function playTrack(id)");
const playTrackEnd = app.indexOf("\nfunction rememberDjTrack");
const playTrackBlock = app.slice(playTrackStart, playTrackEnd);
assert.ok(playTrackStart >= 0 && playTrackEnd > playTrackStart);
assert.match(playTrackBlock, /state\.backgroundAdvanceLock = false;/, "playTrack must drop a stale background-advance lock so it always wins");
assert.match(playTrackBlock, /clearAndroidBackgroundAdvanceTimer\(\);/, "playTrack must cancel any pending Android background-advance timer");

console.log("✓ Android background playback v3.5.5 compatibility structural tests OK");
