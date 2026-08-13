@echo off
setlocal
cd /d "%~dp0"
title GMusic FINAL - Publicar

echo.
echo ========================================
echo        GMUSIC FINAL v1.0.0
echo ========================================
echo.
echo Este proceso NO te pedira de nuevo los secretos
 echo si ya estan guardados en el Worker gmusic-player.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

if not exist "node_modules\wrangler" (
  echo [1/3] Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 goto :error
) else (
  echo [1/3] Dependencias ya instaladas.
)

echo.
echo [2/3] Verificando GMusic...
call npm.cmd run check
if errorlevel 1 goto :error

echo.
echo [3/3] Publicando version FINAL...
call npm.cmd run deploy
if errorlevel 1 goto :error

echo.
echo ========================================
echo   LISTO - GMUSIC FINAL PUBLICADO
echo ========================================
echo.
echo Abriendo GMusic...
start "" "https://gmusic-player.gmusic-cloud-25.workers.dev/?v=1.0.0"
echo.
echo Puedes cerrar esta ventana.
pause
exit /b 0

:error
echo.
echo Hubo un error. No se modificaron tus secretos.
echo Copia el texto rojo de esta ventana y enviamelo.
pause
exit /b 1
