import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function extractFunction(name){
  const marker = `function ${name}(`;
  const start = app.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const brace = app.indexOf("{", start);
  let depth = 0;
  for(let i=brace;i<app.length;i++){
    if(app[i]==="{") depth++;
    else if(app[i]==="}"){
      depth--;
      if(depth===0) return app.slice(start,i+1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const recoverSrc = extractFunction("recoverBackgroundAdvance");
const endedSrc = extractFunction("handleLibraryTrackEnded");
const pauseFallbackSrc = extractFunction("androidPauseEndedFallback");

function makeHarness({pending="B", prepared=null}={}){
  const state = {
    activePlaybackSource:"library",
    currentId:"B",
    backgroundAdvanceLock:true,
    backgroundAdvancePending:pending,
    repeat:"off",
    playCountMarked:true,
    playbackToken:7,
    preparedNext:prepared,
  };
  let playCalls=0, nextCalls=0, clearCalls=0, preparedStarts=0;
  const audio = {
    paused:true,
    ended:true,
    duration:180,
    currentTime:180,
    autoplay:false,
    play(){ playCalls++; return Promise.resolve(); }
  };
  const clearAndroidBackgroundAdvanceTimer=()=>{clearCalls++;};
  const preparedNextStillValid=(p)=>Boolean(p?.valid);
  const startPreparedNextImmediately=()=>{preparedStarts++; return true;};
  const nextTrack=(fromEnded)=>{if(fromEnded)nextCalls++;};
  const scheduleAndroidBackgroundAdvance=()=>{};
  const el=()=>({classList:{remove(){}}});
  const document={hidden:true};
  const factory = new Function(
    "state","audio","clearAndroidBackgroundAdvanceTimer","preparedNextStillValid","startPreparedNextImmediately","nextTrack","scheduleAndroidBackgroundAdvance","el","document","IS_ANDROID",
    `${recoverSrc}\n${endedSrc}\n${pauseFallbackSrc}\nreturn {recoverBackgroundAdvance,handleLibraryTrackEnded,androidPauseEndedFallback};`
  );
  const api=factory(state,audio,clearAndroidBackgroundAdvanceTimer,preparedNextStillValid,startPreparedNextImmediately,nextTrack,scheduleAndroidBackgroundAdvance,el,document,true);
  return {state,audio,api,metrics:()=>({playCalls,nextCalls,clearCalls,preparedStarts})};
}

// A stuck lock + already-selected pending B must retry B, not discard ended and not jump to C.
{
  const h=makeHarness({pending:"B"});
  h.api.handleLibraryTrackEnded();
  assert.equal(h.state.backgroundAdvanceLock,false,"ended must synchronously release stale lock");
  assert.equal(h.metrics().playCalls,1,"pending source must be retried");
  assert.equal(h.metrics().nextCalls,0,"must not skip the pending track");
  await Promise.resolve();
  assert.equal(h.state.backgroundAdvancePending,"","successful retry should settle pending state");
}

// A stuck lock with no pending/prepared source must still execute normal queue advance.
{
  const h=makeHarness({pending:"",prepared:null});
  h.api.handleLibraryTrackEnded();
  assert.equal(h.state.backgroundAdvanceLock,false);
  assert.equal(h.metrics().nextCalls,1,"stale lock must not silence normal ended transition");
}

// Android pause-at-end fallback must also ignore the stale lock and advance.
{
  const h=makeHarness({pending:"",prepared:null});
  h.api.androidPauseEndedFallback();
  assert.equal(h.state.backgroundAdvanceLock,false);
  assert.equal(h.metrics().nextCalls,1,"Android pause/end fallback must advance despite stale lock");
}

console.log("✓ Background lock v3.5.5 behavioral tests OK");
