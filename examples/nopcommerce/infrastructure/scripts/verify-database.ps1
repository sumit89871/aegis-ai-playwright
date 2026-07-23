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
        --quiet `
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

$builtInNextvalPresent = Invoke-DatabaseScalar -Sql "SELECT to_regprocedure('pg_catalog.nextval(regclass)') IS NOT NULL;"
if ($builtInNextvalPresent -ne "t") {
    Write-Error "PostgreSQL built-in function pg_catalog.nextval(regclass) is absent."
    exit 1
}

$compatibilityNextvalPresent = Invoke-DatabaseScalar -Sql "SELECT to_regprocedure('public.nextval(character)') IS NOT NULL;"
if ($compatibilityNextvalPresent -ne "t") {
    Write-Error "Required compatibility function public.nextval(character) is absent."
    exit 1
}

$compatibilityReturnType = Invoke-DatabaseScalar -Sql "SELECT pg_get_function_result(to_regprocedure('public.nextval(character)')::oid);"
if ($compatibilityReturnType -ne "bigint") {
    Write-Error "Compatibility function public.nextval(character) must return bigint; found '$compatibilityReturnType'."
    exit 1
}

$compatibilitySchema = Invoke-DatabaseScalar -Sql "SELECT n.nspname FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace WHERE p.oid = to_regprocedure('public.nextval(character)');"
if ($compatibilitySchema -ne "public") {
    Write-Error "Compatibility function nextval(character) must use schema public; found '$compatibilitySchema'."
    exit 1
}

$functionalVerificationResult = Invoke-DatabaseScalar -Sql "CREATE TEMP SEQUENCE aegis_nextval_verification_seq; SELECT public.nextval('pg_temp.aegis_nextval_verification_seq'::character(63)); DROP SEQUENCE pg_temp.aegis_nextval_verification_seq;"
if ($functionalVerificationResult -ne "1") {
    Write-Error "Compatibility function verification expected sequence value 1; found '$functionalVerificationResult'."
    exit 1
}

$dateTimeFunctionSignature = "public.datetime2fromparts(integer,integer,integer,integer,integer,integer,integer,integer)"
$dateTimeFunctionPresent = Invoke-DatabaseScalar -Sql "SELECT to_regprocedure('$dateTimeFunctionSignature') IS NOT NULL;"
if ($dateTimeFunctionPresent -ne "t") {
    Write-Error "Required compatibility function $dateTimeFunctionSignature is absent."
    exit 1
}

$dateTimeReturnType = Invoke-DatabaseScalar -Sql "SELECT pg_get_function_result(to_regprocedure('$dateTimeFunctionSignature')::oid);"
if ($dateTimeReturnType -ne "timestamp without time zone") {
    Write-Error "Compatibility function $dateTimeFunctionSignature must return timestamp without time zone; found '$dateTimeReturnType'."
    exit 1
}

$dateTimeSchema = Invoke-DatabaseScalar -Sql "SELECT n.nspname FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace WHERE p.oid = to_regprocedure('$dateTimeFunctionSignature');"
if ($dateTimeSchema -ne "public") {
    Write-Error "Compatibility function datetime2fromparts must use schema public; found '$dateTimeSchema'."
    exit 1
}

$dateTimeVolatility = Invoke-DatabaseScalar -Sql "SELECT CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' WHEN 'v' THEN 'volatile' END FROM pg_proc AS p WHERE p.oid = to_regprocedure('$dateTimeFunctionSignature');"
if ($dateTimeVolatility -ne "immutable") {
    Write-Error "Compatibility function datetime2fromparts must be immutable; found '$dateTimeVolatility'."
    exit 1
}

$dateTimeStrict = Invoke-DatabaseScalar -Sql "SELECT p.proisstrict FROM pg_proc AS p WHERE p.oid = to_regprocedure('$dateTimeFunctionSignature');"
if ($dateTimeStrict -ne "f") {
    Write-Error "Compatibility function datetime2fromparts must not be declared STRICT."
    exit 1
}

$wholeSecondResult = Invoke-DatabaseScalar -Sql "SELECT public.datetime2fromparts(2020, 12, 31, 11, 59, 59, 0, 0);"
if ($wholeSecondResult -ne "2020-12-31 11:59:59") {
    Write-Error "Whole-second datetime2fromparts verification failed; found '$wholeSecondResult'."
    exit 1
}

$millisecondResult = Invoke-DatabaseScalar -Sql "SELECT to_char(public.datetime2fromparts(2020, 12, 31, 11, 59, 59, 500, 3), 'YYYY-MM-DD HH24:MI:SS.MS');"
if ($millisecondResult -ne "2020-12-31 11:59:59.500") {
    Write-Error "Millisecond datetime2fromparts verification failed; found '$millisecondResult'."
    exit 1
}

$leapYearResult = Invoke-DatabaseScalar -Sql "SELECT public.datetime2fromparts(2024, 2, 29, 10, 15, 30, 0, 0);"
if ($leapYearResult -ne "2024-02-29 10:15:30") {
    Write-Error "Leap-year datetime2fromparts verification failed; found '$leapYearResult'."
    exit 1
}

$nullRequiredArgumentResult = Invoke-DatabaseScalar -Sql "SELECT public.datetime2fromparts(NULL, 12, 31, 11, 59, 59, 0, 0) IS NULL;"
if ($nullRequiredArgumentResult -ne "t") {
    Write-Error "datetime2fromparts must return NULL when a required date/time argument is NULL."
    exit 1
}

$invalidPrecisionSql = @'
DO $verification$
BEGIN
    BEGIN
        PERFORM public.datetime2fromparts(2020, 12, 31, 11, 59, 59, 0, 8);
        RAISE EXCEPTION 'expected invalid precision error was not raised';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM <> 'datetime2fromparts precision must be between 0 and 7' THEN
                RAISE;
            END IF;
    END;
END;
$verification$;
SELECT 'passed';
'@
$invalidPrecisionResult = Invoke-DatabaseScalar -Sql $invalidPrecisionSql
if ($invalidPrecisionResult -ne "passed") {
    Write-Error "Invalid-precision datetime2fromparts verification did not complete successfully."
    exit 1
}

$invalidFractionsSql = @'
DO $verification$
BEGIN
    BEGIN
        PERFORM public.datetime2fromparts(2020, 12, 31, 11, 59, 59, 1000, 3);
        RAISE EXCEPTION 'expected invalid fractions error was not raised';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM <> 'datetime2fromparts fractions are invalid for precision 3' THEN
                RAISE;
            END IF;
    END;
END;
$verification$;
SELECT 'passed';
'@
$invalidFractionsResult = Invoke-DatabaseScalar -Sql $invalidFractionsSql
if ($invalidFractionsResult -ne "passed") {
    Write-Error "Invalid-fractions datetime2fromparts verification did not complete successfully."
    exit 1
}

$publicTableCount = Invoke-DatabaseScalar -Sql "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';"

Write-Host "PostgreSQL container is running."
Write-Host "citext installed: true"
Write-Host "citext extension version: $citextVersion"
Write-Host "Built-in pg_catalog.nextval(regclass) present: true"
Write-Host "Compatibility public.nextval(character) present: true"
Write-Host "Compatibility function return type: $compatibilityReturnType"
Write-Host "Compatibility function schema: $compatibilitySchema"
Write-Host "Temporary sequence compatibility result: $functionalVerificationResult"
Write-Host "Compatibility $dateTimeFunctionSignature present: true"
Write-Host "datetime2fromparts return type: $dateTimeReturnType"
Write-Host "datetime2fromparts schema: $dateTimeSchema"
Write-Host "datetime2fromparts volatility: $dateTimeVolatility"
Write-Host "datetime2fromparts declared STRICT: false"
Write-Host "Whole-second datetime2fromparts result: $wholeSecondResult"
Write-Host "Millisecond datetime2fromparts result: $millisecondResult"
Write-Host "Leap-year datetime2fromparts result: $leapYearResult"
Write-Host "NULL required-argument result: NULL"
Write-Host "Invalid-precision probe: $invalidPrecisionResult"
Write-Host "Invalid-fractions probe: $invalidFractionsResult"
Write-Host "Public application table count: $publicTableCount"
exit 0
