import { buildPlaylistDocx } from "./docx.js";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const LIBRARY_FOLDER_NAME = "GMUSIC AUDIO - App";
const VERSION = "3.5.6";
const SESSION_DAYS = 14;
const PLAYBACK_URL_MINUTES = 10;
const LOGIN_WINDOW_SECONDS = 10 * 60;
const LOGIN_MAX_ATTEMPTS = 8;
const VALID_ROLES = ["admin", "listener"];
const USERDATA_KINDS = new Set(["profile", "history", "playlists", "queue", "stats", "playback"]);
const DEFAULT_MAX_USERS = 10;

let googleTokenCache = { token: "", expiresAt: 0 };
let libraryFolderCache = { id: "", expiresAt: 0 };
const accountCache = new Map();
const ACCOUNT_CACHE_MS = 60 * 1000;
let musicBrainzLastRequestAt = 0;
let musicBrainzQueue = Promise.resolve();
const youtubeSearchWindows = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    if (!url.pathname.startsWith("/api/")) {
      const response = await env.ASSETS.fetch(request);
      return hardenAssetResponse(request, response);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: securityApiHeaders() });
    }

    if (isMutation(request.method) && !isSameOriginRequest(request)) {
      return json({ error: "Solicitud rechazada por seguridad." }, 403);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, app: "GMusic", version: VERSION, storage: "google-drive" });
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      return createSession(request, env);
    }

    if (url.pathname === "/api/session" && request.method === "GET") {
      const user = await getUser(request, env);
      if (!user) return json({ authenticated: false, name: "" });
      const session = { authenticated: true, name: user.name || "", offline_scope: await deriveOfflineScope(user.sub, normalizedAppToken(env)) };
      // Solo una cuenta con permisos de gestión necesita conocer capacidades administrativas.
      // Una cuenta normal no recibe nombres de roles, IDs internos ni pistas de la arquitectura multiusuario.
      if (user.role === "admin") {
        session.capabilities = { manageLibrary: true, manageUsers: true, diagnostics: true };
      }
      return json(session);
    }

    if (url.pathname === "/api/session" && request.method === "DELETE") {
      return clearSession();
    }

    if (url.pathname === "/api/spotify/callback" && request.method === "GET") {
      return await spotifyOAuthCallback(url, env);
    }

    const signedStreamMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/stream$/);
    if (signedStreamMatch && request.method === "GET" && await validSignedPlaybackUrl(url, env)) {
      try {
        return await streamTrack(request, env, decodeURIComponent(signedStreamMatch[1]));
      } catch (error) {
        console.error(`[${requestId}] signed stream`, error);
        return json({ error: "No se pudo reproducir el audio.", request_id: requestId }, 500);
      }
    }

    const user = await getUser(request, env);
    if (!user) return json({ error: "No autorizado. Inicia sesión en GMusic." }, 401);

    try {
      if (url.pathname === "/api/spotify/authorize" && request.method === "GET") return await spotifyAuthorize(url, env, user);
      if (url.pathname === "/api/spotify/status" && request.method === "GET") return await spotifyStatus(env, user);
      if (url.pathname === "/api/spotify/disconnect" && request.method === "DELETE") return await spotifyDisconnect(env, user);

      if (url.pathname === "/api/youtube/search" && request.method === "GET") return await searchYouTube(url, env, user);
      if (url.pathname === "/api/youtube/listen" && request.method === "POST") return await logYouTubeListen(request, env, user);

      if (url.pathname === "/api/music-requests/identify" && request.method === "POST") return await identifyMusicRequest(request, env, user);
      if (url.pathname === "/api/music-requests" && request.method === "GET") return await listOwnMusicRequests(env, user);
      if (url.pathname === "/api/music-requests" && request.method === "POST") return await createMusicRequest(request, env, user);
      const ownMusicRequestMatch = url.pathname.match(/^\/api\/music-requests\/([^/]+)$/);
      if (ownMusicRequestMatch && request.method === "DELETE") return await cancelOwnMusicRequest(env, user, decodeURIComponent(ownMusicRequestMatch[1]));

      if (url.pathname === "/api/playlist-requests" && request.method === "GET") return await listOwnPlaylistRequests(env, user);
      if (url.pathname === "/api/playlist-requests" && request.method === "POST") return await createSpotifyPlaylistRequest(request, env, user, url.origin);
      const ownPlaylistReanalyze = url.pathname.match(/^\/api\/playlist-requests\/([^/]+)\/reanalyze$/);
      if (ownPlaylistReanalyze && request.method === "POST") return await reanalyzeSpotifyPlaylistRequest(env, user, decodeURIComponent(ownPlaylistReanalyze[1]));

      if (url.pathname === "/api/diagnostics" && request.method === "GET") {
        requireAdmin(user);
        return await diagnostics(env);
      }

      if (url.pathname === "/api/artwork" && request.method === "GET") {
        return await findArtwork(url, env);
      }
      if (url.pathname === "/api/artwork/cover" && request.method === "GET") {
        return await proxyMusicBrainzCover(url);
      }

      if (url.pathname === "/api/tracks" && request.method === "GET") return await listTracks(env);
      if (url.pathname === "/api/tracks" && request.method === "POST") {
        requireAdmin(user);
        const result = await uploadTrack(request, env);
        if (result.status < 400) await logAudit(env, user, "track.upload", { title: result.auditTitle || "" });
        return result.response || result;
      }

      if (url.pathname === "/api/favorites" && request.method === "GET") return await getUserFavorites(env, user);
      const favMatch = url.pathname.match(/^\/api\/favorites\/([^/]+)$/);
      if (favMatch && request.method === "PATCH") return await setUserFavorite(request, env, user, decodeURIComponent(favMatch[1]));

      const userDataMatch = url.pathname.match(/^\/api\/userdata\/(profile|history|playlists|queue|stats|playback)$/);
      if (userDataMatch && request.method === "GET") return await getUserData(env, user, userDataMatch[1]);
      if (userDataMatch && request.method === "PUT") return await putUserData(request, env, user, userDataMatch[1]);

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        requireAdmin(user);
        return await listUsers(env);
      }
      if (url.pathname === "/api/admin/users" && request.method === "POST") {
        requireAdmin(user);
        const result = await createManagedUser(request, env, user);
        return result;
      }
      const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminUserMatch && request.method === "PATCH") {
        requireAdmin(user);
        return await updateManagedUser(request, env, user, decodeURIComponent(adminUserMatch[1]));
      }
      const adminRegenMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/regenerate$/);
      if (adminRegenMatch && request.method === "POST") {
        requireAdmin(user);
        return await regenerateManagedUserCode(env, user, decodeURIComponent(adminRegenMatch[1]));
      }

      if (url.pathname === "/api/admin/status" && request.method === "GET") {
        requireAdmin(user);
        return await adminStatus(env);
      }
      if (url.pathname === "/api/admin/backup" && request.method === "GET") {
        requireAdmin(user);
        return await exportBackup(env);
      }
      if (url.pathname === "/api/admin/library/audit" && request.method === "GET") {
        requireAdmin(user);
        return await auditLibraryMetadata(env);
      }
      if (url.pathname === "/api/admin/library/cleanup" && request.method === "POST") {
        requireAdmin(user);
        const result = await applyLibraryCleanup(request, env, user);
        return result;
      }
      if (url.pathname === "/api/admin/metadata/search" && request.method === "GET") {
        requireAdmin(user);
        return await searchTrackMetadata(url, env);
      }
      if (url.pathname === "/api/admin/metadata/apply" && request.method === "POST") {
        requireAdmin(user);
        return await applyMetadataProposal(request, env, user);
      }
      if (url.pathname === "/api/admin/metadata/apply-batch" && request.method === "POST") {
        requireAdmin(user);
        return await applyMetadataBatch(request, env, user);
      }

      if (url.pathname === "/api/admin/artists/audit" && request.method === "GET") { requireAdmin(user); return await auditArtistImages(env, url); }
      if (url.pathname === "/api/admin/artists/search" && request.method === "GET") { requireAdmin(user); return await adminSearchArtistImage(env, url); }
      if (url.pathname === "/api/admin/artists/apply" && request.method === "POST") { requireAdmin(user); return await adminApplyArtistImage(request, env, user); }
      if (url.pathname === "/api/admin/artists/manual" && request.method === "POST") { requireAdmin(user); return await adminUploadArtistImage(request, env, user); }
      if (url.pathname === "/api/admin/artists/clear" && request.method === "POST") { requireAdmin(user); return await adminClearArtistImage(request, env, user); }

      if (url.pathname === "/api/admin/requests" && request.method === "GET") { requireAdmin(user); return await listAdminMusicRequests(env); }
      if (url.pathname === "/api/admin/requests/reconcile" && request.method === "POST") { requireAdmin(user); return await reconcileMusicRequests(env); }
      const adminReqMatch = url.pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
      if (adminReqMatch && request.method === "PATCH") { requireAdmin(user); return await patchAdminMusicRequest(request, env, decodeURIComponent(adminReqMatch[1])); }

      if (url.pathname === "/api/admin/youtube/listens" && request.method === "GET") { requireAdmin(user); return await listAdminYouTubeListens(env, url); }

      if (url.pathname === "/api/admin/playlist-analyses" && request.method === "GET") { requireAdmin(user); return await listAdminPlaylistRequests(env); }
      const adminPlaylistDocx = url.pathname.match(/^\/api\/admin\/playlist-analyses\/([^/]+)\/docx$/);
      if (adminPlaylistDocx && request.method === "GET") { requireAdmin(user); return await exportPlaylistRequestDocx(env, decodeURIComponent(adminPlaylistDocx[1]), url); }

      if (url.pathname === "/api/artwork/artist/manual" && request.method === "GET") return await serveManualArtistImage(env, url);
      if (url.pathname === "/api/artwork/proxy" && request.method === "GET") return await proxyExternalArtwork(url);

      if (url.pathname === "/api/trash" && request.method === "GET") {
        requireAdmin(user);
        return await listTrash(env);
      }
      const trashRestoreMatch = url.pathname.match(/^\/api\/trash\/([^/]+)\/restore$/);
      if (trashRestoreMatch && request.method === "POST") {
        requireAdmin(user);
        const id = decodeURIComponent(trashRestoreMatch[1]);
        const result = await restoreTrack(env, id);
        await logAudit(env, user, "track.restore", { id });
        return result;
      }
      const trashDeleteMatch = url.pathname.match(/^\/api\/trash\/([^/]+)$/);
      if (trashDeleteMatch && request.method === "DELETE") {
        requireAdmin(user);
        const id = decodeURIComponent(trashDeleteMatch[1]);
        const result = await permanentDeleteTrack(env, id);
        await logAudit(env, user, "track.delete_permanent", { id });
        return result;
      }

      const match = url.pathname.match(/^\/api\/tracks\/([^/]+)(?:\/(stream|play-url))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        if (action === "stream" && request.method === "GET") return await streamTrack(request, env, id);
        if (action === "play-url" && request.method === "GET") return await createPlaybackUrl(env, id);
        if (!action && request.method === "PATCH") {
          requireAdmin(user);
          const result = await updateTrackMetadata(request, env, id);
          await logAudit(env, user, "track.metadata", { id });
          return result;
        }
        if (!action && request.method === "DELETE") {
          requireAdmin(user);
          const result = await trashTrack(env, id);
          await logAudit(env, user, "track.trash", { id });
          return result;
        }
      }

      return json({ error: "Ruta no encontrada" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(`[${requestId}]`, error);
      return json({ error: "Ocurrió un error interno. Inténtalo nuevamente.", request_id: requestId }, 500);
    }
  }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireAdmin(user) { if (user?.role !== "admin") throw new HttpError(404, "Ruta no disponible."); }
