param(
    [ValidateRange(1, 3600)]
    [int]$TimeoutSeconds = 180,

    [ValidateRange(1, 60)]
    [int]$PollIntervalSeconds = 3,

    [string]$Uri = ""
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$infrastructureDirectory = Split-Path -Parent $scriptDirectory
$environmentFile = Join-Path $infrastructureDirectory ".env"
$port = "8080"

if ([string]::IsNullOrWhiteSpace($Uri) -and (Test-Path -LiteralPath $environmentFile)) {
    $portSetting = Get-Content -LiteralPath $environmentFile |
        Where-Object { $_ -match '^\s*NOPCOMMERCE_PORT\s*=' } |
        Select-Object -First 1

    if ($null -ne $portSetting) {
        $configuredPort = ($portSetting -split '=', 2)[1].Trim()
        if ($configuredPort -match '^\d+$') {
            $port = $configuredPort
        }
    }
}

$targetUri = if ([string]::IsNullOrWhiteSpace($Uri)) {
    "http://localhost:$port"
} else {
    $Uri
}

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$attempt = 0

Write-Host "Waiting up to $TimeoutSeconds seconds for nopCommerce at $targetUri ..."

while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    $attempt++

    try {
        $response = Invoke-WebRequest -Uri $targetUri -UseBasicParsing -TimeoutSec 10
        Write-Host "nopCommerce responded with HTTP $([int]$response.StatusCode) after $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1)) seconds."
        exit 0
    } catch {
        $httpResponse = $_.Exception.Response

        if ($null -ne $httpResponse) {
            Write-Host "nopCommerce responded with HTTP $([int]$httpResponse.StatusCode) after $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1)) seconds."
            exit 0
        }

        Write-Host "Attempt ${attempt}: no HTTP response yet; retrying in $PollIntervalSeconds seconds."
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}

Write-Error "Timed out after $TimeoutSeconds seconds waiting for an HTTP response from $targetUri. Check 'npm run nopcommerce:infra:status' and 'npm run nopcommerce:infra:logs' from the repository root."
exit 1
