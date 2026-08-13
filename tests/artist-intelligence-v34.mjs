import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/index.js';

const APP_TOKEN='abcdefghijklmnopqrstuvwxyz0123456789-TEST';
const ADMIN_CODE='artist-admin-code-123456789';
const USER_CODE='artist-user-code-123456789';
class MemoryKV{constructor(){this.m=new Map()}async get(k){return this.m.has(k)?this.m.get(k):null}async put(k,v){this.m.set(k,String(v))}async delete(k){this.m.delete(k)}async list({prefix='' }={}){return{keys:[...this.m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}}}
const env={APP_TOKEN,USER_CODES:JSON.stringify({[ADMIN_CODE]:{role:'admin',name:'Gestión'},[USER_CODE]:{role:'listener',name:'Cuenta'}}),USERDATA:new MemoryKV()};
const req=(path,init={})=>new Request(`https://gmusic.test${path}`,init);
async function login(code){const r=await worker.fetch(req('/api/session',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'127.0.0.31'},body:JSON.stringify({access_key:code})}),env);return (await r.json()).session_token;}
const admin=await login(ADMIN_CODE),user=await login(USER_CODE);
assert.ok(admin&&user);
const fd=new FormData();fd.set('artist','J Balvin');fd.set('file',new File([new Uint8Array([137,80,78,71])],'jbalvin.png',{type:'image/png'}));
const up=await worker.fetch(req('/api/admin/artists/manual',{method:'POST',headers:{authorization:`Bearer ${admin}`},body:fd}),env);assert.equal(up.status,200,'admin can store a manual artist image');
const art=await worker.fetch(req('/api/artwork?kind=artist&artist=J%20Balvin',{headers:{authorization:`Bearer ${user}`}}),env);const ad=await art.json();assert.match(ad.image,/\/api\/artwork\/artist\/manual/,'saved manual photo wins for J Balvin');
const denied=await worker.fetch(req('/api/admin/artists/search?artist=J%20Balvin',{headers:{authorization:`Bearer ${user}`}}),env);assert.equal(denied.status,404,'artist admin tools stay opaque to listener');
const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.match(source,/wikidata\.org\/wiki\/Special:EntityData/);assert.match(source,/artistImage|searchArtistImageCandidate/);assert.match(source,/source==="manual"/,'manual images must have explicit priority');
console.log('✓ Artist Intelligence v3.4 tests OK');
