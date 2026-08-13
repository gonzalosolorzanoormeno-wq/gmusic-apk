# GMusic v3.5.6 — Legacy Auto-Advance Restore

Base: v3.5.5.

## Motivo
En versiones recientes el reproductor intentaba cambiar el `src` a la siguiente canción unas décimas antes del final, además de usar candados, timers y fallbacks de background. En Chrome/Safari móviles eso podía retirar la canción actual antes de que emitiera su `ended` natural y dejar la nueva fuente sin arrancar cuando la página estaba suspendida.

## Cambio principal
Se restaura la filosofía del reproductor v3.0:

`canción A termina naturalmente → ended → nextTrack(true) → canción B → play()`

La app puede resolver por adelantado la URL/Blob de B, pero **nunca cambia `audio.src` ni llama `play()` antes de `ended`**.

## Eliminado
- `backgroundAdvanceLock`
- `backgroundAdvancePending`
- timers de avance anticipado Android
- heartbeat de avance al final
- fallback pause/end que podía competir con `ended`
- `startPreparedNextImmediately()`
- `recoverBackgroundAdvance()`
- segundo elemento `Audio` de precarga

## Conservado
- URL de la siguiente pista precalculada
- cola, shuffle, repeat, DJ
- YouTube Discovery
- Media Session
- offline
- privacidad multiusuario
- KV Saver
- fixes de seguridad y metadata

## Validación
La validación definitiva de background requiere prueba física en Chrome Android y Safari/iPhone con la pantalla apagada.
