@echo off
setlocal
cd /d "%~dp0"
title GMusic v2 - Publicador

echo ==========================================
echo        GMUSIC V2 - ACTUALIZACION
echo ==========================================
echo.
echo Esta actualizacion NO borra tu musica de Google Drive.
echo Tampoco cambia APP_TOKEN ni secretos de Google.
echo.
where node >nul 2>nul || (echo ERROR: Node.js no esta instalado.& pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias...
  call npm.cmd install || goto :error
)
echo Revisando GMusic v2...
call npm.cmd run check || goto :error
echo.
echo Publicando sobre el mismo Worker gmusic-player...
call npm.cmd run deploy || goto :error
echo.
echo ==========================================
echo      LISTO - GMUSIC V2 PUBLICADO
echo ==========================================
echo.
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=2.0.0"
echo Puedes cerrar esta ventana.
pause
exit /b 0
:error
echo.
echo Hubo un error. No se modifico tu musica de Google Drive.
pause
exit /b 1
