param(
  [string]$SourceRoot = "",
  [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $SourceRoot) {
  $SourceRoot = Split-Path -Parent $PSScriptRoot
}

if (-not $InstallRoot) {
  if ($env:SCANNER_INSIGHTS_INSTALL_ROOT) {
    $InstallRoot = $env:SCANNER_INSIGHTS_INSTALL_ROOT
  } else {
    $InstallRoot = Join-Path $env:LOCALAPPDATA "ScannerInsights"
  }
}

$appSource = Join-Path $SourceRoot "app"
$launchersSource = Join-Path $SourceRoot "launchers"
$appTarget = Join-Path $InstallRoot "app"
$dataTarget = Join-Path $InstallRoot "data"
$configTarget = Join-Path $InstallRoot "config"
$runRoot = Join-Path $InstallRoot "run"
$logPath = Join-Path $runRoot "install.log"
$diagnosticsRoot = Join-Path $SourceRoot "diagnostics"
$dataBackup = Join-Path $env:TEMP ("ScannerInsightsDataBackup-{0}" -f ([guid]::NewGuid().ToString("N")))
$cloudEndpoint = "https://scanner-insights-fslc.netlify.app/.netlify/functions/ingest-scans"

New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
New-Item -ItemType Directory -Force -Path $diagnosticsRoot | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logPath -Value $line -Encoding ASCII
  Write-Host $Message
}

function Find-CommandPath {
  param([string]$Name)
  try {
    return (Get-Command $Name -ErrorAction Stop).Source
  } catch {
    return $null
  }
}

function Fail-Install {
  param([string]$Message)
  Write-Log "ERROR: $Message"
  & (Join-Path $launchersSource "collect-logs.ps1") -OutputRoot $diagnosticsRoot -InstallRoot $InstallRoot | Out-Null
  [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null
  [System.Windows.Forms.MessageBox]::Show($Message, "Scanner Insights Installer") | Out-Null
  exit 1
}

function Ensure-NodeRuntime {
  $nodePath = Find-CommandPath "node.exe"

  if (-not $nodePath) {
    $message = "Node.js LTS is required before Scanner Insights can be installed.`n`nPlease install Node.js LTS, then run this installer again."
    Write-Log "Node.js was not found on this machine."
    $openSite = $host.UI.PromptForChoice(
      "Node.js Required",
      "$message`n`nOpen the Node.js download page now?",
      [System.Collections.ObjectModel.Collection[System.Management.Automation.Host.ChoiceDescription]]@(
        (New-Object System.Management.Automation.Host.ChoiceDescription "&Open Download Page"),
        (New-Object System.Management.Automation.Host.ChoiceDescription "&Cancel")
      ),
      0
    )

    if ($openSite -eq 0) {
      Start-Process "https://nodejs.org/en/download"
    }

    exit 1
  }

  $majorVersion = & $nodePath -e "process.stdout.write(process.versions.node.split('.')[0])"
  if ([int]$majorVersion -lt 20) {
    Fail-Install "Node.js 20 or newer is required. Current version: $(& $nodePath --version)"
  }

  Write-Log "Using Node runtime: $(& $nodePath --version)"
  return @{
    Node = $nodePath
  }
}

function Stop-ExistingApp {
  Write-Log "Stopping existing Scanner Insights processes"

  $escapedInstallRoot = [regex]::Escape($InstallRoot)
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -in @("node.exe", "cmd.exe", "powershell.exe", "ScannerKeyHook.exe")) -and
      (
        ($_.CommandLine -and $_.CommandLine -match $escapedInstallRoot) -or
        ($_.ExecutablePath -and $_.ExecutablePath -match $escapedInstallRoot)
      )
    }

  foreach ($process in $processes) {
    try {
      Write-Log "Stopping $($process.Name) PID $($process.ProcessId)"
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Log "Could not stop PID $($process.ProcessId): $($_.Exception.Message)"
    }
  }

  Start-Sleep -Milliseconds 500
}

function Remove-ExistingInstall {
  if (-not (Test-Path $InstallRoot)) {
    return
  }

  foreach ($candidate in @((Join-Path $InstallRoot "data"), (Join-Path $appTarget "data"))) {
    if (Test-Path $candidate) {
      Write-Log "Backing up existing data from $candidate"
      New-Item -ItemType Directory -Force -Path $dataBackup | Out-Null
      Copy-Item (Join-Path $candidate "*") -Destination $dataBackup -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Log "Removing previous install at $InstallRoot"

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Remove-Item $InstallRoot -Recurse -Force -ErrorAction Stop
      return
    } catch {
      Write-Log "Remove attempt $attempt failed: $($_.Exception.Message)"
      Stop-ExistingApp
      Start-Sleep -Seconds 1
    }
  }

  Fail-Install "Could not remove the previous Scanner Insights install. Restart the target PC, then run Install-Local.bat again."
}

