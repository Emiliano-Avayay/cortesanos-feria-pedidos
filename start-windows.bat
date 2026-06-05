@echo off
setlocal
cd /d %~dp0
if not exist .env (
  copy .env.example .env >nul
)
if not exist node_modules (
  npm install
)
npm run build
if errorlevel 1 (
  echo.
  echo ERROR: fallo el build. Revisar mensajes anteriores.
  pause
  exit /b 1
)
npm start
