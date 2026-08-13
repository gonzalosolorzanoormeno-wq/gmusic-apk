# GMusic v4.0 — Android Native Playback

## Objetivo

Esta versión convierte el APK de Android de un simple contenedor WebView en un reproductor musical híbrido: la interfaz sigue siendo GMusic web, pero la reproducción de la biblioteca propia se entrega a Android Media3/ExoPlayer.

## Qué cambia en Android

- `GMusicPlaybackService` extiende `MediaSessionService`.
- ExoPlayer recibe una playlist completa mediante `setMediaItems(...)`.
- El cambio A → B ya no depende del evento `ended`, timers ni JavaScript de la WebView.
- Android puede mantener la cola cuando la pantalla está bloqueada o la interfaz está en segundo plano.
- MediaSession expone reproducción al sistema para notificación multimedia, pantalla bloqueada, Bluetooth y controles externos compatibles.
- La metadata nativa incluye título, artista, álbum y URI de portada cuando está disponible.
- Se usa un foreground service de tipo `mediaPlayback`.

## Autenticación del audio

El APK NO contiene secretos de Google, Cloudflare, YouTube, Spotify ni códigos de usuario.

Después de un login válido, GMusic conserva únicamente el token de sesión firmado en Android Keystore (AES/GCM). ExoPlayer usa ese token como `Authorization: Bearer ...` para solicitar:

`/api/tracks/<track-id>/stream`

La contraseña/código de acceso no se guarda en el motor nativo.

## Compatibilidad

- Android nativo: Media3 `1.10.1`, minSdk 23, compile/target SDK 35.
- iPhone/Safari y PC continúan usando el reproductor web existente.
- YouTube sigue usando el reproductor oficial embebido y NO se envía a ExoPlayer.

## Limitación conocida de esta primera fase

El audio descargado mediante CacheStorage del navegador no se conecta todavía a ExoPlayer. El objetivo de esta compilación es validar reproducción continua, controles del sistema, cola nativa y background. El modo offline web permanece intacto para las superficies que usan el player web.

## Orden de despliegue

1. Ejecutar `PUBLICAR_GMUSIC_V4_WEB.bat` para que el Worker sirva el bridge v4.
2. Subir los cambios de este proyecto al repo `gmusic-apk`.
3. Ejecutar `Build GMusic v4 Native APK` en GitHub Actions.
4. Descargar el artifact `GMusic-v4.0-native-apk` e instalar `GMusic-v4.0-native.apk`.
5. Iniciar sesión una vez en el APK para que Android reciba y cifre el token de sesión.
