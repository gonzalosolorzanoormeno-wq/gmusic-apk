@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo   GMusic v4.0 - Android Native Playback Web
echo ================================================
echo.
echo Ejecutando pruebas de regresion...
call npm run check
if errorlevel 1 (
  echo.
  echo ERROR: Las pruebas fallaron. No se publicara.
  pause
  exit /b 1
)
echo.
echo Publicando frontend/backend v4.0 en Cloudflare...
call npx wrangler deploy
if errorlevel 1 (
  echo.
  echo ERROR durante el deploy.
  pause
  exit /b 1
)
echo.
echo Publicacion terminada: GMusic v4.0.
echo Ahora compila/instala el APK nativo desde GitHub Actions.
pause
