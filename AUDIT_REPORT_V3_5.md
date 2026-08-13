# AUDIT_REPORT_V3_5.md

## Auditoría completa — GMusic v3.5

**Proyecto auditado:** GMusic v3.5 – YouTube Discovery + GMusic DJ  
**Base:** ZIP suministrado por el usuario  
**Modo:** solo auditoría; no se modificó código de producción.  
**Suite existente:** `npm run check` ejecutada correctamente (exit code 0).  

> Nota importante: que la suite pase no significa que los flujos runtime estén cubiertos. Varias pruebas nuevas de v3.5 son comprobaciones estáticas de texto/regex y no simulan el IFrame de YouTube, Media Session, condiciones de carrera ni cuotas reales.

---

# Resumen ejecutivo

Encontré:

- **1 crítico confirmado**
- **7 altos confirmados**
- **11 medios confirmados**
- **3 riesgos/probables**
- **2 riesgos de severidad baja/media**

La prioridad principal no está en el algoritmo básico del DJ. Los puntos más delicados están en:

1. **KV / límites gratuitos**
2. **aplicación masiva de metadata**
3. **YouTube + Media Session**
4. **condiciones de carrera al cambiar videos**
5. **persistencia de cola**
6. **uso real de los datos de YouTube**
7. **calidad de las pruebas**

No encontré en el proyecto descargadores YouTube→MP3 ni extracción directa del stream de audio. La implementación de YouTube utiliza el IFrame Player.

---

# CORREGIR INMEDIATAMENTE

## BUG-001 — La metadata puede modificarse aunque el backup haya fallado

**Severidad:** 🔴 CRÍTICO  
**Estado:** CONFIRMADO  
**Archivo:** `src/index.js`  
**Función:** `applyMetadataProposal()`  
**Líneas aproximadas:** 993–1009

### Problema

Antes de modificar la metadata se intenta guardar un backup en KV:

```js
await env.USERDATA.put(backupKey, JSON.stringify(...), { expirationTtl: ... }).catch(()=>{});
```

El `.catch(()=>{})` silencia por completo cualquier fallo.

Inmediatamente después el código modifica Google Drive:

```js
const response = await driveFetch(... PATCH ...)
```

### Cómo reproducirlo

1. Llevar Workers KV al límite de escrituras o simular un fallo de `USERDATA.put`.
2. Aplicar una propuesta de Metadata Intelligence.
3. El `put()` del backup falla.
4. El error es ignorado.
5. El PATCH de Drive continúa.

### Impacto

La aplicación promete una actualización no destructiva con backup/rollback, pero precisamente cuando KV está saturado puede modificar metadata **sin haber confirmado que existe el backup**.

Con el uso reciente cercano al límite diario de KV, este escenario no es teórico para GMusic.

### Solución recomendada

- Nunca ignorar el error del backup.
- Confirmar que el backup terminó correctamente antes del PATCH a Drive.
- Si falla, devolver un error claro y **no tocar la metadata**.
- Para operaciones masivas, crear un backup de lote antes de modificar ninguna canción.

### Riesgo de regresión

Bajo si se implementa como precondición antes del PATCH.

---

## BUG-002 — Aplicar metadata segura en lote puede consumir cientos de escrituras KV

**Severidad:** 🟠 ALTO  
**Estado:** CONFIRMADO  
**Archivos:** `src/index.js`, `public/app.js`  
**Funciones:** `applyMetadataProposal()`, `logAudit()`, `applySafeMetadataMatches()`, `applyMetadataRow()`  
**Backend:** aprox. 993–1009 y 1403–1406  
**Frontend:** aprox. 1020–1021

### Problema

Cada canción aplicada individualmente genera al menos:

1. `backup:metadata:proposal:*` → **1 KV.put**
2. `audit:*` → **1 KV.put**

Por tanto:

- 50 canciones ≈ **100 escrituras KV**
- 100 canciones ≈ **200 escrituras KV**
- 400 canciones ≈ **800 escrituras KV**

Esto ocurre antes de contar favoritos, playback, cola, usuarios, solicitudes, Spotify u otras operaciones.

Además, el frontend llama `loadTracks()` después de **cada canción aplicada**, por lo que el lote vuelve a leer la biblioteca completa de Drive una vez por canción.

