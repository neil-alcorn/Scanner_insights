param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot "..\dist")
)

$ErrorActionPreference = "Stop"

$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-keyhook.ps1")
if (-not (Test-Path $OutputRoot)) {
  New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
}
$bundleRoot = Join-Path (Resolve-Path $OutputRoot).Path "scanner-insights-usb"
$appBundleRoot = Join-Path $bundleRoot "app"
$launchersRoot = Join-Path $bundleRoot "launchers"

if (Test-Path $bundleRoot) {
  Remove-Item $bundleRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $appBundleRoot | Out-Null
New-Item -ItemType Directory -Force -Path $launchersRoot | Out-Null

Copy-Item (Join-Path $appRoot "server.mjs") -Destination $appBundleRoot -Force
Copy-Item (Join-Path $appRoot "package.json") -Destination $appBundleRoot -Force
Copy-Item (Join-Path $appRoot "package-lock.json") -Destination $appBundleRoot -Force
Copy-Item (Join-Path $appRoot "README.md") -Destination $appBundleRoot -Force
Copy-Item (Join-Path $appRoot "public") -Destination $appBundleRoot -Recurse -Force
Copy-Item (Join-Path $appRoot "src") -Destination $appBundleRoot -Recurse -Force
Copy-Item (Join-Path $appRoot "netlify") -Destination $appBundleRoot -Recurse -Force
Copy-Item (Join-Path $appRoot "node_modules") -Destination $appBundleRoot -Recurse -Force
Copy-Item (Join-Path $appRoot "bin") -Destination $appBundleRoot -Recurse -Force

function New-ScannerInsightsIcon {
  param([string]$OutputPath)

  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 256, 256
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  function New-Brush([string]$hex) {
    return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
  }

  function New-Pen([string]$hex, [int]$width) {
    return New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($hex)), $width
  }

  $g.FillRectangle((New-Brush "#005f73"), 0, 0, 256, 256)
  $g.FillRectangle((New-Brush "#0a9396"), 0, 0, 128, 128)
  $g.FillRectangle((New-Brush "#94d2bd"), 128, 0, 128, 128)
  $g.FillRectangle((New-Brush "#ee9b00"), 0, 128, 128, 128)
  $g.FillRectangle((New-Brush "#9b2226"), 128, 128, 128, 128)

  $rect = New-Object System.Drawing.Rectangle 38, 48, 180, 160
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $radius = 24
  $path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
  $path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
  $path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Brush "#fff7e8"), $path)
  $g.DrawPath((New-Pen "#073b4c" 6), $path)

  $x = 66
  foreach ($width in @(8, 4, 12, 5, 7, 4, 14, 6, 5, 11, 4, 8)) {
    $g.FillRectangle((New-Brush "#073b4c"), $x, 82, $width, 92)
    $x += $width + 7
  }

  $g.FillEllipse((New-Brush "#0a9396"), 58, 184, 20, 20)
  $g.FillEllipse((New-Brush "#94d2bd"), 94, 184, 20, 20)
  $g.FillEllipse((New-Brush "#ee9b00"), 130, 184, 20, 20)
  $g.FillEllipse((New-Brush "#9b2226"), 166, 184, 20, 20)

  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $stream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create)
  try {
    $icon.Save($stream)
  } finally {
    $stream.Close()
    $icon.Dispose()
    $g.Dispose()
    $bmp.Dispose()
  }
}

New-ScannerInsightsIcon -OutputPath (Join-Path $appBundleRoot "public\scanner-insights.ico")

$nodeModulesRoot = Join-Path $appBundleRoot "node_modules"

$pathsToRemove = @(
  "node-global-key-listener",
  "node-global-key-listener\bin\MacKeyServer",
  "node-global-key-listener\bin\X11KeyServer",
  "node-global-key-listener\build\test.d.ts",
  "node-global-key-listener\build\test.d.ts.map",
  "node-global-key-listener\build\test.js",
  "node-global-key-listener\build\ts\_tests",
  "node-global-key-listener\build\ts\MacKeyServer.d.ts",
  "node-global-key-listener\build\ts\MacKeyServer.d.ts.map",
  "node-global-key-listener\build\ts\MacKeyServer.js",
  "node-global-key-listener\build\ts\X11KeyServer.d.ts",
  "node-global-key-listener\build\ts\X11KeyServer.d.ts.map",
  "node-global-key-listener\build\ts\X11KeyServer.js",
  "node-global-key-listener\build\ts\_data\MacGlobalKeyLookup.d.ts",
  "node-global-key-listener\build\ts\_data\MacGlobalKeyLookup.d.ts.map",
  "node-global-key-listener\build\ts\_data\MacGlobalKeyLookup.js",
  "node-global-key-listener\build\ts\_data\X11GlobalKeyLookup.d.ts",
  "node-global-key-listener\build\ts\_data\X11GlobalKeyLookup.d.ts.map",
  "node-global-key-listener\build\ts\_data\X11GlobalKeyLookup.js",
  "tar-fs\test"
)

foreach ($relativePath in $pathsToRemove) {
  $fullPath = Join-Path $nodeModulesRoot $relativePath
  if (Test-Path $fullPath) {
    Remove-Item $fullPath -Recurse -Force
  }
}

$launcherFiles = @(
  "Install-Local.bat",
  "Start-Agent.bat",
  "Start-Agent.vbs",
  "Start-Installed.bat",
  "Start-Installed.vbs",
  "Create-Shortcut.bat",
  "create-shortcut.ps1",
  "Stop-Installed.bat",
  "Uninstall-Local.bat",
  "Collect-Logs.bat",
  "collect-logs.ps1",
  "installer.ps1",
  "launcher-start.ps1",
  "launcher-stop.ps1"
)

foreach ($file in $launcherFiles) {
  Copy-Item (Join-Path $PSScriptRoot "..\usb-launchers\$file") -Destination $launchersRoot -Force
}

$readme = @"
Scanner Insights USB Bundle
===========================

Install flow
1. Double-click launchers\Install-Local.bat
2. The installer verifies Node.js and npm
3. The app is copied to LocalAppData with its prebuilt dependencies
4. Existing local scan data is preserved
5. A background scanner agent is started and added to Windows Startup
6. A desktop shortcut is created for the optional local dashboard

Installed shortcuts
- launchers\Start-Agent.bat starts the installed background sync agent.
- launchers\Start-Installed.bat opens the optional local dashboard.
- launchers\Stop-Installed.bat stops the agent and local dashboard.

Cloud sync
- The installed agent posts scans to https://scanner-insights-fslc.netlify.app/.netlify/functions/ingest-scans
- Scans are written locally first, then synced about every 15 seconds while online.
- The web dashboard reads the combined cloud data at https://scanner-insights-fslc.netlify.app

If install/start fails
- Double-click launchers\Collect-Logs.bat
- Bring back the USB diagnostics folder

Default URL
http://localhost:4312
"@

Set-Content -Path (Join-Path $bundleRoot "README.txt") -Value $readme -Encoding ASCII
Write-Host "USB bundle created at $bundleRoot"
