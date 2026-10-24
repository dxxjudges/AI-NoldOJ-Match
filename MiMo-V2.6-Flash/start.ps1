# NoldOJ one-click startup (PowerShell)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  NoldOJ Startup"
Write-Host "==============================================" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[error] Node.js not found. Install Node.js >= 24" -ForegroundColor Red
  exit 1
}

Write-Host "[info] Node.js $(& node -e 'console.log(process.versions.node)')"

if (-not (Test-Path node_modules)) {
  Write-Host "[info] Installing dependencies..."
  npm install
}

New-Item -ItemType Directory -Force -Path tmp, backend/data | Out-Null

Write-Host "[info] Starting NoldOJ on http://127.0.0.1:3000" -ForegroundColor Green
Write-Host "[info] Default admin: admin / admin123 - change it after first login!" -ForegroundColor Yellow
Start-Process "http://127.0.0.1:3000"
node backend/server.js
