param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot "..\bin")
)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "..\tools\ScannerKeyHook.cs"
if (-not (Test-Path $OutputRoot)) {
  New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
}

$target = Join-Path (Resolve-Path $OutputRoot).Path "ScannerKeyHook.exe"
$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $compiler)) {
  $compiler = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $compiler)) {
  throw "csc.exe was not found."
}

& $compiler /nologo /target:exe /out:$target /reference:System.Windows.Forms.dll /reference:System.Drawing.dll $source
Write-Host "Key hook helper built at $target"
