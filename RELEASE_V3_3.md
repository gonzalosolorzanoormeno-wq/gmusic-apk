# GMusic v3.3 — Metadata Intelligence + Favoritos Offline 2.0

## Metadata Intelligence
- Integración backend con MusicBrainz para buscar recording/release y proponer metadata.
- Score de confianza basado en título, artista, duración, álbum y año.
- Estados: alta confianza, revisión necesaria y baja confianza.
- Portadas mediante Cover Art Archive, servidas a través del Worker.
- Administración → Biblioteca → Completar metadata con Internet.
- Análisis secuencial de canciones incompletas para respetar el ritmo de MusicBrainz.
- Aplicación individual o masiva solo de coincidencias de alta confianza.
- Backup en KV antes de aplicar cada propuesta.
- MusicBrainz IDs guardados en appProperties sin tocar el archivo de audio.
- Número de pista se intenta resolver al aplicar una propuesta mediante el release de MusicBrainz.
- Metadata Intelligence nunca se ejecuta en el camino crítico de reproducción.

## Favoritos Offline 2.0
- Centro offline por usuario/dispositivo.
- Descargar todos los Favoritos sin redescargar los ya guardados.
- Límite configurable: 500 MB, 1 GB o 2 GB.
- Pausar/cancelar lote entre canciones y reintentar fallidas.
- Estimación de almacenamiento con navigator.storage cuando está disponible.
- Opción “Mantener mis Favoritos disponibles offline”.
- Opción espejo para eliminar la copia offline al quitar un favorito.
- Preferencia “solo Wi‑Fi” únicamente cuando el navegador puede detectar red celular de forma fiable.
- Verificación básica de integridad de descargas.
- Descargas aisladas por offline_scope, sin compartir audio entre cuentas.
- Actualizar el Service Worker no elimina el caché de audio offline.

## Seguridad y datos
- Sin cambios destructivos en Drive o KV.
- Sin regenerar usuarios, códigos ni secretos.
- Rutas de Metadata Intelligence exclusivas de administración.
- Listeners siguen sin ver datos administrativos ni de otros usuarios.

## Tests
`npm run check` cubre autenticación, privacidad, normalización, offline, Media Session, Metadata Intelligence y Favoritos Offline 2.0.

> En el entorno local de pruebas puede aparecer el aviso `Falta configurar GOOGLE_CLIENT_ID` dentro del smoke test de privacidad; ese test simula un entorno sin credenciales reales y continúa correctamente.
