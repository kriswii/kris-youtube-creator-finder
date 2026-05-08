param(
  [string]$ChromePath = "",
  [int]$Port = 9333
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ChromePath)) {
  $candidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )

  $ChromePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $ChromePath -or -not (Test-Path $ChromePath)) {
  throw "Chrome executable not found. Please edit ChromePath in this script."
}

$profileDir = Join-Path $env:LOCALAPPDATA "KrisYouTubeFinderChrome"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$arguments = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profileDir",
  "https://www.youtube.com"
)

Start-Process -FilePath $ChromePath -ArgumentList $arguments -WindowStyle Normal
Write-Host "Started Chrome with remote debugging on port $Port"
