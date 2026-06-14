param(
  [string]$Mode = "installed"
)

$ErrorActionPreference = "Stop"

if ($Mode -eq "installed") {
  $installRoot = if ($env:SCANNER_INSIGHTS_INSTALL_ROOT) { $env:SCANNER_INSIGHTS_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "ScannerInsights" }
  $appRoot = Join-Path $installRoot "app"
} else {
  $bundleRoot = Split-Path -Parent $PSScriptRoot
  $appRoot = Join-Path $bundleRoot "app"
}

$pidFile = Join-Path (Join-Path $appRoot "run") "server.pid"
$portFile = Join-Path (Join-Path $appRoot "run") "server.port"

if (-not (Test-Path $pidFile)) {
  Write-Host "No PID file found."
  exit 0
}

$pid = (Get-Content $pidFile | Select-Object -First 1).Trim()
if (-not $pid) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "PID file was empty."
  exit 0
}

$process = Get-Process -Id $pid -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $pid -Force
  Write-Host "Stopped process $pid."
} else {
  Write-Host "Process $pid was not running."
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Remove-Item $portFile -Force -ErrorAction SilentlyContinue
