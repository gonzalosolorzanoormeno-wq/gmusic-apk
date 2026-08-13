@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo       GMUSIC v2.3 - MULTIUSUARIO+
echo ==========================================
echo.
if not exist node_modules (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 goto :error
)
echo Revisando codigo...
call npm.cmd run check
if errorlevel 1 goto :error
echo.
echo Publicando sobre gmusic-player...
call npm.cmd run deploy
if errorlevel 1 goto :error
echo.
echo ==========================================
echo   LISTO - GMUSIC v2.3 PUBLICADO
echo ==========================================
echo.
echo La musica de Google Drive NO se modifica.
echo USER_CODES y secretos existentes se conservan.
echo Abriendo GMusic...
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=2.3.0"
pause
exit /b 0
:error
echo.
echo Hubo un error. No se publico ningun cambio incompleto.
pause
exit /b 1
