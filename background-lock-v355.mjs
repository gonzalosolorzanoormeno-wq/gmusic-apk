import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(app, /const VERSION = "3\.5\.5"/);
assert.equal(pkg.version, "3.5.5");
assert.match(html, /app\.js\?v=20-background-lock-fix/);
assert.match(sw, /const VERSION = "3\.5\.5"/);
assert.match(sw, /app\.js\?v=20-background-lock-fix/);

const endedStart = app.indexOf("function handleLibraryTrackEnded()");
const endedEnd = app.indexOf("function armBackgroundAdvanceWatchdog", endedStart);
const endedBlock = app.slice(endedStart, endedEnd);
assert.ok(endedStart >= 0 && endedEnd > endedStart);
assert.doesNotMatch(endedBlock, /\|\|state\.backgroundAdvanceLock\)return/, "ended must never be discarded by a stale background lock");
assert.match(endedBlock, /state\.backgroundAdvanceLock=false;/, "ended must clear stale transition guard");
assert.match(endedBlock, /state\.backgroundAdvancePending===state\.currentId/, "ended must recover an already-selected pending source instead of skipping it");

const pauseStart = app.indexOf("function androidPauseEndedFallback()");
const pauseEnd = app.indexOf("async function togglePlay", pauseStart);
const pauseBlock = app.slice(pauseStart, pauseEnd);
assert.ok(pauseStart >= 0 && pauseEnd > pauseStart);
assert.doesNotMatch(pauseBlock, /\|\|state\.backgroundAdvanceLock\)return/, "Android pause/end fallback must not be blocked forever");
assert.match(pauseBlock, /nextTrack\(true\)/, "fallback must still advance even when no prepared source exists");

const preparedStart = app.indexOf("function startPreparedNextImmediately");
const preparedEnd = app.indexOf("function recoverBackgroundAdvance", preparedStart);
const preparedBlock = app.slice(preparedStart, preparedEnd);
assert.ok(preparedStart >= 0 && preparedEnd > preparedStart);
const pendingPos = preparedBlock.indexOf("state.backgroundAdvancePending=nextId");
const playPos = preparedBlock.indexOf("const attempt=audio.play()");
const unlockPos = preparedBlock.indexOf("state.backgroundAdvanceLock=false", playPos);
assert.ok(pendingPos >= 0 && pendingPos < playPos, "pending source must be recorded before play() can hang in background");
assert.ok(unlockPos > playPos, "background lock must be released synchronously after invoking play(), not in its Promise callbacks");
assert.match(preparedBlock, /armBackgroundAdvanceWatchdog\(token,nextId\)/);

assert.match(app, /audio\.addEventListener\("playing",/);
assert.match(app, /function recoverBackgroundAdvance\(\)/);
assert.match(app, /const token=state\.playbackToken;/);

console.log("✓ Background transition lock v3.5.5 regression tests OK");
