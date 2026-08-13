package com.gmusic.app;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "GMusicAudio")
public class GMusicAudioPlugin extends Plugin {
    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;
    private Executor mainExecutor;
    private boolean playerListenerAttached = false;
    private final Handler progressHandler = new Handler(Looper.getMainLooper());

    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            emitPlaybackState();
            if (controller != null && controller.isPlaying()) {
                progressHandler.postDelayed(this, 750);
            }
        }
    };

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            emitPlaybackState();
            progressHandler.removeCallbacks(progressRunnable);
            if (isPlaying) progressHandler.postDelayed(progressRunnable, 350);
        }

        @Override
        public void onMediaItemTransition(MediaItem mediaItem, int reason) {
            JSObject data = new JSObject();
            data.put("trackId", mediaItem == null ? "" : mediaItem.mediaId);
            data.put("index", controller == null ? -1 : controller.getCurrentMediaItemIndex());
            data.put("reason", reason);
            notifyListeners("trackChanged", data);
            emitPlaybackState();
        }

        @Override
        public void onPlaybackStateChanged(int playbackState) {
            emitPlaybackState();
            if (playbackState == Player.STATE_ENDED) {
                notifyListeners("queueEnded", new JSObject());
            }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            notifyListeners("error", new JSObject().put(
                    "message",
                    error.getMessage() == null ? "Error de reproducción" : error.getMessage()));
        }
    };

    @Override
    public void load() {
        mainExecutor = ContextCompat.getMainExecutor(getContext());
        SessionToken token = new SessionToken(
                getContext(),
                new ComponentName(getContext(), GMusicPlaybackService.class));
        controllerFuture = new MediaController.Builder(getContext(), token)
                .setApplicationLooper(Looper.getMainLooper())
                .buildAsync();
        controllerFuture.addListener(() -> {
            try {
                MediaController ready = controllerFuture.get();
                attachController(ready);
                String storedToken = SecureSessionStore.token(getContext());
                if (!storedToken.isEmpty()) GMusicPlaybackService.updateRuntimeToken(storedToken);
                emitPlaybackState();
            } catch (Exception error) {
                notifyListeners("error", new JSObject().put("message", "No se pudo iniciar el motor multimedia de Android"));
            }
        }, mainExecutor);
    }

    private void attachController(MediaController ready) {
        controller = ready;
        if (!playerListenerAttached) {
            ready.addListener(playerListener);
            playerListenerAttached = true;
        }
    }

    private void runControllerAction(PluginCall call, MediaController ready, ControllerAction action) {
        Runnable task = () -> {
            try {
                action.run(ready);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Error del reproductor" : error.getMessage());
            }
        };

        if (Looper.myLooper() == ready.getApplicationLooper()) {
            task.run();
        } else {
            new Handler(ready.getApplicationLooper()).post(task);
        }
    }

    private void withController(PluginCall call, ControllerAction action) {
        MediaController readyNow = controller;
        if (readyNow != null) {
            runControllerAction(call, readyNow, action);
            return;
        }
        if (controllerFuture == null) {
            call.reject("Motor de audio no disponible");
            return;
        }
        controllerFuture.addListener(() -> {
            try {
                MediaController ready = controllerFuture.get();
                attachController(ready);
                runControllerAction(call, ready, action);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Motor de audio no disponible" : error.getMessage());
            }
        }, mainExecutor);
    }

    private interface ControllerAction {
        void run(MediaController controller) throws Exception;
    }

    @PluginMethod
    public void setSessionToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token == null) token = "";
        SecureSessionStore.updateToken(getContext(), token);
        GMusicPlaybackService.updateRuntimeToken(token);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray rawItems = call.getArray("items");
        if (rawItems == null || rawItems.length() == 0) {
            call.reject("La cola está vacía");
            return;
        }
        final int startIndex = Math.max(0, call.getInt("startIndex", 0));
        final long positionMs = Math.max(0L, Math.round(call.getDouble("positionMs", 0.0)));
        final String repeatMode = call.getString("repeatMode", "off");
        final boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", true));
        final List<MediaItem> mediaItems = new ArrayList<>();

        try {
            for (int i = 0; i < rawItems.length(); i++) {
                JSONObject item = rawItems.getJSONObject(i);
                String id = item.optString("trackId", "");
                String url = item.optString("url", "");
                if (id.isEmpty() || url.isEmpty()) continue;

                MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                        .setTitle(item.optString("title", ""))
                        .setArtist(item.optString("artist", ""))
                        .setAlbumTitle(item.optString("album", ""));
                String artworkUrl = item.optString("artworkUrl", "");
                if (artworkUrl.startsWith("https://")) metadata.setArtworkUri(Uri.parse(artworkUrl));

                mediaItems.add(new MediaItem.Builder()
                        .setMediaId(id)
                        .setUri(Uri.parse(url))
                        .setMediaMetadata(metadata.build())
                        .build());
            }
        } catch (Exception error) {
            call.reject("No se pudo construir la cola nativa");
            return;
        }

        if (mediaItems.isEmpty()) {
            call.reject("La cola no contiene canciones válidas");
            return;
        }

        withController(call, ready -> {
            int safeIndex = Math.min(startIndex, mediaItems.size() - 1);
            ready.setShuffleModeEnabled(false); // GMusic entrega la cola ya ordenada.
            if ("one".equals(repeatMode)) ready.setRepeatMode(Player.REPEAT_MODE_ONE);
            else if ("all".equals(repeatMode)) ready.setRepeatMode(Player.REPEAT_MODE_ALL);
            else ready.setRepeatMode(Player.REPEAT_MODE_OFF);
            ready.setMediaItems(mediaItems, safeIndex, positionMs);
            ready.prepare();
            if (autoplay) ready.play();
            call.resolve(new JSObject()
                    .put("ok", true)
                    .put("count", mediaItems.size())
                    .put("startIndex", safeIndex));
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withController(call, ready -> { ready.pause(); call.resolve(); });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        withController(call, ready -> { ready.play(); call.resolve(); });
    }

    @PluginMethod
    public void next(PluginCall call) {
        withController(call, ready -> {
            if (ready.hasNextMediaItem()) ready.seekToNextMediaItem();
            call.resolve();
        });
    }

    @PluginMethod
    public void previous(PluginCall call) {
        withController(call, ready -> {
            if (ready.hasPreviousMediaItem()) ready.seekToPreviousMediaItem();
            else ready.seekTo(0);
            call.resolve();
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        long positionMs = Math.max(0L, Math.round(call.getDouble("positionMs", 0.0)));
        withController(call, ready -> { ready.seekTo(positionMs); call.resolve(); });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        double requested = call.getDouble("volume", 1.0);
        float volume = (float) Math.max(0.0, Math.min(1.0, requested));
        withController(call, ready -> { ready.setVolume(volume); call.resolve(); });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withController(call, ready -> {
            ready.stop();
            ready.clearMediaItems();
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        withController(call, ready -> call.resolve(stateObject(ready)));
    }

    private JSObject stateObject(MediaController ready) {
        long duration = ready.getDuration();
        if (duration == C.TIME_UNSET || duration < 0) duration = 0;
        MediaItem current = ready.getCurrentMediaItem();
        return new JSObject()
                .put("isPlaying", ready.isPlaying())
                .put("positionMs", Math.max(0L, ready.getCurrentPosition()))
                .put("durationMs", duration)
                .put("trackId", current == null ? "" : current.mediaId)
                .put("currentIndex", ready.getCurrentMediaItemIndex())
                .put("itemCount", ready.getMediaItemCount())
                .put("playbackState", ready.getPlaybackState());
    }

    private void emitPlaybackState() {
        MediaController ready = controller;
        if (ready == null) return;
        if (Looper.myLooper() == ready.getApplicationLooper()) {
            notifyListeners("playbackStateChanged", stateObject(ready));
        } else {
            new Handler(ready.getApplicationLooper()).post(() -> {
                MediaController current = controller;
                if (current != null) notifyListeners("playbackStateChanged", stateObject(current));
            });
        }
    }

    @Override
    protected void handleOnDestroy() {
        progressHandler.removeCallbacks(progressRunnable);
        MediaController ready = controller;
        if (ready != null) {
            Runnable cleanup = () -> {
                if (controller != null) {
                    controller.removeListener(playerListener);
                    playerListenerAttached = false;
                    controller.release();
                    controller = null;
                }
            };
            if (Looper.myLooper() == ready.getApplicationLooper()) cleanup.run();
            else new Handler(ready.getApplicationLooper()).post(cleanup);
        }
        super.handleOnDestroy();
    }
}
