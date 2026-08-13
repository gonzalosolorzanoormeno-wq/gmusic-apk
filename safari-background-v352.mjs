import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(app, /const VERSION = "3\.5\.5"/);
assert.match(html, /<audio id="audio" preload="auto" playsinline><\/audio>/);
assert.match(app, /audio\.addEventListener\("ended", handleLibraryTrackEnded\)/);
assert.match(app, /audio\.addEventListener\("canplay", recoverBackgroundAdvance\)/);
assert.match(app, /warmNextPlaybackUrl\(\{ minValidityMs: IS_ANDROID \? 600000 : 240000, refreshCandidate: true, eagerMedia: IS_ANDROID \}\)/);
assert.doesNotMatch(app, /function warmNextPlaybackUrl\([^)]*\) \{\s*if \(!state\.onlineApi \|\| document\.hidden\) return;/);
assert.match(app, /function startPreparedNextImmediately\(prepared,\{reason="ended"\}=\{\}\)/);

// The critical background path must issue play() before expensive UI work.
const start = app.indexOf("function startPreparedNextImmediately(prepared,{reason=\"ended\"}={})");
const end = app.indexOf("function recoverBackgroundAdvance()", start);
const fast = app.slice(start, end);
assert.ok(fast.indexOf("const attempt=audio.play()") >= 0, "prepared transition must call play");
assert.ok(fast.indexOf("const attempt=audio.play()") < fast.indexOf("applyCurrentTrackPresentation"), "play must happen before render/presentation");
assert.ok(fast.indexOf("await ") === -1, "prepared ended path must remain synchronous before play");
assert.match(fast, /audio\.autoplay=true/);
assert.match(fast, /audio\.src=prepared\.url/);

assert.match(app, /preparingNext/);
assert.match(app, /preloader\.preload=\(eagerMedia\|\|\(IS_ANDROID&&document\.hidden\)\)\?"auto":"metadata"/);
assert.match(app, /refreshPreparedNextNearTrackEnd/);
assert.match(app, /remaining<150/);
assert.match(app, /if\(state\.repeat==="one"\)/);
assert.match(sw, /const VERSION = "3\.5\.5"/);
assert.match(sw, /app\.js\?v=20-background-lock-fix/);
assert.equal(pkg.version, "3.5.5");

console.log("✓ Safari background playback compatibility on v3.5.5 OK");
