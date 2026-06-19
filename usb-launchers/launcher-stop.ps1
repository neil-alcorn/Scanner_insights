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
$installRunRoot = if ($Mode -eq "installed") { Join-Path $installRoot "run" } else { Join-Path $appRoot "run" }
$agentPidFile = Join-Path $installRunRoot "agent.pid"

function Stop-PidFile {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path $Path)) {
    Write-Host "No $Name PID file found."
    return
  }

  $pid = (Get-Content $Path | Select-Object -First 1).Trim()
  if (-not $pid) {
    Remove-Item $Path -Force -ErrorAction SilentlyContinue
    Write-Host "$Name PID file was empty."
    return
  }

  $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $pid -Force
    Write-Host "Stopped $Name process $pid."
  } else {
    Write-Host "$Name process $pid was not running."
  }

  Remove-Item $Path -Force -ErrorAction SilentlyContinue
}

Stop-PidFile -Path $agentPidFile -Name "agent"
Stop-PidFile -Path $pidFile -Name "server"
Remove-Item $portFile -Force -ErrorAction SilentlyContinue
