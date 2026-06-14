@echo off
setlocal
set SCRIPT_DIR=%~dp0
set BUNDLE_ROOT=%SCRIPT_DIR%\..
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%installer.ps1" -SourceRoot "%BUNDLE_ROOT%"
endlocal
