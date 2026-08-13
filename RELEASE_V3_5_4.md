# GMusic v3.5.4 — Fix crítico: no avanzaba de canción (pantalla apagada y encendida)

## El problema reportado

Con la pantalla del teléfono apagada (o justo al volver a encenderla), la
reproducción se quedaba trabada en una canción: no pasaba a la siguiente ni
sola ni al pulsar "Siguiente" (botón en la app, notificación o control del
bloqueo de pantalla). A veces aparecía el aviso "Pulsa Continuar
reproducción" sin motivo aparente.

## Causa raíz

v3.5.3 introdujo un mecanismo para adelantar la siguiente canción mientras
Android tiene la pantalla apagada (`scheduleAndroidBackgroundAdvance`,
`androidBackgroundHeartbeat`, etc.), ya que en ese estado el navegador
retrasa o ignora temporizadores normales.

Ese mecanismo dejaba una ventana de carrera (*race condition*): si el
usuario (o el sistema, vía notificación/control de bloqueo) pedía
"Siguiente" **mientras** el avance automático en segundo plano ya estaba a
mitad de camino (con su propio `audio.play()` todavía pendiente), ambas
rutas terminaban escribiendo sobre el mismo elemento `<audio>` a la vez:

- `playTrack()` (la ruta manual) revocaba la URL/objeto que el avance
  automático acababa de asignar y sobrescribía `audio.src` mientras ese
  `play()` seguía en curso.
- Cuando la promesa del avance automático finalmente se resolvía o fallaba
  (de forma tardía), su callback igual se ejecutaba y volvía a tocar el
  estado (`backgroundAdvancePending`, `audio.autoplay`, el candado de
  reproducción, la pantalla de "Pulsa Continuar reproducción"), pisando lo
  que la transición manual, más reciente, ya había hecho.

El resultado: la reproducción quedaba en un estado inconsistente —
canción incorrecta, candado de avance trabado, o el audio simplemente
detenido esperando un toque manual— y eso seguía roto aunque el usuario
volviera a encender la pantalla, hasta recargar la app.

## La corrección

Se añadió un token de transición (`state.playbackToken`). Cada vez que se
inicia una transición de pista real —ya sea manual, por el sistema
(bloqueo de pantalla/notificación) o el avance automático en segundo
plano— se reclama un token nuevo. Los callbacks asíncronos de una
transición (el `.then`/`.catch` de su `audio.play()`) solo aplican sus
efectos si su token sigue siendo el vigente; si una transición más nueva ya
tomó el control, se convierten en no-operaciones en lugar de corromper el
estado actual.

Además, `playTrack()` ahora libera de forma explícita e inmediata el
candado y el temporizador de avance en segundo plano al arrancar, así que
una acción manual de "Siguiente/Anterior" siempre gana, sin quedar
bloqueada por una transición automática que ya no importa.

## Alcance de los cambios

- `public/app.js`: nuevo campo `playbackToken` en el estado; guardas de
  token en `startPreparedNextImmediately()` y `playTrack()`.
- `public/sw.js`, `public/index.html`, `package.json`: versión y
  cache-busting subidos a 3.5.4 / `v=19-android-bg-fix` para que el
  Service Worker y los navegadores sirvan el archivo corregido.
- `tests/android-background-v354.mjs`: sustituye a
  `android-background-v353.mjs`; conserva todas sus comprobaciones y
  añade verificaciones específicas del arreglo de la carrera.
- Resto de tests estructurales actualizados a la nueva versión (mismo
  patrón que en releases anteriores).

No se tocó nada de UI, YouTube Discovery, DJ, privacidad ni metadata: es
un cambio quirúrgico centrado únicamente en la transición de pistas.

## Publicar

```
PUBLICAR_GMUSIC_V3_5_4.bat
```

Ejecuta `npm run check` (todos los tests, incluida la suite ampliada de
segundo plano en Android) y solo si pasa hace `wrangler deploy`.
