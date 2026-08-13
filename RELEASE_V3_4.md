# GMusic v3.4 – Artist Intelligence + Music Requests

Actualización no destructiva sobre v3.3.

## Artist Intelligence 2.0
- Identidad canónica de artista antes de aceptar una foto.
- MusicBrainz como identidad principal y Wikidata/Wikimedia Commons como fuente preferida de imagen cuando hay una relación fiable.
- Deezer queda como fallback exacto, con score de confianza.
- Las coincidencias de baja confianza no se muestran automáticamente.
- Panel privado para analizar, aplicar, volver a buscar, quitar y subir manualmente una imagen JPG/PNG/WebP (máx. 1.5 MB).
- Las imágenes manuales tienen prioridad y se guardan en USERDATA KV.
- La portada de un álbum no se guarda como foto de artista.

## Music Requests
- Nueva sección “Solicitudes” visible para cada cuenta.
- Comprobación previa de biblioteca con título, artista, álbum y variantes (remix/live/acoustic/remaster/etc.).
- Identificación opcional con MusicBrainz antes de enviar.
- Cada usuario solo ve sus propias solicitudes.
- El panel privado puede revisar/descartar y reconciliar solicitudes con la biblioteca.
- Al subir o editar una canción compatible, solicitudes pendientes pasan a “Disponible”.

## Playlists de Spotify
- Solo metadata, nunca audio.
- OAuth server-side; tokens cifrados en KV con una clave derivada de APP_TOKEN.
- Spotify exige que la cuenta conectada sea propietaria o colaboradora para leer los elementos de la playlist con la API actual.
- Comparación por título/artista normalizados, álbum y variantes.
- Resultado: Ya está / Falta / Revisar.
- Reanálisis para reflejar cambios posteriores de la biblioteca.

### Configuración opcional
Configura secretos de Cloudflare:
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Y registra como Redirect URI en Spotify:
`https://gmusic-player.gmusic-cloud-25.workers.dev/api/spotify/callback`

Si Spotify no está configurado, el resto de GMusic v3.4 funciona normalmente.

## Word (.docx)
El panel privado exporta un DOCX real (ZIP/Open XML) con tabla de canción, artista, álbum y estado. Hay exportación completa y solo faltantes.

## Seguridad / privacidad
- No se implementa ningún convertidor ni descarga desde Spotify/YouTube.
- Ningún listener puede listar solicitudes de otras cuentas.
- Endpoints administrativos siguen devolviendo respuestas neutras a cuentas no autorizadas.
- Spotify no entra al camino crítico del reproductor.