function isMutation(method) { return ["POST", "PUT", "PATCH", "DELETE"].includes(method); }
function isSameOriginRequest(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function hardenAssetResponse(request, response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("content-security-policy", "default-src 'self'; script-src 'self' https://www.youtube.com; style-src 'self'; img-src 'self' data: blob: https://e-cdns-images.dzcdn.net https://upload.wikimedia.org https://commons.wikimedia.org https://i.scdn.co https://i.ytimg.com; media-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  const path = new URL(request.url).pathname;
  if (request.mode === "navigate" || path === "/index.html" || path === "/sw.js" || path.endsWith(".webmanifest")) {
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function securityApiHeaders() {
  const h = new Headers({ "cache-control": "no-store" });
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  h.set("referrer-policy", "no-referrer");
  return h;
}
function json(value, status = 200, extraHeaders = {}) {
  const headers = new Headers(JSON_HEADERS);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  for (const [key, val] of Object.entries(extraHeaders)) headers.set(key, val);
  const response = new Response(JSON.stringify(value), { status, headers });
  Object.defineProperty(response, "auditTitle", { value: value?.track?.title || "", enumerable: false });
  return response;
}

function normalizedAppToken(env) { return String(env.APP_TOKEN || "").trim(); }
function parseUserCodes(env) {
  try {
    const obj = JSON.parse(String(env.USER_CODES || ""));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch { return null; }
}
function parseCookies(request) {
  const out = {};
  const raw = request.headers.get("cookie") || "";
  for (const pair of raw.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}

async function getUser(request, env) {
  const secret = normalizedAppToken(env);
  if (!secret) return null;
  const cookies = parseCookies(request);
  let token = cookies.gmusic_session || "";
  if (!token) {
    const authorization = request.headers.get("authorization") || "";
    if (authorization.startsWith("Bearer ")) token = authorization.slice(7).trim();
  }
  if (!token) return null;
  return verifySessionToken(token, env, secret);
}

async function verifySessionToken(token, env, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = await signValue(payloadB64, secret);
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(base64urlDecode(payloadB64)); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload?.sub || !Number.isFinite(payload.exp) || payload.exp < now) return null;
  const account = await resolveAccountBySub(env, String(payload.sub), secret);
  if (!account || account.enabled === false) return null;
  const version = Number(account.session_version || 1);
  if (Number(payload.ver || 1) !== version) return null;
  if (!VALID_ROLES.includes(account.role)) return null;
  return { sub: String(payload.sub), role: account.role, name: cleanText(account.name, account.role === "admin" ? "Admin" : "Invitado", 60), source: account.source || "managed" };
}

async function resolveAccountBySub(env, sub, secret) {
  const cacheKey=String(sub),cached=accountCache.get(cacheKey),now=Date.now();
  if(cached&&cached.expiresAt>now)return {...cached.account};
  if (env.USERDATA) {
    const raw = await env.USERDATA.get(`account:${sub}`);
    if (raw) {
      try { const account = { ...JSON.parse(raw), source: "managed" };accountCache.set(cacheKey,{account,expiresAt:now+ACCOUNT_CACHE_MS});return {...account}; } catch { return null; }
    }
  }
  const legacy = parseUserCodes(env);
  if (!legacy) return null;
  for (const [code, info] of Object.entries(legacy)) {
    if (!info || !VALID_ROLES.includes(info.role)) continue;
    const legacySub = await deriveSub(code, secret);
    if (safeEqual(legacySub, sub)) {const account={ sub, role: info.role, name: info.name || "", enabled: true, session_version: 1, source: "legacy" };accountCache.set(cacheKey,{account,expiresAt:now+ACCOUNT_CACHE_MS});return {...account};}
  }
  return null;
}
function invalidateAccountCache(sub){accountCache.delete(String(sub||""));}

async function createSession(request, env) {
  const secret = normalizedAppToken(env);
  if (!secret || secret.length < 24) return json({ error: "APP_TOKEN no está configurado correctamente en Cloudflare." }, 503);
  if (!env.USERDATA && !parseUserCodes(env)) return json({ error: "No hay usuarios configurados." }, 503);

  const rate = await checkLoginRateLimit(request, env, secret);
  if (!rate.allowed) return json({ error: `Demasiados intentos. Espera ${rate.retryAfter} segundos.` }, 429, { "retry-after": String(rate.retryAfter) });

  const body = await request.json().catch(() => ({}));
  const accessKey = String(body.access_key || "").trim();
  if (!accessKey || accessKey.length > 256) {
    await recordFailedLogin(request, env, secret);
    return json({ error: "Código de acceso incorrecto." }, 401);
  }

  const account = await lookupAccountByCode(accessKey, env, secret);
  if (!account || account.enabled === false || !VALID_ROLES.includes(account.role)) {
    await recordFailedLogin(request, env, secret);
    return json({ error: "Código de acceso incorrecto." }, 401);
  }
  await clearLoginRateLimit(request, env, secret);

  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const payloadB64 = base64urlEncode(JSON.stringify({ sub: account.sub, exp, ver: Number(account.session_version || 1) }));
  const sig = await signValue(payloadB64, secret);
  const sessionToken = `${payloadB64}.${sig}`;
  const cookie = `gmusic_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  return json({ ok: true, session_token: sessionToken, expires_at: exp, name: account.name || "" }, 200, { "set-cookie": cookie });
}

async function lookupAccountByCode(accessKey, env, secret) {
  const codeHash = await signValue(`code:${accessKey}`, secret);
  if (env.USERDATA) {
    const sub = await env.USERDATA.get(`authcode:${codeHash}`);
    if (sub) {
      const raw = await env.USERDATA.get(`account:${sub}`);
      if (raw) {
        try { return { ...JSON.parse(raw), sub, source: "managed" }; } catch {}
      }
    }
  }
  const users = parseUserCodes(env);
  if (!users) return null;
  for (const [code, info] of Object.entries(users)) {
    if (safeEqual(accessKey, String(code).trim())) {
      return { sub: await deriveSub(code, secret), role: info.role, name: cleanText(info.name, info.role === "admin" ? "Admin" : "Invitado", 60), enabled: true, session_version: 1, source: "legacy" };
    }
  }
  return null;
}
function clearSession() {
  return json({ ok: true }, 200, { "set-cookie": "gmusic_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
}
async function deriveSub(code, secret) { return (await signValue(`uid:${String(code).trim()}`, secret)).slice(0, 20); }

async function rateKey(request, secret) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  return `ratelimit:login:${(await signValue(`ip:${ip}`, secret)).slice(0, 24)}`;
}
async function checkLoginRateLimit(request, env, secret) {
  if (!env.USERDATA) return { allowed: true, retryAfter: 0 };
  const key = await rateKey(request, secret);
  const raw = await env.USERDATA.get(key);
  if (!raw) return { allowed: true, retryAfter: 0 };
  try {
    const data = JSON.parse(raw); const now = Math.floor(Date.now() / 1000);
    if (Number(data.reset || 0) <= now) { await env.USERDATA.delete(key); return { allowed: true, retryAfter: 0 }; }
    if (Number(data.count || 0) >= LOGIN_MAX_ATTEMPTS) return { allowed: false, retryAfter: Math.max(1, Number(data.reset) - now) };
  } catch {}
  return { allowed: true, retryAfter: 0 };
}
async function recordFailedLogin(request, env, secret) {
  if (!env.USERDATA) return;
  const key = await rateKey(request, secret);
  const now = Math.floor(Date.now() / 1000);
  let count = 0; let reset = now + LOGIN_WINDOW_SECONDS;
  try { const data = JSON.parse(await env.USERDATA.get(key) || "{}"); if (Number(data.reset || 0) > now) { count = Number(data.count || 0); reset = Number(data.reset); } } catch {}
  await env.USERDATA.put(key, JSON.stringify({ count: count + 1, reset }), { expirationTtl: LOGIN_WINDOW_SECONDS });
}
async function clearLoginRateLimit(request, env, secret) { if (env.USERDATA) await env.USERDATA.delete(await rateKey(request, secret)).catch(() => {}); }

function base64urlEncode(str) {
  const bytes = new TextEncoder().encode(str); let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function base64urlDecode(str) {
  let normalized = String(str).replaceAll("-", "+").replaceAll("_", "/"); while (normalized.length % 4) normalized += "=";
  const binary = atob(normalized); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
async function signValue(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function safeEqual(a, b) {
  a = String(a ?? ""); b = String(b ?? ""); if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}

// ---------- Usuarios gestionados desde GMusic ----------
async function listUsers(env) {
  const users = [];
  const secret = normalizedAppToken(env);
  const legacy = parseUserCodes(env) || {};
  for (const [code, info] of Object.entries(legacy)) {
    if (!VALID_ROLES.includes(info?.role)) continue;
    users.push({ sub: await deriveSub(code, secret), name: cleanText(info.name, info.role === "admin" ? "Admin" : "Invitado", 60), role: info.role, enabled: true, source: "legacy", last_activity: null });
  }
  if (env.USERDATA) {
    let cursor;
    do {
      const page = await env.USERDATA.list({ prefix: "account:", cursor, limit: 1000 });
      for (const key of page.keys || []) {
        const raw = await env.USERDATA.get(key.name);
        try {
          const a = JSON.parse(raw || "{}");
          users.push({ sub: key.name.slice(8), name: a.name || "Usuario", role: a.role || "listener", enabled: a.enabled !== false, source: "managed", created_at: a.created_at || null, last_activity: a.last_activity || null });
        } catch {}
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  const unique = new Map(users.map(u => [`${u.source}:${u.sub}`, u]));
  return json({ users: [...unique.values()].sort((a,b) => String(a.name).localeCompare(String(b.name))) });
}
async function createManagedUser(request, env, actor) {
  if (!env.USERDATA) return json({ error: "USERDATA KV es obligatorio para administrar usuarios." }, 503);
  const maxUsers = Number(env.MAX_USERS) > 0 ? Number(env.MAX_USERS) : DEFAULT_MAX_USERS;
  const existing = await listUsers(env);
  const existingData = await existing.json();
  if ((existingData.users || []).length >= maxUsers) {
    return json({ error: `Límite de ${maxUsers} usuarios alcanzado. Desactiva o elimina uno para crear otro.` }, 409);
  }
  const body = await request.json().catch(() => ({}));
  const name = cleanText(body.name, "Invitado", 60);
  const role = VALID_ROLES.includes(body.role) ? body.role : "listener";
  const code = randomAccessCode();
  const secret = normalizedAppToken(env);
  const sub = await deriveSub(code, secret);
  const codeHash = await signValue(`code:${code}`, secret);
  const account = { name, role, enabled: true, session_version: 1, code_hash: codeHash, created_at: new Date().toISOString(), last_activity: null };
  await env.USERDATA.put(`account:${sub}`, JSON.stringify(account));
  invalidateAccountCache(sub);
  await env.USERDATA.put(`authcode:${codeHash}`, sub);
  await logAudit(env, actor, "user.create", { sub, name, role });
  return json({ ok: true, user: { sub, name, role, enabled: true }, access_code: code }, 201);
}
async function updateManagedUser(request, env, actor, sub) {
  if (!env.USERDATA) return json({ error: "USERDATA KV es obligatorio." }, 503);
  const key = `account:${safeId(sub)}`;
  const raw = await env.USERDATA.get(key);
  if (!raw) return json({ error: "Usuario gestionado no encontrado." }, 404);
  const account = JSON.parse(raw);
  const body = await request.json().catch(() => ({}));
  let revoke = false;
  if (typeof body.name === "string") account.name = cleanText(body.name, account.name || "Usuario", 60);
  if (VALID_ROLES.includes(body.role) && body.role !== account.role) { account.role = body.role; revoke = true; }
  if (typeof body.enabled === "boolean" && body.enabled !== (account.enabled !== false)) { account.enabled = body.enabled; revoke = true; }
  if (revoke) account.session_version = Number(account.session_version || 1) + 1;
  await env.USERDATA.put(key, JSON.stringify(account));
  invalidateAccountCache(sub);
  await logAudit(env, actor, "user.update", { sub, role: account.role, enabled: account.enabled !== false });
  return json({ ok: true, user: { sub, name: account.name, role: account.role, enabled: account.enabled !== false } });
}
async function regenerateManagedUserCode(env, actor, sub) {
  if (!env.USERDATA) return json({ error: "USERDATA KV es obligatorio." }, 503);
  sub = safeId(sub); const key = `account:${sub}`; const raw = await env.USERDATA.get(key);
  if (!raw) return json({ error: "Usuario gestionado no encontrado." }, 404);
  const account = JSON.parse(raw); const secret = normalizedAppToken(env); const code = randomAccessCode(); const codeHash = await signValue(`code:${code}`, secret);
  if (account.code_hash) await env.USERDATA.delete(`authcode:${account.code_hash}`).catch(() => {});
  account.code_hash = codeHash; account.session_version = Number(account.session_version || 1) + 1;
  await env.USERDATA.put(key, JSON.stringify(account)); invalidateAccountCache(sub); await env.USERDATA.put(`authcode:${codeHash}`, sub);
  await logAudit(env, actor, "user.regenerate_code", { sub });
  return json({ ok: true, access_code: code });
}
function randomAccessCode() {
  const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); let binary = ""; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function safeId(value) { const s = String(value || ""); if (!/^[A-Za-z0-9_-]{8,80}$/.test(s)) throw new HttpError(400, "ID inválido."); return s; }

// ---------- Favoritos y datos privados ----------
function favoritesKey(user) { return `fav:${user.sub}`; }
async function getUserFavorites(env, user) {
  if (!env.USERDATA) return json({ error: "Falta configurar USERDATA KV." }, 503);
  return json({ ids: parseIdArray(await env.USERDATA.get(favoritesKey(user))).slice(0, 5000) });
}
async function setUserFavorite(request, env, user, id) {
  if (!env.USERDATA) return json({ error: "Falta configurar USERDATA KV." }, 503);
  id = validateDriveId(id); const body = await request.json().catch(() => ({})); const favorite = Boolean(body.favorite);
  const ids = new Set(parseIdArray(await env.USERDATA.get(favoritesKey(user))).filter(validDriveId));
  favorite ? ids.add(id) : ids.delete(id);
  await env.USERDATA.put(favoritesKey(user), JSON.stringify([...ids].slice(0, 5000)));
  return json({ ok: true, favorite });
}
function parseIdArray(raw) { if (!raw) return []; try { const value = JSON.parse(raw); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } }
function userDataKey(user, kind) { return `user:${user.sub}:${kind}`; }
async function getUserData(env, user, kind) {
  if (!env.USERDATA) return json({ error: "Falta configurar USERDATA KV." }, 503);
  if (!USERDATA_KINDS.has(kind)) return json({ error: "Tipo de dato no válido" }, 400);
  const raw = await env.USERDATA.get(userDataKey(user, kind));
  if (!raw) return json({ value: null });
  try { return json({ value: JSON.parse(raw) }); } catch { return json({ value: null }); }
}
async function putUserData(request, env, user, kind) {
  if (!env.USERDATA) return json({ error: "Falta configurar USERDATA KV." }, 503);
  if (!USERDATA_KINDS.has(kind)) return json({ error: "Tipo de dato no válido" }, 400);
  const body = await request.json().catch(() => ({}));
  const value = sanitizeUserData(kind, body.value, user);
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length > 120000) return json({ error: "Datos de usuario demasiado grandes" }, 413);
  const key = userDataKey(user, kind);
  // KV Saver v3.5: las lecturas son mucho más baratas que las escrituras en el plan gratuito.
  // Evitamos reescribir exactamente el mismo valor y no actualizamos account:last_activity en cada PUT.
  const current = await env.USERDATA.get(key);
  if (current === serialized) return json({ ok: true, value, unchanged: true });
  await env.USERDATA.put(key, serialized);
  return json({ ok: true, value });
}
function sanitizeUserData(kind, value, user) {
  if (kind === "profile") return sanitizeProfile(value, user);
  if (kind === "history") {
    const rows = Array.isArray(value) ? value : [];
    return rows.slice(0, 100).map((x) => typeof x === "string" ? { id: validDriveId(x) ? x : "", at: "", position: 0 } : ({ id: validDriveId(x?.id) ? String(x.id) : "", at: cleanText(x?.at, "", 40), position: clampFloat(x?.position, 0, 86400) })).filter(x => x.id);
  }
  if (kind === "playlists") {
    const rows = Array.isArray(value) ? value : [];
    return rows.slice(0, 100).map((p) => ({ id: /^[A-Za-z0-9_-]{8,80}$/.test(String(p?.id || "")) ? String(p.id) : crypto.randomUUID(), name: cleanText(p?.name, "Playlist", 60), ids: Array.isArray(p?.ids) ? p.ids.map(String).filter(validDriveId).slice(0, 2000) : [], created_at: cleanText(p?.created_at, new Date().toISOString(), 40) }));
  }
  if (kind === "queue") {
    value = value && typeof value === "object" ? value : {};
    // La cola es estado, no un registro de actividad. Excluir el timestamp hace que KV Saver
    // pueda detectar una cola idéntica y evitar escrituras que no cambian nada.
    return { manualQueue: arrayDriveIds(value.manualQueue, 500), contextIds: arrayDriveIds(value.contextIds, 5000), currentId: validDriveId(value.currentId) ? String(value.currentId) : null, shuffle: Boolean(value.shuffle), repeat: ["off","all","one"].includes(value.repeat) ? value.repeat : "off" };
  }
  if (kind === "stats") {
    const out = {}; const obj = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    for (const [id, count] of Object.entries(obj).slice(0, 5000)) if (validDriveId(id)) out[id] = clampNumber(count, 0, 1_000_000);
    return out;
  }
  if (kind === "playback") {
    value = value && typeof value === "object" ? value : {};
    return { currentId: validDriveId(value.currentId) ? String(value.currentId) : null, position: clampFloat(value.position, 0, 86400), duration: clampFloat(value.duration, 0, 86400), updated_at: cleanText(value.updated_at, new Date().toISOString(), 40) };
  }
  return null;
}
function sanitizeProfile(value, user) {
  value = value && typeof value === "object" ? value : {};
  const allowedGender = new Set(["male", "female", "other", "prefer_not"]);
  const allowedAccent = new Set(["emerald", "ocean", "berry", "midnight", "orange", "red", "violet"]);
  const appearance = ["auto", "dark", "light"].includes(value.appearance) ? value.appearance : "auto";
  const legacyTheme = ["ocean", "berry", "midnight", "emerald"].includes(value.theme) ? value.theme : "emerald";
  const accent = allowedAccent.has(value.accent) ? value.accent : legacyTheme;
  return { name: cleanText(value.name, user.name || "Usuario", 40), gender: allowedGender.has(value.gender) ? value.gender : "prefer_not", accent, appearance, created_at: cleanText(value.created_at, new Date().toISOString(), 40) };
}
function arrayDriveIds(value, max) { return Array.isArray(value) ? value.map(String).filter(validDriveId).slice(0, max) : []; }
async function touchAccountActivity(env, user) {
  if (!env.USERDATA || user.source !== "managed") return;
  const key = `account:${user.sub}`; const raw = await env.USERDATA.get(key); if (!raw) return;
  try { const a = JSON.parse(raw); a.last_activity = new Date().toISOString(); await env.USERDATA.put(key, JSON.stringify(a)); } catch {}
}

// ---------- Biblioteca Google Drive ----------
async function listTracks(env) {
  const folderId = await ensureLibraryFolder(env);
  const token = await getGoogleAccessToken(env);
  const q = `'${folderId}' in parents and trashed = false and appProperties has { key='gmusic_track' and value='1' }`;
  const files = await listDriveFiles(env, token, q, "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,appProperties)");
  const canonical = buildCanonicalMetadata(files);
  const tracks = files.map((file) => fileToTrack(file, canonical)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return json({ tracks, storage: "google-drive", folder_name: LIBRARY_FOLDER_NAME });
}
async function listDriveFiles(env, token, q, fields) {
  let pageToken = ""; const files = [];
  do {
    const params = new URLSearchParams({ q, spaces: "drive", pageSize: "1000", fields }); if (pageToken) params.set("pageToken", pageToken);
    const response = await driveFetch(`${DRIVE_API}/files?${params}`, { method: "GET" }, env, token);
    if (!response.ok) throw await driveError(response, "No se pudo leer Google Drive");
    const data = await response.json(); files.push(...(data.files || [])); pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}
async function uploadTrack(request, env) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) return { response: json({ error: "Archivo demasiado grande. Máximo: 45 MB." }, 413), status: 413 };
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File)) return { response: json({ error: "Falta el archivo de audio." }, 400), status: 400 };
  if (file.size > MAX_UPLOAD_BYTES) return { response: json({ error: "Archivo demasiado grande. Máximo: 45 MB." }, 413), status: 413 };
  const detectedMime = await sniffAudioMime(file);
  if (!detectedMime) return { response: json({ error: "El archivo no parece contener audio compatible." }, 400), status: 400 };

  const rawTitle = cleanText(form.get("title"), stripExtension(file.name) || "Sin título", 160);
  const rawArtist = cleanText(form.get("artist"), "Artista desconocido", 160);
  const rawAlbum = cleanText(form.get("album"), "Sin álbum", 160);
  const artist = normalizeArtistDisplay(rawArtist);
  const title = cleanTrackTitle(rawTitle, artist);
  const album = normalizeAlbumDisplay(rawAlbum);
  const year = cleanText(form.get("year"), "", 8); const genre = cleanText(form.get("genre"), "", 80); const trackNumber = cleanText(form.get("track_number"), "", 12);
  const duration = clampNumber(form.get("duration_seconds"), 0, 86400); const safeName = sanitizeFilename(file.name || `${crypto.randomUUID()}.audio`); const mimeType = detectedMime;
  const folderId = await ensureLibraryFolder(env); const token = await getGoogleAccessToken(env);
  const metadata = { name: safeName, parents: [folderId], mimeType, appProperties: { gmusic_track: "1", title: fitAppProperty(title), artist: fitAppProperty(artist), album: fitAppProperty(album), year: fitAppProperty(year), genre: fitAppProperty(genre), track_number: fitAppProperty(trackNumber), duration_seconds: String(duration) } };
  const start = await driveFetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size,createdTime,modifiedTime,appProperties`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8", "x-upload-content-type": mimeType, "x-upload-content-length": String(file.size) }, body: JSON.stringify(metadata) }, env, token);
  if (!start.ok) throw await driveError(start, "Google Drive no pudo iniciar la subida");
  const uploadUrl = start.headers.get("location"); if (!uploadUrl) throw new Error("Google Drive no devolvió la URL de subida");
  const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": mimeType, "content-length": String(file.size) }, body: file.stream() });
  if (!uploaded.ok) throw await driveError(uploaded, "Google Drive no pudo guardar el audio");
  const driveFile = await uploaded.json(); const track = fileToTrack(driveFile); const response = json({ track }, 201);
  return { response, status: 201, auditTitle: title };
}
async function updateTrackMetadata(request, env, id) {
  id = validateDriveId(id); const file = await getTrackMetadata(env, id); if (!file) return json({ error: "Canción no encontrada" }, 404);
  const body = await request.json().catch(() => ({})); const old = file.appProperties || {};
  const artist = normalizeArtistDisplay(cleanText(body.artist, old.artist || "Artista desconocido", 160));
  const title = cleanTrackTitle(cleanText(body.title, old.title || stripExtension(file.name), 160), artist);
  const album = normalizeAlbumDisplay(cleanText(body.album, old.album || "Sin álbum", 160));
  const appProperties = { ...old, title: fitAppProperty(title), artist: fitAppProperty(artist), album: fitAppProperty(album), year: fitAppProperty(cleanText(body.year, old.year || "", 8)), genre: fitAppProperty(cleanText(body.genre, old.genre || "", 80)), track_number: fitAppProperty(cleanText(body.track_number, old.track_number || "", 12)) };
  const token = await getGoogleAccessToken(env); const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,createdTime,modifiedTime,appProperties`, { method: "PATCH", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ appProperties }) }, env, token);
  if (!response.ok) throw await driveError(response, "No se pudo actualizar la metadata");
  const track = fileToTrack(await response.json()); return json({ track });
}
async function trashTrack(env, id) {
  id = validateDriveId(id); const file = await getTrackMetadata(env, id); if (!file) return json({ error: "Canción no encontrada" }, 404);
  const token = await getGoogleAccessToken(env); const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,trashed`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) }, env, token);
  if (!response.ok) throw await driveError(response, "No se pudo enviar la canción a la papelera"); return json({ ok: true, trashed: true });
}
async function listTrash(env) {
  const folderId = await ensureLibraryFolder(env); const token = await getGoogleAccessToken(env);
  const q = `'${folderId}' in parents and trashed = true and appProperties has { key='gmusic_track' and value='1' }`;
  const files = await listDriveFiles(env, token, q, "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,appProperties)");
  return json({ tracks: files.map(fileToTrack) });
}
async function restoreTrack(env, id) {
  id = validateDriveId(id); const token = await getGoogleAccessToken(env); const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,createdTime,modifiedTime,appProperties`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: false }) }, env, token);
  if (!response.ok) throw await driveError(response, "No se pudo restaurar la canción"); return json({ ok: true, track: fileToTrack(await response.json()) });
}
async function permanentDeleteTrack(env, id) {
  id = validateDriveId(id); const token = await getGoogleAccessToken(env); const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}`, { method: "DELETE" }, env, token);
  if (!response.ok && response.status !== 404) throw await driveError(response, "No se pudo eliminar definitivamente"); return json({ ok: true });
}
async function createPlaybackUrl(env, id) {
  // No hacemos una consulta redundante a Drive aquí: /stream valida que el ID siga siendo
  // una pista válida dentro de la biblioteca antes de entregar un solo byte de audio.
  id = validateDriveId(id);
  const exp = Math.floor(Date.now() / 1000) + PLAYBACK_URL_MINUTES * 60; const sig = await signPlayback(id, exp, normalizedAppToken(env));
  return json({ url: `/api/tracks/${encodeURIComponent(id)}/stream?exp=${exp}&sig=${encodeURIComponent(sig)}`, expires_at: exp });
}
async function validSignedPlaybackUrl(url, env) {
  const secret = normalizedAppToken(env); if (!secret) return false; const now = Math.floor(Date.now() / 1000); const exp = Number(url.searchParams.get("exp")); const sig = url.searchParams.get("sig") || "";
  if (!Number.isFinite(exp) || exp < now || exp > now + (PLAYBACK_URL_MINUTES + 2) * 60 || !sig) return false;
  const match = url.pathname.match(/^\/api\/tracks\/([^/]+)\/stream$/); if (!match) return false; const id = decodeURIComponent(match[1]); if (!validDriveId(id)) return false;
  return safeEqual(sig, await signPlayback(id, exp, secret));
}
async function signPlayback(id, exp, secret) { return signValue(`${id}:${exp}`, secret); }
async function deriveOfflineScope(sub, secret) { return (await signValue(`offline:${sub}`, secret)).slice(0, 24); }
async function streamTrack(request, env, id) {
  id = validateDriveId(id); const file = await getTrackMetadata(env, id); if (!file) return json({ error: "Audio no encontrado" }, 404);
  const token = await getGoogleAccessToken(env); const headers = {}; const range = request.headers.get("range"); if (range) headers.range = range;
  const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`, { method: "GET", headers }, env, token);
  if (response.status === 404) return json({ error: "Audio no encontrado" }, 404);
  if (!response.ok && response.status !== 206) throw await driveError(response, "No se pudo reproducir el audio");
  const out = new Headers(); for (const name of ["content-type", "content-length", "content-range", "etag", "last-modified"]) { const value = response.headers.get(name); if (value) out.set(name, value); }
  out.set("accept-ranges", "bytes"); out.set("cache-control", "private, max-age=600"); out.set("x-content-type-options", "nosniff"); return new Response(response.body, { status: response.status, headers: out });
}
async function getTrackMetadata(env, id) {
  if (!validDriveId(id)) return null; const token = await getGoogleAccessToken(env); const fields = "id,name,mimeType,size,createdTime,modifiedTime,trashed,parents,appProperties";
  const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, { method: "GET" }, env, token);
  if (response.status === 404) return null; if (!response.ok) throw await driveError(response, "No se pudo consultar la canción");
  const file = await response.json(); if (file.trashed || file.appProperties?.gmusic_track !== "1") return null; const folderId = await ensureLibraryFolder(env); if (!Array.isArray(file.parents) || !file.parents.includes(folderId)) return null; return file;
}
async function ensureLibraryFolder(env) {
  const now = Date.now();
  if (libraryFolderCache.id && libraryFolderCache.expiresAt > now) return libraryFolderCache.id;
  const token = await getGoogleAccessToken(env); const q = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='gmusic_library' and value='1' }`;
  const params = new URLSearchParams({ q, spaces: "drive", pageSize: "10", fields: "files(id,name,appProperties)" }); const response = await driveFetch(`${DRIVE_API}/files?${params}`, { method: "GET" }, env, token);
  if (!response.ok) throw await driveError(response, "No se pudo buscar la carpeta de GMusic"); const data = await response.json();
  if (data.files?.length) { libraryFolderCache = { id: data.files[0].id, expiresAt: now + 10 * 60_000 }; return data.files[0].id; }
  const create = await driveFetch(`${DRIVE_API}/files?fields=id,name`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ name: LIBRARY_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder", appProperties: { gmusic_library: "1" } }) }, env, token);
  if (!create.ok) throw await driveError(create, "No se pudo crear la carpeta de GMusic");
  const created = await create.json(); libraryFolderCache = { id: created.id, expiresAt: now + 10 * 60_000 }; return created.id;
}
async function sniffAudioMime(file) {
  const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer()); const ascii = (...idx) => String.fromCharCode(...idx.map(i => bytes[i] || 0));
  if (ascii(0,1,2) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0,1,2,3) === "fLaC") return "audio/flac";
  if (ascii(0,1,2,3) === "OggS") return "audio/ogg";
  if (ascii(0,1,2,3) === "RIFF" && ascii(8,9,10,11) === "WAVE") return "audio/wav";
  if (ascii(4,5,6,7) === "ftyp") return "audio/mp4";
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "audio/aac";
  return null;
}
function fileToTrack(file, canonical = null) {
  const p = file.appProperties || {};
  const rawArtist = p.artist || "Artista desconocido";
  const rawAlbum = p.album || "Sin álbum";
  const artistParts = splitArtistNames(rawArtist);
  const artistNames = (artistParts.length ? artistParts : [rawArtist]).map((name) => canonical?.artists?.get(normalizeArtistKey(name)) || normalizeArtistDisplay(name));
  const artist = artistNames.join(", ");
  const albumKey = normalizeAlbumKey(rawAlbum);
  const album = canonical?.albums?.get(albumKey) || normalizeAlbumDisplay(rawAlbum);
  const rawTitle = p.title || stripExtension(file.name) || "Sin título";
  const title = cleanTrackTitle(rawTitle, artist);
  return {
    id: file.id, title, artist, album,
    artist_key: artistNames.map(normalizeArtistKey).join("|") || normalizeArtistKey(artist),
    artist_ids: artistNames.map((name) => stableEntityId("artist", normalizeArtistKey(name))),
    artist_names: artistNames,
    album_key: albumKey, album_id: stableEntityId("album", `${normalizeArtistKey(artistNames[0] || artist)}|${albumKey}`),
    year: p.year || "", genre: p.genre || "", track_number: p.track_number || "", release_type: p.release_type || "", mb_recording_id: p.mb_recording_id || "", mb_release_id: p.mb_release_id || "", cover_release_id: p.cover_release_id || p.mb_release_id || "", duration_seconds: Number(p.duration_seconds || 0), mime_type: file.mimeType || "application/octet-stream", size_bytes: Number(file.size || 0), created_at: file.createdTime || new Date().toISOString(), modified_at: file.modifiedTime || file.createdTime || new Date().toISOString(), stream_url: `/api/tracks/${encodeURIComponent(file.id)}/stream`
  };
}
function validDriveId(value) { return /^[A-Za-z0-9_-]{10,200}$/.test(String(value || "")); }
function validateDriveId(value) { if (!validDriveId(value)) throw new HttpError(400, "ID de canción inválido."); return String(value); }


