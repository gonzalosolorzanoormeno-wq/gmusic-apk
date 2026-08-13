package com.gmusic.app;

import android.app.PendingIntent;
import android.content.Intent;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Real Android music engine for GMusic.
 *
 * The playlist lives inside ExoPlayer, not in a WebView timer. Therefore A -> B
 * can happen while the screen is locked or the UI process is backgrounded.
 * MediaSessionService exposes the player to Android system media controls,
 * Bluetooth headsets, the lock screen and compatible wearables.
 */
@UnstableApi
public class GMusicPlaybackService extends MediaSessionService {
    private static volatile GMusicPlaybackService instance;

    private ExoPlayer player;
    private MediaSession mediaSession;
    private DefaultHttpDataSource.Factory httpFactory;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent("GMusic-Android/4.0")
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(30000)
                .setAllowCrossProtocolRedirects(false);
        applyAuthToken(SecureSessionStore.token(this));

        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(dataSourceFactory);

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();

        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(mediaSourceFactory)
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .build();

        Intent openApp = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivity = PendingIntent.getActivity(
                this,
                1001,
                openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        mediaSession = new MediaSession.Builder(this, player)
                .setSessionActivity(sessionActivity)
                .build();
    }

    private void applyAuthToken(String token) {
        Map<String, String> headers;
        if (token == null || token.isEmpty()) {
            headers = Collections.emptyMap();
        } else {
            headers = new HashMap<>();
            headers.put("Authorization", "Bearer " + token);
        }
        if (httpFactory != null) httpFactory.setDefaultRequestProperties(headers);
    }

    public static void updateRuntimeToken(String token) {
        GMusicPlaybackService current = instance;
        if (current != null) current.applyAuthToken(token == null ? "" : token);
    }

    @Override
    @Nullable
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
