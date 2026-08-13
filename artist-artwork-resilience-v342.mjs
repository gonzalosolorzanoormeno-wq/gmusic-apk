import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/index.js';

const APP_TOKEN='abcdefghijklmnopqrstuvwxyz0123456789-TEST';
const USER_CODE='artwork-resilience-user-123456789';
class MemoryKV{constructor(){this.m=new Map()}async get(k){return this.m.has(k)?this.m.get(k):null}async put(k,v){this.m.set(k,String(v))}async delete(k){this.m.delete(k)}async list({prefix=''}={}){return{keys:[...this.m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}}}
const env={APP_TOKEN,USER_CODES:JSON.stringify({[USER_CODE]:{role:'listener',name:'Cuenta'}}),USERDATA:new MemoryKV()};
const req=(path,init={})=>new Request(`https://gmusic.test${path}`,init);
const login=await worker.fetch(req('/api/session',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'127.0.0.44'},body:JSON.stringify({access_key:USER_CODE})}),env);
const token=(await login.json()).session_token;
assert.ok(token,'listener login should work');

const realFetch=globalThis.fetch;
let external=[];
try{
  globalThis.fetch=async input=>{
    const url=String(typeof input==='string'?input:input?.url||input);
    external.push(url);
    if(url.startsWith('https://api.deezer.com/search/artist')){
      return new Response(JSON.stringify({data:[{id:1,name:'J Balvin',picture_xl:'https://e-cdns-images.dzcdn.net/images/artist/test/1000x1000.jpg'}]}),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error(`Unexpected external fetch: ${url}`);
  };
  const r=await worker.fetch(req('/api/artwork?kind=artist&artist=J%20Balvin',{headers:{authorization:`Bearer ${token}`}}),env);
  assert.equal(r.status,200);
  const d=await r.json();
  assert.match(d.image,/\/api\/artwork\/proxy\?url=/,'exact Deezer fallback should produce a proxied artist image');
  assert.equal(d.provisional,true,'fast fallback must be explicitly provisional, not silently persisted as approved');
  assert.equal(d.source,'deezer');
  assert.equal(external.filter(x=>x.includes('musicbrainz.org')).length,0,'normal artist cards must not wait for MusicBrainz when exact Deezer image exists');
}finally{globalThis.fetch=realFetch;}

// A duplicated exact name in Deezer must not be picked blindly.
external=[];
try{
  globalThis.fetch=async input=>{
    const url=String(typeof input==='string'?input:input?.url||input);
    external.push(url);
    if(url.startsWith('https://api.deezer.com/search/artist')){
      return new Response(JSON.stringify({data:[
        {id:1,name:'Same Name',picture_xl:'https://e-cdns-images.dzcdn.net/images/artist/a.jpg'},
        {id:2,name:'Same Name',picture_xl:'https://e-cdns-images.dzcdn.net/images/artist/b.jpg'}
      ]}),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error(`Unexpected external fetch: ${url}`);
  };
  const r=await worker.fetch(req('/api/artwork?kind=artist&artist=Same%20Name',{headers:{authorization:`Bearer ${token}`}}),env);
  const d=await r.json();
  assert.equal(d.image||'', '', 'ambiguous exact-name candidates must not be chosen blindly');
}finally{globalThis.fetch=realFetch;}

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.match(app,/artworkInFlight/,'concurrent artwork requests should be deduplicated');
assert.match(app,/artworkMissUntil/,'temporary misses should have a retry window');
assert.match(app,/cleanArtworkCache/,'old persisted empty artwork entries should be cleaned');
assert.doesNotMatch(app,/state\.artwork\[key\]\s*=\s*""/,'failed lookups must not be persisted as permanent empty artwork');
assert.match(app,/else \{[\s\S]{0,300}hydrateArtwork\(\)/,'artwork should resume hydrating when the app becomes visible again');
assert.match(app,/IntersectionObserver/,'all rendered artwork should use viewport hydration');
assert.match(app,/invalidateArtistArtwork\(row\.artist\)/,'editing one artist should invalidate only that artist');
assert.doesNotMatch(app,/state\.artwork\s*=\s*\{\};\s*localStorage\.removeItem\(ARTWORK_KEY\)/,'editing one artist must not wipe every cached artist image');

console.log('✓ Artist artwork resilience v3.4.2 tests OK');
