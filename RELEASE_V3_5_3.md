# GMusic v3.5.3 – Android Background Playback Fix

Base: GMusic v3.5.2.

## Problema corregido

En Android/Chrome PWA podía ocurrir que una canción siguiera sonando en segundo plano, pero al terminar no arrancara la siguiente. Además, el botón **Siguiente** de Media Session descartaba la pista ya preparada y volvía al flujo asíncrono normal, lo que podía exigir red/JavaScript/UI justo cuando Android tenía la PWA en background.

## Cambios

- Detecta Android sin alterar el comportamiento específico de Safari/iPhone.
- En Android la próxima pista usa precarga `auto` en el media element secundario; en otros navegadores se mantiene la estrategia anterior.
- La URL firmada de la siguiente pista se prepara con margen de 10 minutos en Android.
- El botón **Siguiente** de Media Session usa primero la pista preparada: no descarta la URL ni hace un fetch si ya está lista.
- Se añadieron handlers `seekbackward`, `seekforward` y `seekto` para mantener una Media Session más completa en Android.
- Se añadió un watchdog de background que revalida la posición real cerca del final de la canción.
- Se añadió fallback por `pause/ended` para dispositivos donde el orden de eventos multimedia cambia al estar la pantalla bloqueada.
- En una transición preparada Android hace `audio.load()` y `audio.play()` inmediatamente antes de cualquier render pesado.
- Las actualizaciones de cola/UI se difieren si la aplicación está oculta.
- Se mantiene el camino `ended` original y la corrección Safari v3.5.2 como fallback.
- Service Worker y referencias del shell actualizados a v3.5.3 / `v18-android-bg`.

## Importante

Esta sigue siendo una PWA. Android/Chrome decide cuándo congelar completamente una aplicación web. Los cambios reducen al mínimo el trabajo necesario en el cambio de canción y aprovechan la Media Session y la pista precargada, pero una PWA no puede ofrecer la misma garantía de background que un servicio Android nativo con ExoPlayer.

## Prueba recomendada

1. Instalar/actualizar GMusic.
2. Reproducir una canción de la biblioteca.
3. Ir al Home y bloquear la pantalla.
4. Esperar a que termine.
5. Verificar que comienza la siguiente sin abrir GMusic.
6. Desde la notificación/pantalla bloqueada pulsar Siguiente varias veces.
7. Verificar que no se abre GMusic solo por usar el control multimedia.
8. Repetir con una playlist/álbum y con cola manual.