### Impacto

- Riesgo muy alto de llegar al límite diario gratuito de escrituras KV.
- Operación masiva innecesariamente lenta.
- Muchas llamadas a Google Drive.
- Mayor probabilidad de terminar un lote a medias.

### Solución recomendada

Crear un endpoint de lote:

```text
POST /api/admin/metadata/apply-batch
```

Flujo recomendado:

```text
backup único del lote
→ validar todas las propuestas
→ aplicar cambios
→ un solo audit log resumido
→ recargar biblioteca una sola vez
```

---

## BUG-003 — El contador del lote de metadata dice “aplicadas” incluso cuando fallan

**Severidad:** 🟠 ALTO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Función:** `applySafeMetadataMatches()`  
**Línea aproximada:** 1021

### Problema

El código hace:

```js
for (const x of safe) {
  await applyMetadataRow(x.i);
  ok++;
}
```

`applyMetadataRow()` puede fallar y mostrar un toast, pero no devuelve un estado de éxito/fallo que el lote compruebe.

`ok++` ocurre igualmente.

### Impacto

Si KV, Drive o MusicBrainz falla durante un lote, GMusic puede mostrar:

```text
63 coincidencias seguras aplicadas
```

aunque varias no se hayan guardado.

Esto es especialmente peligroso ante un límite KV.

### Solución recomendada

Hacer que `applyMetadataRow()` devuelva `{ok:true/false}` y contabilizar solamente éxitos reales. Idealmente reemplazar todo por un endpoint batch transaccional/recuperable.

---

## BUG-004 — Subir muchas canciones dispara un escaneo completo de Music Requests por cada archivo

**Severidad:** 🟠 ALTO  
**Estado:** CONFIRMADO  
**Archivo:** `src/index.js`  
**Funciones:** `uploadTrack()`, `updateTrackMetadata()`, `markRequestsAvailableForTrack()`, `listKvJson()`  
**Referencias:** `markRequestsAvailableForTrack()` aprox. 1134–1137

### Problema

Después de subir una canción se ejecuta:

```js
markRequestsAvailableForTrack(env, track)
```

Esta función ejecuta:

```js
listKvJson(env, "musicreq:", 2000)
```

y `listKvJson()` hace:

```text
KV.list()
+
KV.get() por cada solicitud
```

Esto sucede **por cada canción subida**.

### Ejemplo

100 canciones nuevas + 10 solicitudes existentes:

```text
≈ 100 KV.list
≈ 1,000 KV.get
+ escrituras de auditoría de cada upload
```

Si hay más solicitudes, el costo crece multiplicativamente.

### Impacto

Este patrón puede explicar una parte importante de las operaciones `list` y `read` observadas en Cloudflare.

### Solución recomendada

No escanear todas las solicitudes por canción.

Opciones:

- crear un índice por clave normalizada de canción;
- reconciliar una sola vez al terminar un upload masivo;
- endpoint batch de upload/reconcile;
- mantener un índice `musicreq-index:<canonicalTrackKey>`.

---

## BUG-005 — El panel de Administración ejecuta demasiadas operaciones pesadas al abrirse

**Severidad:** 🟠 ALTO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Función:** `loadAdminPanel()`  
**Líneas aproximadas:** 970–975

### Problema

Cada carga del panel lanza simultáneamente:

```text
/api/admin/users
/api/admin/status
/api/trash
/api/admin/library/audit
/api/admin/requests
/api/admin/playlist-analyses
/api/admin/artists/audit
/api/admin/youtube/listens
```

Esto implica varias operaciones Drive y varias listas completas de KV.

Además, acciones como crear/actualizar usuarios o restaurar canciones vuelven a ejecutar `loadAdminPanel()` completo.

### Impacto

Abrir/reabrir Administración puede generar repetidamente:

- `KV.list`
- múltiples `KV.get`
- escaneos de Drive

aunque el usuario solo quiera ver una sección.

### Solución recomendada

Carga por secciones:

```text
Administración
├─ Usuarios       → cargar al abrir sección
├─ Metadata       → cargar bajo demanda
├─ Artistas       → cargar bajo demanda
├─ Solicitudes    → cargar bajo demanda
└─ YouTube        → cargar bajo demanda
```

Y cachear resultados durante la sesión.

