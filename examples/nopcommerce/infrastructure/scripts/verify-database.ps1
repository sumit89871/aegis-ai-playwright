$ErrorActionPreference = "Stop"

$containerName = "aegis-nopcommerce-db"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$infrastructureDirectory = Split-Path -Parent $scriptDirectory
$environmentFile = Join-Path $infrastructureDirectory ".env"

if (-not (Test-Path -LiteralPath $environmentFile)) {
    Write-Error "Missing local infrastructure environment file: $environmentFile"
    exit 1
}

function Get-LocalEnvironmentValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $setting = Get-Content -LiteralPath $environmentFile |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
        Select-Object -First 1

    if ($null -eq $setting) {
        Write-Error "Missing $Name in the local infrastructure environment file."
        exit 1
    }

    return (($setting -split '=', 2)[1].Trim()).Trim('"').Trim("'")
}

function Invoke-DatabaseScalar {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Sql
    )

    $result = & docker exec $containerName psql `
        --username $databaseUser `
        --dbname $databaseName `
        --tuples-only `
        --no-align `
        --set ON_ERROR_STOP=1 `
        --command $Sql

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Database verification query failed."
        exit $LASTEXITCODE
    }

    return (($result | Out-String).Trim())
}

$running = & docker inspect --format "{{.State.Running}}" $containerName 2>$null
if ($LASTEXITCODE -ne 0 -or $running.Trim() -ne "true") {
    Write-Error "PostgreSQL container '$containerName' is not running. Start the local infrastructure first."
    exit 1
}

$databaseName = Get-LocalEnvironmentValue -Name "POSTGRES_DB"
$databaseUser = Get-LocalEnvironmentValue -Name "POSTGRES_USER"

$citextVersion = Invoke-DatabaseScalar -Sql "SELECT extversion FROM pg_extension WHERE extname = 'citext';"
if ([string]::IsNullOrWhiteSpace($citextVersion)) {
    Write-Error "Required PostgreSQL extension 'citext' is absent from database '$databaseName'."
    exit 1
}

$publicTableCount = Invoke-DatabaseScalar -Sql "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';"

Write-Host "PostgreSQL container is running."
Write-Host "citext extension version: $citextVersion"
Write-Host "Public application table count: $publicTableCount"
exit 0
