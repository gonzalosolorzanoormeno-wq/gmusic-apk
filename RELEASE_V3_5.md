# GMusic v3.5 – YouTube Discovery + GMusic DJ

Base: GMusic v3.4.2 – Artist Artwork Fix.

## Qué cambia

### YouTube Discovery
- Nueva vista **Descubrir / DJ**.
- Búsqueda de videos públicos mediante YouTube Data API v3.
- Resultados filtrados para que sean embebibles/sindicables; se omiten resultados marcados `madeForKids`.
- Reproducción únicamente mediante el reproductor oficial YouTube IFrame Player.
- GMusic no descarga, separa, convierte ni almacena el audio de YouTube.
- YouTube se pausa cuando GMusic pasa a segundo plano o se bloquea la pantalla.
- La API de YouTube se carga de forma diferida: no se carga hasta que el usuario elige reproducir un resultado.
- La búsqueda ocurre solo al pulsar **Buscar** o Enter; los resultados se cachean 12 horas para cuidar cuota.

### Registro de interés por escucha
- Una reproducción solo se registra después de **30 segundos reales de reproducción visible**.
- Antes de la primera reproducción se pide consentimiento explícito para guardar video, fecha y tiempo aproximado de escucha.
- El consentimiento se guarda de forma local por cuenta/dispositivo.
- Los logs se separan por usuario mediante ID técnico y expiran automáticamente a los 14 días.
- El listener nunca ve reproducciones de otros usuarios.
- Administración recibe una sección **Escuchado desde YouTube** con video, cantidad de reproducciones y usuarios internos que lo escucharon.
- Se deduplican sesiones para no registrar dos veces la misma reproducción.

### GMusic DJ
- Nuevo DJ dinámico que selecciona la siguiente canción dentro de la biblioteca del usuario.
- Modos: **Mis gustos, Favoritos, Energía, Chill, Descubrimiento y Sorpréndeme**.
- Usa únicamente favoritos, reproducciones, recientes, artista/género y feedback de la cuenta actual.
- Penaliza repetir demasiado la misma canción/artista.
- Feedback inmediato: **Más de esto, Menos, Más energía, Más chill, Sorpréndeme**.
- El feedback del DJ es local a la cuenta/dispositivo y no utiliza datos de otros usuarios.
- En modo Descubrimiento se puede iniciar manualmente una búsqueda relacionada en YouTube; no se hacen búsquedas automáticas para no gastar cuota.
- No implementa beatmatching ni manipulación del audio de YouTube.

### KV Saver
- `PUT /api/userdata/*` evita escribir KV cuando el valor serializado no cambió.
- Ya no actualiza `account:last_activity` en cada guardado de datos personales.
- El progreso de reproducción se sincroniza como máximo cada 3 minutos durante reproducción continua, además de eventos importantes.
- Los registros de YouTube se guardan por usuario/día y no generan entradas de auditoría adicionales.

## Configuración requerida para YouTube

La aplicación funciona sin YouTube si no se configura la clave. Para activar YouTube Discovery:

1. Crear/usar un proyecto en Google Cloud.
2. Habilitar **YouTube Data API v3**.
3. Crear una API key y restringirla a esa API cuando sea posible.
4. Guardarla como secreto del Worker, nunca en frontend ni en `wrangler.jsonc`:

```bash
npx wrangler secret put YOUTUBE_API_KEY
```

También puede añadirse desde Cloudflare Dashboard como secreto llamado exactamente `YOUTUBE_API_KEY`.

## Publicación

En Windows:

```text
PUBLICAR_GMUSIC_V3_5.bat
```

El script ejecuta primero `npm run check` y solo después despliega con Wrangler.

## Pruebas

`npm run check` incluye regresión completa de v3.4.2 y pruebas específicas de:
- búsqueda/reproductor YouTube;
- pausa en background;
- consentimiento y umbral de 30 s;
- DJ y sus modos;
- aislamiento/privacidad;
- ahorro de escrituras KV.

## No destructivo

Esta actualización no elimina canciones, usuarios, favoritos, playlists, historial, estadísticas, metadata, imágenes de artistas, cola ni descargas offline existentes.
