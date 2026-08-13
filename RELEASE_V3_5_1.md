# GMusic v3.5.1 – Stability + KV Optimization

Base: GMusic v3.5 – YouTube Discovery + GMusic DJ.

Esta versión corrige los hallazgos prioritarios de la auditoría v3.5 sin rehacer la aplicación ni borrar datos existentes.

## Metadata segura

- Aplicar una propuesta individual ahora **requiere que el backup KV termine correctamente antes de tocar Google Drive**.
- Si el backup falla, la metadata no se modifica.
- Nuevo endpoint de lote: `POST /api/admin/metadata/apply-batch`.
- Las coincidencias seguras se aplican con **un solo backup del lote** y un solo audit resumido.
- Si una aplicación masiva falla a mitad, GMusic intenta restaurar automáticamente lo ya modificado usando el backup del lote.
- El contador de la UI ya no considera “aplicada” una canción que realmente falló.
- La biblioteca se recarga una sola vez al finalizar el lote.
- La limpieza segura de biblioteca también exige backup antes de aplicar cambios y hace rollback automático si falla a mitad.

## Menos operaciones Cloudflare KV

- La cola ya no guarda un `updated_at` nuevo en cada sincronización; si la cola lógica no cambió, KV Saver puede omitir el `put()`.
- El progreso periódico pasó de 3 a 10 minutos, manteniendo guardados importantes al pausar/ocultar/cambiar de modo.
- Se evita reenviar progreso si apenas cambió y no es un evento importante.
- Al subir varias canciones, Music Requests se reconcilia **una sola vez al terminar el lote**, no una vez por archivo.
- El panel de Administración carga secciones pesadas bajo demanda al acercarse al viewport.
- `/api/admin/status` ya no repite un segundo listado de usuarios en KV.
- Las cuentas autenticadas tienen un caché corto en memoria del Worker para evitar leer `account:<sub>` en KV en cada request dentro del mismo isolate.

## YouTube estable

- Estado explícito del origen de reproducción: `library | youtube | none`.
- Media Session ya no puede reanudar el `<audio>` local mientras YouTube está reproduciendo.
- Los handlers de YouTube y biblioteca se separan.
- Al cerrar/salir de YouTube se limpian sus controles para evitar doble reproducción.
- Los timers de escucha están ligados a un `session_id`; un timer viejo no puede cancelar/interferir con el video nuevo.
- Si falla temporalmente el registro de una escucha se hacen hasta 2 reintentos en memoria.
- Cada resultado de búsqueda recibe un `listen_token` firmado por backend; el registro ya no confía en título/canal/thumbnail enviados libremente por el cliente.
- El backend exige además que haya pasado un tiempo mínimo desde que emitió el token antes de aceptar el registro.
- YouTube Search tiene un guard de búsquedas por cuenta/isolate además del caché de 12 h.
- Los errores 403 se diferencian mejor entre cuota, API deshabilitada, key inválida/restringida y fallos generales.

## DJ

- El modo **Favoritos** ahora reproduce exclusivamente favoritos.
- Si no hay favoritos, no inicia ese modo y muestra un mensaje claro.
- El DJ penaliza directamente las últimas canciones que él mismo eligió, incluso si el usuario las saltó antes de 30 s.
- Se mantiene historial de la sesión del DJ.
- `Anterior` vuelve a la canción anterior de la sesión DJ en vez de navegar según el orden general de la biblioteca.
- Se corrigió el texto de consentimiento: los logs de YouTube no se anuncian como fuente del DJ porque actualmente el DJ no los utiliza.

## Cola / reanudación

- `nextTrack()` persiste `currentId` después de decidir la canción nueva, no antes.
- `previousTrack()` también persiste correctamente el estado.
- La cola/contexto remoto restaurado ya no se reemplaza automáticamente por toda la biblioteca al cargar tracks.
- Se filtran IDs que ya no existen sin destruir un contexto válido de álbum/playlist.

## Panel de Administración

La entrada al panel ya no dispara simultáneamente todos estos escaneos:

- library audit
- Artist Intelligence
- Music Requests
- Playlist analyses
- YouTube listens
- papelera

Usuarios y estado se cargan primero. Las demás secciones se cargan al acercarse a pantalla o al usarlas.

## Tests

Se añadió `tests/stability-v351.mjs` para cubrir los fixes estructurales de:

- backup obligatorio;
- metadata batch;
- reconciliación única tras uploads;
- queue KV Saver real;
- YouTube signed listen proof;
- aislamiento Media Session/YouTube;
- timers ligados a sesión;
- retry de logs;
- modo Favoritos estricto;
- penalización de tracks recientes del DJ;
- lazy loading administrativo;
- versionado 3.5.1.

## No destructivo

No elimina canciones, Google Drive, usuarios, favoritos, playlists, historial, estadísticas, perfiles, cola, metadata existente, fotos de artistas ni descargas offline.
