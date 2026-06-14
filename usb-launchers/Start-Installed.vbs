Set shell = CreateObject("WScript.Shell")
installRoot = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\ScannerInsights"
If shell.ExpandEnvironmentStrings("%SCANNER_INSIGHTS_INSTALL_ROOT%") <> "%SCANNER_INSIGHTS_INSTALL_ROOT%" Then
  installRoot = shell.ExpandEnvironmentStrings("%SCANNER_INSIGHTS_INSTALL_ROOT%")
End If
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & installRoot & "\launcher-start.ps1"" -Mode installed"
shell.Run command, 0, False
