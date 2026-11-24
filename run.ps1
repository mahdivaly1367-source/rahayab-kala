$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverFile = Join-Path $projectRoot 'server.js'
$stdoutLog = Join-Path $projectRoot 'server.log'
$stderrLog = Join-Path $projectRoot 'server-error.log'
$url = 'http://127.0.0.1:4173'

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host 'Node.js was not found. Install Node.js 18 or newer.' -ForegroundColor Red
    exit 1
}

$listener = $null
try {
    $listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction Stop | Select-Object -First 1
} catch {
    $listener = $null
}

if (-not $listener) {
    Write-Host 'Starting Rahayab Kala...' -ForegroundColor Cyan
    Start-Process -FilePath $nodeCommand.Source -ArgumentList @('"' + $serverFile + '"') -WorkingDirectory $projectRoot -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    Start-Sleep -Seconds 2
}

try {
    $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 5
    if (-not $health.ok) {
        throw 'The local server is not healthy.'
    }
    Write-Host "Rahayab Kala is running: $url" -ForegroundColor Green
    Write-Host "Node version: $($health.node)"
    Start-Process $url
} catch {
    Write-Host 'The server did not respond. Check server.log and server-error.log.' -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}
