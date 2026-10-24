@echo off
setlocal
cd /d "%~dp0"
title NoldOJ Online Judge

echo ==========================================
echo   NoldOJ Online Judge - One Click Startup
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 24+.
  pause
  exit /b 1
)
for /f "tokens=2 delims=v" %%v in ('node -v') do set NODEVERSION=%%v
echo [OK] Node.js v%NODEVERSION%

if not exist "config\config.json" (
  echo [SETUP] First run: generating config.json with random JWT secret...
  copy "config\config.default.json" "config\config.json" >nul
)

if not exist "backend\node_modules" (
  echo [SETUP] Installing backend dependencies...
  pushd backend
  call npm install --no-audit --no-fund
  popd
)

if not exist "backend\node_modules" (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo [START] Launching NoldOJ...
node backend\src\index.js
pause
