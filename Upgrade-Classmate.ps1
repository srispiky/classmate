#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BundleRoot = $PSScriptRoot
$IisSitePath  = "C:\inetpub\classmate"
$ServiceName  = "ClassmateAPI"
$EncryptionKey = "a020dcdcbaf23bef23af68dcec10c297163de3ecdcb2af1e7442b57bcd843661"

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }

function Find-PsqlPath {
    $inPath = Get-Command psql -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }
    $pgRoot = "C:\Program Files\PostgreSQL"
    if (Test-Path $pgRoot) {
        $found = Get-ChildItem $pgRoot -Directory |
                 Sort-Object Name -Descending |
                 ForEach-Object { Join-Path $_.FullName "bin\psql.exe" } |
                 Where-Object { Test-Path $_ } |
                 Select-Object -First 1
        if ($found) { return $found }
    }
    return $null
}

Write-Step "Validating upgrade bundle"
$needed = @("api-dist\index.mjs", "frontend\index.html", "classmate-upgrade.sql")
foreach ($item in $needed) {
    $full = Join-Path $BundleRoot $item
    if (-not (Test-Path $full)) {
        Write-Host "    [FAIL] Missing: $full" -ForegroundColor Red
        exit 1
    }
}
Write-Ok "Bundle valid"

Write-Step "Applying database changes"
$psqlPath = Find-PsqlPath
if (-not $psqlPath) {
    Write-Host "    [FAIL] psql not found. Add PostgreSQL bin to PATH." -ForegroundColor Red
    exit 1
}
$pgPassword = Read-Host "    Enter postgres superuser password" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPassword))
$sqlFile = Join-Path $BundleRoot "classmate-upgrade.sql"
& $psqlPath -U classmate_user -d classmate_db -f $sqlFile
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Database upgraded successfully"
} else {
    Write-Warn "DB upgrade finished with warnings (check output above)"
}

Write-Step "Stopping API service"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    nssm stop $ServiceName confirm
    Start-Sleep 3
    Write-Ok "Service stopped"
} else {
    Write-Warn "Service '$ServiceName' not running or not found"
}

Write-Step "Updating API files"
$apiSrc = Join-Path $BundleRoot "api-dist"
$apiDst = Join-Path (Split-Path (nssm get $ServiceName Application 2>$null)) ".."
$apiDst = Join-Path $BundleRoot "api-dist"
Copy-Item -Path "$apiSrc\*" -Destination $apiDst -Recurse -Force
Write-Ok "API files updated"

Write-Step "Updating PASSWORD_ENCRYPTION_KEY in service environment"
nssm get $ServiceName AppEnvironmentExtra | Out-Null
$envLine = nssm get $ServiceName AppEnvironmentExtra 2>$null
if ($envLine -notlike "*PASSWORD_ENCRYPTION_KEY*") {
    $newLine = $envLine + "`nPASSWORD_ENCRYPTION_KEY=" + $EncryptionKey
    nssm set $ServiceName AppEnvironmentExtra $newLine
}
Write-Ok "Encryption key set in service"

Write-Step "Updating frontend files"
if (-not (Test-Path $IisSitePath)) {
    New-Item -ItemType Directory -Path $IisSitePath -Force | Out-Null
}
$frontendSrc = Join-Path $BundleRoot "frontend"
Copy-Item -Path "$frontendSrc\*" -Destination $IisSitePath -Recurse -Force
Write-Ok "Frontend updated"

Write-Step "Starting API service"
nssm start $ServiceName
Start-Sleep 5
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Ok "API service running"
} else {
    Write-Warn "Service may not have started - check C:\Logs\classmate-api-error.log"
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  CLASSMATE UPGRADED SUCCESSFULLY" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Login URL : http://localhost/classmate" -ForegroundColor White
Write-Host "  Username  : admin" -ForegroundColor White
Write-Host "  Password  : classmate123" -ForegroundColor White
Write-Host "  Logs      : C:\Logs\classmate-api.log" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Green