// ---------- Normalización segura de metadata ----------
function normalizeUnicodeText(value) { return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function comparisonKey(value) { return normalizeUnicodeText(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[’‘`´]/g, "'").replace(/\s+/g, " ").trim(); }
function normalizeArtistKey(value) { return comparisonKey(value).replace(/\s*&\s*/g, " & ").replace(/\s+/g, " "); }
function normalizeAlbumKey(value) { return comparisonKey(value); }
function normalizeArtistDisplay(value) { return normalizeUnicodeText(value) || "Artista desconocido"; }
function normalizeAlbumDisplay(value) { return normalizeUnicodeText(value) || "Sin álbum"; }
function splitArtistNames(value) {
  const text = normalizeUnicodeText(value);
  if (!text) return [];
  // Conservador: separadores explícitos de colaboración. No se divide una simple "x" dentro de palabras.
  return text.split(/\s*(?:,|\s+&\s+|\s+[xX×]\s+|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i).map(normalizeUnicodeText).filter(Boolean);
}
function metadataVariantScore(value) {
  const text = normalizeUnicodeText(value); if (!text) return -1;
  let score = 0;
  if (/[a-záéíóúñ]/.test(text) && /[A-ZÁÉÍÓÚÑ]/.test(text)) score += 8;
  if (!/^[A-ZÁÉÍÓÚÑ0-9 .&'/-]+$/.test(text) && !/^[a-záéíóúñ0-9 .&'/-]+$/.test(text)) score += 3;
  if (text === text.toLocaleUpperCase("es") || text === text.toLocaleLowerCase("es")) score -= 1;
  score += Math.min(text.length, 40) / 100;
  return score;
}
function chooseDisplayName(variants, fallback) {
  const counts = new Map();
  for (const v of variants) { const t = normalizeUnicodeText(v); if (t) counts.set(t, (counts.get(t) || 0) + 1); }
  return [...counts.entries()].sort((a,b) => (b[1]-a[1]) || (metadataVariantScore(b[0])-metadataVariantScore(a[0])) || a[0].localeCompare(b[0], "es"))[0]?.[0] || fallback;
}
function buildCanonicalMetadata(files) {
  const artistVariants = new Map(), albumVariants = new Map();
  for (const file of files) {
    const p = file.appProperties || {};
    for (const part of splitArtistNames(p.artist || "Artista desconocido")) {
      const key = normalizeArtistKey(part); if (!key) continue;
      if (!artistVariants.has(key)) artistVariants.set(key, []); artistVariants.get(key).push(part);
    }
    const album = normalizeAlbumDisplay(p.album || "Sin álbum"), akey = normalizeAlbumKey(album);
    if (akey) { if (!albumVariants.has(akey)) albumVariants.set(akey, []); albumVariants.get(akey).push(album); }
  }
  return {
    artists: new Map([...artistVariants].map(([k,v]) => [k, chooseDisplayName(v, v[0] || "Artista desconocido")])),
    albums: new Map([...albumVariants].map(([k,v]) => [k, chooseDisplayName(v, v[0] || "Sin álbum")]))
  };
}
function cleanTrackTitle(value, artist = "") {
  let title = normalizeUnicodeText(value) || "Sin título";
  const junk = String.raw`(?:official\s+music\s+video|official\s+video|official\s+audio|official\s+visuali[sz]er|official\s+lyric(?:s)?\s+video|official\s+lyrics?|music\s+video|video\s+oficial|vídeo\s+oficial|audio\s+oficial|lyric(?:s)?\s+video|visuali[sz]er|lyrics?|letras?|audio|video|official|hd|hq|4k)`;
  const bracket = new RegExp(String.raw`\s*[\(\[\{]\s*${junk}\s*[\)\]\}]\s*`, "gi");
  const suffix = new RegExp(String.raw`\s*(?:[-–—|•·:]+)\s*${junk}\s*$`, "i");
  let previous;
  do { previous = title; title = title.replace(bracket, " ").replace(suffix, " ").replace(/\s+/g, " ").trim(); } while (title !== previous);
  const artistKey = comparisonKey(artist);
  if (artistKey) {
    const sep = title.match(/^(.+?)\s*[-–—|:]\s*(.+)$/);
    if (sep && comparisonKey(sep[1]) === artistKey) title = sep[2].trim();
  }
  return title.replace(/\s*[-–—|:]+\s*$/g, "").replace(/\s+/g, " ").trim() || "Sin título";
}
function stableEntityId(prefix, key) {
  let h = 2166136261;
  for (const ch of String(key || "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return `${prefix}_${(h >>> 0).toString(36)}`;
}
function buildMetadataCleanupPlan(files) {
  const canonical = buildCanonicalMetadata(files); const changes = [];
  for (const file of files) {
    const p = file.appProperties || {}; const before = { title: p.title || stripExtension(file.name) || "Sin título", artist: p.artist || "Artista desconocido", album: p.album || "Sin álbum" };
    const parts = splitArtistNames(before.artist); const afterArtist = (parts.length ? parts : [before.artist]).map(x => canonical.artists.get(normalizeArtistKey(x)) || normalizeArtistDisplay(x)).join(", ");
    const after = { title: cleanTrackTitle(before.title, afterArtist), artist: afterArtist, album: canonical.albums.get(normalizeAlbumKey(before.album)) || normalizeAlbumDisplay(before.album) };
    const fields = Object.keys(after).filter(k => normalizeUnicodeText(before[k]) !== normalizeUnicodeText(after[k]));
    if (fields.length) changes.push({ id: file.id, name: file.name, before, after, fields });
  }
  const artistGroups = new Map();
  for (const file of files) for (const part of splitArtistNames(file.appProperties?.artist || "Artista desconocido")) {
    const key = normalizeArtistKey(part); if (!artistGroups.has(key)) artistGroups.set(key, new Map()); const m=artistGroups.get(key); m.set(part,(m.get(part)||0)+1);
  }
  const duplicate_artists = [...artistGroups.entries()].filter(([,m])=>m.size>1).map(([key,m])=>({ key, display: canonical.artists.get(key), variants:[...m.entries()].map(([name,count])=>({name,count})) }));
  return { canonical, changes, duplicate_artists };
}
async function getLibraryFilesForMetadata(env) {
  const folderId = await ensureLibraryFolder(env); const token = await getGoogleAccessToken(env);
  const q = `'${folderId}' in parents and trashed = false and appProperties has { key='gmusic_track' and value='1' }`;
  return await listDriveFiles(env, token, q, "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,appProperties)");
}
async function auditLibraryMetadata(env) {
  const files = await getLibraryFilesForMetadata(env); const plan = buildMetadataCleanupPlan(files);
  const missingAlbum = files.filter(f => isUnknownAlbumName(f.appProperties?.album || "")).length;
  const missingArtist = files.filter(f => normalizeLookup(f.appProperties?.artist || "") === "artista desconocido").length;
  return json({ ok:true, tracks:files.length, changes:plan.changes, change_count:plan.changes.length, duplicate_artists:plan.duplicate_artists, missing_album:missingAlbum, missing_artist:missingArtist });
}
async function applyLibraryCleanup(request, env, user) {
  const body = await request.json().catch(()=>({})); const apply = body.apply === true;
  const files = await getLibraryFilesForMetadata(env); const plan = buildMetadataCleanupPlan(files);
  if (!apply) return json({ ok:true, dry_run:true, changes:plan.changes, duplicate_artists:plan.duplicate_artists });
  if (!plan.changes.length) return json({ ok:true, applied:0, backup_key:null });
  if(!env.USERDATA)return json({error:"No se puede aplicar la limpieza sin USERDATA: el respaldo obligatorio no está disponible."},503);
  const changedFiles=plan.changes.map(c=>files.find(f=>f.id===c.id)).filter(Boolean);
  const backupKey=await writeMetadataBackup(env,{version:VERSION,created_at:new Date().toISOString(),kind:"library-cleanup",items:changedFiles.map(f=>({id:f.id,file_name:f.name,appProperties:f.appProperties||{}}))},"cleanup");
  const applied=[];
  try{
    for(const change of plan.changes){
      const file=files.find(f=>f.id===change.id);if(!file)continue;
      const old=file.appProperties||{};
      const appProperties={...old,title:fitAppProperty(change.after.title),artist:fitAppProperty(change.after.artist),album:fitAppProperty(change.after.album)};
      await patchTrackAppProperties(env,change.id,appProperties);applied.push(change.id);
    }
  }catch{
    const rollbackFailed=[];
    for(const id of [...applied].reverse()){
      const file=files.find(f=>f.id===id);try{await patchTrackAppProperties(env,id,file?.appProperties||{});}catch{rollbackFailed.push(id);}
    }
    if(rollbackFailed.length)return json({error:"La limpieza falló y algunas canciones no pudieron restaurarse automáticamente. Conserva el backup_key.",backup_key:backupKey,rollback_failed:rollbackFailed},500);
    return json({error:"La limpieza no pudo completarse. Los cambios aplicados fueron restaurados automáticamente.",backup_key:backupKey,rolled_back:true},409);
  }
  await logAudit(env,user,"library.metadata_cleanup",{applied:applied.length,backup_key:backupKey});
  return json({ok:true,applied:applied.length,failed:[],backup_key:backupKey,total_planned:plan.changes.length});
}

// ---------- Metadata Intelligence (MusicBrainz + Cover Art Archive) ----------
function escapeLucene(value) {
  return String(value || "").replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1").trim();
}
function normalizedSimilarity(a, b) {
  const x = normalizeLookup(a), y = normalizeLookup(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = new Set(x.split(" ").filter(Boolean)), B = new Set(y.split(" ").filter(Boolean));
  const union = new Set([...A, ...B]); let same = 0; for (const t of A) if (B.has(t)) same++;
  return union.size ? same / union.size : 0;
}
function durationSimilarity(localSeconds, remoteMs) {
  const local = Number(localSeconds || 0), remote = Number(remoteMs || 0) / 1000;
  if (!local || !remote) return 0;
  const diff = Math.abs(local - remote);
  if (diff <= 2) return 1;
  if (diff <= 5) return .8;
  if (diff <= 10) return .45;
  return 0;
}
function chooseMusicBrainzRelease(recording, local) {
  const releases = Array.isArray(recording?.releases) ? recording.releases : [];
  if (!releases.length) return null;
  const localAlbum = normalizeLookup(local.album || "");
  const ranked = releases.map((r) => {
    const rg = r["release-group"] || {};
    const primary = String(rg["primary-type"] || "").toLowerCase();
    const secondary = Array.isArray(rg["secondary-types"]) ? rg["secondary-types"].map(x=>String(x).toLowerCase()) : [];
    let score = 0;
    if (String(r.status || "").toLowerCase() === "official") score += 18;
    if (primary === "album") score += 12; else if (primary === "single") score += 9; else if (primary === "ep") score += 8;
    if (secondary.some(x => ["compilation","dj-mix","mixtape/street","remix"].includes(x))) score -= 18;
    const titleSim = localAlbum && !isUnknownAlbumName(local.album) ? normalizedSimilarity(local.album, r.title) : 0;
    score += titleSim * 20;
    if (r.date && /^\d{4}/.test(r.date)) score += 2;
    return { r, score, primary };
  }).sort((a,b)=>b.score-a.score || String(a.r.date||"9999").localeCompare(String(b.r.date||"9999")));
  return ranked[0] || null;
}
function scoreMusicBrainzCandidate(recording, local) {
  const titleSim = normalizedSimilarity(local.title, recording.title);
  const artistCredit = (recording["artist-credit"] || []).map(x => x?.artist?.name || x?.name || "").filter(Boolean).join(", ");
  const artistSim = Math.max(normalizedSimilarity(local.artist, artistCredit), ...splitArtistNames(local.artist).map(a=>normalizedSimilarity(a, artistCredit)));
  const durationSim = durationSimilarity(local.duration_seconds, recording.length);
  const release = chooseMusicBrainzRelease(recording, local);
  let score = Math.round(titleSim * 40 + artistSim * 35 + durationSim * 15);
  if (release && local.album && !isUnknownAlbumName(local.album)) score += Math.round(normalizedSimilarity(local.album, release.r.title) * 5);
  if (release?.r?.date && local.year && String(release.r.date).startsWith(String(local.year))) score += 5;
  score = Math.max(0, Math.min(100, score));
  const releaseType = release?.r?.["release-group"]?.["primary-type"] || release?.primary || "";
  const year = String(release?.r?.date || "").match(/^\d{4}/)?.[0] || "";
  return {
    score,
    status: score >= 90 ? "high" : score >= 70 ? "review" : "low",
    proposal: {
      title: normalizeUnicodeText(recording.title || local.title),
      artist: normalizeArtistDisplay(artistCredit || local.artist),
      album: normalizeAlbumDisplay(release?.r?.title || local.album || "Sin álbum"),
      year,
      track_number: "",
      release_type: cleanText(releaseType, "", 40),
      mb_recording_id: /^[0-9a-f-]{36}$/i.test(String(recording.id||"")) ? String(recording.id) : "",
      mb_release_id: /^[0-9a-f-]{36}$/i.test(String(release?.r?.id||"")) ? String(release.r.id) : "",
      cover_release_id: /^[0-9a-f-]{36}$/i.test(String(release?.r?.id||"")) ? String(release.r.id) : "",
      duration_seconds: recording.length ? Math.round(Number(recording.length)/1000) : Number(local.duration_seconds||0)
    }
  };
}
async function musicBrainzFetch(url) {
  const task = musicBrainzQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - musicBrainzLastRequestAt));
    if (wait) await new Promise(r => setTimeout(r, wait));
    musicBrainzLastRequestAt = Date.now();
    const response = await fetch(url, { headers: { "user-agent": `GMusic/${VERSION} (personal music library)`, "accept": "application/json" } });
    if (!response.ok) throw new HttpError(response.status === 503 ? 503 : 502, "El servicio de metadata no está disponible temporalmente.");
    return response;
  });
  musicBrainzQueue = task.then(()=>undefined,()=>undefined);
  return task;
}
async function searchTrackMetadata(url, env) {
  const id = validateDriveId(url.searchParams.get("id"));
  const refresh = url.searchParams.get("refresh") === "1";
  const file = await getTrackMetadata(env, id); if (!file) return json({ error:"Canción no encontrada" },404);
  const local = fileToTrack(file);
  const title = cleanTrackTitle(local.title, local.artist), artist = normalizeArtistDisplay(local.artist);
  const cache = caches.default;
  const cacheUrl = `https://gmusic-metadata.local/v2/${encodeURIComponent(normalizeArtistKey(artist))}/${encodeURIComponent(comparisonKey(title))}/${Math.round(Number(local.duration_seconds||0))}`;
  const cacheKey = new Request(cacheUrl);
  if (!refresh) { const cached = await cache.match(cacheKey); if (cached) return cached; }
  const query = `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(primaryArtistName(artist))}"`;
  const endpoint = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=8`;
  let data;
  try { data = await (await musicBrainzFetch(endpoint)).json(); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(502,"No pudimos consultar metadata en este momento."); }
  const rows = (Array.isArray(data?.recordings) ? data.recordings : []).map(r => ({ recording:r, ...scoreMusicBrainzCandidate(r, local) })).sort((a,b)=>b.score-a.score).slice(0,5);
  const candidates = rows.map(({recording,score,status,proposal})=>({ score,status,proposal, source_score:Number(recording.score||0) }));
  const resultData = { ok:true, source:"MusicBrainz", track:{ id:local.id,title:local.title,artist:local.artist,album:local.album,year:local.year,duration_seconds:local.duration_seconds }, best:candidates[0]||null, candidates };
  const response = json(resultData); response.headers.set("cache-control","public, max-age=604800");
  if (candidates.length) await cache.put(cacheKey,response.clone()).catch(()=>{});
  return response;
}
function primaryArtistName(value) { return splitArtistNames(value)[0] || normalizeArtistDisplay(value); }
async function lookupMusicBrainzTrackNumber(releaseId, recordingId) {
  if(!/^[0-9a-f-]{36}$/i.test(String(releaseId||"")) || !/^[0-9a-f-]{36}$/i.test(String(recordingId||""))) return "";
  try {
    const endpoint=`https://musicbrainz.org/ws/2/release/${encodeURIComponent(releaseId)}?inc=recordings&fmt=json`;
    const data=await (await musicBrainzFetch(endpoint)).json();
    for(const medium of (data?.media||[])) for(const track of (medium?.tracks||[])) if(String(track?.recording?.id||"")===String(recordingId)) return cleanText(track.number || track.position || "", "", 12);
  } catch {}
  return "";
}
function buildMetadataAppProperties(file, proposal = {}) {
  const old = file.appProperties || {};
  const artist = normalizeArtistDisplay(cleanText(proposal.artist, old.artist || "Artista desconocido",160));
  const title = cleanTrackTitle(cleanText(proposal.title, old.title || stripExtension(file.name),160),artist);
  const album = normalizeAlbumDisplay(cleanText(proposal.album, old.album || "Sin álbum",160));
  const uuid = (v)=>/^[0-9a-f-]{36}$/i.test(String(v||""))?String(v):"";
  return {
    ...old,
    title:fitAppProperty(title),artist:fitAppProperty(artist),album:fitAppProperty(album),
    year:fitAppProperty(cleanText(proposal.year,old.year||"",8)),
    track_number:fitAppProperty(cleanText(proposal.track_number,old.track_number||"",12)),
    release_type:fitAppProperty(cleanText(proposal.release_type,old.release_type||"",40)),
    mb_recording_id:fitAppProperty(uuid(proposal.mb_recording_id)||old.mb_recording_id||""),
    mb_release_id:fitAppProperty(uuid(proposal.mb_release_id)||old.mb_release_id||""),
    cover_release_id:fitAppProperty(uuid(proposal.cover_release_id)||uuid(proposal.mb_release_id)||old.cover_release_id||"")
  };
}
async function patchTrackAppProperties(env, id, appProperties) {
  const token=await getGoogleAccessToken(env);
  const response=await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,createdTime,modifiedTime,appProperties`,{method:"PATCH",headers:{"content-type":"application/json; charset=utf-8"},body:JSON.stringify({appProperties})},env,token);
  if(!response.ok) throw await driveError(response,"No se pudo aplicar la metadata");
  return await response.json();
}
async function writeMetadataBackup(env, payload, label="proposal") {
  if(!env.USERDATA) throw new HttpError(503,"No se puede modificar metadata sin USERDATA: el respaldo obligatorio no está disponible.");
  const backupKey=`backup:metadata:${label}:${new Date().toISOString()}:${crypto.randomUUID()}`;
  try {
    await env.USERDATA.put(backupKey,JSON.stringify(payload),{expirationTtl:90*24*60*60});
  } catch {
    throw new HttpError(503,"No se pudo crear el respaldo de metadata. No se modificó ninguna canción.");
  }
  return backupKey;
}
async function applyMetadataProposal(request, env, user) {
  const body = await request.json().catch(()=>({}));
  const id = validateDriveId(body.id); const proposal = body.proposal && typeof body.proposal === "object" ? {...body.proposal} : {};
  if(!proposal.track_number && proposal.mb_release_id && proposal.mb_recording_id) proposal.track_number = await lookupMusicBrainzTrackNumber(proposal.mb_release_id, proposal.mb_recording_id);
  const file = await getTrackMetadata(env,id); if(!file) return json({error:"Canción no encontrada"},404);
  const appProperties=buildMetadataAppProperties(file,proposal);
  const backupKey=await writeMetadataBackup(env,{version:VERSION,created_at:new Date().toISOString(),items:[{id,file_name:file.name,appProperties:file.appProperties||{}}]},"proposal");
  const updated=await patchTrackAppProperties(env,id,appProperties);
  await logAudit(env,user,"track.metadata_intelligence",{id,source:"MusicBrainz",backup_key:backupKey});
  return json({ok:true,track:fileToTrack(updated),backup_key:backupKey});
}
async function applyMetadataBatch(request, env, user) {
  if(!env.USERDATA) return json({error:"No se puede aplicar un lote sin USERDATA: el respaldo obligatorio no está disponible."},503);
  const body=await request.json().catch(()=>({}));
  const items=Array.isArray(body.items)?body.items.slice(0,200):[];
  if(!items.length)return json({error:"No hay propuestas de metadata para aplicar."},400);
  const prepared=[];
  for(const item of items){
    let id;try{id=validateDriveId(item?.id)}catch{return json({error:"Una canción del lote tiene un ID inválido."},400)}
    const proposal=item?.proposal&&typeof item.proposal==="object"?{...item.proposal}:{};
    if(!proposal.track_number&&proposal.mb_release_id&&proposal.mb_recording_id)proposal.track_number=await lookupMusicBrainzTrackNumber(proposal.mb_release_id,proposal.mb_recording_id);
    const file=await getTrackMetadata(env,id);if(!file)return json({error:"Una canción del lote ya no existe en la biblioteca.",id},404);
    prepared.push({id,file,proposal,appProperties:buildMetadataAppProperties(file,proposal)});
  }
  const backupPayload={version:VERSION,created_at:new Date().toISOString(),kind:"metadata-batch",items:prepared.map(x=>({id:x.id,file_name:x.file.name,appProperties:x.file.appProperties||{}}))};
  const backupKey=await writeMetadataBackup(env,backupPayload,"batch");
  const applied=[];
  try{
    for(const item of prepared){
      const updated=await patchTrackAppProperties(env,item.id,item.appProperties);
      applied.push({id:item.id,track:fileToTrack(updated)});
    }
  }catch(error){
    const rollbackFailed=[];
    for(const done of [...applied].reverse()){
      const original=prepared.find(x=>x.id===done.id);
      try{await patchTrackAppProperties(env,done.id,original?.file?.appProperties||{});}catch{rollbackFailed.push(done.id);}
    }
    if(rollbackFailed.length){
      await logAudit(env,user,"track.metadata_batch.rollback_failed",{backup_key:backupKey,failed_count:rollbackFailed.length});
      return json({error:"El lote falló y algunas canciones no pudieron restaurarse automáticamente. Conserva el backup_key para recuperación.",backup_key:backupKey,rollback_failed:rollbackFailed},500);
    }
    return json({error:"El lote no pudo completarse. Los cambios ya aplicados fueron restaurados automáticamente.",backup_key:backupKey,rolled_back:true},409);
  }
  await logAudit(env,user,"track.metadata_batch",{backup_key:backupKey,count:applied.length,source:"MusicBrainz"});
  return json({ok:true,applied:applied.length,items:applied,backup_key:backupKey});
}
async function proxyMusicBrainzCover(url) {
  const release = String(url.searchParams.get("release")||"");
  if(!/^[0-9a-f-]{36}$/i.test(release)) return new Response(null,{status:404});
  const size = ["250","500","1200"].includes(url.searchParams.get("size")) ? url.searchParams.get("size") : "500";
  const cache=caches.default; const key=new Request(`https://gmusic-cover.local/${release}/${size}`); const hit=await cache.match(key); if(hit)return hit;
  try{
    const r=await fetch(`https://coverartarchive.org/release/${encodeURIComponent(release)}/front-${size}`,{headers:{"user-agent":`GMusic/${VERSION} (personal music library)`},redirect:"follow"});
    if(!r.ok)return new Response(null,{status:404});
    const headers=new Headers({"content-type":r.headers.get("content-type")||"image/jpeg","cache-control":"public, max-age=604800","x-content-type-options":"nosniff"});
    const out=new Response(r.body,{status:200,headers}); await cache.put(key,out.clone()).catch(()=>{}); return out;
  }catch{return new Response(null,{status:404});}
}

// ---------- GMusic v3.4: Artist Intelligence + Music Requests ----------
const REQUEST_STATUSES = new Set(["requested","review","available","not_found","discarded"]);
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_SEARCH_CACHE_SECONDS = 12 * 60 * 60;
const YOUTUBE_LISTEN_MIN_SECONDS = 30;
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
const ARTIST_IMAGE_MAX_BYTES = 1500 * 1024;

async function listKvJson(env, prefix, limit = 1000) {
  if (!env.USERDATA) return [];
  const rows = []; let cursor;
  do {
    const page = await env.USERDATA.list({ prefix, cursor, limit: Math.min(1000, Math.max(1, limit - rows.length)) });
    for (const key of page.keys || []) {
      const raw = await env.USERDATA.get(key.name);
      if (!raw) continue;
      try { rows.push({ key: key.name, value: JSON.parse(raw) }); } catch {}
      if (rows.length >= limit) break;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && rows.length < limit);
  return rows;
}
async function getLibraryTrackArray(env) {
  const files = await getLibraryFilesForMetadata(env);
  const canonical = buildCanonicalMetadata(files);
  return files.map(f => fileToTrack(f, canonical));
}
function versionMarkers(value) {
  const k = normalizeLookup(value);
  const terms = ["remix","live","acoustic","acustico","acustica","remaster","remastered","extended","radio edit","sped up","slowed","instrumental","karaoke"];
  return terms.filter(x => k.includes(x)).sort().join("|");
}
function compareRequestedTrack(input, track) {
  const reqTitle = cleanTrackTitle(input.title || "", input.artist || "");
  const localTitle = cleanTrackTitle(track.title || "", track.artist || "");
  const titleExact = comparisonKey(reqTitle) === comparisonKey(localTitle);
  const titleSim = normalizedSimilarity(reqTitle, localTitle);
  const reqArtists = splitArtistNames(input.artist || "");
  const localArtists = splitArtistNames(track.artist || "");
  const artistExact = reqArtists.length && reqArtists.every(a => localArtists.some(b => normalizeArtistKey(a) === normalizeArtistKey(b)));
  const artistSim = Math.max(0, ...reqArtists.map(a => Math.max(0, ...localArtists.map(b => normalizedSimilarity(a,b)))));
  const reqVariant = versionMarkers(input.title || ""); const trackVariant = versionMarkers(track.title || "");
  const variantConflict = reqVariant !== trackVariant && Boolean(reqVariant || trackVariant);
  const albumSim = input.album && !isUnknownAlbumName(input.album) && track.album && !isUnknownAlbumName(track.album) ? normalizedSimilarity(input.album, track.album) : 0;
  let score = Math.round(titleSim * 58 + artistSim * 34 + albumSim * 8);
  if (titleExact) score += 6;
  if (artistExact) score += 5;
  if (variantConflict) score -= 28;
  score = Math.max(0, Math.min(100, score));
  return { score, exact: titleExact && artistExact && !variantConflict, variant_conflict: variantConflict };
}
function findLibraryRequestMatch(input, tracks) {
  const ranked = tracks.map(track => ({ track, ...compareRequestedTrack(input, track) })).sort((a,b)=>b.score-a.score);
  const best = ranked[0] || null;
  return { best, status: best?.exact || best?.score >= 94 ? "available" : best?.score >= 74 ? "review" : "missing", candidates: ranked.slice(0,5) };
}
async function identifyMusicRequest(request, env) {
  const body = await request.json().catch(()=>({}));
  const input = { title: cleanText(body.title,"",160), artist: normalizeArtistDisplay(cleanText(body.artist,"",160)), album: normalizeAlbumDisplay(cleanText(body.album,"Sin álbum",160)) };
  if (!input.title || !input.artist || normalizeLookup(input.artist)==="artista desconocido") return json({ error:"Escribe título y artista." },400);
  const tracks = await getLibraryTrackArray(env); const local = findLibraryRequestMatch(input, tracks);
  if (local.status === "available") return json({ ok:true, status:"available", match:local.best.track, score:local.best.score });
  let external = null;
  try {
    const query = `recording:"${escapeLucene(cleanTrackTitle(input.title,input.artist))}" AND artist:"${escapeLucene(primaryArtistName(input.artist))}"`;
    const data = await (await musicBrainzFetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`)).json();
    const rows = (data.recordings || []).map(r=>({ recording:r, ...scoreMusicBrainzCandidate(r,{...input,duration_seconds:0}) })).sort((a,b)=>b.score-a.score);
    if (rows[0] && rows[0].score >= 65) external = { score:rows[0].score, status:rows[0].status, ...rows[0].proposal };
  } catch {}
  return json({ ok:true, status:local.status, possible_local:local.status==="review"?local.best:null, suggestion:external, normalized:input });
}
async function listOwnMusicRequests(env, user) {
  const rows = (await listKvJson(env, `musicreq:${user.sub}:`, 500)).map(x=>x.value).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  return json({ requests: rows.map(publicMusicRequest) });
}
function publicMusicRequest(r) { return { id:r.id,title:r.title,artist:r.artist,album:r.album||"",status:r.status||"requested",created_at:r.created_at||"",updated_at:r.updated_at||"",available_track_id:r.available_track_id||"" }; }
async function createMusicRequest(request, env, user) {
  if (!env.USERDATA) return json({ error:"Falta configurar USERDATA KV." },503);
  const body = await request.json().catch(()=>({}));
  const input = { title:cleanTrackTitle(cleanText(body.title,"",160),cleanText(body.artist,"",160)), artist:normalizeArtistDisplay(cleanText(body.artist,"",160)), album:normalizeAlbumDisplay(cleanText(body.album,"Sin álbum",160)) };
  if (!input.title || !input.artist || normalizeLookup(input.artist)==="artista desconocido") return json({ error:"Escribe título y artista." },400);
  const tracks = await getLibraryTrackArray(env); const local = findLibraryRequestMatch(input,tracks);
  if (local.status === "available") return json({ ok:true, already_available:true, track:local.best.track });
  const existing = await listKvJson(env,`musicreq:${user.sub}:`,500);
  const duplicate = existing.map(x=>x.value).find(r=>["requested","review"].includes(r.status)&&comparisonKey(r.title)===comparisonKey(input.title)&&normalizeArtistKey(r.artist)===normalizeArtistKey(input.artist));
  if (duplicate) return json({ ok:true, duplicate:true, request:publicMusicRequest(duplicate) });
  const now=new Date().toISOString(), id=crypto.randomUUID();
  const row={id,owner_sub:user.sub,title:input.title,artist:input.artist,album:isUnknownAlbumName(input.album)?"":input.album,status:local.status==="review"?"review":"requested",created_at:now,updated_at:now,source:"manual",mb_recording_id:cleanText(body.mb_recording_id,"",40),mb_release_id:cleanText(body.mb_release_id,"",40)};
  await env.USERDATA.put(`musicreq:${user.sub}:${id}`,JSON.stringify(row));
  return json({ ok:true,request:publicMusicRequest(row) },201);
}
async function cancelOwnMusicRequest(env,user,id){
  if(!env.USERDATA||!/^[0-9a-f-]{36}$/i.test(id))return json({error:"Solicitud no encontrada."},404);
  const key=`musicreq:${user.sub}:${id}`,raw=await env.USERDATA.get(key);if(!raw)return json({error:"Solicitud no encontrada."},404);
  let row;try{row=JSON.parse(raw)}catch{return json({error:"Solicitud no encontrada."},404)}
  if(row.status==="available")return json({error:"La solicitud ya está disponible."},409);
  row.status="discarded";row.updated_at=new Date().toISOString();await env.USERDATA.put(key,JSON.stringify(row));return json({ok:true});
}
async function listAdminMusicRequests(env){
  const rows=(await listKvJson(env,"musicreq:",2000)).map(x=>x.value).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  return json({requests:rows});
}
async function patchAdminMusicRequest(request,env,id){
  if(!env.USERDATA)return json({error:"Falta USERDATA KV."},503);const body=await request.json().catch(()=>({}));
  const status=String(body.status||"");if(!REQUEST_STATUSES.has(status))return json({error:"Estado inválido."},400);
  const rows=await listKvJson(env,"musicreq:",2000);const hit=rows.find(x=>x.value?.id===id);if(!hit)return json({error:"Solicitud no encontrada."},404);
  const row=hit.value;row.status=status;row.updated_at=new Date().toISOString();await env.USERDATA.put(hit.key,JSON.stringify(row));return json({ok:true,request:row});
}
async function reconcileMusicRequests(env){
  const tracks=await getLibraryTrackArray(env);const rows=await listKvJson(env,"musicreq:",2000);let changed=0;
  for(const item of rows){const r=item.value;if(!["requested","review","not_found"].includes(r.status))continue;const match=findLibraryRequestMatch(r,tracks);if(match.status==="available"){r.status="available";r.available_track_id=match.best.track.id;r.updated_at=new Date().toISOString();await env.USERDATA.put(item.key,JSON.stringify(r));changed++;}}
  return json({ok:true,changed});
}

function parseSpotifyPlaylistId(value){const s=String(value||"").trim();const m=s.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/i)||s.match(/^spotify:playlist:([A-Za-z0-9]+)$/i);return m?.[1]||"";}
function bytesToB64(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function b64ToBytes(s){const raw=atob(s);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function tokenCryptoKey(env){const secret=normalizedAppToken(env);const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`spotify-token:${secret}`));return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);}
async function encryptSpotifyToken(env,obj){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new TextEncoder().encode(JSON.stringify(obj));const enc=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await tokenCryptoKey(env),data));return JSON.stringify({v:1,iv:bytesToB64(iv),data:bytesToB64(enc)});}
async function decryptSpotifyToken(env,raw){try{const p=JSON.parse(raw);const dec=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(p.iv)},await tokenCryptoKey(env),b64ToBytes(p.data));return JSON.parse(new TextDecoder().decode(dec));}catch{return null;}}
async function spotifyAuthorize(url,env,user){
  if(!env.USERDATA)return json({error:"Falta USERDATA KV."},503);if(!env.SPOTIFY_CLIENT_ID||!env.SPOTIFY_CLIENT_SECRET)return json({error:"Spotify aún no está configurado en GMusic."},503);
  const state=crypto.randomUUID();await env.USERDATA.put(`spotify:oauth:${state}`,JSON.stringify({sub:user.sub,created_at:new Date().toISOString()}),{expirationTtl:600});
  const redirectUri=`${url.origin}/api/spotify/callback`;const p=new URLSearchParams({client_id:String(env.SPOTIFY_CLIENT_ID),response_type:"code",redirect_uri:redirectUri,scope:"playlist-read-private",state,show_dialog:"false"});
  return new Response(null,{status:302,headers:{location:`${SPOTIFY_ACCOUNTS}/authorize?${p}`,"cache-control":"no-store"}});
}
async function spotifyOAuthCallback(url,env){
  const state=String(url.searchParams.get("state")||""),code=String(url.searchParams.get("code")||"");if(!env.USERDATA||!state||!code)return Response.redirect(`${url.origin}/?spotify=error`,302);
  const key=`spotify:oauth:${state}`,raw=await env.USERDATA.get(key);await env.USERDATA.delete(key).catch(()=>{});if(!raw)return Response.redirect(`${url.origin}/?spotify=expired`,302);
  let pending;try{pending=JSON.parse(raw)}catch{return Response.redirect(`${url.origin}/?spotify=error`,302)}
  const redirectUri=`${url.origin}/api/spotify/callback`;const body=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirectUri});
  const basic=btoa(`${String(env.SPOTIFY_CLIENT_ID||"")}:${String(env.SPOTIFY_CLIENT_SECRET||"")}`);const r=await fetch(`${SPOTIFY_ACCOUNTS}/api/token`,{method:"POST",headers:{authorization:`Basic ${basic}`,"content-type":"application/x-www-form-urlencoded"},body});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)return Response.redirect(`${url.origin}/?spotify=error`,302);
  const token={access_token:d.access_token,refresh_token:d.refresh_token||"",expires_at:Date.now()+Number(d.expires_in||3600)*1000,scope:d.scope||"",token_type:d.token_type||"Bearer"};await env.USERDATA.put(`spotify:token:${pending.sub}`,await encryptSpotifyToken(env,token));
  return Response.redirect(`${url.origin}/?spotify=connected`,302);
}
async function spotifyStatus(env,user){const configured=Boolean(env.SPOTIFY_CLIENT_ID&&env.SPOTIFY_CLIENT_SECRET&&env.USERDATA);const raw=configured?await env.USERDATA.get(`spotify:token:${user.sub}`):null;return json({configured,connected:Boolean(raw)});}
async function spotifyDisconnect(env,user){if(env.USERDATA)await env.USERDATA.delete(`spotify:token:${user.sub}`).catch(()=>{});return json({ok:true});}
async function getSpotifyAccessToken(env,user){
  if(!env.USERDATA||!env.SPOTIFY_CLIENT_ID||!env.SPOTIFY_CLIENT_SECRET)throw new HttpError(503,"Spotify aún no está configurado en GMusic.");
  const key=`spotify:token:${user.sub}`,raw=await env.USERDATA.get(key);if(!raw)throw new HttpError(428,"Conecta Spotify para leer una playlist propia o colaborativa.");let token=await decryptSpotifyToken(env,raw);if(!token)throw new HttpError(428,"Vuelve a conectar Spotify.");
  if(Number(token.expires_at||0)>Date.now()+60000)return token.access_token;if(!token.refresh_token){await env.USERDATA.delete(key);throw new HttpError(428,"Vuelve a conectar Spotify.");}
  const basic=btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:token.refresh_token});const r=await fetch(`${SPOTIFY_ACCOUNTS}/api/token`,{method:"POST",headers:{authorization:`Basic ${basic}`,"content-type":"application/x-www-form-urlencoded"},body});const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token){await env.USERDATA.delete(key).catch(()=>{});throw new HttpError(428,"La autorización de Spotify venció. Vuelve a conectar Spotify.");}
  token={...token,access_token:d.access_token,refresh_token:d.refresh_token||token.refresh_token,expires_at:Date.now()+Number(d.expires_in||3600)*1000,scope:d.scope||token.scope};await env.USERDATA.put(key,await encryptSpotifyToken(env,token));return token.access_token;
}
async function spotifyApiFetch(path,env,user){const token=await getSpotifyAccessToken(env,user);const r=await fetch(`${SPOTIFY_API}${path}`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"}});if(r.status===401){await env.USERDATA.delete(`spotify:token:${user.sub}`).catch(()=>{});throw new HttpError(428,"Vuelve a conectar Spotify.");}if(r.status===403)throw new HttpError(403,"Spotify solo permite leer los elementos cuando la cuenta conectada es propietaria o colaboradora de esa playlist.");if(r.status===429)throw new HttpError(429,"Spotify está limitando temporalmente las consultas. Inténtalo más tarde.");if(!r.ok)throw new HttpError(502,"No pudimos leer esta playlist desde Spotify.");return r;}
async function readSpotifyPlaylist(playlistId,env,user){
  const info=await (await spotifyApiFetch(`/playlists/${encodeURIComponent(playlistId)}`,env,user)).json();const rows=[];let offset=0,total=Infinity;
  while(offset<total&&rows.length<1000){const data=await (await spotifyApiFetch(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50&offset=${offset}`,env,user)).json();const items=Array.isArray(data.items)?data.items:[];total=Number(data.total||items.length);for(const entry of items){const t=entry?.item||entry?.track;if(!t||t.type&&t.type!=="track")continue;rows.push({spotify_id:String(t.id||""),title:cleanText(t.name,"Sin título",180),artist:(t.artists||[]).map(a=>a.name).filter(Boolean).join(", "),artists:(t.artists||[]).map(a=>a.name).filter(Boolean),album:cleanText(t.album?.name,"",180),duration_seconds:Math.round(Number(t.duration_ms||0)/1000),spotify_url:String(t.external_urls?.spotify||""),cover:String(t.album?.images?.[1]?.url||t.album?.images?.[0]?.url||"")});}if(!items.length||!data.next)break;offset+=items.length;}
  return {playlist:{id:playlistId,name:cleanText(info.name,"Playlist",160),spotify_url:String(info.external_urls?.spotify||""),owner_id:String(info.owner?.id||"")},tracks:rows};
}
function analyzeExternalTracks(external,library){const rows=external.map(t=>{const m=findLibraryRequestMatch(t,library);const status=m.status==="available"?"available":m.status==="review"?"review":"missing";return {...t,status,status_label:status==="available"?"Ya está":status==="review"?"Revisar":"Falta",gmusic_track_id:status==="available"?m.best.track.id:"",match_score:m.best?.score||0};});return {rows,summary:{total:rows.length,available:rows.filter(r=>r.status==="available").length,missing:rows.filter(r=>r.status==="missing").length,review:rows.filter(r=>r.status==="review").length}};}
async function createSpotifyPlaylistRequest(request,env,user,origin){
  if(!env.USERDATA)return json({error:"Falta USERDATA KV."},503);const body=await request.json().catch(()=>({})),playlistId=parseSpotifyPlaylistId(body.url);if(!playlistId)return json({error:"Enlace de playlist de Spotify inválido."},400);
  let data;try{data=await readSpotifyPlaylist(playlistId,env,user)}catch(e){if(e instanceof HttpError&&e.status===428)return json({error:e.message,needs_spotify:true,authorize_url:`${origin}/api/spotify/authorize`},428);throw e;}
  const library=await getLibraryTrackArray(env),analysis=analyzeExternalTracks(data.tracks,library),id=crypto.randomUUID(),now=new Date().toISOString();const row={id,owner_sub:user.sub,source:"spotify",playlist:data.playlist,created_at:now,updated_at:now,rows:analysis.rows,summary:analysis.summary};await env.USERDATA.put(`playlistreq:${user.sub}:${id}`,JSON.stringify(row));return json({ok:true,analysis:publicPlaylistRequest(row)},201);
}
async function reanalyzeSpotifyPlaylistRequest(env,user,id){
  if(!env.USERDATA||!/^[0-9a-f-]{36}$/i.test(id))return json({error:"Análisis no encontrado."},404);const key=`playlistreq:${user.sub}:${id}`,raw=await env.USERDATA.get(key);if(!raw)return json({error:"Análisis no encontrado."},404);let old;try{old=JSON.parse(raw)}catch{return json({error:"Análisis no encontrado."},404)}const playlistId=old.playlist?.id||parseSpotifyPlaylistId(old.playlist?.spotify_url||"");if(!playlistId)return json({error:"La playlist guardada ya no es válida."},400);const data=await readSpotifyPlaylist(playlistId,env,user),library=await getLibraryTrackArray(env),analysis=analyzeExternalTracks(data.tracks,library);const previous_summary=old.summary||null;old={...old,playlist:data.playlist,rows:analysis.rows,summary:analysis.summary,previous_summary,updated_at:new Date().toISOString()};await env.USERDATA.put(key,JSON.stringify(old));return json({ok:true,analysis:publicPlaylistRequest(old),previous_summary});
}
function publicPlaylistRequest(r){return {id:r.id,source:r.source,playlist:r.playlist,created_at:r.created_at,updated_at:r.updated_at,summary:r.summary,previous_summary:r.previous_summary||null,rows:r.rows};}
async function listOwnPlaylistRequests(env,user){const rows=(await listKvJson(env,`playlistreq:${user.sub}:`,100)).map(x=>publicPlaylistRequest(x.value)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));return json({analyses:rows});}
async function listAdminPlaylistRequests(env){const rows=(await listKvJson(env,"playlistreq:",500)).map(x=>x.value).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));return json({analyses:rows});}
async function findPlaylistAnalysisById(env,id){const rows=await listKvJson(env,"playlistreq:",500);return rows.find(x=>x.value?.id===id)||null;}
async function exportPlaylistRequestDocx(env,id,url){const hit=await findPlaylistAnalysisById(env,id);if(!hit)return json({error:"Análisis no encontrado."},404);const filter=["all","missing","review"].includes(url.searchParams.get("filter"))?url.searchParams.get("filter"):"all";const r=hit.value;const bytes=buildPlaylistDocx({playlistName:r.playlist?.name||"Playlist",playlistUrl:r.playlist?.spotify_url||"",analyzedAt:r.updated_at||r.created_at,rows:r.rows||[],summary:r.summary,filter});const safe=String(r.playlist?.name||"playlist").normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"playlist";return new Response(bytes,{status:200,headers:{"content-type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","content-disposition":`attachment; filename="GMusic-${safe}-${filter}.docx"`,"cache-control":"no-store","x-content-type-options":"nosniff"}});}



