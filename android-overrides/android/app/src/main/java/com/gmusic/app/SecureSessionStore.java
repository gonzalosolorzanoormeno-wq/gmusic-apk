package com.gmusic.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Small Keystore-backed store for the signed GMusic session token.
 * The private access code is never stored here.
 */
public final class SecureSessionStore {
    private static final String ALIAS = "gmusic_session_aes_v2";
    private static final String PREFS = "gmusic_secure_v2";
    private static final String KEY_SESSION = "session";

    private SecureSessionStore() {}

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        java.security.Key existing = keyStore.getKey(ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build();
        generator.init(spec);
        return generator.generateKey();
    }

    private static String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
        String payload = Base64.encodeToString(
                cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        return iv + ":" + payload;
    }

    private static String decrypt(String value) throws Exception {
        String[] parts = value.split(":", 2);
        if (parts.length != 2) return "";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(
                cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)),
                StandardCharsets.UTF_8);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized void save(Context context, String token, String scope, String name) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("token", token == null ? "" : token);
            payload.put("scope", scope == null ? "" : scope);
            payload.put("name", name == null ? "" : name);
            prefs(context).edit().putString(KEY_SESSION, encrypt(payload.toString())).apply();
        } catch (Exception ignored) {
            clear(context);
        }
    }

    public static synchronized void updateToken(Context context, String token) {
        JSONObject existing = load(context);
        save(
                context,
                token == null ? "" : token,
                existing.optString("scope", ""),
                existing.optString("name", ""));
    }

    public static synchronized JSONObject load(Context context) {
        String encrypted = prefs(context).getString(KEY_SESSION, "");
        if (encrypted == null || encrypted.isEmpty()) return new JSONObject();
        try {
            return new JSONObject(decrypt(encrypted));
        } catch (Exception ignored) {
            clear(context);
            return new JSONObject();
        }
    }

    public static synchronized String token(Context context) {
        return load(context).optString("token", "");
    }

    public static synchronized void clear(Context context) {
        prefs(context).edit().remove(KEY_SESSION).apply();
    }
}
