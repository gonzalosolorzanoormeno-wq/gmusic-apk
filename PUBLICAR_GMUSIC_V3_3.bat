@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo   GMUSIC v3.3 - METADATA + OFFLINE FAVORITOS 2.0
echo ==============================================
echo.
echo Esta publicacion NO borra musica, KV, usuarios,
echo favoritos, playlists, descargas offline ni secretos.
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
echo Publicando GMusic v3.3...
call npm.cmd run deploy
if errorlevel 1 goto :error
echo.
echo ==============================================
echo          LISTO - GMUSIC v3.3 PUBLICADO
echo ==============================================
echo.
echo Prueba recomendada:
echo 1. Administracion ^> Completar metadata con Internet.
echo 2. Pulsa Analizar biblioteca y revisa propuestas.
echo 3. En Favoritos abre Centro offline y descarga favoritos.
echo 4. Activa modo avion y comprueba reproduccion offline.
echo.
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=3.3.0"
pause
exit /b 0
:error
echo.
echo Hubo un error. No se borro tu biblioteca.
pause
exit /b 1
