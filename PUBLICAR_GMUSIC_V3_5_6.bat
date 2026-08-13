@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo   GMusic v3.5.6 - Legacy Auto-Advance Restore
echo ================================================
echo.
echo Ejecutando pruebas...
call npm run check
if errorlevel 1 (
  echo.
  echo ERROR: Las pruebas fallaron. No se publicara.
  pause
  exit /b 1
)
echo.
echo Publicando en Cloudflare...
call npx wrangler deploy
if errorlevel 1 (
  echo.
  echo ERROR durante el deploy.
  pause
  exit /b 1
)
echo.
echo Publicacion terminada: GMusic v3.5.6.
pause
