import { chooseDjTrack, primaryDjArtist } from "./dj-engine.js";

const VERSION = "4.0.0";
const IS_ANDROID = /Android/i.test(navigator.userAgent || "");
const LEGACY_SESSION_KEY = "gmusic_session_v1";
const QUEUE_KEY = "gmusic_queue_v2";
const RECENT_KEY = "gmusic_recent_v2";
const STATS_KEY = "gmusic_stats_v2";
const ARTWORK_KEY = "gmusic_artwork_v4";
const OFFLINE_KEY = "gmusic_offline_v2"; // legacy, migrated after the next online login
const OFFLINE_CACHE = "gmusic-offline-audio-v2"; // legacy cache
const OFFLINE_SESSION_KEY = "gmusic_offline_session_v3";
const OFFLINE_TRACKS_PREFIX = "gmusic_offline_tracks_v3:";
const OFFLINE_USER_PREFIX = "gmusic_offline_user_v3:";
const OFFLINE_IDS_PREFIX = "gmusic_offline_ids_v3:";
const OFFLINE_CACHE_PREFIX = "gmusic-offline-audio-v3-";
const OFFLINE_SETTINGS_PREFIX = "gmusic_offline_settings_v4:";
const YOUTUBE_LISTEN_CONSENT_PREFIX = "gmusic_youtube_listen_consent_v1:";

const state = {
  tracks: [],
  currentId: null,
  contextIds: [],
  manualQueue: [],
  queueCursor: -1,
  view: "home",
  query: "",
  authenticated: false,
  onlineApi: false,
  sessionToken: "",
  canManage: false,
  userName: "",
  profile: null,
  playlists: [],
  serverHistory: [],
  serverStats: {},
  playback: null,
  adminUsers: [],
  trashTracks: [],
  libraryAudit: null,
  favoriteIds: new Set(),
  shuffle: false,
  repeat: "off",
  recentIds: safeJson(localStorage.getItem(RECENT_KEY), []),
  stats: safeJson(localStorage.getItem(STATS_KEY), {}),
  artwork: cleanArtworkCache(safeJson(localStorage.getItem(ARTWORK_KEY), {})),
  offlineIds: new Set(),
  actionTrackId: null,
  lastUiTick: 0,
  playCountMarked: false,
  currentObjectUrl: "",
  offlineScope: "",
  offlineMode: false,
  playbackUrlCache: new Map(),
  favoritesOfflineBusy: false,
  offlineBatchPaused: false,
  offlineBatchCancelled: false,
  offlineFailedIds: new Set(),
  offlineSettings: { autoFavorites:false, mirrorFavorites:false, wifiOnly:true, limitBytes:1024*1024*1024 },
  metadataScan: { busy:false, rows:[], done:0, total:0 },
  musicRequests: [],
  playlistAnalyses: [],
  requestsLoaded: false,
  requestsBusy: false,
  spotifyStatus: null,
  requestIdentify: null,
  artistImageScan: { busy:false, rows:[], done:0, total:0 },
  adminMusicRequests: [],
  adminPlaylistAnalyses: [],
  youtubeResults: [],
  youtubeQuery: "",
  youtubeBusy: false,
  youtubeConfigured: null,
  youtubeSource: "search",
  youtubeCurrent: null,
  youtubePlayer: null,
  youtubePlayerReady: false,
  youtubeListen: null,
  activePlaybackSource: "library",
  adminYouTubeListens: null,
  lastPlaybackSynced: null,
  preparedNext: null,
  preparedNextSeq: 0,
  preparingNext: null,
  playbackToken: 0,
  nativeQueueResyncTimer: null,
  needsRenderAfterBackgroundAdvance: false,
  adminLoaded: { users:false, status:false, trash:false, audit:false, requests:false, playlists:false, artists:false, youtube:false },
  dj: { active:false, mode:"taste", lastIds:[], history:[], suppressHistoryOnce:false, feedback:{} }
};

// Artwork resilience: never persist a failed/empty lookup and deduplicate concurrent requests.
const artworkInFlight = new Map();
const artworkMissUntil = new Map();
const ARTWORK_MISS_RETRY_MS = 90 * 1000;

const el = (id) => document.getElementById(id);
const htmlAudio = el("audio");
const isNativeAndroid = Boolean(window.GMusicNativeAudio?.isAvailable?.());
const NATIVE_API_ORIGIN = "https://gmusic-player.gmusic-cloud-25.workers.dev";

function createAudioFacade(node) {
  if (!isNativeAndroid) return node;
  const native = window.GMusicNativeAudio;
  const handlers = new Map();
  const st = { currentTime:0, duration:0, paused:true, volume:Number(node?.volume||0.85), playbackRate:1, readyState:0, src:"" };
  const emit = (name) => {
    for (const item of [...(handlers.get(name) || [])]) {
      try { item.cb({ type:name, target:facade }); } catch {}
      if (item.once) handlers.get(name)?.delete(item);
    }
  };
  const facade = {
    get src(){ return st.src; },
    set src(value){ st.src=String(value||""); },
    get currentTime(){ return st.currentTime; },
    set currentTime(value){ st.currentTime=Math.max(0,Number(value)||0); native.seekTo(st.currentTime*1000).catch(()=>{}); },
    get duration(){ return st.duration; },
    get paused(){ return st.paused; },
    get volume(){ return st.volume; },
    set volume(value){ st.volume=Math.max(0,Math.min(1,Number(value)||0)); native.setVolume(st.volume).catch(()=>{}); },
    get playbackRate(){ return st.playbackRate; },
    get readyState(){ return st.readyState; },
    addEventListener(name,cb,options){ if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add({cb,once:Boolean(options?.once)}); },
    removeEventListener(name,cb){ for(const item of handlers.get(name)||[])if(item.cb===cb)handlers.get(name).delete(item); },
    async play(){ await native.resume(); },
    async pause(){ await native.pause(); },
    async load(){ return; },
    removeAttribute(name){ if(name==="src"){ st.src="";st.currentTime=0;st.duration=0;st.readyState=0;native.stop().catch(()=>{}); } },
    _sync(data){
      const wasPaused=st.paused;
      const firstMetadata=st.readyState<1 && Number(data?.durationMs||0)>0;
      st.paused=!Boolean(data?.isPlaying);
      st.currentTime=Math.max(0,Number(data?.positionMs||0)/1000);
      st.duration=Math.max(0,Number(data?.durationMs||0)/1000);
      if(st.duration>0)st.readyState=4;
      if(firstMetadata)emit("loadedmetadata");
      emit("timeupdate");
      if(wasPaused!==st.paused){emit(st.paused?"pause":"play");if(!st.paused)emit("playing");}
    },
    _queueEnded(){ st.paused=true;emit("pause");emit("ended"); },
    _error(){ emit("error"); }
  };
  native.onPlaybackStateChanged(data=>facade._sync(data));
  native.onTrackChanged(data=>handleNativeTrackChanged(data));
  native.onQueueEnded(()=>facade._queueEnded());
  native.onError(data=>{console.warn("[GMusic native]",data?.message||"Error de reproducción");facade._error();});
  return facade;
}

const audio = createAudioFacade(htmlAudio);
const trackList = el("trackList");
const emptyState = el("emptyState");
const collectionGrid = el("collectionGrid");
const searchInput = el("searchInput");
const uploadDialog = el("uploadDialog");
const accessDialog = el("accessDialog");
const queueDialog = el("queueDialog");
const actionDialog = el("actionDialog");
const trackListHeader = el("trackListHeader");
const uploadForm = el("uploadForm");
const fileInput = el("fileInput");
const dropzone = el("dropzone");
const npSheet = el("nowPlayingSheet");
const profileDialog = el("profileDialog");
const playlistDialog = el("playlistDialog");
const editTrackDialog = el("editTrackDialog");
const offlineDialog = el("offlineDialog");
const adminOnlyDom = [];

boot();

async function boot() {
  restoreQueue();
  bindEvents();
  initAdminOnlyDom();
  audio.volume = Number(el("volume").value);
  el("versionLabel").textContent = `v${VERSION}`;
  setupMediaSession();
  await restoreNativeSecureSession();
  await checkApi();
  await checkSession();
  if (state.authenticated) {
    loadOfflineSettings();
    if (state.onlineApi) {
      await migrateLegacyOfflineCache();
      await loadUserBundle();
      await loadTracks();
      await maybeShowOnboarding();
    } else {
      loadOfflineLibrary();
    }
  }
  render();
  await syncNativeUiFromPlayer();
  registerServiceWorker();
}

function bindEvents() {
  el("uploadBtn").addEventListener("click", () => requireAccessThen(openUpload));
  el("emptyUploadBtn").addEventListener("click", () => requireAccessThen(openUpload));
  el("accessBtn").addEventListener("click", openAccessDialog);
  el("profileBtn").addEventListener("click", openProfileDialog);
  el("saveProfileBtn").addEventListener("click", saveProfile);
  el("profileGender").addEventListener("change", suggestThemeFromGender);
  el("playlistAction").addEventListener("click", openPlaylistForAction);
  el("createPlaylistBtn").addEventListener("click", createPlaylistFromDialog);
  el("loginBtn").addEventListener("click", login);
  el("accessInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); login(); } });
  el("logoutBtn").addEventListener("click", logout);
  el("queueBtn").addEventListener("click", openQueue);
  el("queueTopBtn").addEventListener("click", openQueue);
  el("clearQueueBtn").addEventListener("click", () => { state.manualQueue = []; saveQueue(); renderQueue(); updateQueueCount(); });
  el("playNextAction").addEventListener("click", () => actionQueue("next"));
  el("queueAction").addEventListener("click", () => actionQueue("queue"));
  el("offlineAction").addEventListener("click", toggleOfflineAction);
  el("favoriteAction").addEventListener("click", async () => { if (state.actionTrackId) await toggleFavorite(state.actionTrackId); actionDialog.close(); });
  el("editAction").addEventListener("click", openMetadataEditor);
  el("deleteAction").addEventListener("click", async () => { if (state.actionTrackId) await deleteTrack(state.actionTrackId); actionDialog.close(); });
  el("saveTrackMetadataBtn").addEventListener("click", saveTrackMetadata);
  el("resumeAudioBtn").addEventListener("click", resumeAudio);
  el("nowFavBtn").addEventListener("click", () => { if (state.currentId) toggleFavorite(state.currentId); });
  el("nowPlayingOpen").addEventListener("click", () => { if (state.currentId) openNowPlaying(); });
  el("npCloseBtn").addEventListener("click", closeNowPlaying);
  el("npFavBtn").addEventListener("click", () => { if (state.currentId) toggleFavorite(state.currentId); });
  el("npPlayBtn").addEventListener("click", togglePlay);
  el("npPrevBtn").addEventListener("click", previousTrack);
  el("npNextBtn").addEventListener("click", () => nextTrack(false));
  el("npShuffleBtn").addEventListener("click", toggleShuffle);
  el("npRepeatBtn").addEventListener("click", cycleRepeat);
  el("npMoreBtn").addEventListener("click", () => { if (state.currentId) openActions(state.currentId); });
  el("npSeek").addEventListener("input", (e) => { if (Number.isFinite(audio.duration)) { audio.currentTime = (Number(e.target.value) / 100) * audio.duration; syncTimeline(true); updateMediaPosition(); } });

  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => el(button.dataset.close).close()));
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view, button)));

  searchInput.addEventListener("input", () => { state.query = normalize(searchInput.value); render(); });
  fileInput.addEventListener("change", () => prepareFiles([...fileInput.files]));
  ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
  dropzone.addEventListener("drop", (e) => { const files = [...(e.dataTransfer.files || [])]; if (!files.length) return; const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); fileInput.files = dt.files; prepareFiles(files); });
  uploadForm.addEventListener("submit", uploadTracks);

  el("playBtn").addEventListener("click", togglePlay);
  el("prevBtn").addEventListener("click", previousTrack);
  el("nextBtn").addEventListener("click", () => nextTrack(false));
  el("shuffleBtn").addEventListener("click", toggleShuffle);
  el("shuffleMiniBtn").addEventListener("click", toggleShuffle);
  el("repeatBtn").addEventListener("click", cycleRepeat);
  el("repeatMiniBtn").addEventListener("click", cycleRepeat);
  el("favoritesOfflineBtn")?.addEventListener("click", downloadFavoritesOffline);
  el("offlineCenterBtn")?.addEventListener("click", openOfflineCenter);
  el("profileOfflineBtn")?.addEventListener("click", () => { profileDialog.close(); openOfflineCenter(); });
  el("offlineDownloadFavorites")?.addEventListener("click", downloadFavoritesOffline);
  el("offlinePauseBtn")?.addEventListener("click", toggleOfflineBatchPause);
  el("offlineCancelBtn")?.addEventListener("click", cancelOfflineBatch);
  el("offlineRetryBtn")?.addEventListener("click", retryOfflineFailures);
  el("offlineDeleteAllBtn")?.addEventListener("click", deleteAllOfflineDownloads);
  el("offlineAutoFavorites")?.addEventListener("change", saveOfflineSettingsFromDialog);
  el("offlineMirrorFavorites")?.addEventListener("change", saveOfflineSettingsFromDialog);
  el("offlineWifiOnly")?.addEventListener("change", saveOfflineSettingsFromDialog);
  el("offlineLimit")?.addEventListener("change", saveOfflineSettingsFromDialog);
  el("youtubeDialog")?.addEventListener("close", () => { if(state.activePlaybackSource==="youtube") pauseYouTubePlayback("dialog_closed"); });
  el("youtubeDialog")?.addEventListener("cancel", () => { if(state.activePlaybackSource==="youtube") pauseYouTubePlayback("dialog_closed"); });
  el("volume").addEventListener("input", (e) => audio.volume = Number(e.target.value));
  el("seek").addEventListener("input", (e) => { if (Number.isFinite(audio.duration)) { audio.currentTime = (Number(e.target.value) / 100) * audio.duration; syncTimeline(true); updateMediaPosition(); } });

  // v3.5.6: restore the simple v3.0 media lifecycle. The active <audio> source is never
  // replaced before its natural `ended` event. We may pre-resolve the next URL, but only
  // the authoritative ended/next action is allowed to advance the queue.
  audio.addEventListener("timeupdate", () => { syncTimeline(false); refreshPreparedNextNearTrackEnd(); });
  audio.addEventListener("loadedmetadata", () => { syncTimeline(true); updateMediaPosition(); warmNextPlaybackUrl({ minValidityMs: document.hidden ? 240000 : 180000 }); });
  audio.addEventListener("play", () => {
    if(state.activePlaybackSource!=="youtube"){state.activePlaybackSource="library";setupLibraryMediaSessionHandlers();}
    syncPlayerButtons();
    el("audioGate").classList.add("hidden");
    warmNextPlaybackUrl({ minValidityMs: document.hidden ? 240000 : 120000 });
  });
  audio.addEventListener("playing", () => syncPlayerButtons());
  audio.addEventListener("pause", () => { syncPlayerButtons(); persistPlaybackNow(true); });
  audio.addEventListener("ended", () => nextTrack(true));
  audio.addEventListener("error", () => toast("No se pudo reproducir este archivo."));
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("background-mode", document.hidden);
    if (document.hidden) {
      // Safari/iOS is much more reliable if the next signed URL is already resolved
      // before the current media session reaches `ended` while the screen is locked.
      warmNextPlaybackUrl({ minValidityMs: 240000, refreshCandidate: true });
      persistPlaybackNow(true);
      pauseYouTubePlayback("background");
    } else {
      if(state.needsRenderAfterBackgroundAdvance){state.needsRenderAfterBackgroundAdvance=false;render();}
      if(isNativeAndroid)syncNativeUiFromPlayer();
      hydrateArtwork();
    }
  });
  window.addEventListener("pagehide", () => persistPlaybackNow(true));
  window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener?.("change", () => { if ((state.profile?.appearance || "auto") === "auto") applyTheme(); });
}

function setView(view, button) {
  if (state.view === "discover" && view !== "discover") pauseYouTubePlayback("view_changed");
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b === button));
  const titles = { home: "Inicio", all: "Tu biblioteca", artists: "Artistas", albums: "Álbumes", favorites: "Favoritos", recent: "Escuchado recientemente", playlists: "Tus playlists", discover: "Descubrir y DJ", stats: "Tus estadísticas", requests: "Solicitudes", admin: "Administración" };
  el("pageTitle").textContent = titles[view] || "GMusic";
  render();
}

function openUpload() {
  fileInput.value = "";
  el("fileLabel").textContent = "Elige o arrastra canciones";
  el("uploadPreview").innerHTML = "";
  el("uploadProgress").textContent = "";
  uploadDialog.showModal();
}

function openAccessDialog() {
  el("accessInput").value = "";
  setAccessStatus(state.authenticated ? "Ya tienes una sesión activa en este dispositivo." : "", "neutral");
  accessDialog.showModal();
  setTimeout(() => el("accessInput").focus(), 50);
}

async function login() {
  const accessKey = el("accessInput").value.trim();
  const button = el("loginBtn");
  if (!accessKey) return setAccessStatus("Pega tu código privado de GMusic.", "error");
  button.disabled = true; button.textContent = "Comprobando…"; setAccessStatus("Conectando…", "neutral");
  try {
    const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify({ access_key: accessKey }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) return setAccessStatus(data.error || "No se pudo iniciar sesión.", "error");
    state.sessionToken = String(data.session_token || "");
    localStorage.removeItem(LEGACY_SESSION_KEY); el("accessInput").value = "";
    if (!await verifySessionToken()) return setAccessStatus("No se pudo validar la sesión.", "error");
    state.authenticated = true; state.offlineMode = false; persistOfflineSession(); applyRoleUI(); updateConnectionBadge();
    setAccessStatus(state.userName ? `Hola, ${state.userName} ✓` : "Acceso correcto ✓", "ok");
    await loadUserBundle(); await loadTracks(); accessDialog.close(); await maybeShowOnboarding();
  } catch { setAccessStatus("No se pudo contactar con GMusic.", "error"); }
  finally { button.disabled = false; button.textContent = "Entrar"; }
}

async function logout() {
  await apiFetch("/api/session", { method: "DELETE" }).catch(() => {});
  await window.GMusicNativeAudio?.stop?.().catch(()=>{});
  await window.GMusicNativeAudio?.setSessionToken?.("").catch(()=>{});
  await window.GMusicSecureSession?.clear?.().catch(()=>{});
  clearLocalSession(); state.authenticated = false; state.tracks = []; state.currentId = null; state.contextIds = []; state.manualQueue = []; state.canManage = false; state.userName = ""; state.profile = null; state.playlists = []; state.serverHistory = []; state.serverStats = {}; state.favoriteIds = new Set(); state.musicRequests=[]; state.playlistAnalyses=[]; state.requestsLoaded=false; state.spotifyStatus=null; state.youtubeResults=[]; state.youtubeCurrent=null; state.adminYouTubeListens=null; state.dj={active:false,mode:"taste",lastIds:[],history:[],suppressHistoryOnce:false,feedback:{}}; state.activePlaybackSource="none"; pauseYouTubePlayback("logout"); localStorage.removeItem(QUEUE_KEY); applyRoleUI(); closeNowPlaying(); audio.pause(); audio.removeAttribute("src"); audio.load(); accessDialog.close(); render();
}

function clearLocalSession() {
  state.sessionToken = "";
  state.offlineMode = false;
  state.offlineScope = "";
  localStorage.removeItem(LEGACY_SESSION_KEY);
  localStorage.removeItem(OFFLINE_SESSION_KEY);
}
function persistOfflineSession() {
  if (!state.authenticated || !state.offlineScope) return;
  localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify({ scope: state.offlineScope, name: state.userName || "", saved_at: Date.now() }));
  if(isNativeAndroid && state.sessionToken){
    window.GMusicSecureSession?.save?.({token:state.sessionToken,scope:state.offlineScope,name:state.userName||""}).catch(()=>{});
    window.GMusicNativeAudio?.setSessionToken?.(state.sessionToken).catch(()=>{});
  }
}
async function restoreNativeSecureSession(){
  if(!isNativeAndroid || !window.GMusicSecureSession?.isAvailable?.())return;
  try{
    const saved=await window.GMusicSecureSession.get();
    if(!saved?.exists||!saved.token)return;
    state.sessionToken=String(saved.token||"");
    if(saved.scope)localStorage.setItem(OFFLINE_SESSION_KEY,JSON.stringify({scope:String(saved.scope),name:String(saved.name||""),saved_at:Date.now()}));
    await window.GMusicNativeAudio?.setSessionToken?.(state.sessionToken).catch(()=>{});
  }catch{}
}
function restoreOfflineSession() {
  const saved = safeJson(localStorage.getItem(OFFLINE_SESSION_KEY), null);
  if (!saved?.scope) return false;
  state.offlineScope = String(saved.scope);
  state.userName = String(saved.name || "");
  state.canManage = false; // las funciones de gestión nunca se habilitan sin validar contra el servidor
  state.offlineMode = true;
  state.authenticated = true;
  return true;
}
async function checkApi() { try { const r = await fetch("/api/health", { cache: "no-store" }); const d = await r.json(); state.onlineApi = Boolean(r.ok && d.ok); } catch { state.onlineApi = false; } updateConnectionBadge(); }
async function verifySessionToken() {
  try {
    const r = await apiFetch("/api/session", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.authenticated) return false;
    state.canManage = Boolean(d.capabilities?.manageLibrary && d.capabilities?.manageUsers); state.userName = d.name || ""; state.offlineScope = String(d.offline_scope || ""); state.offlineMode = false; persistOfflineSession();
    return true;
  } catch { return false; }
}
async function checkSession() {
  if (state.onlineApi) {
    state.authenticated = await verifySessionToken();
    if (state.authenticated) persistOfflineSession();
    else {
      clearLocalSession();
      if(isNativeAndroid){await window.GMusicNativeAudio?.setSessionToken?.("").catch(()=>{});await window.GMusicSecureSession?.clear?.().catch(()=>{});}
    }
  } else {
    state.authenticated = restoreOfflineSession();
  }
  applyRoleUI(); updateConnectionBadge();
}
function applyRoleUI() {
  const canManage = state.authenticated && state.canManage;
  syncAdminOnlyDom(canManage);
  syncDiagnosticControl(canManage);
  if(!canManage && state.view==="admin"){ state.view="home"; document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view==="home")); }
  el("emptyStateText").textContent = canManage ? "Sube tus archivos de audio y aparecerán aquí." : "Todavía no hay canciones en la biblioteca.";
  el("profileBtn").classList.toggle("hidden", !state.authenticated);
  el("profileName").textContent = state.profile?.name || state.userName || "Perfil";
}

