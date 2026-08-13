import worker from "../src/index.js";

const APP_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789-TEST";
const ADMIN_CODE = "admin-test-code-very-long-123";
const LISTENER_CODE = "listener-test-code-very-long-123";
const USER_CODES = JSON.stringify({
  [ADMIN_CODE]: { role: "admin", name: "Admin Test" },
  [LISTENER_CODE]: { role: "listener", name: "Listener Test" }
});

class MemoryKV {
  constructor(){ this.m = new Map(); }
  async get(k){ return this.m.has(k) ? this.m.get(k) : null; }
  async put(k,v){ this.m.set(k,String(v)); }
  async delete(k){ this.m.delete(k); }
  async list({prefix=""}={}){ return { keys:[...this.m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}
const env = { APP_TOKEN, USER_CODES, USERDATA: new MemoryKV() };

function req(path, init = {}) { return new Request(`https://gmusic.test${path}`, init); }
async function login(code) {
  const res = await worker.fetch(req("/api/session", { method:"POST", headers:{"content-type":"application/json","cf-connecting-ip":"127.0.0.1"}, body:JSON.stringify({access_key:code}) }), env);
  const data = await res.json();
  return { res, data };
}

const health = await worker.fetch(req("/api/health"), env);
if (health.status !== 200) throw new Error("health failed");

const publicDiag = await worker.fetch(req("/api/diagnostics"), env);
if (publicDiag.status !== 401) throw new Error("diagnostics must require auth");

const { res: wrong } = await login("incorrecto");
if (wrong.status !== 401) throw new Error("wrong-key test failed");

const { res: adminLogin, data: adminData } = await login(ADMIN_CODE);
if (adminLogin.status !== 200 || !adminData.ok || adminData.role || adminData.sub) throw new Error("admin login response leaked internal identity fields");
if (!adminLogin.headers.get("set-cookie")?.includes("HttpOnly")) throw new Error("secure cookie missing");
const adminToken = adminData.session_token;

const adminVerify = await worker.fetch(req("/api/session", { headers:{authorization:`Bearer ${adminToken}`} }), env);
const adminVerifyData = await adminVerify.json();
if (!adminVerifyData.authenticated || !adminVerifyData.capabilities?.manageUsers || adminVerifyData.role || adminVerifyData.sub) throw new Error("admin session capabilities failed");

const adminDiag = await worker.fetch(req("/api/diagnostics", { headers:{authorization:`Bearer ${adminToken}`} }), env);
if (adminDiag.status !== 200) throw new Error("admin diagnostics failed");

const { data: listenerData } = await login(LISTENER_CODE);
if (listenerData.role || listenerData.sub) throw new Error("listener login leaked role/sub");
const listenerToken = listenerData.session_token;
const listenerVerify = await worker.fetch(req("/api/session", { headers:{authorization:`Bearer ${listenerToken}`} }), env);
const listenerVerifyData = await listenerVerify.json();
if (!listenerVerifyData.authenticated || listenerVerifyData.role || listenerVerifyData.sub || listenerVerifyData.capabilities) throw new Error("listener session leaked multiuser architecture");

const listenerDiag = await worker.fetch(req("/api/diagnostics", { headers:{authorization:`Bearer ${listenerToken}`} }), env);
if (listenerDiag.status !== 404) throw new Error("listener diagnostics must look unavailable");
const listenerDiagBody = JSON.stringify(await listenerDiag.json());
if (/admin|administrator|listener/i.test(listenerDiagBody)) throw new Error("listener diagnostics response leaked role hierarchy");

const uploadAttempt = await worker.fetch(req("/api/tracks", { method:"POST", headers:{authorization:`Bearer ${listenerToken}`}, body:new FormData() }), env);
if (uploadAttempt.status !== 404) throw new Error("listener upload route must look unavailable");

const createUser = await worker.fetch(req("/api/admin/users", { method:"POST", headers:{authorization:`Bearer ${adminToken}`,"content-type":"application/json"}, body:JSON.stringify({name:"New Listener",role:"listener"}) }), env);
const created = await createUser.json();
if (createUser.status !== 201 || !created.access_code) throw new Error("managed user creation failed");
const managedLogin = await login(created.access_code);
if (managedLogin.res.status !== 200 || !managedLogin.data.ok || managedLogin.data.role || managedLogin.data.sub) throw new Error("managed user login leaked role/sub");

console.log("✓ Auth/security smoke test OK");
