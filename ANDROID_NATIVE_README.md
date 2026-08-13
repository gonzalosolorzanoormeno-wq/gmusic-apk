# GMusic v4.0 Android Native — guía rápida

Esta compilación sí usa un motor musical Android real para la biblioteca propia:

- `MediaSessionService` mantiene la sesión de reproducción fuera de la Activity/WebView.
- `ExoPlayer` recibe la cola completa y realiza A → B → C de forma nativa.
- Android puede mostrar controles multimedia de sistema, pantalla bloqueada y Bluetooth.
- La UI de GMusic sigue viniendo del Worker de Cloudflare.

## IMPORTANTE: orden correcto

### 1. Publicar la parte web v4

En Windows ejecuta:

`PUBLICAR_GMUSIC_V4_WEB.bat`

Esto publica `app.js`, los bridges nativos y el Worker v4. El APK apunta a la URL remota de GMusic, así que este paso va primero.

### 2. Actualizar el repo `gmusic-apk`

Sube/reemplaza conservando carpetas:

- `.github/workflows/build-first-apk.yml`
- `android-overrides/`
- `public/`
- `src/`
- `tests/`
- `package.json`
- `capacitor.config.json`

No subas el ZIP como un único archivo.

### 3. Compilar en GitHub

Actions → **Build GMusic v4 Native APK** → **Run workflow**.

Si queda verde, descarga el artifact:

`GMusic-v4.0-native-apk`

Dentro estará:

`GMusic-v4.0-native.apk`

### 4. Instalar y probar

Tras instalar, inicia sesión una vez en el APK. Luego prueba:

1. Reproducir una playlist/álbum de al menos 3 canciones.
2. Apagar la pantalla antes de que termine la primera.
3. Verificar A → B sin abrir la app.
4. Verificar título/artista y Play/Pausa/Siguiente/Anterior en controles multimedia de Android.
5. Probar Siguiente desde auriculares/Bluetooth si tienes disponibles.

## Qué NO hace todavía

- El audio offline guardado en CacheStorage del navegador aún no alimenta ExoPlayer.
- YouTube sigue en el reproductor oficial embebido; no se convierte ni se descarga y no se manda al motor nativo.
