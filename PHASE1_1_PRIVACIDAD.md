# GMusic v3.1.1 — Privacidad Fase 1.1

Actualización enfocada exclusivamente en reducir rastros visibles de la arquitectura multiusuario para cuentas normales, sin migrar ni borrar datos.

## Cambios aplicados

- `/api/session` ya no devuelve `role` ni `sub` a cuentas normales.
- Las cuentas normales tampoco reciben `capabilities`; solo una sesión con permisos de gestión recibe capacidades necesarias para construir su interfaz.
- El login ya no devuelve `role` ni `sub`.
- Las rutas reservadas responden `404 {"error":"Ruta no disponible."}` a cuentas sin permisos, evitando mensajes que revelen una jerarquía administrativa.
- `/api/diagnostics` usa el mismo control opaco.
- El botón Diagnóstico dejó de existir en el HTML estático y se crea únicamente cuando la sesión tiene capacidades de gestión.
- Los elementos marcados `data-admin-only` se retiran del DOM para sesiones normales y se reinsertan únicamente en una sesión con permisos de gestión.
- El frontend dejó de depender de `state.role`; utiliza una capacidad booleana derivada de la sesión.
- Se mantuvo intacto el aislamiento existente de perfil, favoritos, playlists, historial, cola, estadísticas y reproducción.
- No se modificaron canciones, Google Drive, claves KV, usuarios, códigos ni secretos.

## Endpoints afectados

- `GET /api/session`
- `POST /api/session`
- `GET /api/diagnostics`
- Todas las rutas que usan `requireAdmin`, entre ellas usuarios, estado, backup, papelera y mutaciones globales de biblioteca.

## Compatibilidad

La estructura persistida en Google Drive y Cloudflare KV no cambia. No existe migración de datos para esta versión.

## Pruebas

`npm run check` ejecuta:

1. validación sintáctica de Worker, frontend y Service Worker;
2. `tests/auth-smoke.mjs`;
3. `tests/privacy-smoke.mjs`;
4. `tests/privacy-phase11.mjs`.

La prueba Fase 1.1 comprueba específicamente que una sesión normal no recibe roles/IDs internos, que las rutas de gestión parecen inexistentes y que Diagnóstico no está presente en el HTML estático.

## Rollback

No hay migraciones. Para volver atrás basta con desplegar nuevamente el ZIP/proyecto v3.1 anterior. Los datos persistentes no necesitan restauración.
