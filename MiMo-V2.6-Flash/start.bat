@echo off
rem NoldOJ one-click startup (Windows)
setlocal
cd /d "%~dp0"

echo ==============================================
echo   NoldOJ Startup
echo ==============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found. Please install Node.js >= 24 from https://nodejs.org
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -e "console.log(process.versions.node)"') do set NODEVER=%%v
echo [info] Node.js version: %NODEVER%

if not exist node_modules (
  echo [info] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [error] npm install failed
    pause
    exit /b 1
  )
)

if not exist tmp mkdir tmp
if not exist backend\data mkdir backend\data

echo [info] Starting NoldOJ on http://127.0.0.1:3000
echo [info] Default admin: admin / admin123 - change it after first login!
start "" http://127.0.0.1:3000
node backend\server.js

pause