function initAdminOnlyDom() {
  if (adminOnlyDom.length) return;
  document.querySelectorAll("[data-admin-only]").forEach((node) => {
    const marker = document.createComment("gmusic-private-control");
    node.parentNode?.insertBefore(marker, node);
    adminOnlyDom.push({ node, marker });
  });
}
function syncAdminOnlyDom(allowed) {
  if (!adminOnlyDom.length) initAdminOnlyDom();
  for (const { node, marker } of adminOnlyDom) {
    if (allowed) {
      if (!node.isConnected && marker.parentNode) marker.parentNode.insertBefore(node, marker.nextSibling);
      node.classList.remove("hidden");
    } else if (node.isConnected) {
      node.remove();
    }
  }
}
function syncDiagnosticControl(allowed) {
  const existing = el("diagnosticBtn");
  if (!allowed) { existing?.remove(); return; }
  if (existing) return;
  const loginBtn = el("loginBtn");
  if (!loginBtn?.parentElement) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost";
  button.id = "diagnosticBtn";
  button.textContent = "Diagnóstico";
  button.addEventListener("click", runDiagnostics);
  loginBtn.parentElement.insertBefore(button, loginBtn);
}
async function loadFavorites() {
  if (!state.authenticated) { state.favoriteIds = new Set(); return; }
  try {
    const r = await apiFetch("/api/favorites"); const d = await r.json().catch(() => ({}));
    state.favoriteIds = new Set(r.ok ? (d.ids || []) : []);
  } catch { state.favoriteIds = new Set(); }
}
function openNowPlaying() { npSheet.classList.add("open"); npSheet.setAttribute("aria-hidden", "false"); }
function closeNowPlaying() { npSheet.classList.remove("open"); npSheet.setAttribute("aria-hidden", "true"); }
async function runDiagnostics() { try { const r = await apiFetch("/api/diagnostics", { cache: "no-store" }); const d = await r.json().catch(()=>({})); if(!r.ok)return setAccessStatus(d.error||"Ruta no disponible.","error"); const missing = Object.entries(d.configured || {}).filter(([, ok]) => !ok).map(([k]) => k); setAccessStatus(missing.length ? `Faltan componentes: ${missing.join(", ")}` : `Worker v${d.version}: configuración correcta.`, missing.length ? "error" : "ok"); } catch { setAccessStatus("No se pudo ejecutar diagnóstico.", "error"); } }
function setAccessStatus(message, type = "neutral") { const n = el("accessStatus"); n.textContent = message; n.dataset.type = type; }
function updateConnectionBadge() { el("connectionBadge").textContent = !state.onlineApi ? (state.authenticated ? "⬇ Sin conexión · biblioteca offline" : "⚠ Sin conexión") : state.authenticated ? "☁ Google Drive conectado" : "🔐 Falta iniciar sesión"; }
function requireAccessThen(callback) { state.authenticated ? callback() : (openAccessDialog(), toast("Primero inicia sesión.")); }

async function loadTracks() {
  if (!state.authenticated) return render();
  if (!state.onlineApi) { loadOfflineLibrary(); return; }
  try {
    const response = await apiFetch("/api/tracks"); const data = await response.json().catch(() => ({}));
    if (response.status === 401) { clearLocalSession(); state.authenticated = false; state.tracks = []; return render(); }
    if (!response.ok) throw new Error(data.detail || data.error || "No se pudo cargar la biblioteca");
    state.tracks = data.tracks || [];
    const validIds = new Set(state.tracks.map((t) => t.id));
    const restoredContext = (Array.isArray(state.contextIds) ? state.contextIds : []).filter((id) => validIds.has(id));
    state.contextIds = restoredContext.length ? restoredContext : state.tracks.map((t) => t.id);
    state.manualQueue = (Array.isArray(state.manualQueue) ? state.manualQueue : []).filter((id) => validIds.has(id));
    if (state.currentId && !validIds.has(state.currentId)) state.currentId = null;
    state.queueCursor = state.currentId ? state.contextIds.indexOf(state.currentId) : -1;
    persistOfflineTrackSnapshot();
    updateConnectionBadge(); render(); hydrateArtwork();
  } catch (error) { toast(error.message || "No se pudo cargar GMusic."); }
}

function visibleTracks() {
  let tracks = state.tracks;
  if (state.view === "favorites") tracks = tracks.filter((t) => state.favoriteIds.has(t.id));
  if (state.view === "recent") tracks = state.recentIds.map((id) => trackById(id)).filter(Boolean);
  if (state.query) tracks = tracks.filter((t) => [t.title, t.artist, t.album, ...(t.artist_names||[])].some((v) => normalize(v).includes(state.query)));
  return tracks;
}

function render() {
  updateQueueCount(); syncPlayerButtons(); updateFavoritesOfflineButton(); updateOfflineCenterButton();
  if (state.view === "home") return renderHome();
  if (state.view === "artists") return renderArtists();
  if (state.view === "albums") return renderAlbums();
  if (state.view === "playlists") return renderPlaylists();
  if (state.view === "discover") return renderDiscover();
  if (state.view === "stats") return renderStats();
  if (state.view === "requests") return renderRequests();
  if (state.view === "admin") return renderAdmin();
  collectionGrid.classList.add("hidden"); trackList.classList.remove("hidden");
  const visible = visibleTracks();
  el("trackCount").textContent = `${visible.length} ${visible.length === 1 ? "canción" : "canciones"}`;
  emptyState.classList.toggle("hidden", visible.length > 0);
  trackList.classList.toggle("hidden", visible.length === 0);
  trackListHeader.classList.toggle("hidden", visible.length === 0);
  trackList.innerHTML = visible.map((t, i) => trackRow(t, i + 1)).join("");
  bindTrackRows(visible.map((t) => t.id));
}

function isFavorite(id) { return state.favoriteIds.has(id); }

function trackRow(track, index) {
  const playing = track.id === state.currentId;
  const art = getTrackArtwork(track) || "/icon.svg";
  return `<article class="track ${playing ? "playing" : ""}" data-id="${esc(track.id)}">
    <div class="track-num"><span class="num">${playing ? "♫" : (index ?? "")}</span><button class="track-play" data-play="${esc(track.id)}" aria-label="Reproducir">${playing && !audio.paused ? "❚❚" : "▶"}</button></div>
    <img class="track-cover" loading="lazy" data-cover-for="${esc(track.id)}" src="${esc(art)}" alt="" />
    <div class="track-title"><div>${esc(track.title)}</div><div class="track-sub">${state.offlineIds.has(track.id)?"⬇ Disponible offline · ":""}${formatBytes(track.size_bytes)} · ${formatTime(track.duration_seconds)}</div></div>
    <button class="linkish track-artist" data-artist="${esc(track.artist)}">${esc(track.artist)}</button>
    <div class="track-album">${esc(track.album)}</div>
    <div class="track-actions"><button class="quick-next" data-nextquick="${esc(track.id)}" title="Reproducir siguiente" aria-label="Reproducir siguiente">⏭</button><button class="quick-queue" data-queuequick="${esc(track.id)}" title="Agregar a la cola" aria-label="Agregar a la cola">☷＋</button><button class="fav ${isFavorite(track.id) ? "on" : ""}" data-fav="${esc(track.id)}" title="Favorito">♥</button><button data-more="${esc(track.id)}" title="Más opciones">⋯</button></div>
  </article>`;
}

function bindTrackRows(contextIds) {
  trackList.querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => playInContext(contextIds, b.dataset.play)));
  trackList.querySelectorAll("[data-nextquick]").forEach((b) => b.addEventListener("click", () => playNextQueued(b.dataset.nextquick)));
  trackList.querySelectorAll("[data-queuequick]").forEach((b) => b.addEventListener("click", () => enqueue(b.dataset.queuequick)));
  trackList.querySelectorAll("[data-fav]").forEach((b) => b.addEventListener("click", () => toggleFavorite(b.dataset.fav)));
  trackList.querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => openActions(b.dataset.more)));
  trackList.querySelectorAll("[data-artist]").forEach((b) => b.addEventListener("click", () => showArtist(b.dataset.artist)));
}


function greetingText(){
  const h=new Date().getHours(); const name=state.profile?.name||state.userName||"";
  const g=h<12?"Buenos días":h<19?"Buenas tardes":"Buenas noches";
  return name?`${g}, ${name}`:g;
}
function renderHome(){
  trackList.classList.add("hidden"); trackListHeader.classList.add("hidden"); emptyState.classList.add("hidden"); collectionGrid.classList.remove("hidden");
  const recent=state.recentIds.map(trackById).filter(Boolean).slice(0,6);
  const favorites=state.tracks.filter(t=>state.favoriteIds.has(t.id)).slice(0,6);
  const newest=[...state.tracks].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,6);
  const topIds=Object.entries(state.stats||{}).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,6).map(([id])=>id);
  const top=topIds.map(trackById).filter(Boolean);
  const continueTrack=state.playback?.currentId?trackById(state.playback.currentId):null;
  el("pageTitle").textContent=greetingText(); el("trackCount").textContent=`${state.tracks.length} canciones`;
  const section=(title,items)=>items.length?`<section class="home-section"><div class="section-head"><h2>${esc(title)}</h2></div><div class="home-cards">${items.map(t=>homeTrackCard(t)).join("")}</div></section>`:"";
  collectionGrid.innerHTML=`<div class="home-stack">${continueTrack?`<section class="continue-card"><img data-cover-for="${esc(continueTrack.id)}" src="${esc(getTrackArtwork(continueTrack)||"/icon.svg")}" alt=""><div><span class="eyebrow">CONTINUAR ESCUCHANDO</span><strong>${esc(continueTrack.title)}</strong><small>${esc(continueTrack.artist)} · ${formatTime(state.playback.position||0)}</small><button class="primary" data-continue="${esc(continueTrack.id)}">▶ Continuar</button></div></section>`:""}${section("Escuchado recientemente",recent)}${section("Tus favoritos",favorites)}${section("Más escuchadas",top)}${section("Añadidas recientemente",newest)}</div>`;
  collectionGrid.querySelectorAll("[data-home-play]").forEach(b=>b.addEventListener("click",()=>playInContext(state.tracks.map(t=>t.id),b.dataset.homePlay)));
  const cont=collectionGrid.querySelector("[data-continue]"); if(cont)cont.addEventListener("click",()=>resumeSavedPlayback(cont.dataset.continue));
  hydrateArtwork();
}
function homeTrackCard(t){return `<button class="home-track-card" data-home-play="${esc(t.id)}"><img loading="lazy" data-cover-for="${esc(t.id)}" src="${esc(getTrackArtwork(t)||"/icon.svg")}" alt=""><span><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></span><b>▶</b></button>`;}
async function resumeSavedPlayback(id){
  await playInContext(state.tracks.map(t=>t.id),id);
  const pos=Number(state.playback?.position||0); if(pos>0){ const set=()=>{try{audio.currentTime=Math.min(pos,Math.max(0,(audio.duration||pos)-1));}catch{}}; if(audio.readyState>=1)set(); else audio.addEventListener("loadedmetadata",set,{once:true}); }
}

function renderArtists() {
  trackList.classList.add("hidden"); trackListHeader.classList.add("hidden"); emptyState.classList.add("hidden"); collectionGrid.classList.remove("hidden");
  const groups = new Map();
  for (const track of state.tracks) {
    const names = Array.isArray(track.artist_names) && track.artist_names.length ? track.artist_names : splitArtists(track.artist);
    for (const name of (names.length ? names : [track.artist || "Artista desconocido"])) {
      const key = normalize(name);
      if (!groups.has(key)) groups.set(key, { name, tracks: [] });
      groups.get(key).tracks.push(track);
    }
  }
  const items = [...groups.values()].sort((a,b) => a.name.localeCompare(b.name,"es",{sensitivity:"base"}));
  el("trackCount").textContent = `${items.length} artistas`;
  collectionGrid.innerHTML = items.map(({name, tracks}) => `<div class="collection-card" data-open-artist="${esc(name)}" tabindex="0" role="button"><div class="cover-wrap round"><img loading="lazy" data-artist-image="${esc(name)}" src="${esc(getArtistArtwork(name) || "/icon.svg")}" alt=""/><button class="card-play" data-play-artist="${esc(name)}" aria-label="Reproducir ${esc(name)}">▶</button></div><strong>${esc(name)}</strong><span>Artista · ${tracks.length} ${tracks.length===1?"canción":"canciones"}</span></div>`).join("");
  collectionGrid.querySelectorAll("[data-open-artist]").forEach((b) => b.addEventListener("click", () => showArtist(b.dataset.openArtist)));
  collectionGrid.querySelectorAll("[data-open-artist]").forEach((b) => b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showArtist(b.dataset.openArtist); } }));
  collectionGrid.querySelectorAll("[data-play-artist]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const name = b.dataset.playArtist; const tracks = groups.get(normalize(name))?.tracks || []; if (tracks[0]) playInContext(tracks.map(t=>t.id), tracks[0].id); }));
  hydrateArtwork();
}

function renderAlbums() {
  trackList.classList.add("hidden"); trackListHeader.classList.add("hidden"); emptyState.classList.add("hidden"); collectionGrid.classList.remove("hidden");
  const known=state.tracks.filter(t=>!isUnknownAlbum(t.album));
  const groups=groupBy(known,t=>`${normalize(primaryArtist(t.artist))}|||${t.album_key||normalize(t.album)}`);
  const items=[...groups.values()].sort((a,b)=>(a[0].year||"9999").localeCompare(b[0].year||"9999")||a[0].album.localeCompare(b[0].album));
  const singles=state.tracks.filter(t=>isUnknownAlbum(t.album));
  el("trackCount").textContent=`${items.length} álbumes · ${singles.length} singles/sin álbum`;
  collectionGrid.innerHTML=`<div class="discography-grid">${items.map(tracks=>albumCard(tracks)).join("")}</div>${singles.length?`<section class="home-section singles-section"><div class="section-head"><h2>Singles y canciones sin álbum</h2></div><div class="home-cards">${singles.slice(0,30).map(homeTrackCard).join("")}</div></section>`:""}`;
  collectionGrid.querySelectorAll("[data-open-album]").forEach(b=>b.addEventListener("click",()=>showAlbumByKey(b.dataset.openAlbum)));
  collectionGrid.querySelectorAll("[data-play-album]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const tracks=groups.get(b.dataset.playAlbum)||[];if(tracks[0])playInContext(sortAlbumTracks(tracks).map(t=>t.id),sortAlbumTracks(tracks)[0].id);}));
  collectionGrid.querySelectorAll("[data-home-play]").forEach(b=>b.addEventListener("click",()=>playInContext(singles.map(t=>t.id),b.dataset.homePlay)));
  hydrateArtwork();
}
function albumCard(tracks){const t=tracks[0];const key=`${normalize(primaryArtist(t.artist))}|||${t.album_key||normalize(t.album)}`;return `<div class="collection-card" data-open-album="${esc(key)}" tabindex="0" role="button"><div class="cover-wrap"><img loading="lazy" data-cover-for="${esc(t.id)}" src="${esc(getArtwork(t,"album")||"/icon.svg")}" alt=""><button class="card-play" data-play-album="${esc(key)}" aria-label="Reproducir ${esc(t.album)}">▶</button></div><strong>${esc(t.album)}</strong><span>${esc(primaryArtist(t.artist))}${t.year?` · ${esc(t.year)}`:""} · ${tracks.length} canciones</span></div>`;}
function showAlbumByKey(key){const [artistKey,albumKey]=String(key).split("|||");const tracks=state.tracks.filter(t=>normalize(primaryArtist(t.artist))===artistKey&&(t.album_key||normalize(t.album))===albumKey);if(!tracks.length)return;showAlbum(primaryArtist(tracks[0].artist),tracks[0].album);}
function sortAlbumTracks(tracks){return [...tracks].sort((a,b)=>parseTrackNumber(a.track_number)-parseTrackNumber(b.track_number)||String(a.created_at).localeCompare(String(b.created_at)));}
function parseTrackNumber(v){const n=parseInt(String(v||"").split("/")[0],10);return Number.isFinite(n)?n:9999;}

function showArtist(name) {
  state.view="custom"; document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));
  const tracks=state.tracks.filter(t=>(Array.isArray(t.artist_names)?t.artist_names:splitArtists(t.artist)).some(a=>normalize(a)===normalize(name))||normalize(t.artist)===normalize(name));
  const albumGroups=groupBy(tracks.filter(t=>!isUnknownAlbum(t.album)),t=>normalize(t.album));
  const albums=[...albumGroups.values()].sort((a,b)=>(a[0].year||"9999").localeCompare(b[0].year||"9999"));
  const singles=tracks.filter(t=>isUnknownAlbum(t.album));
  el("pageTitle").textContent=name; collectionGrid.classList.remove("hidden");trackList.classList.remove("hidden");trackListHeader.classList.remove("hidden");emptyState.classList.add("hidden");
  collectionGrid.innerHTML=`<div class="artist-hero"><img data-artist-image="${esc(name)}" src="${esc(getArtistArtwork(name)||"/icon.svg")}" alt=""><div><p class="eyebrow">ARTISTA</p><h2>${esc(name)}</h2><p>${tracks.length} canciones · ${albums.length} álbumes · ${singles.length} singles</p><button id="playArtistBtn" class="primary">▶ Reproducir</button></div></div>${albums.length?`<section class="home-section artist-discography"><div class="section-head"><h2>Discografía</h2></div><div class="discography-grid">${albums.map(albumCard).join("")}</div></section>`:""}`;
  const ordered=[...albums.flatMap(sortAlbumTracks),...singles]; trackList.innerHTML=ordered.map((t,i)=>trackRow(t,i+1)).join("");bindTrackRows(ordered.map(t=>t.id));
  el("playArtistBtn").addEventListener("click",()=>ordered[0]&&playInContext(ordered.map(t=>t.id),ordered[0].id));
  collectionGrid.querySelectorAll("[data-open-album]").forEach(b=>b.addEventListener("click",()=>showAlbumByKey(b.dataset.openAlbum)));
  hydrateArtwork();
}

function showAlbum(artist, album) {
  state.view="custom"; document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));
  const tracks=sortAlbumTracks(state.tracks.filter(t=>normalize(primaryArtist(t.artist))===normalize(artist)&&normalize(t.album)===normalize(album)));
  el("pageTitle").textContent=album;collectionGrid.classList.remove("hidden");trackList.classList.remove("hidden");trackListHeader.classList.toggle("hidden",!tracks.length);emptyState.classList.toggle("hidden",!!tracks.length);
  const t=tracks[0];const art=t?getArtwork(t,"album"):"";const total=tracks.reduce((n,x)=>n+Number(x.duration_seconds||0),0);
  collectionGrid.innerHTML=`<div class="artist-hero"><img data-cover-for="${esc(t?.id||"")}" src="${esc(art||"/icon.svg")}" alt=""><div><p class="eyebrow">ÁLBUM</p><h2>${esc(album)}</h2><p>${esc(artist)}${t?.year?` · ${esc(t.year)}`:""} · ${tracks.length} canciones · ${formatTime(total)}</p><div class="hero-buttons"><button id="playAlbumBtn" class="primary">▶ Reproducir</button><button id="queueAlbumBtn" class="ghost">☷ Agregar a cola</button></div></div></div>`;
  trackList.innerHTML=tracks.map((x,i)=>trackRow(x,i+1)).join("");bindTrackRows(tracks.map(x=>x.id));
  el("playAlbumBtn")?.addEventListener("click",()=>tracks[0]&&playInContext(tracks.map(x=>x.id),tracks[0].id));
  el("queueAlbumBtn")?.addEventListener("click",()=>{for(const x of tracks)if(x.id!==state.currentId)state.manualQueue.push(x.id);saveQueue();updateQueueCount();toast("Álbum agregado a la cola");}); hydrateArtwork();
}

function groupBy(items, keyFn) { const m = new Map(); for (const x of items) { const k=keyFn(x); if (!m.has(k)) m.set(k,[]); m.get(k).push(x); } return m; }
function trackById(id) { return state.tracks.find((t) => t.id === id); }

async function playInContext(contextIds, id) {
  state.contextIds = [...contextIds]; state.queueCursor = state.contextIds.indexOf(id); state.currentId = id; state.playCountMarked = false; saveQueue({syncNative:false});
  await playTrack(id);
}

