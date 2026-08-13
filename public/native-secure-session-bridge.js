// GMusic v4.0 Android secure-session bridge.
(function () {
  "use strict";
  const cap = window.Capacitor;
  const native = Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === "android");
  const plugin = native ? cap.Plugins?.GMusicSecureSession : null;

  window.GMusicSecureSession = plugin ? {
    isAvailable: () => true,
    save: ({ token, scope, name }) => plugin.save({
      token: String(token || ""),
      scope: String(scope || ""),
      name: String(name || ""),
    }),
    get: () => plugin.get(),
    clear: () => plugin.clear(),
  } : null;
})();
