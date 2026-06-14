@echo off
setlocal
if "%SCANNER_INSIGHTS_INSTALL_ROOT%"=="" (
  set TARGET=%LOCALAPPDATA%\ScannerInsights
) else (
  set TARGET=%SCANNER_INSIGHTS_INSTALL_ROOT%
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET%\launcher-stop.ps1" -Mode installed
endlocal
