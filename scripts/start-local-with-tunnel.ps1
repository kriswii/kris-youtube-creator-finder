param(
  [string]$ProjectDir = "C:\Users\ug1ra\Documents\New project",
  [string]$BackendPort = "3011",
  [string]$CloudflaredPath = "C:\Users\ug1ra\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe",
  [string]$WorkerDir = "",
  [switch]$UpdateWorkerSecret,
  [string]$PagesProjectName = "",
  [switch]$UpdatePagesSecret
)

$ErrorActionPreference = "Stop"

function Wait-For-Health {
  param([string]$Url, [int]$TimeoutSeconds = 45)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
      if ($response.ok) {
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  throw "Timed out waiting for $Url"
}

function Wait-For-TunnelUrl {
  param([string]$LogPath, [int]$TimeoutSeconds = 60)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $LogPath) {
      $content = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
      $match = [regex]::Match($content, "https://[a-z0-9-]+\.trycloudflare\.com")
      if ($match.Success) {
        return $match.Value
      }
    }
    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for Cloudflare Tunnel URL. Check $LogPath"
}

function Set-FrontendApiBase {
  param([string]$FrontendDir, [string]$ApiBaseUrl)

  $envPath = Join-Path $FrontendDir ".env.local"
  Set-Content -LiteralPath $envPath -Value "VITE_API_BASE_URL=$ApiBaseUrl" -Encoding UTF8
}

if (-not (Test-Path $CloudflaredPath)) {
  throw "cloudflared.exe not found at $CloudflaredPath"
}

$backendDir = Join-Path $ProjectDir "backend"
$frontendDir = Join-Path $ProjectDir "frontend"
$logDir = Join-Path $ProjectDir ".tmp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$tunnelLog = Join-Path $logDir "cloudflared-tunnel.log"
Remove-Item -LiteralPath $tunnelLog -ErrorAction SilentlyContinue

Write-Host "Starting backend..."
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$backendDir'; npm run dev" -WindowStyle Normal
Wait-For-Health -Url "http://localhost:$BackendPort/health"

Write-Host "Starting Cloudflare quick tunnel..."
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "& '$CloudflaredPath' tunnel --url http://localhost:$BackendPort *>&1 | Tee-Object -FilePath '$tunnelLog'" -WindowStyle Normal

$tunnelUrl = Wait-For-TunnelUrl -LogPath $tunnelLog
Write-Host "Tunnel URL: $tunnelUrl"

Set-FrontendApiBase -FrontendDir $frontendDir -ApiBaseUrl $tunnelUrl
Write-Host "Updated frontend .env.local"

if ($UpdateWorkerSecret) {
  if ([string]::IsNullOrWhiteSpace($WorkerDir)) {
    $WorkerDir = Join-Path $ProjectDir "cloudflare\api-proxy"
  }

  if (-not (Test-Path $WorkerDir)) {
    throw "Worker directory not found: $WorkerDir"
  }

  Write-Host "Updating Cloudflare Worker BACKEND_BASE_URL secret..."
  Push-Location $WorkerDir
  try {
    $tunnelUrl | npx wrangler secret put BACKEND_BASE_URL
  } finally {
    Pop-Location
  }
}

if ($UpdatePagesSecret) {
  if ([string]::IsNullOrWhiteSpace($PagesProjectName)) {
    throw "PagesProjectName is required when using -UpdatePagesSecret"
  }

  Write-Host "Updating Cloudflare Pages BACKEND_BASE_URL secret for $PagesProjectName..."
  Push-Location $frontendDir
  try {
    $tunnelUrl | npx wrangler pages secret put BACKEND_BASE_URL --project-name $PagesProjectName
  } finally {
    Pop-Location
  }
}

Write-Host "Starting frontend..."
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$frontendDir'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "Ready."
Write-Host "Local backend: http://localhost:$BackendPort/health"
Write-Host "Tunnel backend: $tunnelUrl/health"
Write-Host "Frontend URL: check the Frontend terminal for Vite Local URL."