// ---------- YouTube Discovery + listening insights (v3.5) ----------
function validYouTubeVideoId(value){return /^[A-Za-z0-9_-]{6,20}$/.test(String(value||""));}
function decodeYouTubeText(value){
  return String(value||"")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.max(0,Math.min(0x10ffff,Number(n)||0))))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(Math.max(0,Math.min(0x10ffff,parseInt(n,16)||0))))
    .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">");
}
function parseIso8601Duration(value){
  const m=String(value||"").match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);if(!m)return 0;
  return Math.round((Number(m[1]||0)*86400)+(Number(m[2]||0)*3600)+(Number(m[3]||0)*60)+Number(m[4]||0));
}
function checkYouTubeSearchWindow(user){
  const key=String(user?.sub||"anon"),now=Date.now(),windowMs=10*60*1000,max=12;
  const current=youtubeSearchWindows.get(key);
  if(!current||current.resetAt<=now){youtubeSearchWindows.set(key,{count:1,resetAt:now+windowMs});return{allowed:true,retryAfter:0};}
  if(current.count>=max)return{allowed:false,retryAfter:Math.max(1,Math.ceil((current.resetAt-now)/1000))};
  current.count++;return{allowed:true,retryAfter:0};
}
async function createYouTubeListenToken(env,user,video){
  const secret=normalizedAppToken(env);if(!secret)return"";
  const payload={sub:user.sub,video_id:String(video.video_id||""),title:cleanText(video.title,"Video",180),channel:cleanText(video.channel,"YouTube",140),thumbnail:cleanText(video.thumbnail,"",500),duration_seconds:clampNumber(video.duration_seconds,0,86400),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+24*60*60};
  const body=base64urlEncode(JSON.stringify(payload));return `${body}.${await signValue(`yt:${body}`,secret)}`;
}
async function verifyYouTubeListenToken(token,env,user){
  const parts=String(token||"").split(".");if(parts.length!==2)return null;
  const [body,sig]=parts,secret=normalizedAppToken(env);if(!secret)return null;
  const expected=await signValue(`yt:${body}`,secret);if(!safeEqual(sig,expected))return null;
  let payload;try{payload=JSON.parse(base64urlDecode(body))}catch{return null}
  const now=Math.floor(Date.now()/1000);if(payload?.sub!==user.sub||!validYouTubeVideoId(payload?.video_id)||Number(payload.exp||0)<now)return null;
  return payload;
}
async function attachYouTubeListenTokens(results,env,user){
  const out=[];for(const row of Array.isArray(results)?results:[]){out.push({...row,listen_token:await createYouTubeListenToken(env,user,row)});}return out;
}
async function youtubeApiError(response){
  let reason="";try{const d=await response.clone().json();reason=String(d?.error?.errors?.[0]?.reason||d?.error?.status||"");}catch{}
  if(response.status===429||/quota|rateLimit/i.test(reason))return new HttpError(429,"YouTube alcanzó temporalmente su límite de búsquedas. Inténtalo más tarde.");
  if(response.status===403&&/keyInvalid|API_KEY_INVALID/i.test(reason))return new HttpError(503,"La clave de YouTube configurada no es válida.");
  if(response.status===403&&/accessNotConfigured|SERVICE_DISABLED|apiDisabled/i.test(reason))return new HttpError(503,"YouTube Data API todavía no está habilitada para este proyecto.");
  if(response.status===403)return new HttpError(503,"YouTube rechazó la búsqueda. Revisa las restricciones de la API key en Google Cloud.");
  return new HttpError(502,"No pudimos buscar en YouTube en este momento.");
}
async function searchYouTube(url,env,user){
  if(!env.YOUTUBE_API_KEY)return json({error:"YouTube todavía no está configurado en GMusic.",configured:false},503);
  const q=cleanText(url.searchParams.get("q"),"",100);if(q.length<2)return json({error:"Escribe al menos 2 caracteres para buscar."},400);
  const normalized=normalizeLookup(q);const cache=caches.default;const cacheKey=new Request(`https://gmusic-youtube-search.local/v2?q=${encodeURIComponent(normalized)}`);
  const hit=await cache.match(cacheKey);if(hit){try{const cached=await hit.json();return json({...cached,results:await attachYouTubeListenTokens(cached.results,env,user),cached:true})}catch{}}
  const rate=checkYouTubeSearchWindow(user);if(!rate.allowed)return json({error:`Has hecho varias búsquedas seguidas. Espera ${rate.retryAfter} segundos para cuidar la cuota de YouTube.`},429,{"retry-after":String(rate.retryAfter)});
  const params=new URLSearchParams({part:"snippet",q,type:"video",maxResults:"8",videoEmbeddable:"true",videoSyndicated:"true",safeSearch:"moderate",key:String(env.YOUTUBE_API_KEY)});
  let sr;try{sr=await fetch(`${YOUTUBE_API}/search?${params}`,{headers:{accept:"application/json","user-agent":`GMusic/${VERSION}`}})}catch{throw new HttpError(502,"No pudimos conectar con YouTube en este momento.");}
  if(!sr.ok)throw await youtubeApiError(sr);
  const searchData=await sr.json();const ids=(searchData.items||[]).map(x=>x?.id?.videoId).filter(validYouTubeVideoId).slice(0,8);
  if(!ids.length){const payload={configured:true,query:q,results:[],filtered_made_for_kids:0};const cached=new Response(JSON.stringify(payload),{headers:{"content-type":"application/json","cache-control":`public,max-age=${YOUTUBE_SEARCH_CACHE_SECONDS}`}});await cache.put(cacheKey,cached).catch(()=>{});return json(payload);}
  const detailParams=new URLSearchParams({part:"snippet,status,contentDetails",id:ids.join(","),key:String(env.YOUTUBE_API_KEY)});
  const vr=await fetch(`${YOUTUBE_API}/videos?${detailParams}`,{headers:{accept:"application/json","user-agent":`GMusic/${VERSION}`}});
  if(!vr.ok)throw await youtubeApiError(vr);
  const details=await vr.json();let filteredKids=0;
  const results=(details.items||[]).filter(v=>{
    if(v?.status?.madeForKids===true){filteredKids++;return false;}
    return v?.status?.embeddable!==false&&validYouTubeVideoId(v?.id);
  }).map(v=>({
    video_id:String(v.id),title:cleanText(decodeYouTubeText(v?.snippet?.title),"Video",180),channel:cleanText(decodeYouTubeText(v?.snippet?.channelTitle),"YouTube",140),
    thumbnail:String(v?.snippet?.thumbnails?.medium?.url||v?.snippet?.thumbnails?.default?.url||""),duration_seconds:parseIso8601Duration(v?.contentDetails?.duration),
    published_at:String(v?.snippet?.publishedAt||""),youtube_url:`https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,made_for_kids:false,embeddable:true
  }));
  const payload={configured:true,query:q,results,filtered_made_for_kids:filteredKids};
  const cached=new Response(JSON.stringify(payload),{headers:{"content-type":"application/json","cache-control":`public,max-age=${YOUTUBE_SEARCH_CACHE_SECONDS}`}});await cache.put(cacheKey,cached).catch(()=>{});
  return json({...payload,results:await attachYouTubeListenTokens(results,env,user)});
}
function youtubeDayKey(user,date){return `ytlisten:${date}:${user.sub}`;}
async function logYouTubeListen(request,env,user){
  if(!env.USERDATA)return json({error:"Falta configurar USERDATA KV."},503);
  const body=await request.json().catch(()=>({}));const seconds=clampNumber(body.listened_seconds,0,86400);
  if(seconds<YOUTUBE_LISTEN_MIN_SECONDS)return json({ok:true,recorded:false,reason:"too_short"});
  const proof=await verifyYouTubeListenToken(body.listen_token,env,user);if(!proof)return json({error:"No pudimos validar esta reproducción de YouTube."},400);
  const now=Math.floor(Date.now()/1000);if(now-Number(proof.iat||now)<25)return json({ok:true,recorded:false,reason:"too_soon"});
  const sessionId=cleanText(body.session_id,"",80);if(!sessionId)return json({error:"Sesión de reproducción inválida."},400);
  const maxSeconds=proof.duration_seconds>0?Math.min(seconds,Number(proof.duration_seconds)):seconds;
  const date=new Date().toISOString().slice(0,10),key=youtubeDayKey(user,date);let log={date,owner_sub:user.sub,user_name:user.name||"Usuario",events:[]};
  try{
    const raw=await env.USERDATA.get(key);
    if(raw){const saved=JSON.parse(raw);log={...log,...saved,events:Array.isArray(saved?.events)?saved.events:[]};}
  }catch{}
  if(log.events.some(x=>x?.session_id===sessionId))return json({ok:true,recorded:false,duplicate:true});
  const event={session_id:sessionId,video_id:proof.video_id,title:proof.title,channel:proof.channel,thumbnail:proof.thumbnail,duration_seconds:proof.duration_seconds,listened_seconds:maxSeconds,source:["search","dj"].includes(body.source)?body.source:"search",dj_mode:cleanText(body.dj_mode,"",32),at:new Date().toISOString()};
  log.user_name=user.name||log.user_name||"Usuario";log.events=[...(log.events||[]),event].slice(-180);
  await env.USERDATA.put(key,JSON.stringify(log),{expirationTtl:14*24*60*60});
  return json({ok:true,recorded:true});
}
async function listAdminYouTubeListens(env,url){
  if(!env.USERDATA)return json({error:"Falta USERDATA KV."},503);
  const requested=cleanText(url.searchParams.get("date"),new Date().toISOString().slice(0,10),10);const date=/^\d{4}-\d{2}-\d{2}$/.test(requested)?requested:new Date().toISOString().slice(0,10);
  const page=await env.USERDATA.list({prefix:`ytlisten:${date}:`,limit:100});const logs=[];
  for(const k of page.keys||[]){try{const raw=await env.USERDATA.get(k.name);if(raw)logs.push(JSON.parse(raw));}catch{}}
  const byVideo=new Map();let totalEvents=0;
  for(const log of logs){for(const e of Array.isArray(log.events)?log.events:[]){totalEvents++;const key=String(e.video_id||"");if(!validYouTubeVideoId(key))continue;let row=byVideo.get(key);if(!row){row={video_id:key,title:e.title||"Video",channel:e.channel||"YouTube",thumbnail:e.thumbnail||"",plays:0,last_listened_at:"",listeners:new Map(),sources:new Set()};byVideo.set(key,row);}row.plays++;row.last_listened_at=String(e.at||"")>row.last_listened_at?String(e.at||""):row.last_listened_at;const uname=cleanText(log.user_name,"Usuario",60);row.listeners.set(String(log.owner_sub||uname),{name:uname,plays:(row.listeners.get(String(log.owner_sub||uname))?.plays||0)+1});row.sources.add(e.source||"search");}}
  const items=[...byVideo.values()].map(r=>({...r,listeners:[...r.listeners.values()],listener_count:r.listeners.size,sources:[...r.sources]})).sort((a,b)=>b.plays-a.plays||String(b.last_listened_at).localeCompare(String(a.last_listened_at)));
  return json({date,total_events:totalEvents,unique_videos:items.length,items});
}

function artistProfileKey(name){return `artistprofile:${stableEntityId("artist",normalizeArtistKey(name))}`;}
function artistBlobKey(name){return `artistblob:${stableEntityId("artist",normalizeArtistKey(name))}`;}
async function getArtistImageProfile(env,name){if(!env.USERDATA)return null;const raw=await env.USERDATA.get(artistProfileKey(name));if(!raw)return null;try{return JSON.parse(raw)}catch{return null}}
async function resolveMusicBrainzArtist(name){
  const cache=caches.default,key=new Request(`https://gmusic-artist-identity.local/v2/${encodeURIComponent(normalizeArtistKey(name))}`),hit=await cache.match(key);if(hit)return await hit.json();
  const query=`artist:"${escapeLucene(name)}"`;const data=await (await musicBrainzFetch(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=8`)).json();const ranked=(data.artists||[]).map(a=>{const sim=normalizedSimilarity(name,a.name);const exact=normalizeArtistKey(name)===normalizeArtistKey(a.name)||Array.isArray(a.aliases)&&a.aliases.some(x=>normalizeArtistKey(x.name)===normalizeArtistKey(name));let score=Math.round(sim*70+Math.min(30,Number(a.score||0)*.3));if(exact)score=Math.max(score,94);return{mbid:a.id,name:a.name,aliases:(a.aliases||[]).map(x=>x.name).filter(Boolean),country:a.country||"",score:Math.min(100,score),exact};}).sort((a,b)=>b.score-a.score);const out={best:ranked[0]||null,candidates:ranked.slice(0,5)};const resp=json(out);resp.headers.set("cache-control","public, max-age=604800");if(out.best)await cache.put(key,resp.clone()).catch(()=>{});return out;
}
async function wikimediaImageForMbid(mbid){
  if(!/^[0-9a-f-]{36}$/i.test(String(mbid||"")))return null;
  try{const data=await (await musicBrainzFetch(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`)).json();const rel=(data.relations||[]).find(r=>String(r?.url?.resource||"").includes("wikidata.org/wiki/Q"));const qid=String(rel?.url?.resource||"").match(/\/wiki\/(Q\d+)/)?.[1];if(!qid)return null;const wd=await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,{headers:{"user-agent":`GMusic/${VERSION} (artist image lookup)`}})).json();const filename=wd?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;if(!filename)return null;const api=`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=800&titles=${encodeURIComponent(`File:${filename}`)}`;const commons=await (await fetch(api,{headers:{"user-agent":`GMusic/${VERSION} (artist image lookup)`}})).json();const page=Object.values(commons?.query?.pages||{})[0];const image=page?.imageinfo?.[0]?.thumburl||page?.imageinfo?.[0]?.url||"";return image?{image,source:"wikimedia",wikidata_id:qid}:null;}catch{return null;}
}
async function deezerArtistCandidate(name){
  try{
    const r=await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`,{headers:{"user-agent":`GMusic/${VERSION}`}});
    if(!r.ok)return null;
    const data=await r.json();
    const rows=Array.isArray(data?.data)?data.data:[];
    const exact=rows.filter(a=>normalizeArtistKey(a?.name)===normalizeArtistKey(name));
    const unique=new Map();
    for(const a of exact){const id=String(a?.id||a?.name||"");if(id&&!unique.has(id))unique.set(id,a);}
    if(unique.size!==1)return unique.size>1?{source:"deezer",ambiguous:true,exact_count:unique.size}:null;
    const x=[...unique.values()][0];
    const image=x?.picture_xl||x?.picture_big||x?.picture_medium||"";
    return image?{image,source:"deezer",matched_name:x.name,deezer_id:String(x.id||""),exact:true}:null;
  }catch{return null;}
}
async function searchArtistImageCandidate(name,env,{refresh=false}={}){
  name=normalizeArtistDisplay(name);const manual=await getArtistImageProfile(env,name);if(manual?.source==="manual")return{artist:name,status:"high",score:100,profile:manual,candidate:{image:`/api/artwork/artist/manual?artist=${encodeURIComponent(name)}`,source:"manual",score:100}};
  const cache=caches.default,key=new Request(`https://gmusic-artist-image.local/v3/${encodeURIComponent(normalizeArtistKey(name))}`);if(!refresh){const hit=await cache.match(key);if(hit)return hit.json();}
  let identity=null;try{identity=await resolveMusicBrainzArtist(name)}catch{}const best=identity?.best||null;let candidate=null,score=0;
  if(best&&best.score>=88){const wiki=await wikimediaImageForMbid(best.mbid);if(wiki){candidate={...wiki,mbid:best.mbid,matched_name:best.name};score=best.exact?100:Math.min(96,best.score+4);}}
  if(!candidate){const dz=await deezerArtistCandidate(name);if(dz?.image&&!dz.ambiguous){candidate={...dz,mbid:best?.mbid||""};score=best?.exact?94:best?.score>=85?86:82;}}
  const out={artist:name,identity:best,candidate:candidate?{...candidate,score}:null,score,status:score>=90?"high":score>=75?"review":"low"};const resp=json(out);resp.headers.set("cache-control","public, max-age=604800");if(candidate)await cache.put(key,resp.clone()).catch(()=>{});return out;
}
async function auditArtistImages(env,url){
  const tracks=await getLibraryTrackArray(env),names=[...new Set(tracks.flatMap(t=>t.artist_names||splitArtistNames(t.artist)).map(normalizeArtistDisplay).filter(x=>normalizeLookup(x)!=="artista desconocido"))].sort((a,b)=>a.localeCompare(b,"es"));const rows=[];
  for(const name of names.slice(0,300)){const profile=await getArtistImageProfile(env,name);rows.push({artist:name,profile:profile||null,status:profile?"saved":"pending",score:Number(profile?.score||0)});}
  return json({ok:true,total:rows.length,saved:rows.filter(r=>r.profile).length,pending:rows.filter(r=>!r.profile).length,rows});
}
async function adminSearchArtistImage(env,url){const artist=normalizeArtistDisplay(cleanText(url.searchParams.get("artist"),"",160));if(!artist)return json({error:"Falta artista."},400);return json(await searchArtistImageCandidate(artist,env,{refresh:url.searchParams.get("refresh")==="1"}));}
async function adminApplyArtistImage(request,env,user){if(!env.USERDATA)return json({error:"Falta USERDATA KV."},503);const body=await request.json().catch(()=>({})),artist=normalizeArtistDisplay(cleanText(body.artist,"",160)),image=cleanText(body.image,"",1000),source=["wikimedia","deezer","manual_url"].includes(body.source)?body.source:"automatic",score=Math.max(0,Math.min(100,Number(body.score||0)));if(!artist||!/^https:\/\//i.test(image))return json({error:"Imagen propuesta inválida."},400);if(source!=="manual_url"&&score<75)return json({error:"La coincidencia no tiene suficiente confianza para guardarse."},409);const profile={artist,image,source:source==="manual_url"?"manual":"automatic",provider:source,score:source==="manual_url"?100:score,mbid:cleanText(body.mbid,"",40),updated_at:new Date().toISOString()};await env.USERDATA.put(artistProfileKey(artist),JSON.stringify(profile));await logAudit(env,user,"artist.image.apply",{artist,source:profile.provider,score:profile.score});return json({ok:true,profile});}
async function adminUploadArtistImage(request,env,user){if(!env.USERDATA)return json({error:"Falta USERDATA KV."},503);const form=await request.formData(),artist=normalizeArtistDisplay(cleanText(form.get("artist"),"",160)),file=form.get("file");if(!artist||!(file instanceof File))return json({error:"Selecciona artista e imagen."},400);if(file.size<=0||file.size>ARTIST_IMAGE_MAX_BYTES)return json({error:"La imagen debe pesar menos de 1.5 MB."},413);const mime=String(file.type||"").toLowerCase();if(!["image/jpeg","image/png","image/webp"].includes(mime))return json({error:"Usa JPG, PNG o WebP."},400);const bytes=new Uint8Array(await file.arrayBuffer());const blob={mime,data:bytesToB64(bytes),bytes:file.size,updated_at:new Date().toISOString()};await env.USERDATA.put(artistBlobKey(artist),JSON.stringify(blob));const profile={artist,image:`/api/artwork/artist/manual?artist=${encodeURIComponent(artist)}`,source:"manual",provider:"upload",score:100,updated_at:new Date().toISOString()};await env.USERDATA.put(artistProfileKey(artist),JSON.stringify(profile));await logAudit(env,user,"artist.image.manual",{artist,bytes:file.size});return json({ok:true,profile});}
async function serveManualArtistImage(env,url){const artist=normalizeArtistDisplay(cleanText(url.searchParams.get("artist"),"",160));if(!env.USERDATA||!artist)return new Response(null,{status:404});const raw=await env.USERDATA.get(artistBlobKey(artist));if(!raw)return new Response(null,{status:404});try{const p=JSON.parse(raw),bytes=b64ToBytes(p.data);return new Response(bytes,{headers:{"content-type":p.mime||"image/jpeg","cache-control":"private, max-age=86400","x-content-type-options":"nosniff"}});}catch{return new Response(null,{status:404});}}
async function adminClearArtistImage(request,env,user){if(!env.USERDATA)return json({error:"Falta USERDATA KV."},503);const body=await request.json().catch(()=>({})),artist=normalizeArtistDisplay(cleanText(body.artist,"",160));if(!artist)return json({error:"Falta artista."},400);await env.USERDATA.delete(artistProfileKey(artist)).catch(()=>{});if(body.delete_manual===true)await env.USERDATA.delete(artistBlobKey(artist)).catch(()=>{});await logAudit(env,user,"artist.image.clear",{artist});return json({ok:true});}
async function proxyExternalArtwork(url){const raw=String(url.searchParams.get("url")||"");let u;try{u=new URL(raw)}catch{return new Response(null,{status:404})}const allowed=new Set(["e-cdns-images.dzcdn.net","cdns-images.dzcdn.net","cdn-images.dzcdn.net","upload.wikimedia.org","commons.wikimedia.org","i.scdn.co"]);if(u.protocol!=="https:"||!allowed.has(u.hostname))return new Response(null,{status:404});try{const r=await fetch(u.toString(),{headers:{"user-agent":`GMusic/${VERSION}`},redirect:"follow"});if(!r.ok)return new Response(null,{status:404});const type=r.headers.get("content-type")||"";if(!type.startsWith("image/"))return new Response(null,{status:404});return new Response(r.body,{headers:{"content-type":type,"cache-control":"public, max-age=604800","x-content-type-options":"nosniff"}});}catch{return new Response(null,{status:404});}}


// ---------- Google OAuth ----------
async function getGoogleAccessToken(env, force = false) {
  const now = Date.now(); if (!force && googleTokenCache.token && googleTokenCache.expiresAt > now + 60_000) return googleTokenCache.token;
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) if (!env[key]) throw new Error(`Falta configurar ${key}`);
  const body = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json().catch(() => ({})); if (!response.ok || !data.access_token) throw new Error("No se pudo renovar el acceso de Google");
  googleTokenCache = { token: data.access_token, expiresAt: now + Number(data.expires_in || 3600) * 1000 }; return googleTokenCache.token;
}
async function driveFetch(url, init, env, token) {
  const headers = new Headers(init.headers || {}); headers.set("authorization", `Bearer ${token}`); let response = await fetch(url, { ...init, headers });
  if (response.status === 401) { googleTokenCache = { token: "", expiresAt: 0 }; const fresh = await getGoogleAccessToken(env, true); const retryHeaders = new Headers(init.headers || {}); retryHeaders.set("authorization", `Bearer ${fresh}`); response = await fetch(url, { ...init, headers: retryHeaders }); }
  return response;
}
async function driveError(response, fallback) { const text = await response.text().catch(() => ""); let detail = ""; try { const p = JSON.parse(text); detail = p?.error?.message || ""; } catch { detail = text.slice(0, 120); } return new Error(detail ? `${fallback}: ${detail}` : `${fallback} (${response.status})`); }

// ---------- Artwork ----------
async function findArtwork(url, env) {
  const kind = url.searchParams.get("kind") === "artist" ? "artist" : "album"; const artist = cleanText(url.searchParams.get("artist"), "", 120); const album = cleanText(url.searchParams.get("album"), "", 120); const rev = cleanText(url.searchParams.get("rev"), "7", 8);
  if (!artist) return json({ image: "", source: "none" }); if (kind === "album" && isUnknownAlbumName(album)) return json({ image: "", source: "none", reason: "unknown_album" });
  if (kind === "artist") {
    // 1) Una foto guardada/aprobada (y especialmente manual) siempre gana.
    const stored = await getArtistImageProfile(env, artist);
    if (stored?.image) {
      const image = stored.source === "manual" && stored.provider === "upload" ? `/api/artwork/artist/manual?artist=${encodeURIComponent(artist)}` : stored.image.startsWith("/api/") ? stored.image : `/api/artwork/proxy?url=${encodeURIComponent(stored.image)}`;
      const result=json({ image, source: stored.source || "saved", matched: true, confidence: Number(stored.score || 100), approved:true });
      result.headers.set("cache-control","public, max-age=86400");
      return result;
    }

    // 2) Para la vista normal usamos un fallback rápido y estricto por nombre exacto.
    // Esto evita poner cada tarjeta a esperar la cola/rate-limit de MusicBrainz.
    try {
      const fast = await deezerArtistCandidate(artist);
      if (fast?.image && !fast.ambiguous) {
        const result=json({ image:`/api/artwork/proxy?url=${encodeURIComponent(fast.image)}`, source:"deezer", matched:true, confidence:86, provisional:true });
        result.headers.set("cache-control","public, max-age=86400");
        return result;
      }
    } catch {}

    // 3) Si el fallback rápido no existe, intentamos la resolución profunda.
    // Solo una coincidencia de alta confianza se muestra automáticamente.
    try {
      const result = await searchArtistImageCandidate(artist, env);
      if (result?.candidate?.image && result.status === "high") {
        const response=json({ image: `/api/artwork/proxy?url=${encodeURIComponent(result.candidate.image)}`, source: result.candidate.source || "automatic", matched: true, confidence: result.score, mbid: result.candidate.mbid || "" });
        response.headers.set("cache-control","public, max-age=86400");
        return response;
      }
      return json({ image: "", source: "none", matched: false, confidence: result?.score || 0, needs_review: result?.status === "review" });
    } catch { return json({ image: "", source: "none" }); }
  }
  const cache = caches.default; const cacheKey = new Request(`https://gmusic-artwork.local/${kind}/v${encodeURIComponent(rev)}?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`); const cached = await cache.match(cacheKey); if (cached) return cached;
  const endpoint = `https://api.deezer.com/search/album?q=${encodeURIComponent(`${artist} ${album}`)}&limit=15`;
  try {
    const response = await fetch(endpoint, { headers: { "user-agent": `GMusic/${VERSION}` } }); if (!response.ok) return json({ image: "", source: "none" });
    const data = await response.json(); const rows = Array.isArray(data?.data) ? data.data : []; const a = normalizeLookup(artist), al = normalizeLookup(album); const chosen = rows.find(x => normalizeLookup(x?.artist?.name || "") === a && normalizeLookup(x?.title || "") === al) || null;
    const image = chosen?.cover_xl || chosen?.cover_big || chosen?.cover_medium || ""; const safeImage = image ? `/api/artwork/proxy?url=${encodeURIComponent(image)}` : "";
    const result = json({ image: safeImage, source: image ? "deezer" : "none", matched: Boolean(chosen) }); result.headers.set("cache-control", "public, max-age=86400"); if (image) await cache.put(cacheKey, result.clone()).catch(() => {}); return result;
  } catch { return json({ image: "", source: "none" }); }
}
function normalizeLookup(value) { return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function isUnknownAlbumName(value) { const v = normalizeLookup(value); return !v || ["sin album", "unknown album", "album desconocido", "desconocido", "n a", "na", "none"].includes(v); }

// ---------- Diagnóstico, backup y auditoría ----------
function diagnostics(env) { return json({ ok: true, version: VERSION, configured: { app_token: Boolean(normalizedAppToken(env)), user_codes_legacy: Boolean(parseUserCodes(env)), userdata_kv: Boolean(env.USERDATA), google_client_id: Boolean(env.GOOGLE_CLIENT_ID), google_client_secret: Boolean(env.GOOGLE_CLIENT_SECRET), google_refresh_token: Boolean(env.GOOGLE_REFRESH_TOKEN), spotify_client_id: Boolean(env.SPOTIFY_CLIENT_ID), spotify_client_secret: Boolean(env.SPOTIFY_CLIENT_SECRET), youtube_api_key: Boolean(env.YOUTUBE_API_KEY) } }); }
async function adminStatus(env) {
  const folderId = await ensureLibraryFolder(env); const token = await getGoogleAccessToken(env); const q = `'${folderId}' in parents and trashed = false and appProperties has { key='gmusic_track' and value='1' }`; const files = await listDriveFiles(env, token, q, "nextPageToken,files(id,size)"); const bytes = files.reduce((n,f) => n + Number(f.size || 0), 0);
  const maxUsers = Number(env.MAX_USERS) > 0 ? Number(env.MAX_USERS) : DEFAULT_MAX_USERS;
  // El conteo de usuarios ya lo obtiene /api/admin/users. No repetimos otro KV.list aquí.
  return json({ ok: true, version: VERSION, drive_connected: true, kv_connected: Boolean(env.USERDATA), tracks: files.length, storage_bytes: bytes, max_users: maxUsers });
}
async function exportBackup(env) {
  const folderId = await ensureLibraryFolder(env); const token = await getGoogleAccessToken(env); const q = `'${folderId}' in parents and trashed = false and appProperties has { key='gmusic_track' and value='1' }`; const files = await listDriveFiles(env, token, q, "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,appProperties)");
  const usersResponse = await listUsers(env); const users = (await usersResponse.json()).users || []; const privateData = {};
  if (env.USERDATA) {
    for (const u of users.slice(0, 100)) {
      const item = {};
      for (const kind of ["profile","history","playlists","queue","stats","playback"]) {
        const raw = await env.USERDATA.get(`user:${u.sub}:${kind}`); if (raw) { try { item[kind] = JSON.parse(raw); } catch {} }
      }
      const fav = await env.USERDATA.get(`fav:${u.sub}`); if (fav) { try { item.favorites = JSON.parse(fav); } catch {} }
      privateData[u.sub] = item;
    }
  }
  return json({ backup_version: 2, generated_at: new Date().toISOString(), gmusic_version: VERSION, tracks: files.map(fileToTrack), users: users.map(({ sub, name, role, enabled, source, created_at }) => ({ sub, name, role, enabled, source, created_at })), userdata: privateData });
}
async function logAudit(env, user, action, detail = {}) {
  if (!env.USERDATA) return;
  const safeDetail = {}; for (const [k,v] of Object.entries(detail)) if (!["code", "secret", "token", "access_code"].includes(k)) safeDetail[k] = typeof v === "string" ? v.slice(0,120) : v;
  const key = `audit:${Date.now()}:${crypto.randomUUID()}`; const value = JSON.stringify({ at: new Date().toISOString(), actor: user.sub, role: user.role, action, detail: safeDetail }); await env.USERDATA.put(key, value, { expirationTtl: 30 * 24 * 60 * 60 }).catch(() => {});
}

// ---------- Helpers ----------
function cleanText(value, fallback, maxLength) { const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim(); return (text || fallback).slice(0, maxLength); }
function fitAppProperty(value, maxBytes = 100) { const encoder = new TextEncoder(); let out = ""; for (const char of String(value || "")) { const candidate = out + char; if (encoder.encode(candidate).length > maxBytes) break; out = candidate; } return out; }
function stripExtension(name) { return String(name || "").replace(/\.[^.]+$/, ""); }
function sanitizeFilename(name) { const source = String(name || "audio").trim(); const extensionMatch = source.match(/(\.[a-zA-Z0-9]{1,8})$/); const extension = extensionMatch ? extensionMatch[1].toLowerCase() : ""; const base = extension ? source.slice(0, -extension.length) : source; const safeBase = base.normalize("NFKD").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim().slice(0, 140) || "audio"; return `${safeBase}${extension}`; }
function clampNumber(value, min, max) { const n = Number(value); if (!Number.isFinite(n)) return min; return Math.min(max, Math.max(min, Math.round(n))); }
function clampFloat(value, min, max) { const n = Number(value); if (!Number.isFinite(n)) return min; return Math.min(max, Math.max(min, Math.round(n * 10) / 10)); }

// Exportaciones limitadas para pruebas automatizadas de normalización. No forman parte de la API HTTP.
export { cleanTrackTitle, normalizeArtistKey, normalizeAlbumKey, splitArtistNames, buildMetadataCleanupPlan, normalizedSimilarity, durationSimilarity, scoreMusicBrainzCandidate, compareRequestedTrack, parseSpotifyPlaylistId };
