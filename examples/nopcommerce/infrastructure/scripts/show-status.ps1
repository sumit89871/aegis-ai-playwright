$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$infrastructureDirectory = Split-Path -Parent $scriptDirectory
$exampleRoot = Resolve-Path (Join-Path $infrastructureDirectory "..")
$composeFile = Join-Path $infrastructureDirectory "compose.yml"
$environmentFile = Join-Path $infrastructureDirectory ".env"

if (-not (Test-Path -LiteralPath $environmentFile)) {
    Write-Error "Missing $environmentFile. Copy .env.example to .env and provide a local password."
    exit 1
}

Push-Location $exampleRoot
try {
    & docker compose --env-file $environmentFile -f $composeFile ps
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}