---

## BUG-006 — KV Saver no evita escrituras repetidas de la cola

**Severidad:** 🟠 ALTO  
**Estado:** CONFIRMADO  
**Archivos:** `public/app.js`, `src/index.js`  
**Funciones:** `syncQueueRemote()`, `putUserData()`, `sanitizeUserData("queue")`

### Problema

El backend intenta evitar una escritura si:

```js
current === serialized
```

Pero el frontend envía siempre:

```js
updated_at: new Date().toISOString()
```

en cada sincronización de cola.

Aunque el contenido lógico de la cola sea el mismo, el JSON nunca será idéntico por `updated_at`.

Por tanto el “KV Saver” no ahorra esa escritura.

### Impacto

- Escrituras innecesarias.
- Especialmente relevante con el límite gratuito de KV.
- El test `kv-saver-v35.mjs` comprueba que exista la comparación de strings, pero no prueba este caso real.

### Solución recomendada

Comparar datos canónicos excluyendo `updated_at`, o actualizar timestamp solamente cuando cambie realmente:

```text
manualQueue
contextIds
currentId
shuffle
repeat
```

---

## BUG-007 — Media Session sigue controlando el audio local mientras YouTube está reproduciendo

**Severidad:** 🟠 ALTO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Funciones:** `setupMediaSession()`, `playYouTubeResult()`, `pauseYouTubePlayback()`

### Problema

Al iniciar YouTube se hace:

```js
audio.pause()
```

pero los handlers de Media Session siguen siendo:

```js
play: () => audio.play()
pause: () => audio.pause()
previoustrack: () => previousTrack(true)
nexttrack: () => nextTrack(false)
```

No se reemplazan ni se deshabilitan mientras el YouTube IFrame está activo.

### Escenario

1. Suena canción local.
2. Se abre YouTube.
3. El audio local se pausa.
4. YouTube empieza.
5. Un control del sistema / Bluetooth manda `play`.
6. `audio.play()` puede reanudar la canción local mientras YouTube continúa.

También `pause` puede pausar únicamente el `<audio>` ya pausado y no el IFrame.

### Impacto

- posibilidad de doble reproducción;
- controles de lockscreen incoherentes;
- metadata de Media Session perteneciente a la canción local anterior.

### Solución recomendada

Crear estado explícito:

```text
activePlaybackSource = "library" | "youtube"
```

Cuando YouTube esté activo:

- evitar que Media Session reanude `<audio>`;
- dirigir controles compatibles al reproductor activo o limpiar handlers si YouTube no debe controlarse desde ahí;
- al volver a biblioteca restaurar handlers de GMusic.

---

## BUG-008 — Cambiar rápidamente de video deja timers viejos que interfieren con la escucha nueva

**Severidad:** 🟠 ALTO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Funciones:** `playYouTubeResult()`, `startYouTubeListenClock()`, `stopYouTubeListenClock()`  
**Líneas aproximadas:** 946–950

### Problema

Al seleccionar un nuevo resultado se reemplaza:

```js
state.youtubeListen = {
  session_id: ...,
  timer: null,
  ...
}
```

pero antes de hacerlo **no se cancela explícitamente el timer de la reproducción anterior**.

El callback del timer viejo utiliza `state.youtubeListen` global cuando finalmente se ejecuta.

Por tanto puede terminar operando sobre la sesión nueva.

### Ejemplo

1. Video A reproduce 10 s.
2. Usuario abre Video B.
3. El timer A sigue vivo.
4. B inicia su propio timer.
5. Al llegar el momento original de A, el callback viejo ejecuta `stopYouTubeListenClock()`.
6. Esa función ve el estado de B y puede cancelar el timer de B.

### Impacto

- escuchas de 30 s que no se registran;
- tiempos inconsistentes;
- comportamiento dependiente de rapidez al cambiar videos.

### Solución recomendada

Antes de reemplazar la sesión:

```js
stopYouTubeListenClock()
clearTimeout(oldListen.timer)
```

y usar callbacks ligados al `session_id` original:

```text
si callback.sessionId !== state.youtubeListen.session_id
→ ignorar
```

---

# CORREGIR EN v3.5.1

## BUG-009 — Si falla el POST del registro YouTube, la escucha se pierde y no se reintenta

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Función:** `registerYouTubeListen()`

