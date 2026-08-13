@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo   GMUSIC v3.2.2 - MEDIA + FAVORITOS OFFLINE
echo ==============================================
echo.
echo Esta publicacion NO borra musica, KV, usuarios,
echo favoritos, playlists ni secretos.
echo.
if not exist node_modules (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 goto :error
)
echo Ejecutando pruebas...
call npm.cmd run check
if errorlevel 1 goto :error
echo.
echo Publicando GMusic v3.2.2...
call npm.cmd run deploy
if errorlevel 1 goto :error
echo.
echo ==============================================
echo      LISTO - GMUSIC v3.2.2 PUBLICADO
echo ==============================================
echo.
echo Prueba recomendada en iPhone:
echo 1. Abre GMusic y reproduce una cancion.
echo 2. Abre Centro de control/pantalla bloqueada.
echo 3. Comprueba Anterior, Play/Pausa y Siguiente.
echo 4. En Favoritos pulsa Descargar favoritos.
echo.
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=3.2.2"
pause
exit /b 0
:error
echo.
echo Hubo un error. No se borro tu biblioteca.
pause
exit /b 1
