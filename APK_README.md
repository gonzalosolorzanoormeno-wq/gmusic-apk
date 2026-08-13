# GMusic v3.5.6 — First APK build

Este proyecto genera un APK Android de prueba que abre la instalación desplegada de GMusic en Cloudflare (`https://gmusic-player.gmusic-cloud-25.workers.dev`) dentro de Capacitor.

- No contiene secretos de Cloudflare/Google.
- No copia canciones dentro del APK.
- La biblioteca sigue en Google Drive y el backend sigue en Cloudflare.
- Es la primera envoltura APK para distribución de prueba.
- **No es todavía el motor Android nativo definitivo**: la reproducción sigue dependiendo del reproductor web de GMusic. El servicio nativo/Media3 será una fase posterior si se quiere background garantizado por Android.

El workflow `.github/workflows/build-first-apk.yml` compila `GMusic-v3.5.6-first.apk` completamente en GitHub Actions; el usuario no necesita Android Studio.
