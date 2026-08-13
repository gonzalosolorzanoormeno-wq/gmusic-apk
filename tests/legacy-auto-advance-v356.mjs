import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(pkg.version, "4.0.0");
assert.match(app, /audio\.addEventListener\(\"ended\", \(\) => nextTrack\(true\)\)/);
assert.doesNotMatch(app, /backgroundAdvanceLock|backgroundAdvancePending|startPreparedNextImmediately|scheduleAndroidBackgroundAdvance|androidBackgroundHeartbeat|androidPauseEndedFallback/);

const time = app.slice(
  app.indexOf('audio.addEventListener("timeupdate"'),
  app.indexOf('audio.addEventListener("loadedmetadata"')
);
assert.doesNotMatch(time, /audio\.src|audio\.load\(|audio\.play\(/);

const warm = app.slice(
  app.indexOf('function warmNextPlaybackUrl'),
  app.indexOf('function refreshPreparedNextNearTrackEnd')
);
assert.doesNotMatch(warm, /new Audio\(|\.play\(/);
assert.match(warm, /state\.preparedNext=/);

const next = app.slice(
  app.indexOf('async function nextTrack'),
  app.indexOf('async function previousTrack')
);
assert.match(next, /await playTrack\(nextId,\{prepared\}\)/);

console.log("✓ Legacy auto-advance regression preserved in v4.0 structural tests OK");