function shuffledNativeIds(ids){
  const out=[...ids];
  for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function buildNativeDjTail(currentId,count=30){
  const result=[];
  const used=new Set([currentId,...state.manualQueue]);
  let simulatedCurrent=currentId;
  let simulatedLast=[...state.dj.lastIds];
  for(let i=0;i<count;i++){
    const pool=state.tracks.filter(t=>t?.id&&!used.has(t.id));
    if(!pool.length)break;
    const recentArtists=simulatedLast.map(id=>primaryDjArtist(trackById(id))).filter(Boolean).slice(0,6);
    const next=chooseDjTrack(pool,{currentId:simulatedCurrent,mode:state.dj.mode,stats:state.stats,favoriteIds:state.favoriteIds,recentIds:state.recentIds,recentArtists,djLastIds:simulatedLast,feedback:state.dj.feedback});
    if(!next?.id)break;
    result.push(next.id);used.add(next.id);simulatedCurrent=next.id;simulatedLast=[next.id,...simulatedLast.filter(x=>x!==next.id)].slice(0,12);
  }
  return result;
}
function buildNativeQueueLayout(startId){
  const valid=(id)=>Boolean(id&&trackById(id));
  const manual=[];const manualSeen=new Set();
  for(const id of state.manualQueue){if(valid(id)&&id!==startId&&!manualSeen.has(id)){manual.push(id);manualSeen.add(id);}}
  if(state.dj.active){
    const before=(state.dj.history||[]).filter(valid).filter(id=>id!==startId).slice(-8);
    const tail=buildNativeDjTail(startId,30);
    const ids=[...before,startId,...manual,...tail.filter(id=>!manualSeen.has(id))].filter(valid);
    return {ids,startIndex:Math.max(0,before.length)};
  }
  const context=(state.contextIds.length?state.contextIds:state.tracks.map(t=>t.id)).filter(valid);
  const currentIndex=context.indexOf(startId);
  const before=currentIndex>0?context.slice(0,currentIndex):[];
  let after=currentIndex>=0?context.slice(currentIndex+1):context.filter(id=>id!==startId);
  after=after.filter(id=>!manualSeen.has(id)&&id!==startId);
  if(state.shuffle)after=shuffledNativeIds(after);
  const ids=[...before,startId,...manual,...after].filter(valid);
  return {ids,startIndex:Math.max(0,before.length)};
}
function nativeQueueItem(id){
  const track=trackById(id);if(!track)return null;
  const artwork=getTrackArtwork(track)||"/icon.svg";
  return {
    trackId:track.id,
    url:new URL(`/api/tracks/${encodeURIComponent(track.id)}/stream`,NATIVE_API_ORIGIN).href,
    title:track.title||"",artist:track.artist||"",album:track.album||"",
    artworkUrl:new URL(artwork,NATIVE_API_ORIGIN).href
  };
}
async function syncNativeQueue({startId=state.currentId,positionMs=0,autoplay=true}={}){
  if(!isNativeAndroid||!startId)return false;
  clearTimeout(state.nativeQueueResyncTimer);state.nativeQueueResyncTimer=null;
  if(!state.sessionToken)await restoreNativeSecureSession();
  if(!state.sessionToken)throw new Error("Vuelve a iniciar sesión una vez para activar el reproductor nativo.");
  const layout=buildNativeQueueLayout(startId);
  const items=layout.ids.map(nativeQueueItem).filter(Boolean);
  if(!items.length)throw new Error("No hay canciones disponibles para la cola nativa.");
  await window.GMusicNativeAudio.setSessionToken(state.sessionToken);
  await window.GMusicNativeAudio.setQueue({items,startIndex:Math.min(layout.startIndex,items.length-1),positionMs,repeatMode:state.repeat,autoplay});
  return true;
}
function scheduleNativeQueueResync(delay=180){
  if(!isNativeAndroid||!state.currentId)return;
  clearTimeout(state.nativeQueueResyncTimer);
  state.nativeQueueResyncTimer=setTimeout(async()=>{
    state.nativeQueueResyncTimer=null;
    try{const ns=await window.GMusicNativeAudio.getState();await syncNativeQueue({startId:String(ns?.trackId||state.currentId),positionMs:Number(ns?.positionMs||0),autoplay:Boolean(ns?.isPlaying)});}catch{}
  },delay);
}
async function syncNativeUiFromPlayer(){
  if(!isNativeAndroid)return;
  try{const ns=await window.GMusicNativeAudio.getState();handleNativeTrackChanged(ns);audio._sync?.(ns);}catch{}
}
function handleNativeTrackChanged(data){
  if(!isNativeAndroid)return;
  const id=String(data?.trackId||"");const track=trackById(id);if(!track)return;
  if(state.currentId!==id){
    state.currentId=id;state.queueCursor=state.contextIds.indexOf(id);state.playCountMarked=false;
    state.manualQueue=state.manualQueue.filter(x=>x!==id);
    rememberDjTrack(id);
    saveQueue({syncNative:false});
    applyCurrentTrackPresentation(track,{renderUi:!document.hidden,openSheet:false});
    if(!document.hidden){renderQueue();updateQueueCount();}
  }
}
async function playTrackNative(id,track){
  clearPreparedNext();revokeCurrentObjectUrl();state.currentId=id;
  applyCurrentTrackPresentation(track,{renderUi:!document.hidden,openSheet:!document.hidden});
  try{await syncNativeQueue({startId:id,positionMs:0,autoplay:true});return true;}
  catch(error){if(!document.hidden)toast(error?.message||"No se pudo iniciar el reproductor nativo.");return false;}
}

async function playTrack(id,{prepared=null}={}) {
  const track = trackById(id); if (!track) return false;
  const token = ++state.playbackToken;
  pauseYouTubePlayback("library_playback");
  state.activePlaybackSource = "library";
  setupLibraryMediaSessionHandlers();
  if (el("youtubeDialog")?.open) el("youtubeDialog").close();
  rememberDjTrack(id);
  if(isNativeAndroid)return playTrackNative(id,track);

  // A prepared entry is only an already-resolved source. It never starts playback by itself
  // and never replaces the currently playing source before ended/Next.
  let preparedSource = prepared && prepared.id===id && prepared.url ? prepared : null;
  if(preparedSource && state.preparedNext===preparedSource){
    state.preparedNext=null;
    state.preparedNextSeq++;
  } else {
    preparedSource=null;
  }
  clearPreparedNext();
  revokeCurrentObjectUrl();

  try {
    if(preparedSource){
      if(preparedSource.objectUrl) state.currentObjectUrl=preparedSource.objectUrl;
      audio.src=preparedSource.url;
    } else {
      const cached = await getOfflineResponse(id);
      if (token !== state.playbackToken) return false;
      if (cached) {
        const blob = await cached.blob();
        if (token !== state.playbackToken) return false;
        state.currentObjectUrl = URL.createObjectURL(blob);
        audio.src = state.currentObjectUrl;
      } else {
        audio.src = await getPlaybackUrl(track, 120000);
      }
    }
  } catch (error) {
    if (token !== state.playbackToken) return false;
    return toast(error.message || "No se pudo preparar la reproducción."), false;
  }
  if (token !== state.playbackToken) return false;

  state.currentId=id;
  applyCurrentTrackPresentation(track, { renderUi: !document.hidden, openSheet: !document.hidden });
  warmNextPlaybackUrl({ minValidityMs: document.hidden ? 240000 : 180000, refreshCandidate: true });
  try {
    await audio.play();
    return true;
  } catch {
    if (token !== state.playbackToken) return false;
    if(!document.hidden){el("audioGate").classList.remove("hidden");toast("Pulsa Continuar reproducción.");}
    return false;
  }
}

function rememberDjTrack(id){
  if (!state.dj.active) return;
  state.dj.lastIds = [id, ...state.dj.lastIds.filter(x=>x!==id)].slice(0,12);
  if (state.dj.suppressHistoryOnce) state.dj.suppressHistoryOnce=false;
  else if (state.dj.history.at(-1)!==id) state.dj.history=[...state.dj.history,id].slice(-50);
}
function applyCurrentTrackPresentation(track,{renderUi=true,openSheet=true}={}){
  if(!track)return;
  state.currentId=track.id;
  el("nowTitle").textContent=track.title;el("nowArtist").textContent=track.artist;
  el("npTitle").textContent=track.title;el("npArtist").textContent=track.artist;
  const art=getTrackArtwork(track)||"/icon.svg";el("nowCover").src=art;el("npCover").src=art;updateMediaSession(track,art);
  if(renderUi)render();else state.needsRenderAfterBackgroundAdvance=true;
  if(openSheet&&window.matchMedia("(max-width:900px)").matches)openNowPlaying();
  if(!document.hidden){
    if(!isUnknownAlbum(track.album)&&!getArtwork(track,"album"))fetchArtwork("album",primaryArtist(track.artist),track.album).then(()=>refreshArtworkNodes(track));
    else if(isUnknownAlbum(track.album)&&!getArtistArtwork(primaryArtist(track.artist)))fetchArtwork("artist",primaryArtist(track.artist),"").then(()=>refreshArtworkNodes(track));
  }
}

async function getPlaybackUrl(track, minValidityMs=15000) {
  if (!state.onlineApi) throw new Error("Esta canción no está guardada para usar sin conexión.");
  const cached = state.playbackUrlCache.get(track.id);
  if (cached && cached.expiresAt > Date.now() + Math.max(15000,Number(minValidityMs)||0)) return cached.url;
  const r = await apiFetch(`/api/tracks/${encodeURIComponent(track.id)}/play-url`);
  const d = await r.json().catch(()=>({}));
  if (!r.ok || !d.url) throw new Error(d.error || "No se pudo crear enlace");
  state.playbackUrlCache.set(track.id, { url: d.url, expiresAt: Number(d.expires_at || 0) * 1000 });
  return d.url;
}
function nextCandidateId({forWarmup=false}={}) {
  if(!state.currentId)return null;
  if(state.repeat==="one")return state.currentId;
  if(state.manualQueue.length)return state.manualQueue[0];
  if(state.dj.active){
    const p=state.preparedNext;
    if(forWarmup&&p?.basis==="dj"&&p.currentId===state.currentId&&trackById(p.id))return p.id;
    return chooseNextDjTrack()?.id||null;
  }
  if(!state.contextIds.length)state.contextIds=state.tracks.map(t=>t.id);
  const idx=state.contextIds.indexOf(state.currentId);
  if(state.shuffle&&state.contextIds.length>1){
    const p=state.preparedNext;
    if(forWarmup&&p?.basis==="shuffle"&&p.currentId===state.currentId&&trackById(p.id))return p.id;
    const choices=state.contextIds.filter(id=>id!==state.currentId);
    return choices[Math.floor(Math.random()*choices.length)]||null;
  }
  if(idx>=0&&idx+1<state.contextIds.length)return state.contextIds[idx+1];
  if(state.repeat==="all"&&state.contextIds.length)return state.contextIds[0];
  return null;
}
function preparedBasis(){
  if(state.repeat==="one")return "repeat-one";
  if(state.manualQueue.length)return "manual";
  if(state.dj.active)return "dj";
  if(state.shuffle)return "shuffle";
  return "context";
}
function clearPreparedNext(){
  const p=state.preparedNext;
  if(p?.objectUrl){try{URL.revokeObjectURL(p.objectUrl);}catch{}}
  state.preparedNext=null;
}
function preparedNextStillValid(p){
  if(!p||p.currentId!==state.currentId||!trackById(p.id))return false;
  if(p.expiresAt&&Number.isFinite(p.expiresAt)&&p.expiresAt<=Date.now()+5000)return false;
  if(state.repeat==="one")return p.basis==="repeat-one"&&p.id===state.currentId;
  if(state.manualQueue.length)return p.basis==="manual"&&state.manualQueue[0]===p.id;
  if(p.basis==="manual")return false;
  if(state.dj.active)return p.basis==="dj";
  if(state.shuffle)return p.basis==="shuffle";
  return p.basis==="context"&&nextCandidateId()===p.id;
}
function warmNextPlaybackUrl({minValidityMs=120000,refreshCandidate=false}={}) {
  if(state.activePlaybackSource!=="library"||!state.currentId)return;
  if(state.repeat==="one"){clearPreparedNext();return;}
  const existing=state.preparedNext;
  if(!refreshCandidate&&preparedNextStillValid(existing)&&(!existing.expiresAt||existing.expiresAt>Date.now()+minValidityMs))return;
  const id=nextCandidateId({forWarmup:true});const track=id&&trackById(id);
  if(!track){clearPreparedNext();return;}
  const basis=preparedBasis(),currentId=state.currentId;
  if(state.preparingNext?.id===id&&state.preparingNext?.currentId===currentId)return state.preparingNext.promise;
  const seq=++state.preparedNextSeq;
  const task=(async()=>{
    let url="",objectUrl="",expiresAt=Number.POSITIVE_INFINITY;
    try{
      const offline=await getOfflineResponse(id);
      if(offline){const blob=await offline.blob();if(!blob.size)return;objectUrl=URL.createObjectURL(blob);url=objectUrl;}
      else{url=await getPlaybackUrl(track,minValidityMs);expiresAt=state.playbackUrlCache.get(id)?.expiresAt||0;}
      if(seq!==state.preparedNextSeq||state.currentId!==currentId){if(objectUrl)URL.revokeObjectURL(objectUrl);return;}
      clearPreparedNext();
      state.preparedNext={id,currentId,basis,url,objectUrl,expiresAt,preparedAt:Date.now()};
    }catch{if(objectUrl)try{URL.revokeObjectURL(objectUrl);}catch{}}
    finally{if(state.preparingNext?.promise===task)state.preparingNext=null;}
  })();
  state.preparingNext={id,currentId,promise:task};
  return task;
}

function refreshPreparedNextNearTrackEnd(){
  if(state.activePlaybackSource!=="library"||audio.paused||!Number.isFinite(audio.duration)||audio.duration<=0)return;
  const remaining=audio.duration-audio.currentTime;
  if(remaining>0&&remaining<150)warmNextPlaybackUrl({minValidityMs:240000});
}

async function togglePlay() { if (!state.currentId) { const first=visibleTracks()[0]||state.tracks[0]; if (first) return playInContext(visibleTracks().map(t=>t.id), first.id); return; } if(state.activePlaybackSource==="youtube"){pauseYouTubePlayback("library_playback");state.activePlaybackSource="library";setupLibraryMediaSessionHandlers();} if (audio.paused) { try { await audio.play(); } catch { el("audioGate").classList.remove("hidden"); } } else audio.pause(); }
async function resumeAudio() { try { await audio.play(); el("audioGate").classList.add("hidden"); } catch { toast("El navegador todavía requiere una interacción de reproducción."); } }


async function nextTrack(fromEnded,{systemAction=false}={}) {
  if (!state.currentId) return;
  if(isNativeAndroid){await window.GMusicNativeAudio.next().catch(()=>{});return;}
  if (fromEnded && state.repeat === "one") {
    state.playCountMarked=false;
    audio.currentTime=0;
    try{await audio.play();}catch{if(!document.hidden)el("audioGate").classList.remove("hidden");}
    return;
  }
  const previousId=state.currentId;
  let nextId = null;
  if (state.manualQueue.length) nextId = state.manualQueue.shift();
  else if (state.dj.active) nextId = chooseNextDjTrack()?.id || null;
  else {
    if (!state.contextIds.length) state.contextIds = state.tracks.map(t=>t.id);
    let idx = state.contextIds.indexOf(state.currentId);
    if (state.shuffle && state.contextIds.length > 1) {
      const choices = state.contextIds.filter((id) => id !== state.currentId); nextId = choices[Math.floor(Math.random()*choices.length)];
    } else if (idx >= 0 && idx + 1 < state.contextIds.length) nextId = state.contextIds[idx+1];
    else if (state.repeat === "all" && state.contextIds.length) nextId = state.contextIds[0];
  }

  let prepared=null;
  if(nextId){
    const p=state.preparedNext;
    if(p&&p.currentId===previousId&&p.id===nextId&&preparedNextStillValid(p))prepared=p;
  }

  if (nextId) {
    state.queueCursor = state.contextIds.indexOf(nextId);
    state.currentId = nextId;
    state.playCountMarked=false;
    saveQueue();
    if(document.hidden)state.needsRenderAfterBackgroundAdvance=true;else{renderQueue();updateQueueCount();}
    await playTrack(nextId,{prepared});
  } else {
    clearPreparedNext();
    saveQueue();
    audio.pause();
    audio.currentTime = 0;
  }
}

async function previousTrack(forceTrackChange=false) {
  if (!forceTrackChange && audio.currentTime > 5) { audio.currentTime = 0; updateMediaPosition(); return; }
  if(isNativeAndroid){await window.GMusicNativeAudio.previous().catch(()=>{});return;}
  if(state.dj.active && state.dj.history.length>1){
    state.dj.history.pop(); const prev=state.dj.history.at(-1); if(prev){state.dj.suppressHistoryOnce=true;state.currentId=prev;state.queueCursor=state.contextIds.indexOf(prev);saveQueue();await playTrack(prev);return;}
  }
  const idx = state.contextIds.indexOf(state.currentId); const prev = idx > 0 ? state.contextIds[idx-1] : (state.repeat === "all" ? state.contextIds.at(-1) : null); if (prev){state.currentId=prev;state.queueCursor=state.contextIds.indexOf(prev);saveQueue();await playTrack(prev);}
}

function enqueue(id) { if (!id || id===state.currentId) return; state.manualQueue.push(id); saveQueue(); updateQueueCount(); toast("Agregada a la cola"); }
function playNextQueued(id) { if (!id || id===state.currentId) return; state.manualQueue = state.manualQueue.filter((x)=>x!==id); state.manualQueue.unshift(id); saveQueue(); updateQueueCount(); toast("Se reproducirá después"); }
function openQueue() { renderQueue(); queueDialog.showModal(); }
function renderQueue() {
  const manual = state.manualQueue.map((id,i)=>({track:trackById(id),manual:true,index:i})).filter(x=>x.track);
  const idx = state.contextIds.indexOf(state.currentId); const context = state.contextIds.slice(idx+1).filter(id=>!state.manualQueue.includes(id)).map((id)=>({track:trackById(id),manual:false})).filter(x=>x.track);
  const rows = [...manual, ...context];
  el("queueList").innerHTML = rows.length ? rows.map((x)=>`<div class="queue-item ${x.manual?"manual":""}"><span>${x.manual?"★":""}</span><div><strong>${esc(x.track.title)}</strong><small>${esc(x.track.artist)}</small></div>${x.manual?`<div class="queue-move"><button data-up="${x.index}">↑</button><button data-down="${x.index}">↓</button><button data-qremove="${x.index}">✕</button></div>`:"<span class=muted>Después</span>"}</div>`).join("") : `<p class="muted">No hay canciones pendientes.</p>`;
  el("queueList").querySelectorAll("[data-up]").forEach(b=>b.addEventListener("click",()=>moveManual(Number(b.dataset.up),-1)));
  el("queueList").querySelectorAll("[data-down]").forEach(b=>b.addEventListener("click",()=>moveManual(Number(b.dataset.down),1)));
  el("queueList").querySelectorAll("[data-qremove]").forEach(b=>b.addEventListener("click",()=>{state.manualQueue.splice(Number(b.dataset.qremove),1);saveQueue();renderQueue();updateQueueCount();}));
}
function moveManual(i,d){const j=i+d;if(j<0||j>=state.manualQueue.length)return;[state.manualQueue[i],state.manualQueue[j]]=[state.manualQueue[j],state.manualQueue[i]];saveQueue();renderQueue();}
function saveQueue({syncNative=true}={}){localStorage.setItem(QUEUE_KEY,JSON.stringify({contextIds:state.contextIds,manualQueue:state.manualQueue,currentId:state.currentId,shuffle:state.shuffle,repeat:state.repeat}));syncQueueRemote();if(syncNative)scheduleNativeQueueResync();}
function restoreQueue(){const q=safeJson(localStorage.getItem(QUEUE_KEY),{});state.contextIds=q.contextIds||[];state.manualQueue=q.manualQueue||[];state.currentId=q.currentId||null;state.shuffle=Boolean(q.shuffle);state.repeat=["off","all","one"].includes(q.repeat)?q.repeat:"off";}
function updateQueueCount(){
  const count = String(state.manualQueue.length);
  el("queueCount").textContent = count;
  const mini = el("queueMiniCount"); if (mini) mini.textContent = count;
}
function toggleShuffle(){state.shuffle=!state.shuffle;saveQueue();syncPlayerButtons();toast(state.shuffle?"Aleatorio activado":"Aleatorio desactivado");}
function cycleRepeat(){state.repeat=state.repeat==="off"?"all":state.repeat==="all"?"one":"off";saveQueue();syncPlayerButtons();}
function syncPlayerButtons(){el("playBtn").textContent=audio.paused?"▶":"❚❚";el("npPlayBtn").textContent=audio.paused?"▶":"❚❚";el("playerBar").classList.toggle("is-playing",!audio.paused && !!state.currentId);if(!isNativeAndroid&&"mediaSession"in navigator&&state.activePlaybackSource==="library"){try{navigator.mediaSession.playbackState=audio.paused?"paused":"playing"}catch{}}el("shuffleBtn").classList.toggle("active",state.shuffle);el("shuffleMiniBtn").classList.toggle("active",state.shuffle);el("npShuffleBtn").classList.toggle("active",state.shuffle);const label=state.repeat==="off"?"↻ Off":state.repeat==="all"?"↻ Todo":"↻ 1";el("repeatBtn").textContent=label;el("repeatMiniBtn").textContent=state.repeat==="one"?"↻¹":"↻";el("repeatMiniBtn").classList.toggle("active",state.repeat!=="off");el("npRepeatBtn").textContent=state.repeat==="one"?"↻¹":"↻";el("npRepeatBtn").classList.toggle("active",state.repeat!=="off");const currentFav=!!(state.currentId&&isFavorite(state.currentId));el("nowFavBtn").classList.toggle("on",currentFav);el("npFavBtn").classList.toggle("on",currentFav);}

function openActions(id){state.actionTrackId=id;const t=trackById(id);if(!t)return;el("actionTrackTitle").textContent=t.title;el("offlineAction").textContent=state.offlineIds.has(id)?"✕ Quitar offline":"⇩ Guardar offline";el("favoriteAction").textContent=isFavorite(id)?"♡ Quitar favorito":"♥ Favorito";actionDialog.showModal();}
function actionQueue(kind){const id=state.actionTrackId;if(!id)return;kind==="next"?playNextQueued(id):enqueue(id);actionDialog.close();}
async function toggleOfflineAction(){const id=state.actionTrackId;if(!id)return;try{if(state.offlineIds.has(id))await removeOffline(id);else await cacheOffline(id);openActions(id);}catch(e){toast(e.message||"No se pudo cambiar el modo offline");}}
async function cacheOffline(id,{silent=false}={}){
  if(!("caches" in window)) throw new Error("Este navegador no permite caché offline.");
  if(!state.offlineScope) throw new Error("Conéctate una vez antes de guardar música offline.");
  if(state.offlineIds.has(id)) return true;
  const t=trackById(id); if(!t) throw new Error("Canción no disponible.");
  loadOfflineSettings(); const limit=Number(state.offlineSettings.limitBytes||1073741824); if(offlineBytesUsed()+Number(t.size_bytes||0)>limit)throw new Error("No queda espacio dentro del límite offline configurado.");
  const url=await getPlaybackUrl(t); if(!silent)toast("Guardando offline…");
  const r=await fetch(url); if(!r.ok) throw new Error("No se pudo descargar para offline");
  const blob=await r.blob(); if(!blob.size)throw new Error("La descarga quedó vacía o incompleta.");
  const c=await caches.open(currentOfflineCache()); await c.put(new Request(`/offline-audio/${id}`),new Response(blob,{headers:{"content-type":r.headers.get("content-type")||t.mime_type||"audio/mpeg","content-length":String(blob.size)}}));
  state.offlineIds.add(id); persistOffline(); persistOfflineTrackSnapshot(); if(!silent)toast("Disponible offline ✓");
  updateFavoritesOfflineButton();
  return true;
}
function favoriteTracks(){return state.tracks.filter(t=>state.favoriteIds.has(t.id));}
function updateFavoritesOfflineButton(){
  const b=el("favoritesOfflineBtn"); if(!b)return;
  const favs=favoriteTracks(); const downloaded=favs.filter(t=>state.offlineIds.has(t.id)).length;
  b.classList.toggle("hidden",state.view!=="favorites"||!state.authenticated||favs.length===0);
  b.disabled=state.favoritesOfflineBusy||!state.onlineApi;
  b.textContent=state.favoritesOfflineBusy?"⇩ Descargando…":downloaded===favs.length?`✓ Favoritos offline (${downloaded})`:`⇩ Descargar favoritos (${downloaded}/${favs.length})`;
  b.title=!state.onlineApi?"Conéctate para descargar tus favoritos":"Guardar tus favoritos en este dispositivo";
}
async function downloadFavoritesOffline(){
  const missing=favoriteTracks().filter(t=>!state.offlineIds.has(t.id));
  if(!missing.length)return toast("Tus favoritos ya están disponibles offline ✓");
  await downloadOfflineTracks(missing,{label:"Descargando favoritos"});
}

async function removeOffline(id,{silent=false}={}){if("caches"in window){const c=await caches.open(currentOfflineCache());await c.delete(new Request(`/offline-audio/${id}`));}state.offlineIds.delete(id);persistOffline();persistOfflineTrackSnapshot();updateFavoritesOfflineButton();if(!silent)toast("Copia offline eliminada");}
async function getOfflineResponse(id){if(!state.offlineIds.has(id)||!("caches"in window)||!state.offlineScope)return null;const c=await caches.open(currentOfflineCache());const hit=await c.match(new Request(`/offline-audio/${id}`));if(!hit){state.offlineIds.delete(id);persistOffline();return null;}const len=Number(hit.headers.get("content-length")||0);if(len===0){const b=await hit.clone().blob();if(!b.size){await c.delete(new Request(`/offline-audio/${id}`));state.offlineIds.delete(id);persistOffline();return null;}}return hit;}
function currentOfflineCache(){return `${OFFLINE_CACHE_PREFIX}${state.offlineScope || "none"}`;}
function currentOfflineIdsKey(){return `${OFFLINE_IDS_PREFIX}${state.offlineScope || "none"}`;}
function currentOfflineTracksKey(){return `${OFFLINE_TRACKS_PREFIX}${state.offlineScope || "none"}`;}
function currentOfflineUserKey(){return `${OFFLINE_USER_PREFIX}${state.offlineScope || "none"}`;}
function persistOffline(){if(state.offlineScope)localStorage.setItem(currentOfflineIdsKey(),JSON.stringify([...state.offlineIds]));}
function persistOfflineTrackSnapshot(){
  if(!state.offlineScope)return;
  const tracks=state.tracks.filter(t=>state.offlineIds.has(t.id)).map(t=>({id:t.id,title:t.title,artist:t.artist,artist_names:t.artist_names||[],album:t.album||"",year:t.year||"",genre:t.genre||"",track_number:t.track_number||"",release_type:t.release_type||"",mb_recording_id:t.mb_recording_id||"",mb_release_id:t.mb_release_id||"",cover_release_id:t.cover_release_id||"",duration_seconds:Number(t.duration_seconds||0),mime_type:t.mime_type||"audio/mpeg",size_bytes:Number(t.size_bytes||0),created_at:t.created_at||"",modified_at:t.modified_at||""}));
  localStorage.setItem(currentOfflineTracksKey(),JSON.stringify(tracks));
}
function persistOfflineUserSnapshot(){
  if(!state.offlineScope)return;
  const snapshot={profile:state.profile||null,playlists:Array.isArray(state.playlists)?state.playlists:[],history:Array.isArray(state.serverHistory)?state.serverHistory:[],stats:state.stats&&typeof state.stats==="object"?state.stats:{},favoriteIds:[...state.favoriteIds],playback:state.playback||null};
  localStorage.setItem(currentOfflineUserKey(),JSON.stringify(snapshot));
}
function loadOfflineUserSnapshot(){
  if(!state.offlineScope)return;
  const d=safeJson(localStorage.getItem(currentOfflineUserKey()),{});
  state.profile=d.profile||null; state.playlists=Array.isArray(d.playlists)?d.playlists:[]; state.serverHistory=Array.isArray(d.history)?d.history:[]; state.stats=d.stats&&typeof d.stats==="object"?d.stats:{}; state.serverStats=state.stats; state.favoriteIds=new Set(Array.isArray(d.favoriteIds)?d.favoriteIds:[]); state.playback=d.playback||null; state.recentIds=state.serverHistory.map(x=>typeof x==="string"?x:x?.id).filter(Boolean).slice(0,50); applyTheme(); applyRoleUI();
}
function loadOfflineLibrary(){
  if(!state.offlineScope){state.tracks=[];state.offlineIds=new Set();return render();}
  loadOfflineSettings(); loadOfflineUserSnapshot();
  state.offlineIds=new Set(safeJson(localStorage.getItem(currentOfflineIdsKey()),[]));
  const saved=safeJson(localStorage.getItem(currentOfflineTracksKey()),[]);
  state.tracks=Array.isArray(saved)?saved.filter(t=>t?.id&&state.offlineIds.has(t.id)):[];
  state.contextIds=state.tracks.map(t=>t.id);
  updateConnectionBadge(); render();
}
async function migrateLegacyOfflineCache(){
  if(!state.offlineScope||!("caches"in window))return;
  const scopedIds=safeJson(localStorage.getItem(currentOfflineIdsKey()),null);
  if(Array.isArray(scopedIds)){state.offlineIds=new Set(scopedIds);return;}
  const legacyIds=safeJson(localStorage.getItem(OFFLINE_KEY),[]);
  state.offlineIds=new Set(Array.isArray(legacyIds)?legacyIds:[]);
  if(!state.offlineIds.size){persistOffline();return;}
  const oldCache=await caches.open(OFFLINE_CACHE); const newCache=await caches.open(currentOfflineCache());
  for(const id of state.offlineIds){const req=new Request(`/offline-audio/${id}`);const hit=await oldCache.match(req);if(hit)await newCache.put(req,hit.clone());}
  persistOffline();
}

function currentOfflineSettingsKey(){return `${OFFLINE_SETTINGS_PREFIX}${state.offlineScope||"none"}`;}
function loadOfflineSettings(){
  if(!state.offlineScope)return;
  const saved=safeJson(localStorage.getItem(currentOfflineSettingsKey()),{});
  state.offlineSettings={autoFavorites:Boolean(saved.autoFavorites),mirrorFavorites:Boolean(saved.mirrorFavorites),wifiOnly:saved.wifiOnly!==false,limitBytes:[524288000,1073741824,2147483648].includes(Number(saved.limitBytes))?Number(saved.limitBytes):1073741824};
  state.offlineFailedIds=new Set(Array.isArray(saved.failedIds)?saved.failedIds:[]);
}
function persistOfflineSettings(){if(!state.offlineScope)return;localStorage.setItem(currentOfflineSettingsKey(),JSON.stringify({...state.offlineSettings,failedIds:[...state.offlineFailedIds]}));}
function offlineBytesUsed(){return state.tracks.filter(t=>state.offlineIds.has(t.id)).reduce((n,t)=>n+Number(t.size_bytes||0),0);}
function networkAllowsAutoDownload(){const type=navigator.connection?.type;return !(state.offlineSettings.wifiOnly&&type==="cellular");}
function updateOfflineCenterButton(){const b=el("offlineCenterBtn");if(!b)return;b.classList.toggle("hidden",!state.authenticated);b.textContent=state.offlineIds.size?`⬇ Offline (${state.offlineIds.size})`:`⬇ Offline`;}
async function openOfflineCenter(){if(!state.authenticated)return toast("Primero inicia sesión.");loadOfflineSettings();await renderOfflineCenter();offlineDialog?.showModal();}
async function renderOfflineCenter(){
  const used=offlineBytesUsed(),limit=Number(state.offlineSettings.limitBytes||1073741824),favs=favoriteTracks(),favDown=favs.filter(t=>state.offlineIds.has(t.id)).length;
  let quotaText="";try{const e=await navigator.storage?.estimate?.();if(e?.quota)quotaText=` · Dispositivo: ${formatBytes(e.usage||0)} / ${formatBytes(e.quota)}`;}catch{}
  el("offlineSummary").innerHTML=`<div class="stats-grid compact"><div class="stat-card"><span>Descargadas</span><strong>${state.offlineIds.size}</strong></div><div class="stat-card"><span>Favoritos offline</span><strong>${favDown}/${favs.length}</strong></div><div class="stat-card"><span>Espacio GMusic</span><strong>${formatBytes(used)}</strong></div><div class="stat-card"><span>Límite</span><strong>${formatBytes(limit)}</strong></div></div><p class="muted">${quotaText||"Las descargas se guardan solo en este dispositivo."}</p>`;
  el("offlineAutoFavorites").checked=state.offlineSettings.autoFavorites;el("offlineMirrorFavorites").checked=state.offlineSettings.mirrorFavorites;el("offlineWifiOnly").checked=state.offlineSettings.wifiOnly;el("offlineLimit").value=String(limit);
  const failed=[...state.offlineFailedIds].map(trackById).filter(Boolean);el("offlineFailedList").innerHTML=failed.length?failed.map(t=>`<div class="admin-row"><div><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></div><span class="chip">Pendiente</span></div>`).join(""):`<p class="muted">No hay descargas fallidas.</p>`;
  el("offlinePauseBtn").classList.toggle("hidden",!state.favoritesOfflineBusy);el("offlineCancelBtn").classList.toggle("hidden",!state.favoritesOfflineBusy);el("offlineRetryBtn").classList.toggle("hidden",!failed.length);
}
function saveOfflineSettingsFromDialog(){state.offlineSettings.autoFavorites=el("offlineAutoFavorites").checked;state.offlineSettings.mirrorFavorites=el("offlineMirrorFavorites").checked;state.offlineSettings.wifiOnly=el("offlineWifiOnly").checked;state.offlineSettings.limitBytes=Number(el("offlineLimit").value)||1073741824;persistOfflineSettings();renderOfflineCenter();}
function toggleOfflineBatchPause(){state.offlineBatchPaused=!state.offlineBatchPaused;el("offlinePauseBtn").textContent=state.offlineBatchPaused?"▶ Continuar":"⏸ Pausar";}
function cancelOfflineBatch(){state.offlineBatchCancelled=true;state.offlineBatchPaused=false;toast("Se cancelará al terminar la descarga actual.");}
async function retryOfflineFailures(){const ids=[...state.offlineFailedIds];if(!ids.length)return;state.offlineFailedIds.clear();persistOfflineSettings();await downloadOfflineTracks(ids.map(trackById).filter(Boolean),{label:"Reintentando"});}
async function deleteAllOfflineDownloads(){if(!state.offlineIds.size)return toast("No hay descargas offline.");if(!confirm("¿Eliminar todas las copias offline de este dispositivo? Tus favoritos y canciones de Drive no se borrarán."))return;const c=await caches.open(currentOfflineCache());for(const id of [...state.offlineIds])await c.delete(new Request(`/offline-audio/${id}`));state.offlineIds.clear();state.offlineFailedIds.clear();persistOffline();persistOfflineTrackSnapshot();persistOfflineSettings();render();renderOfflineCenter();toast("Descargas offline eliminadas");}
async function waitWhileOfflinePaused(){while(state.offlineBatchPaused&&!state.offlineBatchCancelled)await new Promise(r=>setTimeout(r,250));}
async function downloadOfflineTracks(tracks,{label="Descargando favoritos"}={}){
  if(state.favoritesOfflineBusy)return; if(!state.onlineApi)return toast("Conéctate para descargar música."); if(!networkAllowsAutoDownload()&&navigator.connection?.type==="cellular")return toast("Las descargas están configuradas para Wi‑Fi.");
  const unique=tracks.filter(Boolean).filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i&&!state.offlineIds.has(t.id));if(!unique.length)return toast("Todo ya está disponible offline ✓");
  const needed=unique.reduce((n,t)=>n+Number(t.size_bytes||0),0),remaining=Math.max(0,Number(state.offlineSettings.limitBytes||1073741824)-offlineBytesUsed());if(needed>remaining&&!confirm(`Estas descargas necesitan aprox. ${formatBytes(needed)}, pero tu límite tiene ${formatBytes(remaining)} libres. ¿Intentar hasta alcanzar el límite?`))return;
  state.favoritesOfflineBusy=true;state.offlineBatchPaused=false;state.offlineBatchCancelled=false;updateFavoritesOfflineButton();let ok=0,failed=0;
  for(let i=0;i<unique.length;i++){if(state.offlineBatchCancelled)break;await waitWhileOfflinePaused();if(state.offlineBatchCancelled)break;const t=unique[i];try{await cacheOffline(t.id,{silent:true});state.offlineFailedIds.delete(t.id);ok++;}catch{state.offlineFailedIds.add(t.id);failed++;}const text=`${label} · ${i+1}/${unique.length} · ${formatBytes(offlineBytesUsed())}`;const b=el("favoritesOfflineBtn");if(b)b.textContent=`⇩ ${i+1}/${unique.length}`;if(el("offlineProgress"))el("offlineProgress").textContent=text;await renderOfflineCenter();}
  state.favoritesOfflineBusy=false;state.offlineBatchPaused=false;persistOffline();persistOfflineTrackSnapshot();persistOfflineSettings();render();if(offlineDialog?.open)await renderOfflineCenter();toast(state.offlineBatchCancelled?`${ok} descargadas antes de cancelar`:failed?`${ok} descargadas · ${failed} pendientes`:`${ok} canciones disponibles offline ✓`);
}

