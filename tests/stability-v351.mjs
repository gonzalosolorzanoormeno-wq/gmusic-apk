import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chooseDjTrack, scoreDjTrack } from '../public/dj-engine.js';

const backend = fs.readFileSync('src/index.js','utf8');
const app = fs.readFileSync('public/app.js','utf8');
const sw = fs.readFileSync('public/sw.js','utf8');

// Metadata: backup is a hard precondition and safe matches use one batch endpoint.
const writeBackup = backend.slice(backend.indexOf('async function writeMetadataBackup'), backend.indexOf('async function applyMetadataProposal'));
assert.match(writeBackup,/throw new HttpError\(503/);
assert.doesNotMatch(writeBackup,/catch\(\(\)=>\{\}\)/);
assert.match(backend,/\/api\/admin\/metadata\/apply-batch/);
assert.match(backend,/async function applyMetadataBatch/);
assert.match(backend,/rolled_back:true/);
assert.match(app,/\/api\/admin\/metadata\/apply-batch/);

// Requests are reconciled once after an upload batch, not inside uploadTrack per file.
const uploadBlock = backend.slice(backend.indexOf('async function uploadTrack'), backend.indexOf('async function updateTrackMetadata'));
assert.doesNotMatch(uploadBlock,/markRequestsAvailableForTrack/);
const uploadUi = app.slice(app.indexOf('async function uploadTracks'), app.indexOf('function looksLikeAudioFile'));
assert.equal((uploadUi.match(/\/api\/admin\/requests\/reconcile/g)||[]).length,1);

// Queue KV saver: stable semantic queue without updated_at.
const queueSanitizer = backend.slice(backend.indexOf('if (kind === "queue")'), backend.indexOf('if (kind === "stats")'));
assert.doesNotMatch(queueSanitizer,/updated_at/);
const queueSync = app.slice(app.indexOf('function syncQueueRemote'), app.indexOf('function schedulePlaybackSync'));
assert.doesNotMatch(queueSync,/updated_at/);
assert.match(app,/600000/);

// YouTube: signed result proof, playback-source isolation, session-bound timers and retries.
assert.match(backend,/createYouTubeListenToken/);
assert.match(backend,/verifyYouTubeListenToken/);
assert.match(backend,/checkYouTubeSearchWindow/);
assert.match(backend,/youtubeApiError/);
assert.match(app,/activePlaybackSource/);
assert.match(app,/setupYouTubeMediaSession/);
assert.match(app,/state\.youtubeListen\?\.session_id!==sessionId/);
assert.match(app,/l\.retries<=2/);
assert.match(app,/listen_token:l\.listen_token/);

// DJ favorites really means favorites, and recently DJ-selected tracks get a strong penalty.
const tracks=[
  {id:'fav',title:'Favorite',artist:'A',genre:'Pop'},
  {id:'other',title:'Other',artist:'B',genre:'Pop'},
  {id:'current',title:'Current',artist:'C',genre:'Pop'}
];
const ctx={currentId:'current',mode:'favorites',favoriteIds:new Set(['fav']),stats:{},recentIds:[],recentArtists:[],djLastIds:[],feedback:{}};
assert.equal(scoreDjTrack(tracks[1],ctx),-Infinity);
assert.equal(chooseDjTrack(tracks,ctx,()=>0)?.id,'fav');
const fresh=scoreDjTrack(tracks[0],{...ctx,mode:'taste',favoriteIds:new Set(),djLastIds:[]});
const recent=scoreDjTrack(tracks[0],{...ctx,mode:'taste',favoriteIds:new Set(),djLastIds:['fav']});
assert.ok(recent < fresh - 40);

// Admin is no longer eager-loading every heavy endpoint in one Promise.all.
const adminPanel = app.slice(app.indexOf('async function loadAdminPanel'), app.indexOf('function artistCandidateSrc'));
assert.doesNotMatch(adminPanel,/\/api\/admin\/library\/audit/);
assert.match(app,/setupAdminLazyLoading/);

// Version/cache consistency.
assert.match(app,/const VERSION = "4\.0\.0"/);
assert.match(backend,/const VERSION = "4\.0\.0"/);
assert.match(sw,/const VERSION = "4\.0\.0"/);

console.log('✓ Stability + KV optimization v4.0 compatibility tests OK');
