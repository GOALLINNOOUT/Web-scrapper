$ErrorActionPreference = "Stop"
$processes = Get-Process load-balancer -ErrorAction SilentlyContinue
if (!$processes) {
  Write-Host "No local load-balancer process is running."
  exit 0
}

$processes | Stop-Process -Force
Write-Host "Stopped local load-balancer process."
