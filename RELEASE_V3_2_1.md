# GMusic v3.2.1 — Offline real + arranque de audio más rápido

## Corregido
- La PWA ya no borra/cierra la sesión local solamente porque el Worker no responda.
- Si el dispositivo ya inició sesión online al menos una vez y tiene canciones descargadas, GMusic puede abrir en modo sin conexión sin volver a pedir la clave.
- La biblioteca offline usa una copia local mínima de metadata de las canciones descargadas.
- Perfil, favoritos, playlists, historial y estadísticas tienen una copia local de lectura para mantener contexto al abrir sin conexión.
- El audio descargado queda aislado por un ámbito opaco de la cuenta; cerrar sesión borra el puntero local de sesión y no permite entrar offline como la cuenta anterior.
- Las funciones de administración nunca se habilitan offline: requieren validación online.
- Al recuperar conexión, GMusic revalida la sesión y vuelve a sincronizar.

## Rendimiento de reproducción
- `/play-url` ya no consulta Google Drive antes de firmar la URL. La validación real sigue ocurriendo en `/stream` antes de servir audio.
- Se cachea temporalmente el ID de la carpeta de biblioteca en el Worker para evitar búsquedas repetidas a Drive.
- El frontend conserva temporalmente URLs firmadas y prepara de forma ligera la URL de la siguiente pista cuando está online y visible.
- Se mantiene soporte `Range` en streaming.

## Compatibilidad
- No borra canciones, KV, usuarios ni secretos.
- Las descargas offline antiguas de `gmusic-offline-audio-v2` se migran al almacenamiento aislado de la cuenta después del siguiente inicio online.

## Pruebas
`npm run check` incluye autenticación, privacidad, metadata y un nuevo smoke test de offline/latencia.

## Nota
La prueba automatizada no puede simular Safari/iOS real ni Google Drive real sin credenciales. Después del deploy conviene hacer una prueba manual: abrir online, guardar una canción offline, reproducirla, activar modo avión, cerrar/reabrir la PWA y reproducirla de nuevo.
