import assert from 'node:assert/strict';
import worker,{compareRequestedTrack,parseSpotifyPlaylistId} from '../src/index.js';

assert.equal(parseSpotifyPlaylistId('https://open.spotify.com/playlist/32w8lBS9W0Xo8X8JW92153?si=x'),'32w8lBS9W0Xo8X8JW92153');
assert.equal(parseSpotifyPlaylistId('spotify:playlist:32w8lBS9W0Xo8X8JW92153'),'32w8lBS9W0Xo8X8JW92153');
const exact=compareRequestedTrack({title:'LUNA',artist:'FEID'},{title:'Luna',artist:'Feid',album:'FERXXOCALIPSIS'});assert.ok(exact.score>=94&&exact.exact,'case variants should match');
const remix=compareRequestedTrack({title:'Canción - Remix',artist:'Artista'},{title:'Canción',artist:'Artista',album:'X'});assert.ok(remix.variant_conflict&&remix.score<94,'remix and standard version should not become an exact match');

const APP_TOKEN='abcdefghijklmnopqrstuvwxyz0123456789-REQUEST';const A='request-a-123456789012345',B='request-b-123456789012345',ADMIN='request-admin-123456789';
class MemoryKV{constructor(){this.m=new Map()}async get(k){return this.m.has(k)?this.m.get(k):null}async put(k,v){this.m.set(k,String(v))}async delete(k){this.m.delete(k)}async list({prefix='' }={}){return{keys:[...this.m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}}}
const kv=new MemoryKV(),env={APP_TOKEN,USER_CODES:JSON.stringify({[A]:{role:'listener',name:'A'},[B]:{role:'listener',name:'B'},[ADMIN]:{role:'admin',name:'Gestión'}}),USERDATA:kv};
const req=(path,init={})=>new Request(`https://gmusic.test${path}`,init);async function login(code,ip){const r=await worker.fetch(req('/api/session',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify({access_key:code})}),env);return (await r.json()).session_token;}
const ta=await login(A,'127.0.0.41'),tb=await login(B,'127.0.0.42'),tadmin=await login(ADMIN,'127.0.0.43');
function sub(token){return JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString()).sub}
const sa=sub(ta),sb=sub(tb);await kv.put(`musicreq:${sa}:11111111-1111-4111-8111-111111111111`,JSON.stringify({id:'11111111-1111-4111-8111-111111111111',owner_sub:sa,title:'LUNA',artist:'Feid',status:'requested',created_at:'2026-08-11T00:00:00Z'}));await kv.put(`musicreq:${sb}:22222222-2222-4222-8222-222222222222`,JSON.stringify({id:'22222222-2222-4222-8222-222222222222',owner_sub:sb,title:'OTRA',artist:'Otro',status:'requested',created_at:'2026-08-11T00:00:00Z'}));
const own=await worker.fetch(req('/api/music-requests',{headers:{authorization:`Bearer ${ta}`}}),env);const od=await own.json();assert.equal(od.requests.length,1);assert.equal(od.requests[0].title,'LUNA');assert.equal('owner_sub' in od.requests[0],false,'listener response must not expose internal owner id');
const denied=await worker.fetch(req('/api/admin/requests',{headers:{authorization:`Bearer ${ta}`}}),env);assert.equal(denied.status,404);
const all=await worker.fetch(req('/api/admin/requests',{headers:{authorization:`Bearer ${tadmin}`}}),env);assert.equal((await all.json()).requests.length,2);
console.log('✓ Music Requests v3.4 tests OK');
