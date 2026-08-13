@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo       GMUSIC v3.0 - ACTUALIZACION SEGURA
echo ==========================================
echo.
echo Esta publicacion NO borra musica de Google Drive,
echo NO borra USERDATA KV y NO cambia tus secretos.
echo.
if not exist node_modules (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 goto :error
)
echo Revisando codigo y pruebas de seguridad...
call npm.cmd run check
if errorlevel 1 goto :error
echo.
echo Publicando sobre el mismo Worker gmusic-player...
call npm.cmd run deploy
if errorlevel 1 goto :error
echo.
echo ==========================================
echo        LISTO - GMUSIC v3.0 PUBLICADO
echo ==========================================
echo.
echo IMPORTANTE: v3 usa sesion HttpOnly mas segura.
echo Puede pedirte iniciar sesion una vez nuevamente.
echo Tus canciones y datos permanecen intactos.
echo.
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=3.0.0"
pause
exit /b 0
:error
echo.
echo Hubo un error. Revisa el mensaje anterior.
echo No se borro la biblioteca por este script.
pause
exit /b 1
