@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo   GMUSIC v3.4.2 - ARTIST ARTWORK RESILIENCE
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
echo Publicando GMusic v3.4.2...
call npm.cmd run deploy
if errorlevel 1 goto :error
echo.
echo ==============================================
echo          LISTO - GMUSIC v3.4.2 PUBLICADO
echo ==============================================
echo.
echo Si usaras Spotify, configura antes SPOTIFY_CLIENT_ID y
 echo SPOTIFY_CLIENT_SECRET como secretos de Cloudflare y registra:
echo https://gmusic-player.gmusic-cloud-25.workers.dev/api/spotify/callback
echo como Redirect URI en tu app de Spotify.
echo.
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=3.4.2"
pause
exit /b 0
:error
echo.
echo Hubo un error. No se borro tu biblioteca.
pause
exit /b 1
