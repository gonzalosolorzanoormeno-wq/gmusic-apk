# GMusic v3.2.2 — Controles multimedia + Favoritos Offline

## Centro de control / pantalla bloqueada
- Media Session prioriza **Anterior / Siguiente** en lugar de registrar saltos de ±10 segundos.
- El botón anterior del sistema cambia realmente a la pista anterior; el botón anterior dentro de GMusic conserva el comportamiento habitual de reiniciar si ya avanzó más de 5 s.
- Se mantienen título, artista, álbum, portada, play/pause y posición cuando el navegador lo soporte.
- Nota: iOS decide finalmente el diseño del Centro de control; la app ahora publica las acciones musicales correctas, pero Apple puede variar la presentación según versión de iOS.

## Favoritos Offline
- En **Favoritos** aparece `Descargar favoritos (x/y)`.
- Descarga solamente los favoritos de la cuenta activa y únicamente los que falten.
- Muestra progreso y mantiene el aislamiento offline por cuenta/dispositivo.
- Las canciones descargadas muestran `⬇ Offline` en la biblioteca.
- No borra una descarga si una canción deja de ser favorita; se conserva hasta que el usuario la quite offline manualmente.

## Compatibilidad
- No borra Drive, KV, usuarios, favoritos, playlists ni descargas existentes.
- Service Worker actualizado a 3.2.2 para invalidar el shell anterior.
