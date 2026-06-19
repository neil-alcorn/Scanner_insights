param(
  [string]$Mode = "portable",
  [ValidateSet("dashboard", "agent")]
  [string]$Target = "dashboard"
)

$ErrorActionPreference = "Stop"

if ($Mode -eq "installed") {
  $installRoot = if ($env:SCANNER_INSIGHTS_INSTALL_ROOT) { $env:SCANNER_INSIGHTS_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "ScannerInsights" }
  $appRoot = Join-Path $installRoot "app"
  $bundleRoot = $appRoot
} else {
  $bundleRoot = Split-Path -Parent $PSScriptRoot
  $appRoot = Join-Path $bundleRoot "app"
}

try {
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("Node.js was not found on this machine. Please install Node.js LTS and try again.", "Scanner Insights") | Out-Null
  exit 1
}
$serverScript = Join-Path $appRoot "server.mjs"
$agentScript = Join-Path $appRoot "src\local\agent.mjs"
$runRoot = Join-Path $appRoot "run"
$installRunRoot = if ($Mode -eq "installed") { Join-Path $installRoot "run" } else { $runRoot }
$configRoot = if ($Mode -eq "installed") { Join-Path $installRoot "config" } else { Join-Path $bundleRoot "config" }
$agentEnvPath = Join-Path $configRoot "agent.env"
$pidFile = Join-Path $runRoot "server.pid"
$portFile = Join-Path $runRoot "server.port"
$stdoutLog = Join-Path $runRoot "server.out.log"
$stderrLog = Join-Path $runRoot "server.err.log"
$agentPidFile = Join-Path $installRunRoot "agent.pid"
$agentStdoutLog = Join-Path $installRunRoot "agent.out.log"
$agentStderrLog = Join-Path $installRunRoot "agent.err.log"

New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
New-Item -ItemType Directory -Force -Path $installRunRoot | Out-Null

function Import-AgentEnv {
  if (-not (Test-Path $agentEnvPath)) {
    return
  }

  Get-Content $agentEnvPath -ErrorAction SilentlyContinue | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }

    $parts = $line.Split("=", 2)
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
  }
}

function Export-Diagnostics {
  param([string]$Reason)

  if (-not $env:SCANNER_INSIGHTS_DIAG_ROOT) {
    return
  }

  try {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $safeComputer = ($env:COMPUTERNAME -replace '[^A-Za-z0-9_-]', '_')
    $target = Join-Path $env:SCANNER_INSIGHTS_DIAG_ROOT "$safeComputer-$stamp"
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Set-Content -Path (Join-Path $target "failure.txt") -Value @(
      "Reason=$Reason",
      "Date=$(Get-Date -Format o)",
      "Mode=$Mode",
      "AppRoot=$appRoot",
      "Port=$port"
    ) -Encoding ASCII
    Copy-Item -Path $runRoot -Destination (Join-Path $target "app-run") -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $installRoot "run") -Destination (Join-Path $target "install-run") -Recurse -Force -ErrorAction SilentlyContinue
    Get-Process node,ScannerKeyHook,powershell,cmd -ErrorAction SilentlyContinue |
      Select-Object Id,ProcessName,StartTime,Path |
      Format-List |
      Out-File -FilePath (Join-Path $target "processes.txt") -Encoding ASCII
  } catch {
  }
}

function Get-Port {
  if (Test-Path $portFile) {
    $saved = (Get-Content $portFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($saved -match '^\d+$') {
      return [int]$saved
    }
  }

  foreach ($candidate in 4312..4320) {
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
      $listener.Start()
      $listener.Stop()
      return $candidate
    } catch {
    }
  }

  throw "No open port found between 4312 and 4320."
}

function Test-Health {
  param([int]$Port)
  try {
    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-PortListening {
  param([int]$Port)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(1000, $false)
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

function Start-Agent {
  Import-AgentEnv

  if (-not (Test-Path $agentScript)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Scanner Insights agent is missing from the installed app. Please rerun the installer.", "Scanner Insights") | Out-Null
    exit 1
  }

  if (-not $env:SCANNER_MACHINE_ID) {
    $env:SCANNER_MACHINE_ID = $env:COMPUTERNAME
  }

  if (-not $env:SCANNER_INSIGHTS_DATA_DIR) {
    $env:SCANNER_INSIGHTS_DATA_DIR = if ($Mode -eq "installed") { Join-Path $installRoot "data" } else { Join-Path $appRoot "data" }
  }

  if (-not $env:SCANNER_INSIGHTS_SYNC_INTERVAL_MS) {
    $env:SCANNER_INSIGHTS_SYNC_INTERVAL_MS = "15000"
  }

  if (Test-Path $agentPidFile) {
    $existingAgentPid = (Get-Content $agentPidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($existingAgentPid) {
      $existingAgent = Get-Process -Id $existingAgentPid -ErrorAction SilentlyContinue
      if ($existingAgent) {
        return
      }
    }
    Remove-Item $agentPidFile -Force -ErrorAction SilentlyContinue
  }

  $command = "set `"SCANNER_MACHINE_ID=$env:SCANNER_MACHINE_ID`" && set `"SCANNER_INSIGHTS_DATA_DIR=$env:SCANNER_INSIGHTS_DATA_DIR`" && set `"SCANNER_INSIGHTS_CLOUD_ENDPOINT=$env:SCANNER_INSIGHTS_CLOUD_ENDPOINT`" && set `"SCANNER_INSIGHTS_SYNC_INTERVAL_MS=$env:SCANNER_INSIGHTS_SYNC_INTERVAL_MS`" && `"$nodePath`" `"$agentScript`" >> `"$agentStdoutLog`" 2>> `"$agentStderrLog`""
  $process = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", $command `
    -WorkingDirectory $appRoot `
    -PassThru `
    -WindowStyle Hidden

  Set-Content -Path $agentPidFile -Value $process.Id -Encoding ASCII
}

if ($Target -eq "agent") {
  Start-Agent
  exit 0
}

$port = Get-Port
$appUrl = "http://127.0.0.1:$port"
$env:SCANNER_INSIGHTS_DISABLE_LISTENER = "1"
if (-not $env:SCANNER_INSIGHTS_DATA_DIR -and $Mode -eq "installed") {
  $env:SCANNER_INSIGHTS_DATA_DIR = Join-Path $installRoot "data"
}

if (Test-Path $pidFile) {
  $existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($existingPid) {
    $process = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if (-not $process) {
      Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not (Test-Health -Port $port)) {
  $command = "set SCANNER_INSIGHTS_PORT=$port && `"$nodePath`" `"$serverScript`" >> `"$stdoutLog`" 2>> `"$stderrLog`""
  $process = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", $command `
    -WorkingDirectory $appRoot `
    -PassThru `
    -WindowStyle Hidden

  Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII
  Set-Content -Path $portFile -Value $port -Encoding ASCII

  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 1000
    if (Test-Health -Port $port) {
      break
    }
  }
}

if (-not (Test-Health -Port $port) -and -not (Test-PortListening -Port $port)) {
  Export-Diagnostics "Health check failed after launch"
  Add-Type -AssemblyName System.Windows.Forms
  $message = "Scanner Insights could not start. Diagnostic logs were copied to the USB diagnostics folder if the USB is still attached."
  [System.Windows.Forms.MessageBox]::Show($message, "Scanner Insights") | Out-Null
  exit 1
}

Start-Process $appUrl
