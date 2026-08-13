import fs from "node:fs/promises";
import worker from "../src/index.js";

const APP_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789-TEST";
const ADMIN_CODE = "admin-test-code-very-long-123";
const NORMAL_CODE = "normal-test-code-very-long-123";
class MemoryKV { constructor(){this.m=new Map()} async get(k){return this.m.has(k)?this.m.get(k):null} async put(k,v){this.m.set(k,String(v))} async delete(k){this.m.delete(k)} async list({prefix=""}={}){return {keys:[...this.m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}} }
const env={APP_TOKEN,USER_CODES:JSON.stringify({[ADMIN_CODE]:{role:"admin",name:"Gestión"},[NORMAL_CODE]:{role:"listener",name:"Cuenta privada"}}),USERDATA:new MemoryKV()};
const req=(path,init={})=>new Request(`https://gmusic.test${path}`,init);
async function login(code){const r=await worker.fetch(req("/api/session",{method:"POST",headers:{"content-type":"application/json","cf-connecting-ip":"127.0.0.9"},body:JSON.stringify({access_key:code})}),env);return {r,d:await r.json()}}
const normal=await login(NORMAL_CODE); if(!normal.d.session_token) throw new Error("normal login failed");
const H={authorization:`Bearer ${normal.d.session_token}`};

const session=await worker.fetch(req("/api/session",{headers:H}),env); const sessionText=await session.text();
if(/admin|administrator|administrador|listener|role|sub/i.test(sessionText)) throw new Error("normal session reveals role architecture");
for(const path of ["/api/admin/users","/api/admin/status","/api/admin/backup","/api/trash","/api/diagnostics"]){const r=await worker.fetch(req(path,{headers:H}),env);const txt=await r.text();if(r.status!==404)throw new Error(`${path} not opaque`);if(/admin|administrator|administrador|listener|role|sub/i.test(txt))throw new Error(`${path} reveals role hierarchy`)}

const html=await fs.readFile(new URL("../public/index.html",import.meta.url),"utf8");
if(/id="diagnosticBtn"/i.test(html)) throw new Error("diagnostic control is statically present in listener HTML");
if(/Solo el administrador|Solo para admin|Admin only|Administrator/i.test(html)) throw new Error("static HTML contains visible management hierarchy text");

const app=await fs.readFile(new URL("../public/app.js",import.meta.url),"utf8");
if(/Diagnóstico disponible solo para admin|Solo el administrador/i.test(app)) throw new Error("frontend contains listener-facing management denial text");
if(/console\.log\s*\(/.test(app)) throw new Error("frontend contains debug console.log calls");

console.log("✓ Privacy Phase 1.1 inference/UI smoke test OK");
