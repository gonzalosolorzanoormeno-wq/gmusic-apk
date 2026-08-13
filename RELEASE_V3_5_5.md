# GMusic v3.5.5 — Background Transition Deadlock Fix

Base: GMusic v3.5.4.

## Problema corregido

Cuando GMusic quedaba en otra pestaña/app o con la pantalla bloqueada, una canción podía terminar y la reproducción quedarse en silencio sin pasar a la siguiente. El problema podía aparecer tanto en Chrome/Android como en Safari/iPhone.

La causa era que `backgroundAdvanceLock` se usaba como un candado asíncrono: se activaba antes de `audio.play()` y solo se liberaba cuando la Promise de `play()` resolvía o rechazaba. Un navegador puede dejar esa Promise pendiente al limitar/suspender una página en segundo plano. En ese estado, `handleLibraryTrackEnded()` y el fallback Android podían descartar el evento de fin para siempre.

## Corrección

- `backgroundAdvanceLock` deja de ser un bloqueo asíncrono y pasa a ser solo un guard de reentrada síncrono.
- La pista seleccionada se guarda en `backgroundAdvancePending` **antes** de llamar a `audio.play()`.
- El candado se libera inmediatamente después de invocar `play()`, sin esperar a su Promise.
- `ended` nunca vuelve a descartarse por un candado viejo.
- Si ya existe una pista pendiente, `ended` intenta recuperar esa misma pista en vez de saltar otra canción.
- El fallback `pause/end` de Android tampoco queda bloqueado por `backgroundAdvanceLock` y, si no hay pista preparada, cae a `nextTrack(true)`.
- Se añadió un watchdog de transición protegido por `playbackToken`; no puede pisar una transición más nueva.
- Se escucha también el evento `playing`, que confirma reproducción real y limpia el estado pendiente aunque la Promise de `play()` tenga un comportamiento tardío.
- Se conserva el `playbackToken` de v3.5.4 para evitar carreras entre avance automático, Next manual y controles multimedia.

## Cache / Service Worker

- Versión: `3.5.5`.
- `app.js`: `v=20-background-lock-fix`.
- El shell del Service Worker también sube a 3.5.5 para impedir que Chrome/Safari reutilicen el player anterior.

## Alcance

No cambia canciones, usuarios, playlists, favoritos, metadata, YouTube Discovery, DJ, KV ni almacenamiento offline. El cambio está limitado a la transición de pistas y al versionado de caché.

## Publicar

Ejecutar:

```text
PUBLICAR_GMUSIC_V3_5_5.bat
```

El script corre `npm run check` antes de desplegar.
