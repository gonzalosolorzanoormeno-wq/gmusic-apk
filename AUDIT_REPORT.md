# Auditoría GMusic v2.3 → v3.0

## Arquitectura encontrada

- Frontend/PWA estático servido mediante Cloudflare Workers Assets.
- Backend en un Cloudflare Worker (`src/index.js`).
- Audio y metadata principal en Google Drive mediante `drive.file`.
- Datos privados por usuario en Cloudflare KV `USERDATA`.
- Acceso legacy mediante `USER_CODES` y firma HMAC con `APP_TOKEN`.
- Artwork consultado a Deezer y cacheado.

## Hallazgos corregidos

### Alto — IDOR en streaming
La ruta autenticada `/api/tracks/:id/stream` aceptaba un ID de Drive y enviaba el contenido sin comprobar que perteneciera a la carpeta/biblioteca GMusic. Un usuario autenticado que conociera otro ID accesible por la cuenta de Google podía intentar leerlo.

**Corrección:** cada reproducción valida `gmusic_track=1`, `trashed=false` y que el archivo pertenezca a la carpeta GMusic antes de solicitar `alt=media`.

### Alto/Medio — sesiones no revocables
Los tokens firmados podían seguir válidos hasta 30 días aunque se cambiara/eliminara un código en `USER_CODES`.

**Corrección:** cada sesión se resuelve contra el usuario vigente. Los usuarios gestionados tienen `session_version`; desactivar, cambiar rol o regenerar código invalida sus sesiones existentes.

### Medio — token de sesión en localStorage
La PWA guardaba el bearer token en `localStorage`, aumentando el impacto potencial de una vulnerabilidad XSS.

**Corrección:** v3 usa cookie `HttpOnly; Secure; SameSite=Strict`. Se mantiene lectura de bearer solo como compatibilidad temporal con shells antiguos.

### Medio — sin rate limiting de login
No había límite de intentos sobre `/api/session`.

**Corrección:** contador por IP anonimizada mediante HMAC en KV, con ventana de 10 minutos y máximo de 8 fallos.

### Medio — validación de upload débil
Se confiaba principalmente en `file.type` o la extensión.

**Corrección:** inspección de firmas binarias para MP3/MPEG audio, FLAC, OGG/Opus, WAV, MP4/M4A y AAC, además del límite de 45 MB.

### Medio — eliminación irreversible inmediata
El botón de eliminar borraba directamente el archivo de Drive.

**Corrección:** ahora envía a papelera. El admin puede restaurar o eliminar definitivamente desde Administración.

### Bajo — diagnóstico público
`/api/diagnostics` informaba sin autenticación qué secretos/componentes estaban configurados.

**Corrección:** requiere sesión admin.

### Bajo — CSP inconsistente con Google Fonts
La página cargaba Google Fonts mientras la CSP solo permitía estilos `self`, generando bloqueo y tráfico externo innecesario.

**Corrección:** se eliminó la dependencia externa de fuentes y se usa la pila nativa del sistema.

## Mejoras implementadas

- Panel de usuarios administrable desde GMusic.
- Códigos nuevos almacenados mediante HMAC en KV; se muestran una sola vez.
- Desactivar/activar usuarios, cambiar rol y regenerar código.
- Home con saludo, continuar escuchando, recientes, favoritos, más escuchadas y nuevas.
- Apariencia claro/oscuro/automático y acentos múltiples por usuario.
- Editor de metadata: título, artista, álbum, año, género y pista.
- Discografía por artista y álbum; singles separados cuando el álbum es desconocido.
- Papelera y backup descargable.
- Progreso de reproducción sincronizado con escrituras limitadas.
- Service Worker versionado y limpieza de caché shell vieja.
- Headers CSP/HSTS/X-Frame-Options/Permissions-Policy reforzados.
- Validación same-origin para mutaciones.

## Pruebas ejecutadas

- `node --check src/index.js` ✅
- `node --check public/app.js` ✅
- `node --check public/sw.js` ✅
- Smoke test de salud ✅
- Login admin legacy ✅
- Login listener legacy ✅
- Cookie HttpOnly emitida ✅
- Diagnóstico público bloqueado ✅
- Diagnóstico listener bloqueado ✅
- Upload listener bloqueado en backend ✅
- Creación de usuario gestionado en KV simulado ✅
- Login de usuario gestionado ✅

## No probado aquí

No se pudo hacer una prueba E2E física en Safari/iPhone o Chrome/Samsung desde este entorno. Esas pruebas deben hacerse después del deploy real, especialmente pantalla bloqueada, Media Session, PWA y consumo de batería.

## Pendientes para una fase posterior

- Portada incrustada APIC almacenada como asset propio.
- Upload de carpetas con experiencia específica para cada navegador móvil.
- Fuzzy search avanzado y filtros visuales completos.
- Playlists colaborativas.
- Wrapped por semana/mes/año y minutos exactos.
- Límite configurable de almacenamiento offline y pantalla de gestión de caché.
- Crossfade y normalización (requieren pruebas de batería/Safari antes de activar).
- Sleep timer.
- Importación segura por URL directa.
- Notificaciones de nueva música.
- Logs de auditoría visibles en UI (los eventos ya se guardan en KV durante 30 días).

## Rollback

La v3 no realiza una migración destructiva de Drive/KV. Para rollback, vuelve a desplegar el ZIP v2.3 anterior. Los datos creados por v3 permanecen en KV como claves adicionales y no impiden que v2.3 lea sus claves existentes. Los archivos enviados a la papelera de Google Drive deben restaurarse desde v3 o desde Drive si quieres que vuelvan a aparecer en v2.3.