### Problema

Antes de hacer el request:

```js
l.recorded = true;
```

Después:

```js
await apiFetch(...).catch(()=>{});
```

Si la red falla o KV no acepta la escritura, la sesión ya queda marcada como registrada y no existe retry.

### Solución recomendada

Marcar `recorded=true` únicamente después de respuesta 2xx.  
Mientras tanto usar estados:

```text
pending
recording
recorded
failed
```

con uno o dos retries limitados.

---

## BUG-010 — El backend confía en los datos de escucha enviados por el cliente

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivo:** `src/index.js`  
**Función:** `logYouTubeListen()`

### Problema

Un usuario autenticado puede enviar manualmente:

```json
{
  "listened_seconds": 999,
  "video_id": "...",
  "title": "cualquier cosa",
  "channel": "cualquier cosa"
}
```

El servidor solo valida formato y mínimo de segundos.

### Impacto

Un usuario puede falsificar la bandeja administrativa de YouTube.

No permite ver datos ajenos, pero sí daña la integridad de los datos que ve el administrador.

### Solución recomendada

Guardar en el servidor una referencia de búsqueda/resultado firmado o validar `video_id` contra una caché/referencia conocida. No es necesario confiar en título/canal enviados por el cliente.

---

## BUG-011 — YouTube Search no tiene rate limit propio

**Severidad:** 🟡 MEDIO / 🟠 ALTO según uso  
**Estado:** CONFIRMADO  
**Archivo:** `src/index.js`  
**Función:** `searchYouTube()`

### Problema

La caché evita repetir la misma consulta, pero un usuario autenticado puede realizar muchas búsquedas únicas.

No existe:

- rate limit por usuario;
- rate limit global;
- presupuesto diario interno;
- bloqueo temporal antes de agotar cuota.

### Impacto

Un solo usuario puede dejar YouTube Discovery sin cuota para todos.

### Solución recomendada

Implementar límite razonable por cuenta sin generar una escritura KV por búsqueda. Preferir:

- contador agregado;
- rate limit de Worker adecuado;
- caché;
- ventana temporal en memoria cuando aporte;
- límites suaves en frontend + validación real backend.

---

## BUG-012 — Respuestas 403 de YouTube se presentan siempre como “límite”

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivo:** `src/index.js`  
**Función:** `searchYouTube()`

### Problema

El código trata:

```js
403 || 429
```

como:

```text
YouTube alcanzó temporalmente su límite de búsquedas
```

Un 403 puede tener otras causas, como una clave inválida, API deshabilitada o restricciones incorrectas.

### Impacto

Dificulta muchísimo configurar/diagnosticar la nueva función.

### Solución recomendada

Parsear el error de YouTube y distinguir:

- quota exceeded;
- API key invalid;
- API disabled;
- forbidden/restriction mismatch.

Sin exponer detalles sensibles al usuario normal.

---

## BUG-013 — “Favoritos” del DJ puede reproducir canciones que no son favoritas

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivo:** `public/dj-engine.js`  
**Funciones:** `scoreDjTrack()`, `chooseDjTrack()`

### Problema

En modo favorites:

```js
if (!favoriteIds.has(track.id)) score -= 28;
```

Las no favoritas reciben penalización pero siguen siendo candidatas.

Si no existen favoritos, el DJ sigue escogiendo cualquier canción.

### Impacto

El nombre del modo no corresponde a lo que realmente hace.

### Solución recomendada

Si modo `favorites`:

- filtrar candidatos a favoritos;
- si no hay favoritos, explicar “Aún no tienes favoritos” y ofrecer otro modo.

---

## BUG-014 — “Anterior” en DJ no vuelve a la canción anterior elegida por el DJ

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Funciones:** `startDj()`, `previousTrack()`

### Problema

DJ mantiene `lastIds`, pero `previousTrack()` utiliza:

```js
state.contextIds.indexOf(state.currentId)
```

`contextIds` se inicializa como toda la biblioteca.

Por tanto “Anterior” navega según el orden de la biblioteca, no según el historial real de selecciones del DJ.

### Solución recomendada

Mantener:

```text
dj.history
dj.historyCursor
```

y usarlo cuando `state.dj.active === true`.

