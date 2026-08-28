param(
  [string]$Port = "8080",
  [string]$Backends = "http://127.0.0.1:4001,http://127.0.0.1:4002"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Exe = Join-Path $Root "target\release\load-balancer.exe"
$LogDir = Join-Path $Root "logs"
$OutLog = Join-Path $LogDir "load-balancer-local.out.log"
$ErrLog = Join-Path $LogDir "load-balancer-local.err.log"

if (!(Test-Path $Exe)) {
  throw "Missing $Exe. Run: cargo build -p load-balancer --release"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Get-Process load-balancer -ErrorAction SilentlyContinue | Stop-Process -Force

$command = @"
`$env:PORT='$Port'
`$env:BACKENDS='$Backends'
Set-Location '$Root'
& '$Exe' *> '$OutLog'
"@

Start-Process powershell -WindowStyle Hidden -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-Command", $command
)

Start-Sleep -Seconds 2

try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 5
  Write-Host "Load balancer started on http://127.0.0.1:$Port -> $Backends"
  Write-Host "Health: $($response.StatusCode) $($response.Content)"
} catch {
  if (Test-Path $OutLog) {
    Write-Host "--- load balancer log ---"
    Get-Content $OutLog -Tail 80
  }
  throw
}
