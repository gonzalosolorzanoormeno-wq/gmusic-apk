# GMusic v3.2.0

GMusic personal/PWA con Google Drive + Cloudflare Workers/KV. Esta versión añade **privacidad reforzada, artistas canónicos y limpieza segura de metadata** sin rehacer la arquitectura ni borrar la biblioteca.

## Lo principal

- Los listeners no pueden descubrir otros usuarios ni la estructura administrativa.
- Favoritos, playlists, historial, estadísticas, cola, perfil y configuración siguen aislados por sesión.
- Biblioteca musical global compartida sin atribución de quién subió o administró canciones.
- `FEID`, `Feid`, `feid` y variantes triviales se agrupan mediante una clave canónica.
- `Mora` y `Morad` no se fusionan por similitud.
- Limpieza de `Official Video`, `Official Audio`, `Visualizer`, `Video Oficial`, `Lyric Video`, `Lyrics`, `HD`, `HQ`, `4K` cuando aparecen como etiquetas descriptivas.
- Administración → Biblioteca ofrece auditoría, vista previa y aplicación segura de limpieza.
- No se modifican los bytes del audio durante la limpieza de metadata.

## Publicar

En Windows, ejecuta:

`PUBLICAR_GMUSIC_V3_2.bat`

El script ejecuta primero `npm run check` y solo después hace `wrangler deploy`.

Manual:

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run deploy
```

## Después de publicar

Entra con la cuenta de gestión y abre **Administración → Biblioteca**. Revisa la vista previa antes de pulsar **Aplicar limpieza segura**.

Consulta `RELEASE_V3_2.md` para todos los detalles y rollback.

## v3.4
Para publicar esta versión usa **PUBLICAR_GMUSIC_V3_3.bat**.
La función Metadata Intelligence está en Administración → Biblioteca → Completar metadata con Internet. Favoritos Offline 2.0 se gestiona desde el botón **Offline** o desde tu perfil.

## v3.5 – YouTube Discovery + GMusic DJ

La vista **Descubrir / DJ** permite buscar y reproducir contenido público mediante el reproductor oficial de YouTube y usar un DJ dinámico basado exclusivamente en los datos de la cuenta actual. Para habilitar la búsqueda de YouTube configura `YOUTUBE_API_KEY` como secreto del Worker. Consulta `RELEASE_V3_5.md`.

## v3.5.5 — Fix de candado en segundo plano

Corrige un deadlock donde `backgroundAdvanceLock` podía quedar activo si `audio.play()` permanecía pendiente con Chrome/Safari en background. `ended` y los fallbacks ya no se descartan por ese candado; la pista pendiente se recupera mediante `backgroundAdvancePending` + `playbackToken`.

## v3.5.4 — Fix crítico de cambio de canción

Corrige una condición de carrera entre el avance automático en segundo plano (Android, pantalla apagada) y cualquier cambio de canción manual/del sistema, que podía dejar la reproducción trabada sin poder pasar de canción, incluso después de encender la pantalla. Para publicar usa **PUBLICAR_GMUSIC_V3_5_4.bat**. Detalles en `RELEASE_V3_5_4.md`.
