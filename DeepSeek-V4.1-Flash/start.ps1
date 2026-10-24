<#
  NoldOJ one-click startup script (Windows PowerShell 5.1+)
  - Verifies Node.js >= 24
  - Migrates directory structure on first start
  - Generates config/config.json + JWT secret if missing
  - Initializes the SQLite database
  - Starts the backend server
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Migrate
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

function Info($m) { Write-Host "[NoldOJ] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[NoldOJ] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[NoldOJ] $m" -ForegroundColor Red; exit 1 }

# --- Node.js check ---------------------------------------------------------
try {
  $nodeVersion = (& node --version).TrimStart('v')
} catch {
  Fail "Node.js not found. Please install Node.js >= 24 from https://nodejs.org"
}
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 24) { Fail "Node.js >= 24 required (found $nodeVersion)." }
Info "Node.js $nodeVersion detected."

# --- Directory migration ---------------------------------------------------
$dirs = @('data', 'uploads', 'testdata', 'sandbox-work', 'logs', 'config', 'config/ai')
foreach ($d in $dirs) {
  $p = Join-Path $Root $d
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
Info "Directory structure ready."

# --- Config generation -----------------------------------------------------
$configPath = Join-Path $Root 'config/config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  Copy-Item -LiteralPath (Join-Path $Root 'config/config.example.json') -Destination $configPath
  $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
  $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
  $raw = $raw -replace '"jwtSecret":\s*""', ('"jwtSecret": "' + $secret + '"')
  [System.IO.File]::WriteAllText($configPath, $raw, (New-Object System.Text.UTF8Encoding($false)))
  Info "Generated config/config.json with a fresh JWT secret."
} else {
  Info "Using existing config/config.json."
}

# --- Dependency install ----------------------------------------------------
if ($Install -or -not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
  if (Test-Path -LiteralPath (Join-Path $Root 'package.json')) {
    Info "Installing dependencies (optional dev tooling)..."
    & npm install --no-audit --no-fund
  }
}

# --- Uninstall -------------------------------------------------------------
if ($Uninstall) {
  Warn "Uninstalling removes node_modules and sandbox-work only. Data is preserved."
  foreach ($d in @('node_modules', 'sandbox-work')) {
    $p = Join-Path $Root $d
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
  }
  Info "Uninstall complete."
  exit 0
}

# --- Database init / migrate ----------------------------------------------
if ($Migrate) { & node backend/scripts/migrate.js; exit $LASTEXITCODE }

Info "Starting NoldOJ..."
& node backend/server.js
