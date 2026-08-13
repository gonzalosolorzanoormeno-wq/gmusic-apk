import worker from "../src/index.js";

// Privacidad: una cuenta normal no puede leer, inferir ni descubrir
// datos o existencia de otra cuenta ni la jerarquía de gestión.

const APP_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789-TEST";
const ADMIN_CODE = "admin-test-code-very-long-123";

class MemoryKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "" } = {}) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
}

const env = { APP_TOKEN, USER_CODES: JSON.stringify({ [ADMIN_CODE]: { role: "admin", name: "Admin Test" } }), USERDATA: new MemoryKV() };

function req(path, init = {}) { return new Request(`https://gmusic.test${path}`, init); }
async function login(code) {
  const res = await worker.fetch(req("/api/session", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" }, body: JSON.stringify({ access_key: code }) }), env);
  const data = await res.json();
  return { res, data };
}
function auth(token) { return { authorization: `Bearer ${token}` }; }
async function api(token, path, init = {}) {
  return worker.fetch(req(path, { ...init, headers: { ...(init.headers || {}), ...auth(token) } }), env);
}
function assert(cond, msg) { if (!cond) throw new Error(`FALLO: ${msg}`); }
async function assertOpaqueUnavailable(response, label) {
  const body = await response.clone().text();
  assert(response.status === 404, `${label} debe parecer inexistente`);
  assert(!/admin|administrator|administrador|listener|usuario|role|sub/i.test(body), `${label} no debe revelar jerarquía o usuarios`);
}

// Setup técnico, visible únicamente desde la superficie de gestión.
const adminLogin = await login(ADMIN_CODE);
assert(adminLogin.res.status === 200 && adminLogin.data.session_token, "la cuenta de gestión debe iniciar sesión");
const adminToken = adminLogin.data.session_token;
const adminSession = await (await api(adminToken, "/api/session")).json();
assert(adminSession.capabilities?.manageUsers === true, "la sesión de gestión debe conservar sus capacidades");

async function createPrivateAccount(name) {
  const res = await api(adminToken, "/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, role: "listener" }) });
  const data = await res.json();
  assert(res.status === 201 && data.access_code, `no se pudo crear ${name}`);
  const loginResult = await login(data.access_code);
  assert(loginResult.res.status === 200 && loginResult.data.session_token, `${name} no pudo iniciar sesión`);
  assert(!("role" in loginResult.data) && !("sub" in loginResult.data), `${name} recibió campos internos al iniciar sesión`);
  return { sub: data.user.sub, token: loginResult.data.session_token };
}

const accountA = await createPrivateAccount("Cuenta A");
const accountB = await createPrivateAccount("Cuenta B");

// B guarda datos privados propios.
await api(accountB.token, "/api/userdata/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: { name: "Secreto de B", gender: "other", accent: "berry" } }) });
await api(accountB.token, "/api/userdata/playlists", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: [{ id: "p1", name: "Mi playlist privada", ids: ["1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"] }] }) });
await api(accountB.token, "/api/favorites/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ favorite: true }) });

// A nunca hereda datos de B.
const aProfile = await (await api(accountA.token, "/api/userdata/profile")).json();
assert(aProfile.value === null, "A no debe heredar ni ver el perfil de B");
const aPlaylists = await (await api(accountA.token, "/api/userdata/playlists")).json();
assert(Array.isArray(aPlaylists.value) ? aPlaylists.value.length === 0 : aPlaylists.value === null, "A no debe ver playlists de B");
const aFavorites = await (await api(accountA.token, "/api/favorites")).json();
assert(Array.isArray(aFavorites.ids) && aFavorites.ids.length === 0, "A no debe ver favoritos de B");

// Intentar forzar identificadores ajenos en body no cambia el destino real: siempre lo determina la sesión.
const spoofAttempt = await api(accountA.token, "/api/userdata/profile", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ value: { name: "Intento" }, sub: accountB.sub, userId: accountB.sub, owner: accountB.sub, role: "admin" })
});
assert(spoofAttempt.status === 200, "A debe poder guardar su propio perfil");
const bProfileAfter = await (await api(accountB.token, "/api/userdata/profile")).json();
assert(bProfileAfter.value?.name === "Secreto de B", "el perfil de B no debe alterarse por una escritura de A");

// Superficies de gestión deben parecer inexistentes para A.
for (const path of ["/api/admin/users", "/api/admin/status", "/api/admin/backup", "/api/trash", "/api/diagnostics"]) {
  await assertOpaqueUnavailable(await api(accountA.token, path), path);
}

// Mutaciones de biblioteca reservadas tampoco revelan la jerarquía.
await assertOpaqueUnavailable(await api(accountA.token, "/api/tracks", { method: "POST", body: new FormData() }), "subida");
await assertOpaqueUnavailable(await api(accountA.token, "/api/tracks/fake-track-id-aaaaaaaaaa", { method: "DELETE" }), "eliminación");

// Sesión normal minimalista: nada de rol, sub, capacidades o estructura de cuentas.
const sessionA = await (await api(accountA.token, "/api/session")).json();
assert(sessionA.authenticated === true, "A debe conservar sesión");
assert(!("role" in sessionA) && !("sub" in sessionA) && !("capabilities" in sessionA), "sesión normal no debe exponer campos internos");
const sessionRaw = JSON.stringify(sessionA);
assert(!/admin|administrator|administrador|listener|role|sub/i.test(sessionRaw), "sesión normal no debe revelar jerarquía");

// Biblioteca compartida: metadata musical, sin atribución de personas.
const tracksResponse = await (await api(accountA.token, "/api/tracks")).json();
const rawTracks = JSON.stringify(tracksResponse);
assert(!/uploadedBy|adminName|ownerName|creatorUserId|internalUserList|createdBy|modifiedBy/i.test(rawTracks), "la biblioteca no debe exponer quién gestionó canciones");

// Regenerar A no afecta ni revela a B.
const regen = await api(adminToken, `/api/admin/users/${encodeURIComponent(accountA.sub)}/regenerate`, { method: "POST" });
const regenData = await regen.json();
assert(regen.status === 200 && regenData.access_code, "la cuenta de gestión debe poder regenerar el código de A");
const oldTokenData = await (await api(accountA.token, "/api/session")).json();
assert(oldTokenData.authenticated === false, "el token viejo de A debe invalidarse");
const bStillFineData = await (await api(accountB.token, "/api/session")).json();
assert(bStillFineData.authenticated === true && !("role" in bStillFineData), "B debe seguir funcionando sin exponer rol");

console.log("✓ Privacy isolation smoke test OK");
