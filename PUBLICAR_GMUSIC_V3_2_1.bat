@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo   GMUSIC v3.2.1 - OFFLINE + PLAYBACK FIX
echo   PRIVACIDAD + METADATA + OFFLINE REAL
echo ==============================================
echo.
echo Esta publicacion NO borra musica de Google Drive,
echo NO borra USERDATA KV, NO elimina usuarios
echo y NO cambia tus secretos.
echo.
if not exist node_modules (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 goto :error
)
echo Ejecutando todas las pruebas...
call npm.cmd run check
if errorlevel 1 goto :error
echo.
echo Publicando sobre el mismo Worker gmusic-player...
call npm.cmd run deploy
if errorlevel 1 goto :error
echo.
echo ==============================================
echo      LISTO - GMUSIC v3.2.1 PUBLICADO
echo ==============================================
echo.
echo Despues del deploy prueba el modo offline:
echo 1. Abre GMusic con internet.
echo 2. Guarda una cancion offline.
echo 3. Activa modo avion.
echo 4. Cierra y vuelve a abrir la PWA.
echo 5. Reproduce la cancion descargada.
echo.
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=3.2.1"
pause
exit /b 0
:error
echo.
echo Hubo un error. Revisa el mensaje anterior.
echo Este script no borra tu biblioteca.
pause
exit /b 1
