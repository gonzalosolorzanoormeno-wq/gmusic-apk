# GMusic v3.2.0 — Privacidad total + Biblioteca limpia

Esta versión parte de GMusic v3.1.1 y mantiene su arquitectura actual. No elimina canciones, usuarios, KV ni secretos.

## Incluido

- Privacidad Fase 1.1 conservada: un listener no recibe roles, IDs de otras cuentas ni pistas de administración.
- Artistas canónicos por clave normalizada: `feid`, `FEID`, `Feid` y variantes de espacios se agrupan como una sola entidad lógica.
- IDs lógicos estables de artista y álbum derivados de claves canónicas, sin cambiar el ID real de las canciones.
- Artistas múltiples: separación conservadora de coma, `&`, `x`, `feat.`, `ft.` y `featuring` cuando aparecen como separadores explícitos.
- Álbumes normalizados por Unicode/case/espacios. Sufijos reales como Deluxe/Remastered/Live no se eliminan, por lo que permanecen separados.
- Limpieza automática de títulos para metadata basura como `Official Video`, `Official Audio`, `Visualizer`, `Video Oficial`, `Lyric Video`, `Lyrics`, `HD`, `HQ`, `4K`, etc.
- Limpieza del patrón `Artista - Título` cuando el artista coincide inequívocamente con la metadata del artista.
- La limpieza se aplica a nuevas subidas y al editor de metadata.
- La biblioteca existente se muestra ya normalizada sin tocar el audio.
- Panel Administración → Biblioteca con diagnóstico de metadata, variantes de artista, vista previa Antes → Después y botón de limpieza segura.
- Antes de una limpieza persistente se crea un respaldo de metadata en KV cuando `USERDATA` está disponible.
- Búsqueda tolerante a mayúsculas, minúsculas, acentos y espacios.
- Tests automáticos de privacidad y normalización.

## Flujo recomendado después del deploy

1. Publica con `PUBLICAR_GMUSIC_V3_2.bat`.
2. Inicia sesión con tu cuenta de gestión.
3. Abre **Administración → Biblioteca**.
4. Revisa `Cambios seguros`, variantes de artistas y la vista previa.
5. Pulsa **Aplicar limpieza segura** solo después de revisar.
6. La operación modifica únicamente `appProperties` de los archivos de Drive; no reemplaza ni mueve el audio.

## Ejemplos

- `FEID`, `Feid`, `feid` → un solo artista lógico.
- `LUNA [Official Audio]` → `LUNA`.
- `CLASSY 101 - Visualizer` → `CLASSY 101`.
- `Feid - LUNA (Official Video)` → `LUNA`.
- `Mora` y `Morad` permanecen separados.

## Rollback

El ZIP anterior v3.1.1 sigue siendo compatible. Si necesitas volver al código anterior, publica ese ZIP. La limpieza persistente de metadata debe revisarse antes de aplicarse; además se guarda una copia previa en KV cuando existe `USERDATA`.
