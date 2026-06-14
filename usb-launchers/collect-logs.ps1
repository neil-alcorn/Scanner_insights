param(
  [string]$OutputRoot = "",
  [string]$InstallRoot = ""
)

$ErrorActionPreference = "Continue"

if (-not $OutputRoot) {
  $bundleRoot = Split-Path -Parent $PSScriptRoot
  $OutputRoot = Join-Path $bundleRoot "diagnostics"
}

if (-not $InstallRoot) {
  if ($env:SCANNER_INSIGHTS_INSTALL_ROOT) {
    $InstallRoot = $env:SCANNER_INSIGHTS_INSTALL_ROOT
  } else {
    $InstallRoot = Join-Path $env:LOCALAPPDATA "ScannerInsights"
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeComputer = ($env:COMPUTERNAME -replace '[^A-Za-z0-9_-]', '_')
$target = Join-Path $OutputRoot "$safeComputer-$stamp"
New-Item -ItemType Directory -Force -Path $target | Out-Null

function Write-Text {
  param(
    [string]$Name,
    [string[]]$Lines
  )
  Set-Content -Path (Join-Path $target $Name) -Value $Lines -Encoding ASCII
}

Write-Text "environment.txt" @(
  "ComputerName=$env:COMPUTERNAME",
  "UserName=$env:USERNAME",
  "Date=$(Get-Date -Format o)",
  "InstallRoot=$InstallRoot",
  "Path=$env:PATH"
)

try {
  Write-Text "node.txt" @(
    "node path=$((Get-Command node.exe -ErrorAction SilentlyContinue).Source)",
    "node version=$(& node --version 2>&1)",
    "npm version=$(& npm --version 2>&1)"
  )
} catch {
  Write-Text "node.txt" @("Node check failed: $($_.Exception.Message)")
}

try {
  Get-Process node,ScannerKeyHook,powershell,cmd -ErrorAction SilentlyContinue |
    Select-Object Id,ProcessName,StartTime,Path |
    Format-List |
    Out-File -FilePath (Join-Path $target "processes.txt") -Encoding ASCII
} catch {}

try {
  Get-NetTCPConnection -LocalPort 4312,4313,4314,4315,4316,4317,4318,4319,4320 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,State,OwningProcess |
    Format-List |
    Out-File -FilePath (Join-Path $target "ports.txt") -Encoding ASCII
} catch {}

if (Test-Path $InstallRoot) {
  Copy-Item -Path (Join-Path $InstallRoot "run") -Destination (Join-Path $target "install-run") -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -Path (Join-Path $InstallRoot "app\run") -Destination (Join-Path $target "app-run") -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -Path (Join-Path $InstallRoot "app\package.json") -Destination $target -Force -ErrorAction SilentlyContinue
  Copy-Item -Path (Join-Path $InstallRoot "app\server.mjs") -Destination (Join-Path $target "server.mjs.txt") -Force -ErrorAction SilentlyContinue
}

try {
  $helperPath = Join-Path $InstallRoot "app\bin\ScannerKeyHook.exe"
  Write-Text "files.txt" @(
    "InstallRoot exists=$(Test-Path $InstallRoot)",
    "App exists=$(Test-Path (Join-Path $InstallRoot 'app'))",
    "Server exists=$(Test-Path (Join-Path $InstallRoot 'app\server.mjs'))",
    "KeyHook exists=$(Test-Path $helperPath)"
  )
} catch {}

Write-Host "Scanner Insights diagnostics copied to:"
Write-Host $target
