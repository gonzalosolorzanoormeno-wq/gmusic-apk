# GMusic v3.4.1

## Fix: fotos de artistas no cargaban al hacer scroll

**Problema:** `hydrateArtwork()` en `public/app.js` solo procesaba los primeros
8 elementos `[data-artist-image]` / `[data-cover-for]` presentes en el DOM en
el momento de la llamada, sin ningún `IntersectionObserver` ni listener de
`scroll`. En bibliotecas con más de 8 artistas, todos los que aparecían más
abajo en la grilla nunca disparaban la búsqueda automática de imagen
(Deezer / MusicBrainz / Wikimedia), quedando siempre con el ícono de nota
musical por defecto.

**Solución:** se reemplazó la lógica por un `IntersectionObserver` que
observa **todas** las tarjetas de artista/álbum renderizadas y dispara la
búsqueda de imagen justo cuando cada tarjeta entra en el viewport (con un
margen de 200px para precargar un poco antes). Se mantiene un fallback sin
observer (`hydrateArtwork` procesa todo el DOM) para navegadores sin soporte
de `IntersectionObserver`.

Esto no cambia el comportamiento del panel Admin → "Artist Intelligence 2.0"
(`/api/admin/artists/search` + `/api/admin/artists/apply`), que ya escaneaba
toda la biblioteca y sigue siendo la vía recomendada para revisar coincidencias
dudosas o subir fotos manuales para artistas sin match automático.

## Archivos modificados
- `public/app.js` — nueva lógica de hidratación de artwork basada en
  `IntersectionObserver` (funciones `hydrateCoverNode`, `hydrateArtistNode`,
  `getArtworkObserver`, `hydrateArtwork`).
- `package.json`, `public/app.js`, `src/index.js` — versión → 3.4.1.
