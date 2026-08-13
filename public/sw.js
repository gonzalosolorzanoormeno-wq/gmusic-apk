const VERSION = "4.0.0";
const CACHE = `gmusic-shell-${VERSION}`;
const SHELL = [
  "/", "/index.html", "/styles.css?v=21-legacy-advance",
  "/native-audio-bridge.js?v=4.0.0", "/native-secure-session-bridge.js?v=4.0.0",
  "/app.js?v=40-native-media3", "/dj-engine.js", "/icon.svg", "/manifest.webmanifest?v=4.0.0"
];

self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("gmusic-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(req).then((res) => { const copy=res.clone(); caches.open(CACHE).then((c)=>c.put(req,copy)).catch(()=>{}); return res; }).catch(() => caches.match(req).then((r)=>r||caches.match("/index.html"))));
});
