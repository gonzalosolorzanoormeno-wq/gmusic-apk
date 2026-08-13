# Fase 1 de tu especificación completa — Privacidad total (v3.0 → v3.1.0)

Tu pedido tiene 36 secciones. Es demasiado para hacerlo bien en una sola pasada sin
arriesgar bugs, así que lo estoy dividiendo en fases. Esta primera fase cubrió las
secciones más críticas: **1 (privacidad total), 2 (aislamiento de datos), 3 (roles),
24 (límite de usuarios), 27 (sesiones) y 32 (pruebas de privacidad obligatorias)**.

## Arquitectura encontrada (resumen)
Igual que en tu v3.0: Worker de Cloudflare + Assets estáticos, audio y metadata en
Google Drive, datos privados por usuario en KV (`USERDATA`), sesión por cookie
`HttpOnly`. Nada de esto cambió de raíz — se reforzó sobre lo mismo.

## Verificado (ya cumplía la spec, sin cambios necesarios)
- Ningún endpoint de datos privados (favoritos, perfil, historial, playlists, cola,
  progreso de reproducción) acepta un ID de usuario desde el cliente: todos operan
  sobre el `sub` que viene del token de sesión firmado. Es decir, no existe forma de
  que el frontend pida "los datos del usuario X" — estructuralmente no hay ese
  parámetro en ningún lado. Esto ya cumplía el punto 2 antes de tocar nada.
- La metadata de canciones que reciben los listeners (`fileToTrack`) nunca incluyó
  `uploadedBy`, `adminName`, `ownerName` ni similares.
- `/api/admin/*`, `/api/trash`, `/api/diagnostics` ya exigían rol admin en backend
  (no solo ocultos en la interfaz).

## Bug real encontrado y corregido
**Manejo de errores incompleto en el router.** Varias rutas hacían
`return funciónAsíncrona(...)` sin `await` dentro del bloque `try`. En JavaScript,
si esa función falla *después* de que el `return` ya se ejecutó, el error se
escapa del `catch` central y termina como una falla sin manejar en vez de una
respuesta JSON prolija con código de error. En producción esto se traduce en un
error genérico feo de Cloudflare en vez del mensaje claro que ya tenías diseñado.
Corregido en todas las rutas del router (favoritos, datos de usuario, biblioteca,
papelera, panel admin, streaming).

## Implementado en esta fase
- **Límite máximo de usuarios (`MAX_USERS`, sección 24).** Por defecto 10,
  configurable con la variable de entorno `MAX_USERS` en Cloudflare. Si lo superas,
  el backend rechaza la creación con un error claro; el panel admin ahora muestra
  "Usuarios: X / 10".
- **Pruebas de privacidad obligatorias (sección 32)**, nuevas, en
  `tests/privacy-smoke.mjs`. Crean dos listeners (A y B) reales y verifican, contra
  el backend de verdad (no simulado en el frontend):
  - A no puede leer el perfil, playlists ni favoritos de B.
  - Un intento de A de escribir usando el `sub` de B en el body es ignorado (el
    backend siempre usa el `sub` de la sesión, nunca el del body).
  - A no puede listar usuarios, ver el panel admin, el estado del sistema ni el
    backup (403 en los cuatro).
  - A no puede subir ni borrar canciones (403).
  - La sesión de A nunca contiene nada sobre el admin ni sobre otros usuarios.
  - La biblioteca de canciones nunca expone quién subió cada una.
  - Regenerar el código de A invalida su sesión vieja **sin afectar a B**.
  Ahora `npm run check` (y por lo tanto todos los `.bat` de publicar) corren esta
  prueba automáticamente antes de cada deploy — si algún cambio futuro rompe el
  aislamiento entre usuarios, el script de publicar falla y no deja subir el bug.

## No tocado en esta fase (queda para las siguientes)
Todo lo de normalización de artistas/álbumes (secciones 4–9, 14–16), limpieza de
títulos (10–12), portadas por confianza (13), discografías (9), smart playlists y
recomendaciones (21–22), notificaciones (23), gestión de sesiones por dispositivo
visible al propio usuario (27, la parte de "ver tus dispositivos"), y batería /
buffer más agresivos (28–30). Son bloques grandes e independientes — te propongo
seguir con **normalización de artistas + limpieza de títulos** en la próxima
pasada, ya que es lo que más se nota en tu biblioteca actual.

## Cómo desplegar esto
Igual que siempre: `PUBLICAR_GMUSIC_V3_1.bat`. No borra nada de Drive ni de KV,
no cambia ningún secreto existente. Como agrega una prueba nueva al `check`,
si por lo que sea la prueba fallara, el script se detiene ANTES de publicar
(no deja subir un cambio que rompa el aislamiento).

## Rollback
Igual que con v3.0: puedes volver a publicar el zip anterior en cualquier momento.
Esta versión no migra ni transforma datos existentes.
