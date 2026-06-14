param(
  [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallRoot) {
  if ($env:SCANNER_INSIGHTS_INSTALL_ROOT) {
    $InstallRoot = $env:SCANNER_INSIGHTS_INSTALL_ROOT
  } else {
    $InstallRoot = Join-Path $env:LOCALAPPDATA "ScannerInsights"
  }
}

$desktop = [Environment]::GetFolderPath("Desktop")
$publicDesktop = Join-Path $env:PUBLIC "Desktop"
$startVbs = Join-Path $InstallRoot "Start-Scanner-Insights.vbs"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
$icon = Join-Path $InstallRoot "app\public\scanner-insights.ico"

function New-ScannerShortcut {
  param([string]$ShortcutPath)

  $folder = Split-Path -Parent $ShortcutPath
  if (-not (Test-Path $folder)) {
    return $false
  }

  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $wscript
  $shortcut.Arguments = "`"$startVbs`""
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.IconLocation = $icon
  $shortcut.Description = "Start Scanner Insights"
  $shortcut.Save()
  return $true
}

$created = @()
if (New-ScannerShortcut -ShortcutPath (Join-Path $desktop "Scanner Insights.lnk")) {
  $created += (Join-Path $desktop "Scanner Insights.lnk")
}

try {
  if ($publicDesktop -and (Test-Path $publicDesktop)) {
    if (New-ScannerShortcut -ShortcutPath (Join-Path $publicDesktop "Scanner Insights.lnk")) {
      $created += (Join-Path $publicDesktop "Scanner Insights.lnk")
    }
  }
} catch {
}

if (-not $created.Count) {
  throw "Unable to create a desktop shortcut. InstallRoot=$InstallRoot"
}

Write-Host "Created Scanner Insights shortcut:"
$created | ForEach-Object { Write-Host $_ }
