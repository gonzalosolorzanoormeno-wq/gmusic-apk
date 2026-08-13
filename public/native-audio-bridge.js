// GMusic v4.0 Android Media3 bridge.
(function () {
  "use strict";
  const cap = window.Capacitor;
  const isNative = Boolean(
    cap &&
    typeof cap.isNativePlatform === "function" &&
    cap.isNativePlatform() &&
    cap.getPlatform?.() === "android"
  );

  if (!isNative) {
    window.GMusicNativeAudio = null;
    return;
  }

  const plugin = cap.Plugins?.GMusicAudio;
  if (!plugin) {
    window.GMusicNativeAudio = null;
    return;
  }

  const listenerBuckets = new Map();
  const events = ["playbackStateChanged", "trackChanged", "queueEnded", "error"];
  for (const event of events) {
    listenerBuckets.set(event, new Set());
    plugin.addListener(event, (payload) => {
      for (const cb of listenerBuckets.get(event) || []) {
        try { cb(payload || {}); }
        catch (error) { console.error(`[GMusic native] ${event}`, error); }
      }
    });
  }

  const on = (event, cb) => {
    const bucket = listenerBuckets.get(event);
    if (!bucket || typeof cb !== "function") return () => {};
    bucket.add(cb);
    return () => bucket.delete(cb);
  };

  window.GMusicNativeAudio = {
    isAvailable: () => true,
    setSessionToken: (token) => plugin.setSessionToken({ token: String(token || "") }),
    setQueue: (payload) => plugin.setQueue({
      items: Array.isArray(payload?.items) ? payload.items : [],
      startIndex: Math.max(0, Number(payload?.startIndex || 0)),
      positionMs: Math.max(0, Math.round(Number(payload?.positionMs || 0))),
      repeatMode: ["off", "all", "one"].includes(payload?.repeatMode) ? payload.repeatMode : "off",
      autoplay: payload?.autoplay !== false,
    }),
    pause: () => plugin.pause(),
    resume: () => plugin.resume(),
    next: () => plugin.next(),
    previous: () => plugin.previous(),
    stop: () => plugin.stop(),
    seekTo: (ms) => plugin.seekTo({ positionMs: Math.max(0, Math.round(Number(ms || 0))) }),
    setVolume: (value) => plugin.setVolume({ volume: Math.max(0, Math.min(1, Number(value) || 0)) }),
    getState: () => plugin.getState(),
    onPlaybackStateChanged: (cb) => on("playbackStateChanged", cb),
    onTrackChanged: (cb) => on("trackChanged", cb),
    onQueueEnded: (cb) => on("queueEnded", cb),
    onError: (cb) => on("error", cb),
  };
})();
