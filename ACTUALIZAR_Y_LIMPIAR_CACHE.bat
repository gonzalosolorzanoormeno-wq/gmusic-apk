@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   GMUSIC V2 - COLA + LIMPIEZA DE CACHE
echo ================================================
if not exist node_modules call npm.cmd install
call npm.cmd run check
if errorlevel 1 goto error
call npm.cmd run deploy
if errorlevel 1 goto error
echo.
echo Listo. Abriendo la pagina que limpia la version vieja...
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/reset.html"
echo.
echo No se borraron canciones ni secretos.
pause
exit /b 0
:error
echo.
echo Hubo un error. No se modifico tu musica.
pause
exit /b 1