window.addEventListener("online", async()=>{await checkApi();if(state.onlineApi){const ok=await verifySessionToken();if(ok){state.authenticated=true;state.offlineMode=false;loadOfflineSettings();await migrateLegacyOfflineCache();await loadUserBundle();await loadTracks();toast("Conexión recuperada ✓");}else{clearLocalSession();state.authenticated=false;render();}}});
window.addEventListener("offline", ()=>{state.onlineApi=false;if(restoreOfflineSession())loadOfflineLibrary();updateConnectionBadge();toast("Modo sin conexión");});
function revokeCurrentObjectUrl(){if(state.currentObjectUrl){URL.revokeObjectURL(state.currentObjectUrl);state.currentObjectUrl="";}}

async function prepareFiles(files){const audios=files.filter(looksLikeAudioFile);el("fileLabel").textContent=audios.length?`${audios.length} archivo(s) seleccionado(s)`:"No se encontraron audios compatibles";const previews=[];for(const file of audios.slice(0,100)){const meta=normalizeImportedMetadata(await readMetadata(file).catch(()=>parseFilename(file.name)));previews.push(`<div class="upload-item"><strong>${esc(meta.title)}</strong><span>${esc(meta.artist)} · ${esc(meta.album)}</span><small>${esc(file.name)}</small></div>`);}el("uploadPreview").innerHTML=previews.join("");}
async function uploadTracks(event){
  event.preventDefault();const files=[...fileInput.files].filter(looksLikeAudioFile);if(!files.length)return toast("Selecciona archivos de audio.");
  let done=0,skipped=0;
  for(const file of files){
    const meta=normalizeImportedMetadata(await readMetadata(file).catch(()=>parseFilename(file.name)));
    const duplicate=state.tracks.some(t=>normalize(t.title)===normalize(meta.title)&&normalize(t.artist)===normalize(meta.artist)&&Number(t.size_bytes)===file.size);if(duplicate){skipped++;continue;}
    el("uploadProgress").textContent=`Subiendo ${done+1}/${files.length}: ${meta.title}`;
    const form=new FormData();form.append("file",file);form.append("title",meta.title);form.append("artist",meta.artist);form.append("album",meta.album);form.append("year",meta.year||"");form.append("genre",meta.genre||"");form.append("track_number",meta.track_number||"");form.append("duration_seconds",String(await getDuration(file).catch(()=>0)));
    const r=await apiFetch("/api/tracks",{method:"POST",body:form});const d=await r.json().catch(()=>({}));if(!r.ok){toast(d.error||`Falló ${file.name}`);continue;}state.tracks.unshift(d.track);done++;
  }
  el("uploadProgress").textContent=`Listo: ${done} subidas${skipped?`, ${skipped} duplicadas omitidas`:""}.`;render();hydrateArtwork();
  if(done){
    // Reconciliar solicitudes UNA sola vez al terminar el lote. Antes se listaba KV por cada archivo.
    if(state.canManage)apiFetch("/api/admin/requests/reconcile",{method:"POST"}).then(()=>{state.adminLoaded.requests=false;}).catch(()=>{});
    toast(`${done} canción(es) agregadas`);
  }
}
function looksLikeAudioFile(file){return file.type?.startsWith("audio/")||/\.(mp3|mpeg|m4a|aac|ogg|opus|wav|flac)$/i.test(file.name||"");}
async function readMetadata(file){if(!/\.mp3$/i.test(file.name))return parseFilename(file.name);const buf=await file.slice(0,Math.min(file.size,512*1024)).arrayBuffer();const v=new DataView(buf);if(String.fromCharCode(v.getUint8(0),v.getUint8(1),v.getUint8(2))!=="ID3")return parseFilename(file.name);const version=v.getUint8(3);let pos=10;const out={};while(pos+10<=v.byteLength){const id=String.fromCharCode(v.getUint8(pos),v.getUint8(pos+1),v.getUint8(pos+2),v.getUint8(pos+3));if(!/^T[A-Z0-9]{3}$/.test(id)&&id!=="APIC")break;const size=version===4?synchsafe(v,pos+4):v.getUint32(pos+4);if(size<=0||pos+10+size>v.byteLength)break;if(["TIT2","TPE1","TALB","TYER","TDRC","TCON","TRCK"].includes(id)){const bytes=new Uint8Array(buf,pos+10,size);out[id]=decodeId3Text(bytes);}pos+=10+size;}const fallback=parseFilename(file.name);return{title:out.TIT2||fallback.title,artist:out.TPE1||fallback.artist,album:out.TALB||fallback.album,year:(out.TDRC||out.TYER||"").slice(0,8),genre:out.TCON||"",track_number:out.TRCK||""};}
function cleanTrackTitleClient(value,artist=""){let title=String(value||"").normalize("NFKC").replace(/\s+/g," ").trim()||"Sin título";const junk=String.raw`(?:official\s+music\s+video|official\s+video|official\s+audio|official\s+visuali[sz]er|official\s+lyric(?:s)?\s+video|official\s+lyrics?|music\s+video|video\s+oficial|vídeo\s+oficial|audio\s+oficial|lyric(?:s)?\s+video|visuali[sz]er|lyrics?|letras?|audio|video|official|hd|hq|4k)`;const bracket=new RegExp(String.raw`\s*[\(\[\{]\s*${junk}\s*[\)\]\}]\s*`,"gi");const suffix=new RegExp(String.raw`\s*(?:[-–—|•·:]+)\s*${junk}\s*$`,"i");let prev;do{prev=title;title=title.replace(bracket," ").replace(suffix," ").replace(/\s+/g," ").trim();}while(title!==prev);const m=title.match(/^(.+?)\s*[-–—|:]\s*(.+)$/);if(m&&artist&&normalize(m[1])===normalize(artist))title=m[2].trim();return title.replace(/\s*[-–—|:]+\s*$/g,"").trim()||"Sin título";}
function normalizeImportedMetadata(meta){const artist=String(meta?.artist||"Artista desconocido").normalize("NFKC").replace(/\s+/g," ").trim()||"Artista desconocido";const album=String(meta?.album||"Sin álbum").normalize("NFKC").replace(/\s+/g," ").trim()||"Sin álbum";return{...meta,artist,album,title:cleanTrackTitleClient(meta?.title||"Sin título",artist)};}
function synchsafe(v,p){return(v.getUint8(p)<<21)|(v.getUint8(p+1)<<14)|(v.getUint8(p+2)<<7)|v.getUint8(p+3);}
function decodeId3Text(bytes){const enc=bytes[0];const body=bytes.slice(1);try{if(enc===1||enc===2)return new TextDecoder(enc===1?"utf-16":"utf-16be").decode(body).replace(/\0/g,"").trim();return new TextDecoder("utf-8").decode(body).replace(/\0/g,"").trim();}catch{return"";}}
function parseFilename(name){let base=String(name||"").replace(/\.(mp3|mpeg|m4a|aac|ogg|opus|wav|flac)$/i,"").replace(/\s*-\s*copia$/i,"").trim();const parts=base.split(/\s+[–—-]\s+/);if(parts.length>=2){const artist=parts.shift().trim();return{title:parts.join(" - ").trim(),artist,album:"Sin álbum",year:"",genre:"",track_number:""};}return{title:base||"Sin título",artist:"Artista desconocido",album:"Sin álbum",year:"",genre:"",track_number:""};}
function getDuration(file){return new Promise((resolve,reject)=>{const a=document.createElement("audio");const u=URL.createObjectURL(file);a.preload="metadata";a.onloadedmetadata=()=>{const d=Math.round(a.duration||0);URL.revokeObjectURL(u);resolve(d)};a.onerror=()=>{URL.revokeObjectURL(u);reject(new Error("duration"))};a.src=u;});}

