$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $appDir "node_modules\.bin\electron.cmd"
$electronExe = Join-Path $appDir "node_modules\electron\dist\electron.exe"
$logDir = Join-Path $appDir "logs"
$logFile = Join-Path $logDir "launcher.log"
$ports = 4173..4193

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log {
  param([string]$Message)
  Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -Encoding UTF8
}

try {
  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $electronExe } |
    Stop-Process -Force
} catch {
  Write-Log "Could not stop old Electron process: $($_.Exception.Message)"
}

if (Test-Path $electronExe) {
  try {
    Start-Process -FilePath $electronExe -ArgumentList "`"$appDir\electron-main.js`"" -WorkingDirectory $appDir
    Write-Log "Started Electron directly."
    exit
  } catch {
    Write-Log "Direct Electron start failed: $($_.Exception.Message)"
  }
}

if (Test-Path $electron) {
  try {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run desktop >> `"$logFile`" 2>&1" -WorkingDirectory $appDir -WindowStyle Hidden
    Write-Log "Started Electron through npm."
    exit
  } catch {
    Write-Log "npm desktop start failed: $($_.Exception.Message)"
  }
}

function Get-PulseShelfUrl {
  foreach ($port in $ports) {
    try {
      $health = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 1
      if ($health.ok) {
        return "http://localhost:$port"
      }
    } catch {
    }
  }

  return $null
}

$url = Get-PulseShelfUrl

if (-not $url) {
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm start" -WorkingDirectory $appDir -WindowStyle Minimized

  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    $url = Get-PulseShelfUrl
    if ($url) {
      break
    }
  }
}

if ($url) {
  Start-Process $url
} else {
  Start-Process "http://localhost:4173"
}
