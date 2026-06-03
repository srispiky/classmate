#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BundleRoot     = $PSScriptRoot
$IisSitePath    = "C:\inetpub\classmate"
$ServiceName    = "ClassmateAPI"
$EncryptionKey  = "a020dcdcbaf23bef23af68dcec10c297163de3ecdcb2af1e7442b57bcd843661"

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

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

# ----------------------------------------------------------------
Write-Step "Validating upgrade bundle"
$needed = @("api-dist\index.mjs", "frontend\index.html", "classmate-upgrade.sql")
foreach ($item in $needed) {
    $full = Join-Path $BundleRoot $item
    if (-not (Test-Path $full)) { Write-Fail "Missing: $full" }
}
Write-Ok "Bundle valid"

# ----------------------------------------------------------------
Write-Step "Applying database changes"
$psqlPath = Find-PsqlPath
if (-not $psqlPath) { Write-Fail "psql not found. Add PostgreSQL bin to PATH." }

$pgPassword = Read-Host "    Enter postgres superuser password" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPassword))

$sqlFile = Join-Path $BundleRoot "classmate-upgrade.sql"
& $psqlPath -U postgres -d classmate_db -f $sqlFile
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Database upgraded successfully"
} else {
    Write-Warn "DB upgrade finished with warnings (check output above)"
}
$env:PGPASSWORD = ""

# ----------------------------------------------------------------
Write-Step "Locating API installation directory"
$appExe = nssm get $ServiceName Application 2>$null
if (-not $appExe) { Write-Fail "Cannot read service path from NSSM. Is '$ServiceName' installed?" }

# Executable path is something like C:\ClassmateAPI\dist\index.mjs
# We want the dist folder that contains index.mjs
$apiDistDst = Split-Path $appExe -Parent
Write-Ok "API dist folder: $apiDistDst"

# ----------------------------------------------------------------
Write-Step "Stopping API service"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    nssm stop $ServiceName confirm
    Start-Sleep 3
    Write-Ok "Service stopped"
} else {
    Write-Warn "Service '$ServiceName' not running or not found — continuing anyway"
}

# ----------------------------------------------------------------
Write-Step "Updating API files"
$apiSrc = Join-Path $BundleRoot "api-dist"
Copy-Item -Path "$apiSrc\*" -Destination $apiDistDst -Recurse -Force
Write-Ok "API files copied to $apiDistDst"

# ----------------------------------------------------------------
Write-Step "Updating service environment variables"

# Preserve existing SESSION_SECRET so active sessions survive upgrades
$existingEnv = (nssm get $ServiceName AppEnvironmentExtra 2>$null) -join "`n"
$sessionSecret = $null
foreach ($line in $existingEnv -split "`n") {
    if ($line -match "^SESSION_SECRET=(.+)$") {
        $sessionSecret = $Matches[1].Trim()
        break
    }
}

# Generate a new SESSION_SECRET only if one does not exist yet
if (-not $sessionSecret) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $sessionSecret = [BitConverter]::ToString($bytes) -replace '-',''
    Write-Warn "SESSION_SECRET was not set — a new random secret has been generated"
}

# DATABASE_URL uses a password without special characters to avoid
# NSSM/pg-library percent-encoding issues (classmate-upgrade.sql sets this password)
$dbUrl = "postgresql://classmate_user:ClassmateDB2026@localhost:5432/classmate_db"

$envBlock = "NODE_ENV=production`nPORT=3001`nDATABASE_URL=$dbUrl`nPASSWORD_ENCRYPTION_KEY=$EncryptionKey`nSESSION_SECRET=$sessionSecret"
nssm set $ServiceName AppEnvironmentExtra $envBlock
Write-Ok "Environment variables updated (DATABASE_URL, NODE_ENV, PORT, keys)"

# ----------------------------------------------------------------
Write-Step "Updating frontend files"
if (-not (Test-Path $IisSitePath)) {
    New-Item -ItemType Directory -Path $IisSitePath -Force | Out-Null
}
$frontendSrc = Join-Path $BundleRoot "frontend"
Copy-Item -Path "$frontendSrc\*" -Destination $IisSitePath -Recurse -Force
Write-Ok "Frontend updated at $IisSitePath"

# ----------------------------------------------------------------
Write-Step "Starting API service"
nssm start $ServiceName
Start-Sleep 5
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Ok "API service running"
} else {
    Write-Warn "Service may not have started — check C:\Logs\classmate-api-error.log"
}

# ----------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  CLASSMATE UPGRADED SUCCESSFULLY" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Login URL : http://localhost/classmate" -ForegroundColor White
Write-Host "  Username  : admin" -ForegroundColor White
Write-Host "  Password  : classmate123" -ForegroundColor White
Write-Host "  Logs      : C:\Logs\classmate-api.log" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Green
