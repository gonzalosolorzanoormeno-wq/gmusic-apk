# GMusic v3.5.2 – Safari Background Playback Fix

Base: GMusic v3.5.1 – Stability + KV Optimization.

Esta versión está enfocada en el caso reportado en Safari/iPhone: la canción termina con la pantalla bloqueada y la siguiente no comienza automáticamente.

## Cambios

- La siguiente pista se prepara mientras la canción actual todavía está reproduciendo.
- Al pasar GMusic a segundo plano se fuerza la preparación/renovación de la siguiente URL antes de que Safari suspenda JavaScript.
- Se eliminó el bloqueo que impedía preparar la siguiente URL cuando `document.hidden === true`.
- Las URLs de reproducción se renuevan con margen suficiente cerca del final de la pista para evitar usar un enlace firmado próximo a expirar.
- `audio` usa `preload="auto"`.
- Se crea un media element secundario con `preload="metadata"` solo para calentar la URL/range de la siguiente pista; nunca reproduce audio ni fuerza una descarga completa.
- La preparación concurrente de la misma siguiente pista se deduplica para no triplicar requests al coincidir `play`, `loadedmetadata` y el warm-up inicial.
- En `ended`, si la siguiente pista ya está preparada, GMusic asigna `src`, activa `autoplay` y ejecuta `play()` **sin esperar ningún fetch, Cache API ni render**.
- Si Safari rechaza el primer intento, GMusic mantiene una recuperación ligada a `canplay` y vuelve a intentarlo al regresar a foreground.
- Repeat One reinicia la misma pista sin volver a pedir una URL.
- Las transiciones hechas con la pantalla bloqueada difieren el render pesado hasta volver a primer plano, pero actualizan el estado y Media Session.
- La preparación funciona también con una copia offline: se deja lista la siguiente pista desde Cache Storage.
- Se mantiene el aislamiento entre el reproductor de biblioteca y YouTube.

## Service Worker

- Shell cache actualizado a v3.5.2.
- `app.js` usa revisión `v17-safari-bg` para evitar quedarse con el player de v3.5.1.

## Alcance

No modifica usuarios, canciones, playlists, favoritos, metadata, Artist Intelligence, Music Requests, YouTube Discovery, DJ ni datos almacenados.

## Limitación de plataforma

Una PWA no puede impedir que iOS suspenda completamente JavaScript. Este fix reduce al mínimo el trabajo necesario en el momento exacto del cambio de canción y deja la próxima fuente preparada antes del bloqueo. La validación final del comportamiento con pantalla bloqueada requiere prueba física en iPhone/Safari.