---

## BUG-015 — El DJ puede repetir pronto canciones que fueron saltadas antes de 30 s

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivos:** `public/app.js`, `public/dj-engine.js`

### Problema

`state.dj.lastIds` guarda canciones anteriores, pero el algoritmo solo usa esos IDs para derivar `recentArtists`.

No penaliza directamente que un `track.id` aparezca en `lastIds`.

Además `recentIds` solo se actualiza cuando una canción alcanza el umbral de reproducción.

Si el usuario salta rápido una canción, puede volver a ser candidata pocas canciones después.

### Solución recomendada

Penalizar/excluir los últimos N `track.id` del historial del DJ independientemente del contador de reproducción.

---

## BUG-016 — El consentimiento afirma que YouTube mejora el DJ, pero el DJ no usa esos datos

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivos:** `public/app.js`, `public/dj-engine.js`

### Problema

El mensaje de consentimiento indica que las escuchas YouTube se guardan:

```text
para gestionar música solicitada y mejorar tu DJ
```

Pero `chooseNextDjTrack()` usa únicamente:

- `state.stats`
- `favoriteIds`
- `recentIds`
- `recentArtists`
- feedback local

No consulta ni carga los logs de YouTube.

### Impacto

- explicación de privacidad inexacta;
- función prometida pero no implementada.

### Solución recomendada

Elegir una de dos:

1. eliminar del consentimiento la afirmación sobre mejorar el DJ; o
2. crear un resumen privado por usuario que realmente alimente Discovery/DJ.

Nunca usar escuchas de otros usuarios.

---

# Persistencia y cola

## BUG-017 — La cola guarda `currentId` anterior al pasar automáticamente a la siguiente canción

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Función:** `nextTrack()`

### Problema

Orden actual:

```js
saveQueue();
...
state.currentId = nextId;
await playTrack(nextId);
```

La cola se guarda **antes** de actualizar `currentId`.

`previousTrack()` tampoco persiste después del cambio.

### Impacto

Después de cerrar/recargar, el estado remoto/local de la cola puede apuntar a la canción anterior.

### Solución recomendada

Actualizar primero el estado y después persistirlo, sin duplicar escrituras.

---

## BUG-018 — La restauración de `contextIds` remota se pierde durante el arranque

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Funciones:** `loadUserBundle()`, `loadTracks()`

### Problema

`loadUserBundle()` restaura:

```js
state.contextIds = remoteQueue.contextIds
```

Pero inmediatamente después `boot()` ejecuta `loadTracks()`, que hace:

```js
state.contextIds = state.tracks.map(t => t.id)
```

La cola contextual restaurada se reemplaza por toda la biblioteca.

### Impacto

La promesa de conservar el contexto original de álbum/playlist/cola entre sesiones no se cumple completamente.

### Solución recomendada

Después de cargar tracks:

- validar los IDs restaurados contra la biblioteca;
- conservar el contexto remoto válido;
- usar toda la biblioteca solamente si no existe contexto guardado.

---

# KV y rendimiento

## Hallazgo KV-01 — `listKvJson()` escala mal

**Estado:** CONFIRMADO  
**Archivo:** `src/index.js`  
**Función:** `listKvJson()`

Cada uso realiza:

```text
1 o más KV.list
+
1 KV.get por cada clave
```

Se utiliza para:

- solicitudes propias;
- solicitudes administrativas;
- modificar una solicitud por ID;
- reconciliar solicitudes;
- playlists propias;
- playlists administrativas;
- buscar análisis para DOCX.

A medida que crezcan los datos, abrir paneles y ejecutar acciones será más caro.

### Recomendación

Cuando se conoce un ID, acceder directamente a una key indexada en lugar de listar todo para encontrarlo.

---

## Hallazgo KV-02 — Auditoría genera una escritura extra por muchas acciones

**Estado:** CONFIRMADO  
**Archivo:** `src/index.js`  
**Función:** `logAudit()`

Uploads, metadata, trash, usuarios e imágenes pueden generar `audit:*`.

La auditoría es útil, pero con el límite gratuito necesita estrategia:

- agrupar operaciones masivas;
- no crear un audit separado por cada elemento de un batch;
- mantener audit resumido del lote.

---

