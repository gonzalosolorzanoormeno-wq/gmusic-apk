# GMusic v3.4.2 — Artist Artwork Resilience

## Qué se corrigió

La v3.4.1 resolvía que solo se hidrataran las primeras tarjetas visibles, pero quedaban tres causas adicionales que podían hacer desaparecer fotos de artistas:

1. **Los resultados vacíos se guardaban como si fueran definitivos.** `fetchArtwork()` escribía `state.artwork[key] = ""` y persistía ese valor. Después, al existir la clave, GMusic ya no volvía a consultar ese artista aunque el fallo hubiese sido temporal.
2. **La vista normal dependía de la resolución profunda de MusicBrainz.** Esa ruta está rate-limitada y es adecuada para el panel de revisión, pero no para bloquear la carga visual de decenas de tarjetas.
3. **Cambiar una sola foto desde Administración borraba toda la caché local de artwork.** Eso hacía que artistas que ya tenían foto volvieran momentáneamente al icono genérico.

## Solución v3.4.2

- Los fallos/ausencias de imagen **ya no se persisten como vacíos permanentes**.
- Las ausencias temporales usan una ventana corta de reintento en memoria (90 s).
- Solicitudes concurrentes del mismo artwork se deduplican.
- Al volver la app a primer plano se reanuda la hidratación de imágenes.
- Si una imagen proxificada falla al cargar, se invalida solo esa entrada y se vuelve a intentar más tarde.
- Las tarjetas normales usan primero un **fallback rápido de Deezer con nombre canónico exacto y no ambiguo**.
- MusicBrainz/Wikidata quedan como resolución profunda para casos sin fallback y para el panel Artist Intelligence.
- Si Deezer devuelve más de un artista distinto con exactamente el mismo nombre, GMusic no elige uno a ciegas.
- Las imágenes manuales o aprobadas guardadas en KV siguen teniendo prioridad absoluta.
- Aplicar/subir/quitar la foto de un artista invalida **solo ese artista**, no todas las fotos de GMusic.
- Se mantiene el `IntersectionObserver` de v3.4.1 para hidratar todas las tarjetas al hacer scroll.
- Se actualizó Service Worker y cache-busting a 3.4.2 para evitar que el navegador conserve `app.js` antiguo.

## Qué NO cambia

No se borran canciones, archivos de Drive, usuarios, favoritos, playlists, historial, estadísticas, descargas offline, perfiles ni secretos. Music Requests y Metadata Intelligence permanecen intactos.

## Pruebas añadidas

`tests/artist-artwork-resilience-v342.mjs` comprueba que:

- J Balvin puede obtener un fallback exacto sin esperar MusicBrainz;
- un nombre ambiguo no se selecciona a ciegas;
- los vacíos no se guardan como resultados permanentes;
- existe reintento y deduplicación;
- volver al foreground reactiva la hidratación;
- editar una foto no vacía toda la caché local.
