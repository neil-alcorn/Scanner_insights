@echo off
setlocal
if "%SCANNER_INSIGHTS_INSTALL_ROOT%"=="" (
  set TARGET=%LOCALAPPDATA%\ScannerInsights
) else (
set TARGET=%SCANNER_INSIGHTS_INSTALL_ROOT%
)
set SHORTCUT=%USERPROFILE%\Desktop\Scanner Insights.lnk
set STARTUPSHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Scanner Insights Startup.lnk

if exist "%TARGET%\launcher-stop.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET%\launcher-stop.ps1" -Mode installed
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$target=$env:TARGET; $escaped=[regex]::Escape($target); Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('node.exe','cmd.exe','powershell.exe','ScannerKeyHook.exe') -and (($_.CommandLine -and $_.CommandLine -match $escaped) -or ($_.ExecutablePath -and $_.ExecutablePath -match $escaped)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

if exist "%SHORTCUT%" del "%SHORTCUT%"
if exist "%STARTUPSHORTCUT%" del "%STARTUPSHORTCUT%"
if exist "%TARGET%" rmdir /s /q "%TARGET%"

echo Scanner Insights removed from this PC.
endlocal