## Hallazgo KV-03 — El progreso sigue escribiendo periódicamente aunque no haya cambio estructural

**Estado:** CONFIRMADO  
**Archivo:** `public/app.js`  
**Funciones:** `schedulePlaybackSync()`, `persistPlaybackNow()`

Cada 3 minutos durante reproducción se guarda:

```text
currentId
position
duration
updated_at
```

Aquí el cambio de posición sí es real, por lo que KV Saver no puede evitar la escritura.

No es un bug por sí solo, pero debe incluirse en el presupuesto diario.

Una sesión de 8 horas puede producir ~160 escrituras de playback por una sola cuenta si el timer se mantiene de forma continua.

### Recomendación

Considerar intervalos mayores, guardar por eventos importantes y/o utilizar una estrategia de progreso con menor frecuencia.

---

# YouTube

## Verificado correctamente

- No encontré `youtube-dl`, `yt-dlp`, conversión MP3 ni extracción directa de audio.
- La reproducción nueva usa `https://www.youtube.com/iframe_api`.
- La búsqueda se hace desde backend y `YOUTUBE_API_KEY` no aparece en `wrangler.jsonc`.
- Hay caché de búsquedas.
- Los logs YouTube tienen `expirationTtl` de 14 días.
- El endpoint administrativo de escuchas está protegido por `requireAdmin()`.
- El listener no recibe el agregado global de reproducciones.

---

# Privacidad y seguridad

## RIESGO-001 — El session token se devuelve al JavaScript aunque también exista cookie HttpOnly

**Severidad:** 🟡 MEDIO / hardening  
**Estado:** RIESGO CONFIRMADO EN DISEÑO  
**Archivo:** `src/index.js`  
**Función:** `createSession()`

Se establece una cookie:

```text
HttpOnly; Secure; SameSite=Strict
```

pero además se devuelve:

```json
"session_token": "..."
```

en el body.

La aplicación web no parece necesitar ese token.

### Riesgo

Un HttpOnly cookie está diseñado para evitar acceso JavaScript al token. Devolver el mismo token en el JSON reduce esa ventaja durante el login.

### Recomendación

Si la PWA no necesita bearer tokens, no devolverlo.  
Si existe un cliente nativo futuro, crear un flujo separado claramente definido.

---

## RIESGO-002 — Offline local no está cifrado

**Severidad:** 🟢 BAJO / 🟡 MEDIO según amenaza  
**Estado:** RIESGO

Las bibliotecas offline están aisladas por `offlineScope`, pero permanecen en almacenamiento local/cache del navegador.

Un usuario con acceso a DevTools/perfil del navegador podría inspeccionar esos datos.

No es una fuga entre cuentas a través de la UI normal, pero no debe considerarse almacenamiento confidencial fuerte.

---

# Artist Intelligence

## RIESGO-003 — Los artistas sin foto pueden reintentar cada ~90 s mientras sigan visibles

**Severidad:** 🟢 BAJO  
**Estado:** PROBABLE  
**Archivo:** `public/app.js`  
**Funciones:** `scheduleArtworkRetry()`, `hydrateArtwork()`

Un miss visible programa un nuevo intento después de ~90 s.

Esto evita el bug anterior de “vacío permanente”, pero si existen muchos artistas sin resultado puede producir actividad de red periódica mientras la pantalla permanezca abierta.

### Recomendación

Backoff progresivo:

```text
90 s → 5 min → 30 min
```

y no repetir durante una misma sesión después de cierto número de fallos.

---

# Calidad de tests

## BUG-019 — Las pruebas YouTube/KV no cubren los flujos que más pueden romperse

**Severidad:** 🟡 MEDIO  
**Estado:** CONFIRMADO  
**Archivos:**
- `tests/youtube-discovery-v35.mjs`
- `tests/kv-saver-v35.mjs`

### Problema

La prueba YouTube verifica principalmente patrones como:

```js
assert.match(app, /pauseYouTubePlayback/)
```

pero no simula:

- Video A → Video B rápidamente;
- timer viejo;
- Media Session durante YouTube;
- fallo de `/api/youtube/listen`;
- doble audio;
- cambio de pestaña real.

La prueba KV comprueba que exista:

```js
current === serialized
```

pero no detecta que `updated_at` cambia en cada guardado de cola.