async function toggleFavorite(id){const t=trackById(id);if(!t)return;const favorite=!isFavorite(id);const r=await apiFetch(`/api/favorites/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({favorite})});if(r.ok){favorite?state.favoriteIds.add(id):state.favoriteIds.delete(id);persistOfflineUserSnapshot();loadOfflineSettings();render();if(favorite&&state.offlineSettings.autoFavorites&&state.onlineApi&&networkAllowsAutoDownload()&&!state.offlineIds.has(id)){cacheOffline(id,{silent:true}).then(()=>{render();toast("Favorito guardado también offline ✓");}).catch(()=>{state.offlineFailedIds.add(id);persistOfflineSettings();});}if(!favorite&&state.offlineSettings.autoFavorites&&state.offlineSettings.mirrorFavorites&&state.offlineIds.has(id)){removeOffline(id,{silent:true}).catch(()=>{});}}}
async function deleteTrack(id){const t=trackById(id);if(!t||!confirm(`¿Enviar “${t.title}” a la papelera de GMusic? Podrás restaurarla desde Administración.`))return;const r=await apiFetch(`/api/tracks/${encodeURIComponent(id)}`,{method:"DELETE"});const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo mover a la papelera");state.tracks=state.tracks.filter(x=>x.id!==id);state.manualQueue=state.manualQueue.filter(x=>x!==id);state.contextIds=state.contextIds.filter(x=>x!==id);if(state.currentId===id){audio.pause();state.currentId=null;}await removeOffline(id).catch(()=>{});saveQueue();render();toast("Canción enviada a la papelera");}

function syncTimeline(force=false){if(document.hidden&&!force)return;const now=performance.now();if(!force&&now-state.lastUiTick<1000)return;state.lastUiTick=now;const duration=Number.isFinite(audio.duration)?audio.duration:0;const current=Number.isFinite(audio.currentTime)?audio.currentTime:0;el("currentTime").textContent=formatTime(current);el("duration").textContent=formatTime(duration);el("seek").value=duration?(current/duration)*100:0;el("npCurrentTime").textContent=formatTime(current);el("npDuration").textContent=formatTime(duration);el("npSeek").value=duration?(current/duration)*100:0;if(current>=30&&!state.playCountMarked&&state.currentId){state.playCountMarked=true;markPlayed(state.currentId);} if(!document.hidden&&state.currentId)schedulePlaybackSync(); }
function markPlayed(id){state.recentIds=[id,...state.recentIds.filter(x=>x!==id)].slice(0,50);state.serverHistory=[{id,at:new Date().toISOString(),position:Math.round(audio.currentTime||0)},...(Array.isArray(state.serverHistory)?state.serverHistory:[]).filter(x=>(typeof x==="string"?x:x?.id)!==id)].slice(0,100);state.stats[id]=(state.stats[id]||0)+1;localStorage.setItem(RECENT_KEY,JSON.stringify(state.recentIds));localStorage.setItem(STATS_KEY,JSON.stringify(state.stats)); syncHistoryAndStats();}

function clearMediaSessionHandlers(){
  if(!("mediaSession"in navigator))return;
  for(const action of ["play","pause","previoustrack","nexttrack","seekbackward","seekforward","seekto"]){try{navigator.mediaSession.setActionHandler(action,null);}catch{}}
  try{navigator.mediaSession.playbackState="none";}catch{}
}
function setupLibraryMediaSessionHandlers(){
  if(isNativeAndroid)return;
  if(!("mediaSession"in navigator))return;
  const handlers={
    play:()=>{state.activePlaybackSource="library";audio.play().catch(()=>{});},
    pause:()=>audio.pause(),
    previoustrack:()=>previousTrack(true),
    nexttrack:()=>nextTrack(false,{systemAction:true}),
    seekbackward:(details)=>{if(Number.isFinite(audio.duration)){audio.currentTime=Math.max(0,audio.currentTime-Number(details?.seekOffset||10));updateMediaPosition();}},
    seekforward:(details)=>{if(Number.isFinite(audio.duration)){audio.currentTime=Math.min(audio.duration,audio.currentTime+Number(details?.seekOffset||10));updateMediaPosition();}},
    seekto:(details)=>{if(Number.isFinite(audio.duration)&&Number.isFinite(details?.seekTime)){audio.currentTime=Math.max(0,Math.min(audio.duration,details.seekTime));updateMediaPosition();}}
  };
  for(const [action,fn] of Object.entries(handlers)){try{navigator.mediaSession.setActionHandler(action,fn);}catch{}}
}
function setupYouTubeMediaSession(video){
  if(!("mediaSession"in navigator))return;
  for(const action of ["previoustrack","nexttrack","seekbackward","seekforward","seekto"]){try{navigator.mediaSession.setActionHandler(action,null);}catch{}}
  try{navigator.mediaSession.setActionHandler("play",()=>{try{state.youtubePlayer?.playVideo?.();}catch{}});}catch{}
  try{navigator.mediaSession.setActionHandler("pause",()=>{try{state.youtubePlayer?.pauseVideo?.();}catch{}});}catch{}
  try{navigator.mediaSession.metadata=new MediaMetadata({title:video?.title||"YouTube",artist:video?.channel||"YouTube",album:"YouTube",artwork:video?.thumbnail?[{src:video.thumbnail}]:[]});navigator.mediaSession.playbackState="playing";}catch{}
}
function setupMediaSession(){
  if(isNativeAndroid)return;
  if(!("mediaSession"in navigator))return;
  setupLibraryMediaSessionHandlers();
}
function updateMediaSession(track, artwork){if(isNativeAndroid||!("mediaSession"in navigator)||state.activePlaybackSource!=="library")return;try{navigator.mediaSession.metadata=new MediaMetadata({title:track.title,artist:track.artist,album:track.album,artwork:[{src:new URL(artwork,location.href).href,sizes:"512x512"}]});navigator.mediaSession.playbackState=audio.paused?"paused":"playing";}catch{}}
function updateMediaPosition(){if(isNativeAndroid||!("mediaSession"in navigator)||state.activePlaybackSource!=="library"||!Number.isFinite(audio.duration)||audio.duration<=0)return;try{navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.min(audio.currentTime,audio.duration)});}catch{}}

function isUnknownAlbum(value){
  const v=normalize(value);
  return !v || ["sin album","unknown album","album desconocido","desconocido","n/a","na","none"].includes(v);
}
function primaryArtist(value){
  return splitArtists(value)[0] || String(value||"").trim();
}
function getTrackArtwork(track){
  if(!track) return "";
  if(track.cover_release_id && state.onlineApi) return `/api/artwork/cover?release=${encodeURIComponent(track.cover_release_id)}&size=500`;
  if(!isUnknownAlbum(track.album)){
    const albumArt=getArtwork(track,"album");
    if(albumArt) return albumArt;
  }
  return getArtistArtwork(primaryArtist(track.artist));
}
function persistArtworkCache(){
  try{ localStorage.setItem(ARTWORK_KEY,JSON.stringify(state.artwork)); }catch{}
}
function invalidateArtworkKey(key){
  delete state.artwork[key];
  artworkMissUntil.delete(key);
  persistArtworkCache();
}
function invalidateArtistArtwork(artist){invalidateArtworkKey(artworkKey("artist",primaryArtist(artist),""));}
function hydrateCoverNode(id){
  const t=trackById(id);if(!t)return Promise.resolve("");
  const pa=primaryArtist(t.artist);
  if(!isUnknownAlbum(t.album)&&!getArtwork(t,"album"))return fetchArtwork("album",pa,t.album).then(art=>{if(art)refreshArtworkNodes(t);return art;});
  if(isUnknownAlbum(t.album)&&pa&&!getArtistArtwork(pa))return fetchArtwork("artist",pa,"").then(art=>{if(art)refreshArtworkNodes(t);return art;});
  return Promise.resolve(getTrackArtwork(t));
}
function hydrateArtistNode(artist){
  const pa=primaryArtist(artist);
  if(pa&&!getArtistArtwork(pa))return fetchArtwork("artist",pa,"").then(art=>{if(art)refreshArtistNodes(pa);return art;});
  return Promise.resolve(getArtistArtwork(pa));
}
let artworkObserver=null;
function scheduleArtworkRetry(node){
  if(!node?.isConnected)return;
  setTimeout(()=>{
    if(!node.isConnected||document.hidden)return;
    const observer=getArtworkObserver();
    if(observer)observer.observe(node);
    else if(node.dataset.coverFor)hydrateCoverNode(node.dataset.coverFor);
    else if(node.dataset.artistImage)hydrateArtistNode(node.dataset.artistImage);
  },ARTWORK_MISS_RETRY_MS+250);
}
function getArtworkObserver(){
  if(artworkObserver)return artworkObserver;
  if(!("IntersectionObserver" in window)) return null;
  artworkObserver=new IntersectionObserver((entries)=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      const node=entry.target;
      artworkObserver.unobserve(node);
      const task=node.dataset.coverFor?hydrateCoverNode(node.dataset.coverFor):node.dataset.artistImage?hydrateArtistNode(node.dataset.artistImage):Promise.resolve("");
      Promise.resolve(task).then(art=>{if(!art)scheduleArtworkRetry(node);}).catch(()=>scheduleArtworkRetry(node));
    }
  },{root:null,rootMargin:"300px 0px",threshold:0.01});
  return artworkObserver;
}
function bindArtworkErrorRecovery(node){
  if(!node||node.dataset.artworkErrorBound==="1")return;
  node.dataset.artworkErrorBound="1";
  node.addEventListener("error",()=>{
    const src=String(node.currentSrc||node.src||"");
    if(!src||/\/icon\.svg(?:\?|$)/.test(src))return;
    if(node.dataset.artistImage)invalidateArtistArtwork(node.dataset.artistImage);
    else if(node.dataset.coverFor){const t=trackById(node.dataset.coverFor);if(t)invalidateArtworkKey(artworkKey("album",primaryArtist(t.artist),t.album));}
    node.src="/icon.svg";
    scheduleArtworkRetry(node);
  });
}
async function hydrateArtwork(){
  if(!state.authenticated || document.hidden) return;
  const observer=getArtworkObserver();
  const coverNodes=[...document.querySelectorAll("[data-cover-for]")];
  const artistNodes=[...document.querySelectorAll("[data-artist-image]")];
  for(const node of [...coverNodes,...artistNodes])bindArtworkErrorRecovery(node);
  if(observer){
    for(const node of coverNodes)observer.observe(node);
    for(const node of artistNodes)observer.observe(node);
    return;
  }
  const albumIds=coverNodes.map(n=>n.dataset.coverFor).filter(Boolean);
  const artistNames=artistNodes.map(n=>n.dataset.artistImage).filter(Boolean);
  for(const id of [...new Set(albumIds)])hydrateCoverNode(id);
  for(const artist of [...new Set(artistNames)])hydrateArtistNode(artist);
}

function artworkKey(kind,artist,album=""){return `${kind}:${normalize(artist)}:${normalize(album)}`;}
function getArtwork(track,kind){return state.artwork[artworkKey(kind,track.artist,track.album)]||"";}
function getArtistArtwork(artist){return state.artwork[artworkKey("artist",artist,"")]||"";}
async function fetchArtwork(kind,artist,album,{force=false}={}){
  if(kind==="album"&&isUnknownAlbum(album)) return "";
  artist=primaryArtist(artist);
  const key=artworkKey(kind,artist,album);
  const existing=state.artwork[key];
  if(existing&&!force)return existing;
  if(!force&&(artworkMissUntil.get(key)||0)>Date.now())return "";
  if(!force&&artworkInFlight.has(key))return artworkInFlight.get(key);
  if(force){artworkMissUntil.delete(key);delete state.artwork[key];}
  const task=(async()=>{
    try{
      const p=new URLSearchParams({kind,artist,rev:"7"});if(album)p.set("album",album);
      const r=await apiFetch(`/api/artwork?${p}`);
      if(!r.ok)throw new Error(`Artwork ${r.status}`);
      const d=await r.json().catch(()=>({}));
      const image=typeof d.image==="string"?d.image.trim():"";
      if(image){
        state.artwork[key]=image;
        artworkMissUntil.delete(key);
        persistArtworkCache();
        return image;
      }
      artworkMissUntil.set(key,Date.now()+ARTWORK_MISS_RETRY_MS);
      return "";
    }catch{
      artworkMissUntil.set(key,Date.now()+ARTWORK_MISS_RETRY_MS);
      return "";
    }finally{
      artworkInFlight.delete(key);
    }
  })();
  artworkInFlight.set(key,task);
  return task;
}
function refreshArtworkNodes(track){const art=getTrackArtwork(track);if(!art)return;document.querySelectorAll(`[data-cover-for="${cssEsc(track.id)}"]`).forEach(img=>img.src=art);if(state.currentId===track.id){el("nowCover").src=art;el("npCover").src=art;updateMediaSession(track,art);}}
function refreshArtistNodes(artist){const art=getArtistArtwork(artist);if(!art)return;document.querySelectorAll(`[data-artist-image="${cssEsc(artist)}"]`).forEach(img=>img.src=art);}
function splitArtists(value){return String(value||"").split(/,|&|\bfeat\.?\b|\bft\.?\b/i).map(s=>s.trim()).filter(Boolean);}


// ---------- Solicitudes de música ----------
function requestStatusLabel(status){return ({requested:"Solicitada",review:"En revisión",available:"Disponible",not_found:"No encontrada",discarded:"Descartada"})[status]||"Solicitada";}
function renderRequests(){
  trackList.classList.add("hidden");trackListHeader.classList.add("hidden");emptyState.classList.add("hidden");collectionGrid.classList.remove("hidden");el("trackCount").textContent="Tus solicitudes";
  const spotify=state.spotifyStatus;const spotifyText=spotify?.connected?"Spotify conectado ✓":spotify?.configured?"Conectar Spotify":"Spotify no configurado";
  const requestRows=state.musicRequests.length?state.musicRequests.map(r=>`<div class="admin-row"><div><strong>${esc(r.title)}</strong><small>${esc(r.artist)}${r.album?` · ${esc(r.album)}`:""}</small></div><div class="admin-row-actions"><span class="chip">${esc(requestStatusLabel(r.status))}</span>${r.status==="available"&&r.available_track_id?`<button class="chip" data-request-play="${esc(r.available_track_id)}">▶ Reproducir</button>`:""}${!["available","discarded"].includes(r.status)?`<button class="danger-text" data-request-cancel="${esc(r.id)}">Cancelar</button>`:""}</div></div>`).join(""):`<p class="muted">Todavía no has solicitado canciones.</p>`;
  const playlistRows=state.playlistAnalyses.length?state.playlistAnalyses.map(a=>`<div class="admin-row"><div><strong>${esc(a.playlist?.name||"Playlist")}</strong><small>${Number(a.summary?.total||0)} canciones · ${Number(a.summary?.available||0)} disponibles · ${Number(a.summary?.missing||0)} faltan · ${Number(a.summary?.review||0)} revisar${a.previous_summary?` · antes faltaban ${Number(a.previous_summary.missing||0)}`:""}</small></div><div class="admin-row-actions"><button class="chip" data-playlist-reanalyze="${esc(a.id)}">Analizar de nuevo</button><a class="chip" href="${esc(a.playlist?.spotify_url||"#")}" target="_blank" rel="noopener noreferrer">Spotify ↗</a></div></div>`).join(""):`<p class="muted">Aún no has analizado playlists.</p>`;
  const preview=renderRequestIdentifyPreview();
  collectionGrid.innerHTML=`<div class="admin-stack request-stack"><section class="admin-card"><div class="section-head"><div><span class="eyebrow">PEDIR UNA CANCIÓN</span><h2>¿Qué quieres escuchar?</h2></div></div><p class="muted">GMusic comprobará primero si ya está en la biblioteca. Solo tú ves tus solicitudes.</p><div class="request-form"><input id="requestTitle" maxlength="160" placeholder="Título de la canción"><input id="requestArtist" maxlength="160" placeholder="Artista"><input id="requestAlbum" maxlength="160" placeholder="Álbum (opcional)"><button id="requestIdentifyBtn" class="primary">Comprobar</button></div><div id="requestIdentifyPreview">${preview}</div></section><section class="admin-card"><div class="section-head"><div><span class="eyebrow">TUS SOLICITUDES</span><h2>Estado</h2></div><button id="refreshRequestsBtn" class="ghost">Actualizar</button></div><div class="admin-list">${requestRows}</div></section><section class="admin-card"><div class="section-head"><div><span class="eyebrow">PLAYLISTS</span><h2>Comparar con GMusic</h2></div><button id="spotifyConnectBtn" class="ghost" ${spotify&&!spotify.configured?"disabled":""}>${esc(spotifyText)}</button></div><p class="muted">Spotify permite leer los elementos cuando la cuenta conectada es propietaria o colaboradora de la playlist. Solo se usa metadata; GMusic no descarga audio desde Spotify.</p><div class="request-form playlist-request-form"><input id="playlistRequestUrl" placeholder="https://open.spotify.com/playlist/…"><button id="playlistAnalyzeBtn" class="primary">Analizar playlist</button></div><p id="playlistRequestStatus" class="status-line"></p><div class="admin-list">${playlistRows}</div></section></div>`;
  el("requestIdentifyBtn")?.addEventListener("click",identifyRequestFromForm);el("refreshRequestsBtn")?.addEventListener("click",()=>loadRequestCenter(true));el("playlistAnalyzeBtn")?.addEventListener("click",analyzePlaylistFromForm);el("spotifyConnectBtn")?.addEventListener("click",()=>{if(state.spotifyStatus?.connected)return disconnectSpotify();location.href="/api/spotify/authorize";});
  collectionGrid.querySelectorAll("[data-request-play]").forEach(b=>b.addEventListener("click",()=>playInContext(state.tracks.map(t=>t.id),b.dataset.requestPlay)));collectionGrid.querySelectorAll("[data-request-cancel]").forEach(b=>b.addEventListener("click",()=>cancelMusicRequest(b.dataset.requestCancel)));collectionGrid.querySelectorAll("[data-playlist-reanalyze]").forEach(b=>b.addEventListener("click",()=>reanalyzePlaylistRequest(b.dataset.playlistReanalyze)));
  if(!state.requestsLoaded&&!state.requestsBusy&&state.onlineApi)loadRequestCenter();
}
function renderRequestIdentifyPreview(){const d=state.requestIdentify;if(!d)return"";if(d.status==="available"&&d.match)return`<div class="request-preview ok"><strong>✓ Ya está en GMusic</strong><span>${esc(d.match.title)} — ${esc(d.match.artist)}</span><button class="chip" data-identify-play="${esc(d.match.id)}">▶ Reproducir</button></div>`;const p=d.suggestion;const local=d.possible_local?.track;if(p)return`<div class="request-preview"><strong>Creemos que buscas:</strong><span>${esc(p.title)} — ${esc(p.artist)}</span><small>${esc(p.album||"Álbum no identificado")}${p.year?` · ${esc(p.year)}`:""} · confianza ${Number(p.score||0)}%</small><button class="primary" id="requestSubmitSuggested">Sí, solicitar esta</button><button class="ghost" id="requestSubmitTyped">Solicitar lo escrito</button></div>`;if(local)return`<div class="request-preview warning"><strong>Hay una posible coincidencia</strong><span>${esc(local.title)} — ${esc(local.artist)}</span><small>Revísala antes de solicitar otra versión.</small><button class="chip" data-identify-play="${esc(local.id)}">▶ Escuchar coincidencia</button><button class="primary" id="requestSubmitTyped">Solicitar igualmente</button></div>`;return`<div class="request-preview"><strong>No está en la biblioteca</strong><span>Puedes enviar la solicitud.</span><button class="primary" id="requestSubmitTyped">Solicitar canción</button></div>`;}
function bindRequestPreview(){collectionGrid.querySelectorAll("[data-identify-play]").forEach(b=>b.addEventListener("click",()=>playInContext(state.tracks.map(t=>t.id),b.dataset.identifyPlay)));el("requestSubmitSuggested")?.addEventListener("click",()=>submitMusicRequest(true));el("requestSubmitTyped")?.addEventListener("click",()=>submitMusicRequest(false));}
async function loadRequestCenter(force=false){if(state.requestsBusy||!state.onlineApi)return;state.requestsBusy=true;try{const [r1,r2,r3]=await Promise.all([apiFetch("/api/music-requests"),apiFetch("/api/playlist-requests"),apiFetch("/api/spotify/status")]);const d1=await r1.json().catch(()=>({})),d2=await r2.json().catch(()=>({})),d3=await r3.json().catch(()=>({}));if(r1.ok)state.musicRequests=d1.requests||[];if(r2.ok)state.playlistAnalyses=d2.analyses||[];if(r3.ok)state.spotifyStatus=d3;state.requestsLoaded=true;}catch{}finally{state.requestsBusy=false;if(state.view==="requests")renderRequests();}}
async function identifyRequestFromForm(){const title=el("requestTitle")?.value.trim(),artist=el("requestArtist")?.value.trim(),album=el("requestAlbum")?.value.trim();if(!title||!artist)return toast("Escribe título y artista.");const btn=el("requestIdentifyBtn");btn.disabled=true;btn.textContent="Comprobando…";try{const r=await apiFetch("/api/music-requests/identify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title,artist,album})});const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo comprobar la canción");state.requestIdentify={...d,typed:{title,artist,album}};const box=el("requestIdentifyPreview");if(box)box.innerHTML=renderRequestIdentifyPreview();bindRequestPreview();}finally{btn.disabled=false;btn.textContent="Comprobar";}}
async function submitMusicRequest(useSuggestion){const d=state.requestIdentify||{},typed=d.typed||{};const p=useSuggestion&&d.suggestion?d.suggestion:typed;const r=await apiFetch("/api/music-requests",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:p.title||typed.title,artist:p.artist||typed.artist,album:p.album||typed.album,mb_recording_id:p.mb_recording_id||"",mb_release_id:p.mb_release_id||""})});const out=await r.json().catch(()=>({}));if(!r.ok)return toast(out.error||"No se pudo enviar la solicitud");if(out.already_available){toast("Esa canción ya está disponible ✓");return playInContext(state.tracks.map(t=>t.id),out.track.id);}toast(out.duplicate?"Ya tenías esa solicitud.":"Solicitud enviada ✓");state.requestIdentify=null;await loadRequestCenter(true);}
async function cancelMusicRequest(id){const r=await apiFetch(`/api/music-requests/${encodeURIComponent(id)}`,{method:"DELETE"});if(!r.ok)return toast("No se pudo cancelar");toast("Solicitud cancelada");await loadRequestCenter(true);}
async function analyzePlaylistFromForm(){const url=el("playlistRequestUrl")?.value.trim();if(!url)return toast("Pega un enlace de playlist.");const b=el("playlistAnalyzeBtn"),status=el("playlistRequestStatus");b.disabled=true;b.textContent="Analizando…";status.textContent="Leyendo metadata y comparando con tu biblioteca…";try{const r=await apiFetch("/api/playlist-requests",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});const d=await r.json().catch(()=>({}));if(r.status===428&&d.needs_spotify){status.innerHTML=`${esc(d.error||"Conecta Spotify.")} <button id="playlistSpotifyAuthorize" class="chip">Conectar Spotify</button>`;el("playlistSpotifyAuthorize")?.addEventListener("click",()=>location.href=d.authorize_url||"/api/spotify/authorize");return;}if(!r.ok){status.textContent=d.error||"No se pudo analizar la playlist.";return;}status.textContent=`✓ ${d.analysis.summary.total} canciones · ${d.analysis.summary.available} disponibles · ${d.analysis.summary.missing} faltan · ${d.analysis.summary.review} revisar`;await loadRequestCenter(true);}finally{b.disabled=false;b.textContent="Analizar playlist";}}
async function reanalyzePlaylistRequest(id){const r=await apiFetch(`/api/playlist-requests/${encodeURIComponent(id)}/reanalyze`,{method:"POST"}),d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo reanalizar la playlist");toast(`Actualizado: ahora faltan ${Number(d.analysis?.summary?.missing||0)} canciones`);await loadRequestCenter(true);}
async function disconnectSpotify(){if(!confirm("¿Desconectar Spotify de GMusic en este usuario?"))return;await apiFetch("/api/spotify/disconnect",{method:"DELETE"});state.spotifyStatus={...(state.spotifyStatus||{}),connected:false};renderRequests();}

// ---------- YouTube Discovery + GMusic DJ v3.5 ----------
function djPrefsKey(){return `gmusic_dj_prefs_v1:${state.offlineScope||"anonymous"}`;}
function loadDjFeedback(){state.dj.feedback=safeJson(localStorage.getItem(djPrefsKey()),{})||{};}
function saveDjFeedback(){localStorage.setItem(djPrefsKey(),JSON.stringify(state.dj.feedback||{}));}
function djModeLabel(mode){return ({taste:"Mis gustos",favorites:"Favoritos",energy:"Energía",chill:"Chill",discovery:"Descubrimiento",surprise:"Sorpréndeme"})[mode]||"Mis gustos";}
function chooseNextDjTrack(){const recentArtists=state.dj.lastIds.map(id=>primaryDjArtist(trackById(id))).filter(Boolean).slice(0,6);return chooseDjTrack(state.tracks,{currentId:state.currentId,mode:state.dj.mode,stats:state.stats,favoriteIds:state.favoriteIds,recentIds:state.recentIds,recentArtists,djLastIds:state.dj.lastIds,feedback:state.dj.feedback});}
async function startDj(mode="taste"){if(!state.tracks.length)return toast("La biblioteca está vacía.");if(mode==="favorites"&&!state.favoriteIds.size)return toast("Aún no tienes canciones favoritas para este modo.");loadDjFeedback();state.dj.active=true;state.dj.mode=mode;state.dj.lastIds=[];state.dj.history=[];state.dj.suppressHistoryOnce=false;const next=chooseNextDjTrack();if(!next){state.dj.active=false;return toast("No encontramos una canción para este modo.");}toast(`DJ activado · ${djModeLabel(mode)}`);await playInContext(state.tracks.map(t=>t.id),next.id);renderDiscover();}
function stopDj(){state.dj.active=false;state.dj.lastIds=[];state.dj.history=[];state.dj.suppressHistoryOnce=false;scheduleNativeQueueResync();toast("DJ desactivado");renderDiscover();}
function adjustDjFeedback(kind){const t=trackById(state.currentId);if(!t)return toast("Primero reproduce una canción de tu biblioteca.");loadDjFeedback();const artist=primaryDjArtist(t);const genre=normalize(t.genre||"");state.dj.feedback.artistWeights=state.dj.feedback.artistWeights||{};state.dj.feedback.genreWeights=state.dj.feedback.genreWeights||{};if(kind==="more"){state.dj.feedback.artistWeights[artist]=(Number(state.dj.feedback.artistWeights[artist]||0)+1);if(genre)state.dj.feedback.genreWeights[genre]=Number(state.dj.feedback.genreWeights[genre]||0)+1;toast("El DJ tendrá más en cuenta este estilo");}if(kind==="less"){state.dj.feedback.artistWeights[artist]=(Number(state.dj.feedback.artistWeights[artist]||0)-1);if(genre)state.dj.feedback.genreWeights[genre]=Number(state.dj.feedback.genreWeights[genre]||0)-1;toast("El DJ reducirá este estilo");}if(kind==="energy"){state.dj.mode="energy";toast("DJ: subiendo energía");}if(kind==="chill"){state.dj.mode="chill";toast("DJ: más tranquilo");}if(kind==="surprise"){state.dj.mode="surprise";toast("DJ: modo sorpresa");}saveDjFeedback();renderDiscover();}
function renderDiscover(){trackList.classList.add("hidden");trackListHeader.classList.add("hidden");emptyState.classList.add("hidden");collectionGrid.classList.remove("hidden");el("trackCount").textContent=state.dj.active?`DJ · ${djModeLabel(state.dj.mode)}`:"YouTube + DJ";const results=state.youtubeResults||[];const current=trackById(state.currentId);collectionGrid.innerHTML=`<div class="discover-stack"><section class="admin-card discover-card"><div class="section-head"><div><span class="eyebrow">YOUTUBE DISCOVERY</span><h2>Busca y reproduce</h2></div><span class="source-badge">YouTube</span></div><p class="muted">La reproducción usa el reproductor oficial de YouTube. No se descarga ni se separa el audio. YouTube se pausa si GMusic queda en segundo plano. Si escuchas un video durante 30 segundos o más, GMusic registra esa escucha en tu cuenta para gestionar música solicitada.</p><div class="youtube-search-row"><input id="youtubeSearchInput" maxlength="100" placeholder="Canción o artista" value="${esc(state.youtubeQuery)}"><button id="youtubeSearchBtn" class="primary" ${state.youtubeBusy?"disabled":""}>${state.youtubeBusy?"Buscando…":"Buscar"}</button></div><p id="youtubeSearchStatus" class="status-line">${state.youtubeConfigured===false?"Configura YOUTUBE_API_KEY en Cloudflare para activar esta función.":results.length?`${results.length} resultados disponibles para reproducir.`:"La búsqueda se hace solo al pulsar Buscar para cuidar la cuota diaria."}</p><div class="youtube-results">${results.map((v,i)=>youtubeResultCard(v,i)).join("")||`<p class="muted">Aún no hay resultados.</p>`}</div></section><section class="admin-card discover-card"><div class="section-head"><div><span class="eyebrow">GMUSIC DJ</span><h2>Sesión inteligente</h2></div>${state.dj.active?`<span class="chip">Activo · ${esc(djModeLabel(state.dj.mode))}</span>`:""}</div><p class="muted">El DJ elige dinámicamente dentro de tu biblioteca usando tus favoritos, reproducciones, recientes y feedback local. No usa datos de otros usuarios.</p><div class="dj-modes">${["taste","favorites","energy","chill","discovery","surprise"].map(m=>`<button class="${state.dj.active&&state.dj.mode===m?"primary":"chip"}" data-dj-start="${m}">${esc(djModeLabel(m))}</button>`).join("")}${state.dj.active?`<button class="danger-text" id="djStopBtn">Detener DJ</button>`:""}</div>${state.dj.active?`<div class="dj-now"><div><span class="eyebrow">EL DJ ESTÁ ESCUCHANDO</span><strong>${esc(current?.title||"Preparando siguiente canción")}</strong><small>${esc(current?.artist||"")}</small></div><div class="admin-row-actions"><button class="chip" data-dj-feedback="more">👍 Más de esto</button><button class="chip" data-dj-feedback="less">👎 Menos</button><button class="chip" data-dj-feedback="energy">🔥 Más energía</button><button class="chip" data-dj-feedback="chill">🌙 Más chill</button><button class="chip" data-dj-feedback="surprise">✨ Sorpréndeme</button></div></div>`:""}${state.dj.active&&state.dj.mode==="discovery"?`<button id="djYoutubeDiscoveryBtn" class="ghost">Buscar descubrimiento relacionado en YouTube</button><small class="muted">Esta acción consume una búsqueda de la cuota de YouTube y por eso solo se ejecuta cuando tú la pulsas.</small>`:""}</section></div>`;el("youtubeSearchBtn")?.addEventListener("click",()=>searchYouTubeFromDiscover());el("youtubeSearchInput")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchYouTubeFromDiscover();}});collectionGrid.querySelectorAll("[data-youtube-play]").forEach(b=>b.addEventListener("click",()=>playYouTubeResult(Number(b.dataset.youtubePlay),state.youtubeSource||"search")));collectionGrid.querySelectorAll("[data-dj-start]").forEach(b=>b.addEventListener("click",()=>startDj(b.dataset.djStart)));collectionGrid.querySelectorAll("[data-dj-feedback]").forEach(b=>b.addEventListener("click",()=>adjustDjFeedback(b.dataset.djFeedback)));el("djStopBtn")?.addEventListener("click",stopDj);el("djYoutubeDiscoveryBtn")?.addEventListener("click",()=>searchYouTubeForDj());}
function youtubeResultCard(v,i){return `<article class="youtube-result"><img src="${esc(v.thumbnail||"/icon.svg")}" alt=""><div><strong>${esc(v.title)}</strong><small>${esc(v.channel)}${v.duration_seconds?` · ${formatTime(v.duration_seconds)}`:""}</small></div><div class="admin-row-actions"><button class="primary" data-youtube-play="${i}">▶ Reproducir</button><a class="chip" href="${esc(v.youtube_url)}" target="_blank" rel="noopener">YouTube ↗</a></div></article>`;}
async function searchYouTubeFromDiscover(queryOverride="",source="search"){const input=el("youtubeSearchInput");const q=String(queryOverride||input?.value||"").trim();if(q.length<2)return toast("Escribe una canción o artista.");state.youtubeQuery=q;state.youtubeSource=source;state.youtubeBusy=true;renderDiscover();try{const r=await apiFetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);const d=await r.json().catch(()=>({}));state.youtubeConfigured=!(r.status===503&&d.configured===false);if(!r.ok){state.youtubeResults=[];toast(d.error||"No se pudo buscar en YouTube");}else{state.youtubeResults=d.results||[];if(d.filtered_made_for_kids)toast("Algunos resultados infantiles fueron omitidos por privacidad.");}}catch{state.youtubeResults=[];toast("No se pudo conectar con YouTube");}finally{state.youtubeBusy=false;renderDiscover();}}
async function searchYouTubeForDj(){const t=trackById(state.currentId);const seed=t?.artist||state.tracks.find(x=>state.favoriteIds.has(x.id))?.artist||"música";await searchYouTubeFromDiscover(`${seed} música`,"dj");}
function ensureYouTubeApi(){if(window.YT?.Player)return Promise.resolve(window.YT);if(ensureYouTubeApi.promise)return ensureYouTubeApi.promise;ensureYouTubeApi.promise=new Promise((resolve,reject)=>{const previous=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{try{previous?.();}catch{}resolve(window.YT);};const script=document.createElement("script");script.src="https://www.youtube.com/iframe_api";script.async=true;script.onerror=()=>reject(new Error("No se pudo cargar el reproductor de YouTube"));document.head.appendChild(script);});return ensureYouTubeApi.promise;}
function youtubeListenConsentKey(){return `${YOUTUBE_LISTEN_CONSENT_PREFIX}${state.offlineScope||"anonymous"}`;}
function ensureYouTubeListenConsent(){if(localStorage.getItem(youtubeListenConsentKey())==="1")return true;const ok=window.confirm("Para reproducir YouTube dentro de GMusic, si escuchas un video durante 30 segundos o más se registrarán en tu cuenta el video, la fecha y el tiempo aproximado de escucha para gestionar música solicitada. ¿Deseas continuar?");if(ok)localStorage.setItem(youtubeListenConsentKey(),"1");return ok;}
async function playYouTubeResult(index,source="search"){
  const video=state.youtubeResults[index];if(!video||!ensureYouTubeListenConsent())return;
  // Cerrar correctamente la sesión anterior ANTES de reemplazarla evita timers huérfanos.
  stopYouTubeListenClock(state.youtubeListen?.session_id||"");
  await persistPlaybackNow(true);audio.pause();state.activePlaybackSource="youtube";
  state.youtubeCurrent={...video,source,index};
  state.youtubeListen={session_id:crypto.randomUUID(),accumulated:0,started_at:0,recorded:false,recording:false,retries:0,timer:null,listen_token:video.listen_token||""};
  setupYouTubeMediaSession(video);
  el("ytDialogTitle").textContent=video.title;el("ytDialogChannel").textContent=video.channel;el("ytOpenLink").href=video.youtube_url;
  const dialog=el("youtubeDialog");dialog.showModal();
  try{
    await ensureYouTubeApi();
    if(!state.youtubePlayer){
      state.youtubePlayer=new window.YT.Player("youtubePlayerMount",{height:"360",width:"640",videoId:video.video_id,playerVars:{playsinline:1,autoplay:0,controls:1,origin:location.origin},events:{onReady:e=>{state.youtubePlayerReady=true;e.target.playVideo();},onStateChange:onYouTubePlayerState,onAutoplayBlocked:()=>toast("Pulsa Play dentro del reproductor de YouTube.")}});
    }else state.youtubePlayer.loadVideoById({videoId:video.video_id,startSeconds:0});
  }catch(e){state.activePlaybackSource="none";clearMediaSessionHandlers();toast(e.message||"No se pudo abrir YouTube");}
}
function onYouTubePlayerState(event){
  if(!window.YT)return;
  if(event.data===window.YT.PlayerState.PLAYING){state.activePlaybackSource="youtube";setupYouTubeMediaSession(state.youtubeCurrent);try{navigator.mediaSession.playbackState="playing";}catch{}startYouTubeListenClock();}
  else if([window.YT.PlayerState.PAUSED,window.YT.PlayerState.ENDED,window.YT.PlayerState.BUFFERING].includes(event.data)){stopYouTubeListenClock(state.youtubeListen?.session_id||"");if(state.activePlaybackSource==="youtube"){try{navigator.mediaSession.playbackState=event.data===window.YT.PlayerState.BUFFERING?"playing":"paused";}catch{}}}
}
function startYouTubeListenClock(){
  const l=state.youtubeListen;if(!l||l.recorded||l.recording||document.hidden)return;if(!l.started_at)l.started_at=Date.now();clearTimeout(l.timer);
  const sessionId=l.session_id,remaining=Math.max(250,30000-l.accumulated);
  l.timer=setTimeout(()=>{if(state.youtubeListen?.session_id!==sessionId)return;stopYouTubeListenClock(sessionId);registerYouTubeListen(l,state.youtubeCurrent);},remaining);
}
function stopYouTubeListenClock(sessionId=""){
  const l=state.youtubeListen;if(!l||sessionId&&l.session_id!==sessionId)return;
  if(l.started_at){l.accumulated+=Math.max(0,Date.now()-l.started_at);l.started_at=0;}
  clearTimeout(l.timer);l.timer=null;
  if(!l.recorded&&!l.recording&&l.accumulated>=30000)registerYouTubeListen(l,state.youtubeCurrent);
}
async function registerYouTubeListen(listen=state.youtubeListen,video=state.youtubeCurrent){
  const l=listen,v=video;if(!l||!v||l.recorded||l.recording||l.accumulated<30000||!l.listen_token)return;
  l.recording=true;
  try{
    const r=await apiFetch("/api/youtube/listen",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({session_id:l.session_id,listen_token:l.listen_token,listened_seconds:Math.round(l.accumulated/1000),source:v.source||"search",dj_mode:state.dj.active?state.dj.mode:""})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&(d.recorded||d.duplicate||d.reason==="too_short"||d.reason==="too_soon")){l.recorded=Boolean(d.recorded||d.duplicate);l.recording=false;return;}
    throw new Error(d.error||"No se pudo registrar la escucha");
  }catch{
    l.recording=false;l.retries=Number(l.retries||0)+1;
    if(!l.recorded&&l.retries<=2){const retrySession=l.session_id;setTimeout(()=>{if(l.recorded||l.session_id!==retrySession)return;registerYouTubeListen(l,v);},l.retries*2500);}
  }
}
function pauseYouTubePlayback(reason="pause"){
  const p=state.youtubePlayer;
  if(p){try{stopYouTubeListenClock(state.youtubeListen?.session_id||"");if(typeof p.pauseVideo==="function")p.pauseVideo();}catch{}}
  if(reason!=="pause"&&reason!=="buffering"){
    state.activePlaybackSource=reason==="library_playback"?"library":"none";
    if(state.activePlaybackSource==="library")setupLibraryMediaSessionHandlers();else clearMediaSessionHandlers();
  }
  if(reason==="background"&&state.youtubeCurrent)toast("YouTube se pausó al dejar GMusic en segundo plano.");
}
function renderAdminYouTubeListens(){const box=el("adminYouTubeListens"),summary=el("adminYouTubeSummary");if(!box||!summary)return;const data=state.adminYouTubeListens||{};const rows=data.items||[];summary.textContent=`${Number(data.total_events||0)} reproducciones registradas · ${Number(data.unique_videos||0)} videos · ${data.date||"hoy"}`;box.innerHTML=rows.length?rows.map(v=>`<div class="admin-row youtube-admin-row"><div><strong>${esc(v.title)}</strong><small>${esc(v.channel)} · ${Number(v.plays||0)} reproducciones · ${Number(v.listener_count||0)} usuarios</small><small>${(v.listeners||[]).map(x=>`${esc(x.name)} (${Number(x.plays||0)})`).join(" · ")}</small></div><div class="admin-row-actions"><a class="chip" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}" target="_blank" rel="noopener">YouTube ↗</a></div></div>`).join(""):`<p class="muted">Todavía no hay reproducciones de YouTube registradas hoy.</p>`;}

