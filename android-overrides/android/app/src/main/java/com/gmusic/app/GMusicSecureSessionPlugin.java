package com.gmusic.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "GMusicSecureSession")
public class GMusicSecureSessionPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String token = call.getString("token", "");
        String scope = call.getString("scope", "");
        String name = call.getString("name", "");
        if (token == null || token.isEmpty() || scope == null || scope.isEmpty()) {
            call.reject("Sesión incompleta");
            return;
        }
        SecureSessionStore.save(getContext(), token, scope, name);
        GMusicPlaybackService.updateRuntimeToken(token);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSONObject stored = SecureSessionStore.load(getContext());
        String token = stored.optString("token", "");
        if (token.isEmpty()) {
            call.resolve(new JSObject().put("exists", false));
            return;
        }
        JSObject out = new JSObject();
        out.put("exists", true);
        out.put("token", token);
        out.put("scope", stored.optString("scope", ""));
        out.put("name", stored.optString("name", ""));
        call.resolve(out);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        SecureSessionStore.clear(getContext());
        GMusicPlaybackService.updateRuntimeToken("");
        call.resolve(new JSObject().put("ok", true));
    }
}