### Impacto

`npm run check` da verde aunque existan BUG-006, BUG-007 y BUG-008.

### Solución recomendada

Crear tests de comportamiento con mocks de:

- timers;
- YT PlayerState;
- MediaSession;
- fetch fallido;
- MemoryKV contando `get/put/list`;
- transición de cola.

---

# Resultado de la suite actual

Se ejecutó:

```text
npm run check
```

Resultado:

```text
EXIT CODE 0
✓ Auth/security
✓ Privacy isolation
✓ Privacy Phase 1.1
✓ Metadata normalization
✓ Offline startup
✓ Media Session + favoritos
✓ Metadata Intelligence
✓ Favoritos Offline 2.0
✓ Artist Intelligence
✓ Artist artwork resilience
✓ Music Requests
✓ DOCX
✓ YouTube Discovery
✓ DJ
✓ KV Saver
```

Durante `privacy-smoke.mjs` aparece un error esperado por falta de `GOOGLE_CLIENT_ID` en el entorno de auditoría, pero el script continúa y la suite termina con código 0.

---

# Regresiones v3.5 / problemas nuevos

Problemas claramente relacionados con las nuevas funciones v3.5:

1. **Media Session vs YouTube**
2. **race de timers al cambiar videos**
3. **registro perdido si falla el POST**
4. **sin rate limit propio de YouTube**
5. **consentimiento afirma uso en DJ que no existe**
6. **Favorites DJ no es realmente exclusivo de favoritos**
7. **tests nuevos demasiado estáticos**
8. **KV Saver de cola no ahorra realmente por `updated_at`**

Problemas preexistentes que siguen presentes:

- persistencia de `contextIds`;
- `currentId` stale en cola;
- costo alto de `listKvJson`;
- operaciones masivas de Metadata Intelligence.

---

# Pruebas manuales pendientes

## REQUIERE PRUEBA EN DISPOSITIVO

No se puede afirmar desde esta auditoría de código que funcionen correctamente:

- Safari iPhone lockscreen;
- Chrome Android PWA;
- controles Bluetooth;
- comportamiento exacto de YouTube IFrame al bloquear pantalla;
- cambios de orientación;
- safe areas;
- autoplay específico por navegador;
- consumo real de batería;
- eviction real de caché offline por iOS;
- comportamiento de Media Session mientras el IFrame de YouTube está activo.

---

# Priorización final

## CORREGIR INMEDIATAMENTE

1. **BUG-001** — no modificar metadata si el backup falla.
2. **BUG-002** — batch de metadata con backup/audit agrupado.
3. **BUG-003** — conteo falso de “aplicadas”.
4. **BUG-004** — no escanear todas las Music Requests por cada upload.
5. **BUG-005** — carga lazy del panel Admin.
6. **BUG-006** — KV Saver real para cola.
7. **BUG-007** — separar Media Session local/YouTube.
8. **BUG-008** — cancelar timers viejos de YouTube.

## CORREGIR EN v3.5.1

9. retry de escuchas YouTube.
10. integridad de logs YouTube.
11. rate limit YouTube.
12. mensajes 403.
13. modo Favoritos real.
14. historial Previous del DJ.
15. evitar repetición de tracks saltados.
16. corregir texto/uso de YouTube para DJ.
17. persistencia de cola.
18. restauración de `contextIds`.
19. tests de comportamiento.

## PUEDE ESPERAR

- hardening del token de sesión;
- cifrado offline más fuerte;
- backoff de artwork.

---

# Recomendación de arquitectura para v3.5.1

No recomiendo añadir más funciones antes de corregir estos puntos.

La v3.5.1 debería ser principalmente:

```text
GMusic v3.5.1
├── KV Efficiency
│   ├── metadata batch
│   ├── request index
│   ├── lazy admin
│   └── queue saver real
├── YouTube Stability
│   ├── playback source state
│   ├── timer isolation
│   ├── retry
│   └── quota guard
├── DJ Stability
│   ├── real favorites mode
│   ├── DJ history
│   └── skip/repetition memory
└── Regression Tests
    ├── timers
    ├── MediaSession
    ├── KV counters
    └── queue persistence
```

El objetivo debería ser **reducir operaciones KV y estabilizar v3.5**, no sumar otra función grande todavía.