// ---------- Administración y metadata ----------
async function renderAdmin(){
  if(!state.canManage){state.view="home";return renderHome();}
  state.adminLoaded={users:false,status:false,trash:false,audit:false,requests:false,playlists:false,artists:false,youtube:false};
  trackList.classList.add("hidden");trackListHeader.classList.add("hidden");emptyState.classList.add("hidden");collectionGrid.classList.remove("hidden");el("trackCount").textContent="Panel privado";
  collectionGrid.innerHTML=`<div class="admin-stack">
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">USUARIOS</span><h2>Accesos</h2></div></div><div class="admin-create"><input id="adminNewName" maxlength="60" placeholder="Nombre del usuario"><select id="adminNewRole"><option value="listener">Listener</option><option value="admin">Admin</option></select><button id="adminCreateUser" class="primary">Crear usuario</button></div><div id="adminUsersList" class="admin-list"><p class="muted">Cargando usuarios…</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">SISTEMA</span><h2>Estado y respaldo</h2></div><button id="adminBackupBtn" class="ghost">Descargar backup</button></div><div id="adminStatusGrid" class="stats-grid compact"><p class="muted">Comprobando…</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">BIBLIOTECA</span><h2>Calidad de metadata</h2></div><div class="admin-row-actions"><button id="adminAuditBtn" class="ghost">Analizar</button><button id="adminCleanupBtn" class="primary">Aplicar limpieza segura</button></div></div><div id="adminLibraryAudit" class="admin-list"><p class="muted">Analizando artistas, álbumes y títulos…</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">ARTIST INTELLIGENCE 2.0</span><h2>Fotos de artistas</h2></div><div class="admin-row-actions"><button id="artistImageScanBtn" class="ghost">Analizar imágenes</button></div></div><p class="muted">Las imágenes manuales tienen prioridad. Las coincidencias dudosas nunca se aplican solas.</p><div id="artistImageSummary" class="status-line"></div><div id="artistImageList" class="admin-list"><p class="muted">Cargando artistas…</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">MUSIC REQUESTS</span><h2>Solicitudes de canciones</h2></div><button id="adminReconcileRequests" class="ghost">Revisar biblioteca</button></div><div id="adminRequestsList" class="admin-list"><p class="muted">Cargando solicitudes…</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">PLAYLIST REQUESTS</span><h2>Playlists analizadas</h2></div></div><p class="muted">Exporta un Word completo o solo con las canciones que faltan.</p><div id="adminPlaylistAnalyses" class="admin-list"><p class="muted">Cargando playlists…</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">YOUTUBE DISCOVERY</span><h2>Escuchado desde YouTube</h2></div></div><p class="muted">Solo se registra una reproducción después de 30 segundos. Esta información es privada del panel de administración.</p><div id="adminYouTubeSummary" class="status-line"></div><div id="adminYouTubeListens" class="admin-list"><p class="muted">Cargando reproducciones de hoy…</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">METADATA INTELLIGENCE</span><h2>Completar metadata con Internet</h2></div><div class="admin-row-actions"><button id="metadataScanBtn" class="ghost">✨ Analizar biblioteca</button><button id="metadataApplySafeBtn" class="primary">Aplicar coincidencias seguras</button></div></div><p class="muted">Busca álbum, año, portada y release con MusicBrainz. Las propuestas dudosas nunca se aplican solas.</p><div id="metadataScanSummary" class="status-line"></div><div id="metadataScanResults" class="admin-list"><p class="muted">Aún no se ha ejecutado el análisis online.</p></div></section>
  <section class="admin-card"><div class="section-head"><div><span class="eyebrow">PAPELERA</span><h2>Canciones eliminadas</h2></div></div><div id="adminTrashList" class="admin-list"><p class="muted">Cargando papelera…</p></div></section></div>`;
  el("adminCreateUser")?.addEventListener("click",adminCreateUser);el("adminBackupBtn")?.addEventListener("click",downloadAdminBackup);el("adminAuditBtn")?.addEventListener("click",loadAdminLibraryAudit);el("adminCleanupBtn")?.addEventListener("click",applyAdminLibraryCleanup);el("metadataScanBtn")?.addEventListener("click",scanMetadataLibrary);el("metadataApplySafeBtn")?.addEventListener("click",applySafeMetadataMatches);el("artistImageScanBtn")?.addEventListener("click",scanArtistImages);el("adminReconcileRequests")?.addEventListener("click",adminReconcileRequests);renderMetadataScan();await loadAdminPanel();
}
async function loadAdminUsers(){const r=await apiFetch("/api/admin/users"),d=await r.json().catch(()=>({}));if(r.ok){state.adminUsers=d.users||[];state.adminLoaded.users=true;renderAdminUsers();}}
async function loadAdminStatusOnly(){const r=await apiFetch("/api/admin/status"),d=await r.json().catch(()=>({}));if(r.ok){d.users=state.adminUsers.length;state.adminLoaded.status=true;renderAdminStatus(d);}}
async function loadAdminTrash(){const r=await apiFetch("/api/trash"),d=await r.json().catch(()=>({}));if(r.ok){state.trashTracks=d.tracks||[];state.adminLoaded.trash=true;renderAdminTrash();}}
async function loadAdminPlaylistAnalyses(){const r=await apiFetch("/api/admin/playlist-analyses"),d=await r.json().catch(()=>({}));if(r.ok){state.adminPlaylistAnalyses=d.analyses||[];state.adminLoaded.playlists=true;renderAdminPlaylistAnalyses();}}
async function loadAdminArtistsAudit(){const r=await apiFetch("/api/admin/artists/audit"),d=await r.json().catch(()=>({}));if(r.ok){state.artistImageScan={busy:false,rows:d.rows||[],done:0,total:Number(d.total||0)};state.adminLoaded.artists=true;renderAdminArtistImages();}}
async function loadAdminYouTubeListens(){const r=await apiFetch("/api/admin/youtube/listens"),d=await r.json().catch(()=>({}));state.adminYouTubeListens=r.ok?d:{items:[],total_events:0,unique_videos:0};state.adminLoaded.youtube=true;renderAdminYouTubeListens();}
function setupAdminLazyLoading(){
  if(loadAdminPanel.observer){loadAdminPanel.observer.disconnect();loadAdminPanel.observer=null;}
  const tasks=[
    ["adminLibraryAudit","audit",loadAdminLibraryAudit],["artistImageList","artists",loadAdminArtistsAudit],["adminRequestsList","requests",reloadAdminRequests],
    ["adminPlaylistAnalyses","playlists",loadAdminPlaylistAnalyses],["adminYouTubeListens","youtube",loadAdminYouTubeListens],["adminTrashList","trash",loadAdminTrash]
  ];
  const run=(id,key,loader)=>{if(state.adminLoaded[key])return;loader().catch(()=>{});};
  if(!("IntersectionObserver"in window)){for(const t of tasks)run(...t);return;}
  const observer=new IntersectionObserver((entries)=>{for(const entry of entries){if(!entry.isIntersecting)continue;const task=tasks.find(t=>el(t[0])?.closest("section")===entry.target);if(task){observer.unobserve(entry.target);run(...task);}}},{rootMargin:"300px 0px"});
  for(const task of tasks){const section=el(task[0])?.closest("section");if(section)observer.observe(section);}
  loadAdminPanel.observer=observer;
}
async function loadAdminPanel(){
  try{await loadAdminUsers();await loadAdminStatusOnly();setupAdminLazyLoading();}
  catch{toast("No se pudo cargar el panel de administración");}
}
function artistCandidateSrc(image){if(!image)return"/icon.svg";if(String(image).startsWith("/api/"))return image;return `/api/artwork/proxy?url=${encodeURIComponent(image)}`;}
function renderAdminArtistImages(){const box=el("artistImageList"),summary=el("artistImageSummary");if(!box||!summary)return;const rows=state.artistImageScan.rows||[];const saved=rows.filter(r=>r.profile).length,high=rows.filter(r=>r.result?.status==="high").length,review=rows.filter(r=>r.result?.status==="review").length,missing=rows.filter(r=>r.result&& !r.result.candidate).length,pending=rows.filter(r=>!r.profile&&!r.result).length;summary.textContent=state.artistImageScan.busy?`Analizando ${state.artistImageScan.done}/${state.artistImageScan.total} · ${high} seguras · ${review} revisar`:`${rows.length} artistas · ${saved} guardadas · ${high} propuestas seguras · ${review} revisar · ${missing} sin foto · ${pending} pendientes`;
 const scan=el("artistImageScanBtn");if(scan){scan.disabled=state.artistImageScan.busy;scan.textContent=state.artistImageScan.busy?`Analizando ${state.artistImageScan.done}/${state.artistImageScan.total}…`:"Analizar imágenes";}
 box.innerHTML=rows.length?rows.map((r,i)=>{const profile=r.profile,c=r.result?.candidate;const src=profile?artistCandidateSrc(profile.image||`/api/artwork/artist/manual?artist=${encodeURIComponent(r.artist)}`):c?artistCandidateSrc(c.image):"/icon.svg";const label=profile?(profile.source==="manual"?"Manual":"Guardada"):r.result?(r.result.status==="high"?"Alta confianza":r.result.status==="review"?"Revisar":"Sin coincidencia"):"Pendiente";return `<div class="admin-row artist-quality-row"><img class="artist-admin-thumb" src="${esc(src)}" alt=""><div><strong>${esc(r.artist)}</strong><small>${esc(label)}${c?.source?` · ${esc(c.source)}`:""}${r.result?.score?` · ${Number(r.result.score)}%`:""}</small></div><div class="admin-row-actions">${c&&["high","review"].includes(r.result.status)?`<button class="chip" data-artist-apply="${i}">Aplicar</button>`:""}<button class="chip" data-artist-search="${i}">${r.result?"Buscar de nuevo":"Buscar"}</button><button class="chip" data-artist-upload="${i}">Subir manual</button>${profile?`<button class="danger-text" data-artist-clear="${i}">Quitar</button>`:""}</div></div>`;}).join(""):`<p class="muted">No hay artistas en la biblioteca.</p>`;
 box.querySelectorAll("[data-artist-search]").forEach(b=>b.addEventListener("click",()=>searchOneArtistImage(Number(b.dataset.artistSearch),true)));box.querySelectorAll("[data-artist-apply]").forEach(b=>b.addEventListener("click",()=>applyArtistImageCandidate(Number(b.dataset.artistApply))));box.querySelectorAll("[data-artist-upload]").forEach(b=>b.addEventListener("click",()=>uploadManualArtistImage(Number(b.dataset.artistUpload))));box.querySelectorAll("[data-artist-clear]").forEach(b=>b.addEventListener("click",()=>clearArtistImage(Number(b.dataset.artistClear))));}
