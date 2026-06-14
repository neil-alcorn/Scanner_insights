param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot "..\dist")
)

$ErrorActionPreference = "Stop"

$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bundleBuilder = Join-Path $PSScriptRoot "build-usb-bundle.ps1"
$bundleRoot = Join-Path $OutputRoot "scanner-insights-usb"
$workRoot = Join-Path $OutputRoot "installer-build"
$payloadZip = Join-Path $workRoot "payload.zip"
$bootstrapPs1 = Join-Path $workRoot "bootstrap-install.ps1"
$bootstrapCmd = Join-Path $workRoot "bootstrap-install.cmd"
$sedPath = Join-Path $workRoot "scanner-insights-installer.sed"
$targetExe = Join-Path $OutputRoot "ScannerInsights-Installer.exe"

if (-not (Test-Path $OutputRoot)) {
  New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bundleBuilder -OutputRoot $OutputRoot

if (Test-Path $workRoot) {
  Remove-Item $workRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null

Compress-Archive -Path (Join-Path $bundleRoot "*") -DestinationPath $payloadZip -Force

$bootstrapPs1Content = @'
$ErrorActionPreference = "Stop"

$sourceZip = Join-Path $PSScriptRoot "payload.zip"
$extractRoot = Join-Path $env:TEMP ("ScannerInsightsInstaller-" + [guid]::NewGuid().ToString("N"))

try {
  Expand-Archive -Path $sourceZip -DestinationPath $extractRoot -Force
  $installer = Join-Path $extractRoot "launchers\Install-Local.bat"
  Start-Process -FilePath $installer -WorkingDirectory (Split-Path $installer -Parent) -Wait
} finally {
  if (Test-Path $extractRoot) {
    Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
'@

$bootstrapCmdContent = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-install.ps1"
'@

$sedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$targetExe
FriendlyName=Scanner Insights Installer
AppLaunched=bootstrap-install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$workRoot
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
[Strings]
FILE0=payload.zip
FILE1=bootstrap-install.ps1
FILE2=bootstrap-install.cmd
"@

Set-Content -Path $bootstrapPs1 -Value $bootstrapPs1Content -Encoding ASCII
Set-Content -Path $bootstrapCmd -Value $bootstrapCmdContent -Encoding ASCII
Set-Content -Path $sedPath -Value $sedContent -Encoding ASCII

if (Test-Path $targetExe) {
  Remove-Item $targetExe -Force
}

Start-Process -FilePath "iexpress.exe" -ArgumentList "/N", $sedPath -Wait -NoNewWindow

Write-Host "Installer EXE created at $targetExe"
