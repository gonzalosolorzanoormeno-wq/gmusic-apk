@echo off
setlocal
cd /d "%~dp0"
echo ==================================================
echo   GMusic v3.5.4 - Fix critico: cambio de cancion
echo ==================================================
echo.
echo Ejecutando validaciones...
call npm run check
if errorlevel 1 (
  echo.
  echo ERROR: Los tests fallaron. No se publicara esta version.
  pause
  exit /b 1
)
echo.
echo Publicando Worker y PWA...
call npx wrangler deploy
if errorlevel 1 (
  echo.
  echo ERROR: Wrangler no pudo publicar GMusic.
  pause
  exit /b 1
)
echo.
echo Publicacion terminada: GMusic v3.5.4.
echo IMPORTANTE: YouTube Discovery requiere YOUTUBE_API_KEY como secreto de Cloudflare.
pause