function Copy-AppFiles {
  if (Test-Path $InstallRoot) {
    Stop-ExistingApp
    Remove-ExistingInstall
  }

  New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $appTarget | Out-Null
  New-Item -ItemType Directory -Force -Path $dataTarget | Out-Null
  New-Item -ItemType Directory -Force -Path $configTarget | Out-Null

  Write-Log "Copying app files"
  Copy-Item (Join-Path $appSource "server.mjs") -Destination $appTarget -Force
  Copy-Item (Join-Path $appSource "package.json") -Destination $appTarget -Force
  Copy-Item (Join-Path $appSource "package-lock.json") -Destination $appTarget -Force
  Copy-Item (Join-Path $appSource "README.md") -Destination $appTarget -Force
  Copy-Item (Join-Path $appSource "public") -Destination $appTarget -Recurse -Force
  Copy-Item (Join-Path $appSource "src") -Destination $appTarget -Recurse -Force
  Copy-Item (Join-Path $appSource "netlify") -Destination $appTarget -Recurse -Force
  Copy-Item (Join-Path $appSource "node_modules") -Destination $appTarget -Recurse -Force
  Copy-Item (Join-Path $appSource "bin") -Destination $appTarget -Recurse -Force

  if (Test-Path $dataBackup) {
    Write-Log "Restoring existing data to $dataTarget"
    Copy-Item (Join-Path $dataBackup "*") -Destination $dataTarget -Recurse -Force -ErrorAction SilentlyContinue
  }

  $agentEnv = @(
    "SCANNER_MACHINE_ID=$env:COMPUTERNAME",
    "SCANNER_INSIGHTS_CLOUD_ENDPOINT=$cloudEndpoint",
    "SCANNER_INSIGHTS_DATA_DIR=$dataTarget",
    "SCANNER_INSIGHTS_SYNC_INTERVAL_MS=15000"
  )
  Set-Content -Path (Join-Path $configTarget "agent.env") -Value $agentEnv -Encoding ASCII

  Write-Log "Copying launcher files"
  Copy-Item (Join-Path $launchersSource "launcher-start.ps1") -Destination (Join-Path $InstallRoot "launcher-start.ps1") -Force
  Copy-Item (Join-Path $launchersSource "launcher-stop.ps1") -Destination (Join-Path $InstallRoot "launcher-stop.ps1") -Force
  Copy-Item (Join-Path $launchersSource "Start-Installed.bat") -Destination (Join-Path $InstallRoot "Start-Scanner-Insights.bat") -Force
  Copy-Item (Join-Path $launchersSource "Start-Installed.vbs") -Destination (Join-Path $InstallRoot "Start-Scanner-Insights.vbs") -Force
  Copy-Item (Join-Path $launchersSource "Start-Agent.bat") -Destination (Join-Path $InstallRoot "Start-Scanner-Agent.bat") -Force
  Copy-Item (Join-Path $launchersSource "Start-Agent.vbs") -Destination (Join-Path $InstallRoot "Start-Scanner-Agent.vbs") -Force
  Copy-Item (Join-Path $launchersSource "Stop-Installed.bat") -Destination (Join-Path $InstallRoot "Stop-Scanner-Insights.bat") -Force
  Copy-Item (Join-Path $launchersSource "Uninstall-Local.bat") -Destination (Join-Path $InstallRoot "Uninstall-Scanner-Insights.bat") -Force

  if (-not (Test-Path (Join-Path $appTarget "src\local\agent.mjs"))) {
    Fail-Install "Install copy failed: agent.mjs is missing after copy."
  }
}

function Create-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$Arguments = "",
    [string]$IconLocation = ""
  )

  $shortcutFolder = Split-Path -Parent $ShortcutPath
  if (-not (Test-Path $shortcutFolder)) {
    return $false
  }

  try {
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    if ($Arguments) {
      $shortcut.Arguments = $Arguments
    }
    $shortcut.WorkingDirectory = $WorkingDirectory
    if ($IconLocation) {
      $shortcut.IconLocation = $IconLocation
    }
    $shortcut.Save()
    return $true
  } catch {
    Write-Log "Shortcut skipped: $ShortcutPath"
    return $false
  }
}

function Create-Shortcuts {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $startup = [Environment]::GetFolderPath("Startup")
  $startBat = Join-Path $InstallRoot "Start-Scanner-Insights.bat"
  $startVbs = Join-Path $InstallRoot "Start-Scanner-Insights.vbs"
  $agentVbs = Join-Path $InstallRoot "Start-Scanner-Agent.vbs"
  $wscript = Join-Path $env:WINDIR "System32\wscript.exe"
  $icon = Join-Path $InstallRoot "app\public\scanner-insights.ico"

  if ($desktop -and (Test-Path $desktop)) {
    if (Create-Shortcut -ShortcutPath (Join-Path $desktop "Scanner Insights.lnk") -TargetPath $wscript -Arguments "`"$startVbs`"" -WorkingDirectory $InstallRoot -IconLocation $icon) {
      Write-Log "Desktop shortcut created"
    }
  }

  if ($startup -and (Test-Path $startup)) {
    Remove-Item (Join-Path $startup "Scanner Insights Startup.lnk") -Force -ErrorAction SilentlyContinue
    if (Create-Shortcut -ShortcutPath (Join-Path $startup "Scanner Insights Agent.lnk") -TargetPath $wscript -Arguments "`"$agentVbs`"" -WorkingDirectory $InstallRoot -IconLocation $icon) {
      Write-Log "Startup agent shortcut created"
    }
  }
}

$runtime = Ensure-NodeRuntime
Copy-AppFiles
Create-Shortcuts

Write-Log "Starting installed app"
$env:SCANNER_INSIGHTS_DIAG_ROOT = $diagnosticsRoot
& (Join-Path $InstallRoot "launcher-start.ps1") -Mode installed -Target agent | Out-Null
Write-Log "Install complete"
