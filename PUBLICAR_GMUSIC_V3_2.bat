@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo   GMUSIC v3.2 - BIBLIOTECA LIMPIA
 echo   PRIVACIDAD TOTAL + METADATA CANONICA
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
echo Ejecutando pruebas de codigo, privacidad y metadata...
call npm.cmd run check
if errorlevel 1 goto :error
echo.
echo Publicando sobre el mismo Worker gmusic-player...
call npm.cmd run deploy
if errorlevel 1 goto :error
echo.
echo ==========================================
echo      LISTO - GMUSIC v3.2 PUBLICADO
echo ==========================================
echo.
echo IMPORTANTE: entra a Administracion ^> Biblioteca
echo para revisar la vista previa antes de aplicar
echo la limpieza persistente de metadata existente.
echo.
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=3.2.0"
pause
exit /b 0
:error
echo.
echo Hubo un error. Revisa el mensaje anterior.
echo No se borro la biblioteca por este script.
pause
exit /b 1
