param(
  [string]$ComposeFile = "docker/docker-compose.yml",
  [string]$LoadBalancerUrl = "http://localhost:8080",
  [int]$RequestCount = 6,
  [int]$HealthCheckWaitSeconds = 8,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Health {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri "$Url/health" -UseBasicParsing -TimeoutSec 10
    return @{
      Ok = $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
      Status = $response.StatusCode
      Body = $response.Content
    }
  } catch {
    return @{
      Ok = $false
      Status = "ERROR"
      Body = $_.Exception.Message
    }
  }
}

function Test-LoadBalancerRequests {
  param(
    [string]$Url,
    [int]$Count
  )

  $failures = 0
  for ($i = 1; $i -le $Count; $i += 1) {
    $result = Invoke-Health -Url $Url
    if ($result.Ok) {
      Write-Host ("request {0}/{1}: OK {2} {3}" -f $i, $Count, $result.Status, $result.Body) -ForegroundColor Green
    } else {
      $failures += 1
      Write-Host ("request {0}/{1}: FAILED {2} {3}" -f $i, $Count, $result.Status, $result.Body) -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 500
  }

  if ($failures -gt 0) {
    throw "$failures request(s) failed through the load balancer."
  }
}

function Compose {
  param([string[]]$ComposeArgs)
  & docker compose -f $ComposeFile @ComposeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($ComposeArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

Write-Step "Checking compose services"
Compose @("ps")

Write-Step "Checking load balancer before failure"
Test-LoadBalancerRequests -Url $LoadBalancerUrl -Count $RequestCount

Write-Step "Stopping api-1 to simulate server 1 crash"
Compose @("stop", "api-1")

try {
  Write-Step "Waiting $HealthCheckWaitSeconds seconds for the load balancer to mark api-1 unhealthy"
  Start-Sleep -Seconds $HealthCheckWaitSeconds

  Write-Step "Checking requests still pass through api-2"
  Test-LoadBalancerRequests -Url $LoadBalancerUrl -Count $RequestCount

  Write-Step "Load balancer failover test passed"
} finally {
  if ($SkipRestart) {
    Write-Host ""
    Write-Host "SkipRestart was set, so api-1 is still stopped." -ForegroundColor Yellow
  } else {
    Write-Step "Restarting api-1"
    Compose @("up", "-d", "api-1")
  }
}

Write-Step "Final compose status"
Compose @("ps")
