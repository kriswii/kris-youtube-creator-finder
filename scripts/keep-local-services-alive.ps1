param(
  [string]$RunRoot = "C:\Users\Og\Downloads\kris-youtube-creator-finder-run",
  [int]$FrontendPort = 4173,
  [int]$BackendPort = 3001,
  [int]$ChromeDebugPort = 9333,
  [int]$CheckIntervalSeconds = 8
)

$ErrorActionPreference = "Stop"

function Test-PortListening {
  param([int]$Port)
  $result = netstat -ano | Select-String ":$Port"
  return [bool]$result
}

function Start-Backend {
  param([string]$Root)
  $backendRoot = Join-Path $Root "backend"
  $stdout = Join-Path $backendRoot "logs\backend-stdout.log"
  $stderr = Join-Path $backendRoot "logs\backend-stderr.log"
  New-Item -ItemType Directory -Force -Path (Join-Path $backendRoot "logs") | Out-Null
  Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList ".\dist\src\server.js" -WorkingDirectory $backendRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
}

function Start-Frontend {
  param([string]$Root, [int]$Port)
  $frontendRoot = Join-Path $Root "frontend"
  $stdout = Join-Path $frontendRoot "preview-stdout.log"
  $stderr = Join-Path $frontendRoot "preview-stderr.log"
  Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList ".\node_modules\vite\bin\vite.js","preview","--host","127.0.0.1","--port",$Port -WorkingDirectory $frontendRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
}

function Start-SearchBrowser {
  param([string]$Root)
  $scriptPath = Join-Path $Root "scripts\start-youtube-search-browser.ps1"
  if (Test-Path $scriptPath) {
    Start-Process -WindowStyle Hidden -FilePath "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-ExecutionPolicy","Bypass","-File",$scriptPath | Out-Null
  }
}

Write-Host "Watching local YouTube Finder services..."
Write-Host "RunRoot: $RunRoot"

while ($true) {
  try {
    if (-not (Test-PortListening -Port $BackendPort)) {
      Start-Backend -Root $RunRoot
      Start-Sleep -Seconds 2
    }

    if (-not (Test-PortListening -Port $FrontendPort)) {
      Start-Frontend -Root $RunRoot -Port $FrontendPort
      Start-Sleep -Seconds 2
    }

    if (-not (Test-PortListening -Port $ChromeDebugPort)) {
      Start-SearchBrowser -Root $RunRoot
      Start-Sleep -Seconds 2
    }
  } catch {
    Write-Warning $_.Exception.Message
  }

  Start-Sleep -Seconds $CheckIntervalSeconds
}
