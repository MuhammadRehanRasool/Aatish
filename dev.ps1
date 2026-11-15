<#
.SYNOPSIS
  Start the Aatish API (FastAPI, :8000) and web app (Next.js, :3000) together.

.DESCRIPTION
  Run from anywhere:  .\dev.ps1   (or double-click / run dev.cmd)
  - Loads FIRMS_MAP_KEY etc. from the repo-root .env into the API process (values are never printed).
  - Installs web dependencies with pnpm if web/node_modules is missing.
  - If a port is already serving, that server is reused instead of started twice.
  - Ctrl+C stops both servers (whole process trees).

.PARAMETER Open
  Open http://localhost:3000/explore in the default browser once both servers answer.

.PARAMETER Reload
  Run the API with uvicorn --reload (restarts on Python changes).

.PARAMETER ApiPort
  API port (default 8000). The web app is pointed at it via NEXT_PUBLIC_API_URL.

.PARAMETER WebPort
  Web port (default 3000).
#>
param(
  [switch]$Open,
  [switch]$Reload,
  [int]$ApiPort = 8000,
  [int]$WebPort = 3000
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$web = Join-Path $root 'web'

function Say($msg, $color = 'Gray') { Write-Host "[dev] $msg" -ForegroundColor $color }

function Test-Port([int]$port) {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Http([string]$url, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -lt 500) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Stop-Tree($proc) {
  if ($proc -and -not $proc.HasExited) {
    & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
  }
}

# ---------------------------------------------------------------- preflight
if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw "The Python launcher 'py' is not on PATH (needs Python 3.14 with api/requirements.txt installed)." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not on PATH." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw "pnpm is not on PATH (npm i -g pnpm)." }
if (-not (Test-Path (Join-Path $root 'data\harmonized_points.parquet'))) {
  throw "data\harmonized_points.parquet is missing. Build it first: py -3.14 -E -P pipeline/build_harmonized.py"
}

# .env -> environment of this session (inherited by the API). Values are not echoed.
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $val = $Matches[2].Trim('"').Trim("'")
      [Environment]::SetEnvironmentVariable($Matches[1], $val, 'Process')
    }
  }
  if ($env:AI_STUDIO) { Say 'AI_STUDIO loaded from .env (Ask anything enabled)' } else { Say '.env has no AI_STUDIO; the Ask anything assistant will report it as not configured' 'Yellow' }
  if ($env:FIRMS_MAP_KEY) { Say 'FIRMS_MAP_KEY loaded from .env (live NRT lookups enabled)' } else { Say '.env has no FIRMS_MAP_KEY; the live NRT panel will report it as not configured' 'Yellow' }
} else {
  Say 'no .env found; the live NRT panel will report FIRMS as not configured' 'Yellow'
}

$env:NEXT_PUBLIC_API_URL = "http://localhost:$ApiPort"

if (-not (Test-Path (Join-Path $web 'node_modules'))) {
  Say 'installing web dependencies (pnpm install)...' 'Cyan'
  Push-Location $web
  try { & pnpm install; if ($LASTEXITCODE) { throw 'pnpm install failed' } } finally { Pop-Location }
}

# ---------------------------------------------------------------- launch
$api = $null; $webProc = $null
try {
  if (Test-Port $ApiPort) {
    Say "port $ApiPort is already in use; reusing the server there (not started by this script)" 'Yellow'
  } else {
    $apiArgs = @('-3.14', '-E', '-P', '-m', 'uvicorn', 'api.main:app', '--port', "$ApiPort")
    if ($Reload) { $apiArgs += @('--reload', '--reload-dir', 'api') }
    Say "API  -> http://localhost:$ApiPort  (docs: /docs)" 'Green'
    $api = Start-Process py -ArgumentList $apiArgs -WorkingDirectory $root -NoNewWindow -PassThru
  }

  if (Test-Port $WebPort) {
    Say "port $WebPort is already in use; reusing the server there (not started by this script)" 'Yellow'
  } else {
    Say "Web  -> http://localhost:$WebPort" 'Green'
    $webProc = Start-Process cmd.exe -ArgumentList '/c', 'pnpm', 'dev', '--port', "$WebPort" -WorkingDirectory $web -NoNewWindow -PassThru
  }

  if (-not $api -and -not $webProc) { Say 'both servers were already running; nothing to do.' 'Yellow'; return }

  $apiOk = Wait-Http "http://localhost:$ApiPort/api/health" 90
  $webOk = Wait-Http "http://localhost:$WebPort/" 120
  if ($apiOk) { Say 'API is up' 'Green' } else { Say 'API did not answer /api/health within 90 s (see its output above)' 'Red' }
  if ($webOk) { Say 'Web is up' 'Green' } else { Say 'Web did not answer within 120 s (see its output above)' 'Red' }
  if ($Open -and $webOk) { Start-Process "http://localhost:$WebPort/explore" }
  Say 'Ctrl+C stops both.' 'Cyan'

  while ($true) {
    if ($api -and $api.HasExited) { Say "API exited (code $($api.ExitCode)); stopping." 'Red'; break }
    if ($webProc -and $webProc.HasExited) { Say "Web exited (code $($webProc.ExitCode)); stopping." 'Red'; break }
    Start-Sleep -Milliseconds 500
  }
} finally {
  Say 'shutting down...'
  Stop-Tree $webProc
  Stop-Tree $api
}