async function scanArtistImages(){if(state.artistImageScan.busy)return;if(!state.adminLoaded.artists)await loadAdminArtistsAudit();const targets=(state.artistImageScan.rows||[]).map((r,i)=>({r,i})).filter(x=>!x.r.profile);state.artistImageScan.busy=true;state.artistImageScan.done=0;state.artistImageScan.total=targets.length;renderAdminArtistImages();for(const x of targets){if(!state.artistImageScan.busy)break;await searchOneArtistImage(x.i,false);state.artistImageScan.done++;renderAdminArtistImages();}state.artistImageScan.busy=false;renderAdminArtistImages();toast("Análisis de artistas terminado");}
async function searchOneArtistImage(i,refresh=false){const row=state.artistImageScan.rows[i];if(!row)return;try{const r=await apiFetch(`/api/admin/artists/search?artist=${encodeURIComponent(row.artist)}${refresh?"&refresh=1":""}`);const d=await r.json().catch(()=>({}));row.result=r.ok?d:{status:"low",candidate:null,error:d.error};}catch{row.result={status:"low",candidate:null,error:true};}renderAdminArtistImages();}
async function applyArtistImageCandidate(i){const row=state.artistImageScan.rows[i],c=row?.result?.candidate;if(!row||!c)return;const r=await apiFetch("/api/admin/artists/apply",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({artist:row.artist,image:c.image,source:c.source,score:row.result.score,mbid:c.mbid||""})});const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo guardar la imagen");row.profile=d.profile;invalidateArtistArtwork(row.artist);const art=await fetchArtwork("artist",row.artist,"",{force:true});if(art)refreshArtistNodes(row.artist);renderAdminArtistImages();toast(`Imagen guardada para ${row.artist}`);}
async function uploadManualArtistImage(i){const row=state.artistImageScan.rows[i];if(!row)return;const input=document.createElement("input");input.type="file";input.accept="image/jpeg,image/png,image/webp";input.onchange=async()=>{const file=input.files?.[0];if(!file)return;const fd=new FormData();fd.set("artist",row.artist);fd.set("file",file);const r=await apiFetch("/api/admin/artists/manual",{method:"POST",body:fd});const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo subir la imagen");row.profile=d.profile;invalidateArtistArtwork(row.artist);state.artwork[artworkKey("artist",row.artist,"")]=`/api/artwork/artist/manual?artist=${encodeURIComponent(row.artist)}`;persistArtworkCache();refreshArtistNodes(row.artist);renderAdminArtistImages();toast(`Foto manual guardada para ${row.artist}`);};input.click();}
async function clearArtistImage(i){const row=state.artistImageScan.rows[i];if(!row||!confirm(`¿Quitar la imagen guardada de ${row.artist}?`))return;const r=await apiFetch("/api/admin/artists/clear",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({artist:row.artist,delete_manual:true})});if(!r.ok)return toast("No se pudo quitar la imagen");row.profile=null;row.result=null;invalidateArtistArtwork(row.artist);renderAdminArtistImages();}
function renderAdminRequests(){const box=el("adminRequestsList");if(!box)return;const rows=state.adminMusicRequests||[];box.innerHTML=rows.length?rows.map(r=>`<div class="admin-row"><div><strong>${esc(r.title)}</strong><small>${esc(r.artist)}${r.album?` · ${esc(r.album)}`:""}</small></div><div class="admin-row-actions"><span class="chip">${esc(requestStatusLabel(r.status))}</span>${r.status!=="available"?`<button class="chip" data-admin-req-review="${esc(r.id)}">En revisión</button><button class="danger-text" data-admin-req-discard="${esc(r.id)}">Descartar</button>`:""}</div></div>`).join(""):`<p class="muted">No hay solicitudes.</p>`;box.querySelectorAll("[data-admin-req-review]").forEach(b=>b.addEventListener("click",()=>patchAdminRequest(b.dataset.adminReqReview,"review")));box.querySelectorAll("[data-admin-req-discard]").forEach(b=>b.addEventListener("click",()=>patchAdminRequest(b.dataset.adminReqDiscard,"discarded")));}
async function patchAdminRequest(id,status){const r=await apiFetch(`/api/admin/requests/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status})});if(!r.ok)return toast("No se pudo actualizar");await reloadAdminRequests();}
async function reloadAdminRequests(){const r=await apiFetch("/api/admin/requests"),d=await r.json().catch(()=>({}));if(r.ok){state.adminMusicRequests=d.requests||[];state.adminLoaded.requests=true;}renderAdminRequests();}
async function adminReconcileRequests(){const r=await apiFetch("/api/admin/requests/reconcile",{method:"POST"}),d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo revisar");toast(`${Number(d.changed||0)} solicitudes pasaron a Disponible`);await reloadAdminRequests();}
function renderAdminPlaylistAnalyses(){const box=el("adminPlaylistAnalyses");if(!box)return;const rows=state.adminPlaylistAnalyses||[];box.innerHTML=rows.length?rows.map(a=>`<div class="admin-row"><div><strong>${esc(a.playlist?.name||"Playlist")}</strong><small>${Number(a.summary?.total||0)} canciones · ${Number(a.summary?.available||0)} disponibles · ${Number(a.summary?.missing||0)} faltan · ${Number(a.summary?.review||0)} revisar</small></div><div class="admin-row-actions"><a class="chip" href="/api/admin/playlist-analyses/${encodeURIComponent(a.id)}/docx?filter=all">Word completo</a><a class="chip" href="/api/admin/playlist-analyses/${encodeURIComponent(a.id)}/docx?filter=missing">Word faltantes</a>${a.playlist?.spotify_url?`<a class="chip" href="${esc(a.playlist.spotify_url)}" target="_blank" rel="noopener noreferrer">Spotify ↗</a>`:""}</div></div>`).join(""):`<p class="muted">No hay playlists analizadas.</p>`;}

function renderAdminUsers(){
  const box=el("adminUsersList");if(!box)return;box.innerHTML=state.adminUsers.length?state.adminUsers.map(u=>`<div class="admin-row"><div><strong>${esc(u.name)}</strong><small>${esc(u.role)} · ${u.source==="legacy"?"Código legado":"Gestionado"}${u.enabled===false?" · Desactivado":""}</small></div><div class="admin-row-actions">${u.source==="managed"?`<button class="chip" data-user-role="${esc(u.sub)}">${u.role==="admin"?"Hacer listener":"Hacer admin"}</button><button class="chip" data-user-toggle="${esc(u.sub)}">${u.enabled===false?"Activar":"Desactivar"}</button><button class="chip" data-user-regen="${esc(u.sub)}">Regenerar código</button>`:`<span class="muted">USER_CODES</span>`}</div></div>`).join(""):`<p class="muted">No hay usuarios.</p>`;
  box.querySelectorAll("[data-user-role]").forEach(b=>b.addEventListener("click",()=>adminPatchUser(b.dataset.userRole,{role:state.adminUsers.find(u=>u.sub===b.dataset.userRole)?.role==="admin"?"listener":"admin"})));box.querySelectorAll("[data-user-toggle]").forEach(b=>b.addEventListener("click",()=>{const u=state.adminUsers.find(x=>x.sub===b.dataset.userToggle);adminPatchUser(b.dataset.userToggle,{enabled:u?.enabled===false});}));box.querySelectorAll("[data-user-regen]").forEach(b=>b.addEventListener("click",()=>adminRegenerateCode(b.dataset.userRegen)));
}
function renderAdminStatus(s){const box=el("adminStatusGrid");if(!box)return;box.innerHTML=`<div class="stat-card"><span>Versión</span><strong>${esc(s.version||VERSION)}</strong></div><div class="stat-card"><span>Canciones</span><strong>${Number(s.tracks||0)}</strong></div><div class="stat-card"><span>Usuarios</span><strong>${Number(s.users||0)} / ${Number(s.max_users||10)}</strong></div><div class="stat-card"><span>Almacenamiento</span><strong>${formatBytes(s.storage_bytes||0)}</strong></div><div class="stat-card"><span>Drive</span><strong>${s.drive_connected?"OK":"Error"}</strong></div><div class="stat-card"><span>KV</span><strong>${s.kv_connected?"OK":"Error"}</strong></div>`;}
function renderAdminLibraryAudit(){
  const box=el("adminLibraryAudit"); if(!box)return; const a=state.libraryAudit||{};
  const dup=Array.isArray(a.duplicate_artists)?a.duplicate_artists:[]; const changes=Array.isArray(a.changes)?a.changes:[];
  const examples=changes.slice(0,12).map(c=>`<div class="admin-row metadata-change"><div><strong>${esc(c.before?.title||"")}</strong><small>${esc(c.before?.artist||"")} → <b>${esc(c.after?.title||"")}</b> · ${esc(c.after?.artist||"")}</small></div><span class="chip">${esc((c.fields||[]).join(", "))}</span></div>`).join("");
  const duplicates=dup.slice(0,8).map(g=>`<div class="admin-row"><div><strong>${esc(g.display||g.key)}</strong><small>${(g.variants||[]).map(v=>`${esc(v.name)} (${Number(v.count||0)})`).join(" · ")}</small></div><span class="chip">Un solo artista</span></div>`).join("");
  box.innerHTML=`<div class="stats-grid compact"><div class="stat-card"><span>Canciones</span><strong>${Number(a.tracks||state.tracks.length)}</strong></div><div class="stat-card"><span>Cambios seguros</span><strong>${Number(a.change_count||changes.length)}</strong></div><div class="stat-card"><span>Artistas duplicados</span><strong>${dup.length}</strong></div><div class="stat-card"><span>Sin álbum</span><strong>${Number(a.missing_album||0)}</strong></div></div>${duplicates?`<h3>Variantes de artista</h3>${duplicates}`:""}${examples?`<h3>Vista previa de limpieza</h3>${examples}`:`<p class="muted">La metadata ya está limpia según las reglas automáticas.</p>`}`;
}
async function loadAdminLibraryAudit(){const r=await apiFetch("/api/admin/library/audit");const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo analizar la biblioteca");state.libraryAudit=d;state.adminLoaded.audit=true;renderAdminLibraryAudit();}
async function applyAdminLibraryCleanup(){if(!state.adminLoaded.audit)await loadAdminLibraryAudit();const count=Number(state.libraryAudit?.change_count||state.libraryAudit?.changes?.length||0);if(!count)return toast("No hay cambios seguros pendientes.");if(!confirm(`Se limpiarán ${count} registros de metadata. No se tocarán los archivos de audio y se creará respaldo antes de aplicar. ¿Continuar?`))return;const btn=el("adminCleanupBtn");if(btn){btn.disabled=true;btn.textContent="Aplicando…";}try{const r=await apiFetch("/api/admin/library/cleanup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({apply:true})});const d=await r.json().catch(()=>({}));if(!r.ok&&r.status!==207)return toast(d.error||"No se pudo aplicar la limpieza");toast(`${Number(d.applied||0)} registros actualizados${d.failed?.length?` · ${d.failed.length} con error`:""}`);await loadTracks();await loadAdminLibraryAudit();}finally{if(btn){btn.disabled=false;btn.textContent="Aplicar limpieza segura";}}}

function needsMetadataIntelligence(t){return isUnknownAlbum(t.album)||!t.year||!t.cover_release_id||!t.track_number;}
async function scanMetadataLibrary(){
  if(state.metadataScan.busy)return;const targets=state.tracks.filter(needsMetadataIntelligence);state.metadataScan={busy:true,rows:[],done:0,total:targets.length};renderMetadataScan();
  for(const t of targets){if(!state.metadataScan.busy)break;try{const r=await apiFetch(`/api/admin/metadata/search?id=${encodeURIComponent(t.id)}`);const d=await r.json().catch(()=>({}));state.metadataScan.rows.push({track:t,...d});}catch{state.metadataScan.rows.push({track:t,best:null,error:true});}state.metadataScan.done++;renderMetadataScan();await new Promise(r=>setTimeout(r,1125));}
  state.metadataScan.busy=false;renderMetadataScan();toast(`Metadata: ${state.metadataScan.done} canciones analizadas`);
}
function renderMetadataScan(){const summary=el("metadataScanSummary"),box=el("metadataScanResults");if(!summary||!box)return;const rows=state.metadataScan.rows||[];const high=rows.filter(x=>x.best?.status==="high").length,review=rows.filter(x=>x.best?.status==="review").length,none=rows.filter(x=>!x.best||x.best.status==="low").length;summary.textContent=state.metadataScan.busy?`Analizando ${state.metadataScan.done}/${state.metadataScan.total} · ${high} seguras · ${review} para revisar`:`${rows.length?`${rows.length} analizadas · ${high} seguras · ${review} para revisar · ${none} sin coincidencia fiable`:""}`;const btn=el("metadataScanBtn");if(btn){btn.disabled=state.metadataScan.busy;btn.textContent=state.metadataScan.busy?`Analizando ${state.metadataScan.done}/${state.metadataScan.total}…`:"✨ Analizar biblioteca";}const apply=el("metadataApplySafeBtn");if(apply)apply.disabled=state.metadataScan.busy||!high;
  box.innerHTML=rows.length?rows.map((row,i)=>metadataProposalRow(row,i)).join(""):`<p class="muted">Aún no se ha ejecutado el análisis online.</p>`;
  box.querySelectorAll("[data-meta-apply]").forEach(b=>b.addEventListener("click",()=>applyMetadataRow(Number(b.dataset.metaApply))));box.querySelectorAll("[data-meta-other]").forEach(b=>b.addEventListener("click",()=>cycleMetadataCandidate(Number(b.dataset.metaOther))));box.querySelectorAll("[data-meta-ignore]").forEach(b=>b.addEventListener("click",()=>{state.metadataScan.rows[Number(b.dataset.metaIgnore)].ignored=true;renderMetadataScan();}));
}
function metadataProposalRow(row,i){const current=row.track,best=row.candidates?.[row.candidateIndex||0]||row.best;if(row.ignored)return `<div class="admin-row"><div><strong>${esc(current.title)}</strong><small>Ignorada en esta revisión</small></div><span class="chip">Ignorada</span></div>`;if(!best)return `<div class="admin-row"><div><strong>${esc(current.title)}</strong><small>${esc(current.artist)} · sin coincidencia fiable</small></div><span class="chip">Sin resultado</span></div>`;const p=best.proposal||{};const label=best.status==="high"?"Seguro":best.status==="review"?"Revisar":"Baja confianza";return `<div class="admin-row metadata-intel-row"><div class="metadata-cover-proposal">${p.cover_release_id?`<img src="/api/artwork/cover?release=${encodeURIComponent(p.cover_release_id)}&size=250" alt="">`:""}</div><div class="metadata-intel-main"><strong>${esc(current.title)} — ${esc(current.artist)}</strong><small>Álbum: ${esc(current.album||"—")} → <b>${esc(p.album||"—")}</b> · Año: ${esc(current.year||"—")} → <b>${esc(p.year||"—")}</b>${p.release_type?` · ${esc(p.release_type)}`:""}</small></div><div class="admin-row-actions"><span class="chip">${Number(best.score||0)}% · ${label}</span><button class="chip" data-meta-apply="${i}">Aplicar</button>${(row.candidates||[]).length>1?`<button class="chip" data-meta-other="${i}">Otro candidato</button>`:""}<button class="danger-text" data-meta-ignore="${i}">Ignorar</button></div></div>`;}
function cycleMetadataCandidate(i){const row=state.metadataScan.rows[i],list=row?.candidates||[];if(list.length<2)return;row.candidateIndex=((row.candidateIndex||0)+1)%list.length;row.best=list[row.candidateIndex];renderMetadataScan();}
async function applyMetadataRow(i){
  const row=state.metadataScan.rows[i],best=row?.candidates?.[row.candidateIndex||0]||row?.best;if(!row||!best)return false;
  const r=await apiFetch("/api/admin/metadata/apply",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:row.track.id,proposal:best.proposal})});const d=await r.json().catch(()=>({}));
  if(!r.ok){toast(d.error||"No se pudo aplicar la metadata");return false;}
  row.applied=true;row.ignored=true;toast(`Metadata aplicada a ${row.track.title}`);await loadTracks();if(state.canManage)apiFetch("/api/admin/requests/reconcile",{method:"POST"}).catch(()=>{});renderMetadataScan();return true;
}
async function applySafeMetadataMatches(){
  const safe=state.metadataScan.rows.map((r,i)=>({r,i,best:r?.candidates?.[r.candidateIndex||0]||r?.best})).filter(x=>!x.r.ignored&&x.best?.status==="high");
  if(!safe.length)return toast("No hay coincidencias seguras pendientes.");
  if(!confirm(`Se aplicarán ${safe.length} coincidencias de alta confianza con un respaldo único del lote. ¿Continuar?`))return;
  const btn=el("metadataApplySafeBtn");if(btn)btn.disabled=true;
  try{
    const r=await apiFetch("/api/admin/metadata/apply-batch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({items:safe.map(x=>({id:x.r.track.id,proposal:x.best.proposal}))})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){toast(d.error||"No se pudo aplicar el lote de metadata");return;}
    const appliedIds=new Set((d.items||[]).map(x=>x.id));for(const x of safe)if(appliedIds.has(x.r.track.id)){x.r.applied=true;x.r.ignored=true;}
    await loadTracks();renderMetadataScan();
    apiFetch("/api/admin/requests/reconcile",{method:"POST"}).catch(()=>{});
    toast(`${Number(d.applied||0)} coincidencias seguras aplicadas`);
  }finally{if(btn)btn.disabled=false;}
}

function renderAdminTrash(){const box=el("adminTrashList");if(!box)return;box.innerHTML=state.trashTracks.length?state.trashTracks.map(t=>`<div class="admin-row"><div><strong>${esc(t.title)}</strong><small>${esc(t.artist)} · ${esc(t.album)}</small></div><div class="admin-row-actions"><button class="chip" data-trash-restore="${esc(t.id)}">Restaurar</button><button class="danger-text" data-trash-delete="${esc(t.id)}">Eliminar definitivamente</button></div></div>`).join(""):`<p class="muted">La papelera está vacía.</p>`;box.querySelectorAll("[data-trash-restore]").forEach(b=>b.addEventListener("click",()=>adminRestoreTrack(b.dataset.trashRestore)));box.querySelectorAll("[data-trash-delete]").forEach(b=>b.addEventListener("click",()=>adminPermanentDelete(b.dataset.trashDelete)));}
async function adminCreateUser(){const name=el("adminNewName").value.trim();const role=el("adminNewRole").value;if(!name)return toast("Escribe un nombre");const r=await apiFetch("/api/admin/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,role})});const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo crear el usuario");el("adminNewName").value="";await navigator.clipboard?.writeText(d.access_code).catch(()=>{});alert(`Código de acceso de ${name} (se muestra una sola vez):\n\n${d.access_code}\n\nGuárdalo en un lugar seguro.${navigator.clipboard?" También intentamos copiarlo al portapapeles.":""}`);await loadAdminUsers();}
async function adminPatchUser(sub,patch){const r=await apiFetch(`/api/admin/users/${encodeURIComponent(sub)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(patch)});const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo actualizar");toast("Usuario actualizado");await loadAdminUsers();}
async function adminRegenerateCode(sub){if(!confirm("El código anterior dejará de funcionar y sus sesiones se cerrarán. ¿Continuar?"))return;const r=await apiFetch(`/api/admin/users/${encodeURIComponent(sub)}/regenerate`,{method:"POST"});const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo regenerar");await navigator.clipboard?.writeText(d.access_code).catch(()=>{});alert(`Nuevo código (solo se muestra una vez):\n\n${d.access_code}`);await loadAdminUsers();}
async function downloadAdminBackup(){const r=await apiFetch("/api/admin/backup");const d=await r.json().catch(()=>({}));if(!r.ok)return toast(d.error||"No se pudo crear el backup");const blob=new Blob([JSON.stringify(d,null,2)],{type:"application/json"});const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=`gmusic-library-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function adminRestoreTrack(id){const r=await apiFetch(`/api/trash/${encodeURIComponent(id)}/restore`,{method:"POST"});if(!r.ok)return toast("No se pudo restaurar");toast("Canción restaurada");await loadTracks();await loadAdminTrash();await loadAdminStatusOnly();}
async function adminPermanentDelete(id){if(!confirm("Esta acción sí es definitiva. ¿Eliminar el archivo de Google Drive?"))return;const r=await apiFetch(`/api/trash/${encodeURIComponent(id)}`,{method:"DELETE"});if(!r.ok)return toast("No se pudo eliminar");toast("Eliminada definitivamente");await loadAdminTrash();await loadAdminStatusOnly();}
function openMetadataEditor(){const t=trackById(state.actionTrackId);if(!t||!state.canManage)return;actionDialog.close();el("editTitle").value=t.title||"";el("editArtist").value=t.artist||"";el("editAlbum").value=t.album||"";el("editYear").value=t.year||"";el("editGenre").value=t.genre||"";el("editTrackNumber").value=t.track_number||"";el("editTrackStatus").textContent="";editTrackDialog.showModal();}
async function saveTrackMetadata(){const id=state.actionTrackId;if(!id)return;el("editTrackStatus").textContent="Guardando…";const body={title:el("editTitle").value,artist:el("editArtist").value,album:el("editAlbum").value,year:el("editYear").value,genre:el("editGenre").value,track_number:el("editTrackNumber").value};const r=await apiFetch(`/api/tracks/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok){el("editTrackStatus").textContent=d.error||"No se pudo guardar";return;}const i=state.tracks.findIndex(t=>t.id===id);if(i>=0)state.tracks[i]=d.track;el("editTrackStatus").textContent="Guardado ✓";render();hydrateArtwork();if(state.canManage)apiFetch("/api/admin/requests/reconcile",{method:"POST"}).catch(()=>{});setTimeout(()=>editTrackDialog.close(),300);}

// ---------- Perfil y datos privados sincronizados ----------
async function loadUserData(kind, fallback) {
  try { const r = await apiFetch(`/api/userdata/${kind}`); const d = await r.json().catch(()=>({})); return r.ok && d.value != null ? d.value : fallback; }
  catch { return fallback; }
}
async function saveUserData(kind, value) {
  try { const r = await apiFetch(`/api/userdata/${kind}`, {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({value})}); return r.ok; }
  catch { return false; }
}
async function loadUserBundle(){
  await loadFavorites();
  state.profile = await loadUserData("profile", null);
  state.playlists = await loadUserData("playlists", []);
  state.serverHistory = await loadUserData("history", []);
  state.serverStats = await loadUserData("stats", {});
  state.playback = await loadUserData("playback", null);
  state.lastPlaybackSynced = state.playback && typeof state.playback === "object" ? {...state.playback} : null;
  const remoteQueue = await loadUserData("queue", null);
  state.recentIds = Array.isArray(state.serverHistory) ? state.serverHistory.map(x=>typeof x==="string"?x:x.id).filter(Boolean).slice(0,50) : [];
  state.stats = state.serverStats && typeof state.serverStats === "object" ? state.serverStats : {};
  state.manualQueue = remoteQueue && Array.isArray(remoteQueue.manualQueue) ? remoteQueue.manualQueue : [];
  state.contextIds = remoteQueue && Array.isArray(remoteQueue.contextIds) ? remoteQueue.contextIds : [];
  state.currentId = remoteQueue?.currentId || null;
  if(remoteQueue && typeof remoteQueue === "object") { state.shuffle=Boolean(remoteQueue.shuffle); state.repeat=["off","all","one"].includes(remoteQueue.repeat)?remoteQueue.repeat:"off"; }
  persistOfflineUserSnapshot();
  applyTheme(); applyRoleUI();
}
async function maybeShowOnboarding(){ if(state.authenticated && !state.profile){ openProfileDialog(true); } }
function openProfileDialog(firstTime=false){
  if(!state.authenticated) return openAccessDialog();
  const p=state.profile||{};
  el("profileNameInput").value=p.name||state.userName||"";
  el("profileGender").value=p.gender||"prefer_not";
  el("profileTheme").value=p.accent||p.theme||"emerald";
  el("profileAppearance").value=p.appearance||"auto";
  el("profileStatus").textContent=firstTime?"Configura tu perfil una sola vez. Podrás cambiarlo después.":"";
  profileDialog.showModal();
}
function suggestThemeFromGender(){
  const g=el("profileGender").value;
  if(g==="male") el("profileTheme").value="ocean";
  else if(g==="female") el("profileTheme").value="berry";
  else if(g==="other") el("profileTheme").value="midnight";
}
async function saveProfile(){
  const profile={name:el("profileNameInput").value.trim()||state.userName||"Usuario",gender:el("profileGender").value,accent:el("profileTheme").value,appearance:el("profileAppearance").value,created_at:state.profile?.created_at||new Date().toISOString()};
  el("profileStatus").textContent="Guardando…";
  if(!await saveUserData("profile",profile)){el("profileStatus").textContent="No se pudo guardar el perfil.";el("profileStatus").dataset.type="error";return;}
  state.profile=profile;applyTheme();applyRoleUI();el("profileStatus").textContent="Perfil guardado ✓";el("profileStatus").dataset.type="ok";setTimeout(()=>profileDialog.close(),300);
}
function applyTheme(){ const accent=state.profile?.accent||state.profile?.theme||"emerald"; const appearance=state.profile?.appearance||"auto"; const resolved=appearance==="auto"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):appearance; document.body.dataset.theme=accent; document.body.dataset.appearance=resolved; const meta=document.querySelector('meta[name="theme-color"]'); if(meta)meta.content=resolved==="light"?"#f5f5f5":"#0f1115"; }

let syncTimer=null;
function syncHistoryAndStats(){ clearTimeout(syncTimer); syncTimer=setTimeout(()=>{ saveUserData("history",Array.isArray(state.serverHistory)?state.serverHistory.slice(0,100):[]); saveUserData("stats",state.stats); },900); }
function syncQueueRemote(){ if(!state.authenticated)return; clearTimeout(syncQueueRemote.timer); syncQueueRemote.timer=setTimeout(()=>saveUserData("queue",{manualQueue:state.manualQueue,contextIds:state.contextIds,currentId:state.currentId,shuffle:state.shuffle,repeat:state.repeat}),500); }
function schedulePlaybackSync(){ if(!state.authenticated||!state.currentId||schedulePlaybackSync.timer)return; schedulePlaybackSync.timer=setTimeout(()=>{schedulePlaybackSync.timer=null;persistPlaybackNow(false);},600000); }
async function persistPlaybackNow(force=false){
  if(!state.authenticated||!state.currentId||state.activePlaybackSource!=="library")return;
  const value={currentId:state.currentId,position:Number(audio.currentTime||0),duration:Number(audio.duration||0),updated_at:new Date().toISOString()};
  const last=state.lastPlaybackSynced;
  if(last&&last.currentId===value.currentId&&Math.abs(Number(last.position||0)-value.position)<2&&Math.abs(Number(last.duration||0)-value.duration)<1)return;
  if(!force&&last&&last.currentId===value.currentId&&Math.abs(Number(last.position||0)-value.position)<20&&Math.abs(Number(last.duration||0)-value.duration)<1)return;
  state.playback=value;
  if(await saveUserData("playback",value))state.lastPlaybackSynced={...value};
}

function renderPlaylists(){
  trackList.classList.add("hidden");trackListHeader.classList.add("hidden");emptyState.classList.add("hidden");collectionGrid.classList.remove("hidden");
  const items=Array.isArray(state.playlists)?state.playlists:[]; el("trackCount").textContent=`${items.length} playlists`;
  collectionGrid.innerHTML = `<div class="playlist-grid">${items.map((p,i)=>`<button class="playlist-card" data-playlist-index="${i}"><strong>${esc(p.name||"Playlist")}</strong><span>${(p.ids||[]).length} canciones</span></button>`).join("")}${items.length?"":"<p class=muted>Aún no tienes playlists. Usa ⋯ en una canción para crear una.</p>"}</div>`;
  collectionGrid.querySelectorAll("[data-playlist-index]").forEach(b=>b.addEventListener("click",()=>showPlaylist(Number(b.dataset.playlistIndex))));
}
function showPlaylist(index){ const p=state.playlists[index]; if(!p)return; const tracks=(p.ids||[]).map(trackById).filter(Boolean); state.view="custom"; el("pageTitle").textContent=p.name||"Playlist"; collectionGrid.classList.add("hidden");trackList.classList.remove("hidden");trackListHeader.classList.toggle("hidden",!tracks.length);emptyState.classList.toggle("hidden",!!tracks.length);trackList.innerHTML=tracks.map((t,i)=>trackRow(t,i+1)).join("");bindTrackRows(tracks.map(t=>t.id)); }
function openPlaylistForAction(){ if(!state.actionTrackId)return; renderPlaylistChoices(); actionDialog.close(); playlistDialog.showModal(); }
function renderPlaylistChoices(){ const items=Array.isArray(state.playlists)?state.playlists:[]; el("playlistChoices").innerHTML=items.length?items.map((p,i)=>`<button class="playlist-choice" data-add-playlist="${i}"><span>${esc(p.name)}</span><small>${(p.ids||[]).length} canciones</small></button>`).join(""):`<p class="muted">Crea tu primera playlist.</p>`; el("playlistChoices").querySelectorAll("[data-add-playlist]").forEach(b=>b.addEventListener("click",()=>addCurrentTrackToPlaylist(Number(b.dataset.addPlaylist)))); }
async function createPlaylistFromDialog(){ const name=el("newPlaylistName").value.trim(); if(!name)return; state.playlists.push({id:crypto.randomUUID(),name,ids:[],created_at:new Date().toISOString()}); el("newPlaylistName").value=""; await saveUserData("playlists",state.playlists); renderPlaylistChoices(); toast("Playlist creada"); }
async function addCurrentTrackToPlaylist(index){ const p=state.playlists[index]; if(!p||!state.actionTrackId)return; p.ids=Array.isArray(p.ids)?p.ids:[]; if(!p.ids.includes(state.actionTrackId))p.ids.push(state.actionTrackId); await saveUserData("playlists",state.playlists); playlistDialog.close(); toast(`Añadida a ${p.name}`); }
function renderStats(){
  trackList.classList.add("hidden");trackListHeader.classList.add("hidden");emptyState.classList.add("hidden");collectionGrid.classList.remove("hidden");
  const entries=Object.entries(state.stats||{}).sort((a,b)=>b[1]-a[1]); const total=entries.reduce((n,[,c])=>n+Number(c||0),0); const top=entries.slice(0,8).map(([id,c])=>({t:trackById(id),c})).filter(x=>x.t);
  el("trackCount").textContent=`${total} reproducciones`;
  collectionGrid.innerHTML=`<div class="stats-grid"><div class="stat-card"><span>Reproducciones</span><strong>${total}</strong></div><div class="stat-card"><span>Favoritos</span><strong>${state.favoriteIds.size}</strong></div><div class="stat-card"><span>Playlists</span><strong>${state.playlists.length}</strong></div><div class="stat-card"><span>Recientes</span><strong>${state.recentIds.length}</strong></div></div><div class="playlist-grid">${top.map(x=>`<button class="playlist-card" data-stat-play="${esc(x.t.id)}"><strong>${esc(x.t.title)}</strong><span>${esc(x.t.artist)} · ${x.c} reproducciones</span></button>`).join("")}</div>`;
  collectionGrid.querySelectorAll("[data-stat-play]").forEach(b=>b.addEventListener("click",()=>playInContext(state.tracks.map(t=>t.id),b.dataset.statPlay)));
}

async function apiFetch(path,options={}){const headers=new Headers(options.headers||{});if(isNativeAndroid&&state.sessionToken&&!headers.has("authorization"))headers.set("authorization",`Bearer ${state.sessionToken}`);return fetch(path,{...options,headers,credentials:"same-origin",cache:options.cache||"no-store"});}
function formatTime(seconds){seconds=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;}
function formatBytes(bytes){const mb=Number(bytes||0)/1024/1024;return mb>=1?`${mb.toFixed(1)} MB`:`${Math.round(Number(bytes||0)/1024)} KB`;}
function normalize(v){return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();}
function esc(v){return String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function cssEsc(v){return window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/["\\]/g,"\\$&");}
function safeJson(value,fallback){try{return JSON.parse(value)||fallback}catch{return fallback}}
function cleanArtworkCache(value){const out={};if(!value||typeof value!=="object"||Array.isArray(value))return out;for(const [k,v] of Object.entries(value)){if(typeof v!=="string")continue;const image=v.trim();if(image&&image!=="/icon.svg")out[k]=image;}return out;}
function toast(message){const t=el("toast");t.textContent=message;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),2600);}
async function registerServiceWorker(){
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register(`/sw.js?v=${VERSION}`, { updateViaCache: "none" });
    await reg.update().catch(()=>{});
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(sessionStorage.getItem("gmusic_sw_reloaded")!==VERSION){sessionStorage.setItem("gmusic_sw_reloaded",VERSION);location.reload();}});
  } catch {}
}
