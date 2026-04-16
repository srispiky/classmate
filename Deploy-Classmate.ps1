#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Classmate - Automated Windows Deployment Script

.DESCRIPTION
    Installs all dependencies, configures PostgreSQL, builds the application,
    registers the API as a Windows Service, and sets up IIS to host the app.

.NOTES
    Requirements:
      - Windows 10/11 or Windows Server 2019+
      - Run PowerShell as Administrator
      - Internet connection (for downloading dependencies)
      - Run from the root of the extracted Classmate project folder

    Usage:
      Right-click Deploy-Classmate.ps1 -> "Run with PowerShell" (as Admin)
      OR from an Admin PowerShell terminal:
        Set-ExecutionPolicy Bypass -Scope Process -Force
        .\Deploy-Classmate.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ==============================================================================
# CONFIGURATION  — Adjust these values before running
# ==============================================================================

$Config = @{

    # --- Database ---
    DbName          = "classmate_db"
    DbUser          = "classmate_user"
    DbPassword      = "ClassmateDb@2024!"        # Change this!
    DbPort          = 5432

    # --- IIS Site ---
    SiteName        = "Classmate"
    SitePort        = 80                          # Port users will browse to
    IisSitePath     = "C:\inetpub\classmate"      # Where static files are copied

    # --- API Service ---
    ApiPort         = 8080                        # Internal Node.js API port (not public)
    ServiceName     = "ClassmateAPI"

    # --- Session Secret (auto-generated; override if needed) ---
    SessionSecret   = -join ((65..90) + (97..122) + (48..57) |
                        Get-Random -Count 40 |
                        ForEach-Object { [char]$_ })

    # --- Source ---
    AppRoot         = $PSScriptRoot               # Folder containing this script
}

# ==============================================================================
# HELPERS
# ==============================================================================

function Write-Step  { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "    [FAIL] $msg" -ForegroundColor Red }

function Invoke-Choco {
    param([string]$Package, [string[]]$Extra = @())
    $installed = choco list --local-only $Package 2>$null | Select-String $Package
    if ($installed) {
        Write-Ok "$Package already installed"
    } else {
        Write-Host "    Installing $Package..."
        choco install $Package -y --no-progress @Extra
        if ($LASTEXITCODE -ne 0) { throw "Failed to install $Package" }
        Write-Ok "$Package installed"
    }
}

function Wait-ForPort {
    param([int]$Port, [int]$TimeoutSec = 30)
    $end = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $end) {
        try {
            $conn = New-Object System.Net.Sockets.TcpClient("localhost", $Port)
            $conn.Close()
            return $true
        } catch { Start-Sleep 1 }
    }
    return $false
}

# ==============================================================================
# STEP 0 — Validate working directory
# ==============================================================================

Write-Step "Validating project directory"
$requiredPaths = @("artifacts/api-server", "artifacts/classmate", "lib/api-spec", "pnpm-workspace.yaml")
foreach ($p in $requiredPaths) {
    if (-not (Test-Path (Join-Path $Config.AppRoot $p))) {
        Write-Fail "Missing: $p"
        Write-Host "  Run this script from the root of the extracted Classmate project." -ForegroundColor Red
        exit 1
    }
}
Write-Ok "Project directory looks good: $($Config.AppRoot)"

Set-Location $Config.AppRoot

# ==============================================================================
# STEP 1 — Chocolatey
# ==============================================================================

Write-Step "Checking Chocolatey package manager"
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "    Installing Chocolatey..."
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:PATH += ";$env:ALLUSERSPROFILE\chocolatey\bin"
    Write-Ok "Chocolatey installed"
} else {
    Write-Ok "Chocolatey already available"
}

# ==============================================================================
# STEP 2 — Node.js
# ==============================================================================

Write-Step "Installing Node.js LTS"
Invoke-Choco "nodejs-lts"

# Refresh PATH so node/npm are available
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("PATH", "User")

$nodeVersion = node --version 2>&1
Write-Ok "Node.js version: $nodeVersion"

# ==============================================================================
# STEP 3 — pnpm
# ==============================================================================

Write-Step "Installing pnpm"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    npm install -g pnpm | Out-Null
    $env:PATH += ";$env:APPDATA\npm"
    Write-Ok "pnpm installed"
} else {
    Write-Ok "pnpm already available: $(pnpm --version)"
}

# ==============================================================================
# STEP 4 — PostgreSQL
# ==============================================================================

Write-Step "Installing PostgreSQL"
Invoke-Choco "postgresql16" "--params" "/Password:$($Config.DbPassword)"

# Add pg binaries to PATH
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
if (Test-Path $pgBin) {
    $env:PATH += ";$pgBin"
} else {
    # Try other versions
    $pgBins = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
              Sort-Object Name -Descending |
              Select-Object -First 1
    if ($pgBins) { $env:PATH += ";$($pgBins.FullName)\bin" }
}

# Wait for PostgreSQL to start
$pgStarted = Wait-ForPort -Port $Config.DbPort -TimeoutSec 60
if (-not $pgStarted) {
    Write-Warn "PostgreSQL port not responding, attempting service start..."
    Get-Service | Where-Object { $_.Name -like "postgresql*" } | Start-Service
    $pgStarted = Wait-ForPort -Port $Config.DbPort -TimeoutSec 30
    if (-not $pgStarted) { throw "PostgreSQL failed to start" }
}
Write-Ok "PostgreSQL is running on port $($Config.DbPort)"

# ==============================================================================
# STEP 5 — Create database and user
# ==============================================================================

Write-Step "Setting up PostgreSQL database"

$env:PGPASSWORD = $Config.DbPassword

# Create user if not exists
$userCheck = psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$($Config.DbUser)'" 2>&1
if ($userCheck -ne "1") {
    Write-Host "    Creating database user '$($Config.DbUser)'..."
    psql -U postgres -c "CREATE USER $($Config.DbUser) WITH PASSWORD '$($Config.DbPassword)';" | Out-Null
    Write-Ok "Database user created"
} else {
    Write-Ok "Database user '$($Config.DbUser)' already exists"
}

# Create database if not exists
$dbCheck = psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$($Config.DbName)'" 2>&1
if ($dbCheck -ne "1") {
    Write-Host "    Creating database '$($Config.DbName)'..."
    psql -U postgres -c "CREATE DATABASE $($Config.DbName) OWNER $($Config.DbUser);" | Out-Null
    Write-Ok "Database '$($Config.DbName)' created"
} else {
    Write-Ok "Database '$($Config.DbName)' already exists"
}

# Grant privileges
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $($Config.DbName) TO $($Config.DbUser);" | Out-Null

# Import the SQL dump
$sqlDump = Join-Path $Config.AppRoot "classmate_db_export.sql"
if (Test-Path $sqlDump) {
    Write-Host "    Importing database from classmate_db_export.sql..."
    $env:PGPASSWORD = $Config.DbPassword
    psql -U $Config.DbUser -d $Config.DbName -f $sqlDump | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Database imported successfully"
    } else {
        Write-Warn "Import completed with warnings (this may be normal for duplicate data)"
    }
} else {
    Write-Warn "classmate_db_export.sql not found — skipping data import (schema will be empty)"
}

$Config.DatabaseUrl = "postgresql://$($Config.DbUser):$($Config.DbPassword)@localhost:$($Config.DbPort)/$($Config.DbName)"

# ==============================================================================
# STEP 6 — Install Node dependencies & Build
# ==============================================================================

Write-Step "Installing Node.js dependencies (this may take a few minutes)"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Frozen lockfile failed, retrying without..."
    pnpm install
}
Write-Ok "Dependencies installed"

# --- Build API server ---
Write-Step "Building API server"
$env:NODE_ENV = "production"
pnpm --filter "@workspace/api-server" run build
if ($LASTEXITCODE -ne 0) { throw "API server build failed" }
Write-Ok "API server built"

# --- Build frontend ---
Write-Step "Building frontend (React/Vite)"
$env:PORT     = "3000"
$env:BASE_PATH = "/"
pnpm --filter "@workspace/classmate" run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
Write-Ok "Frontend built"

# ==============================================================================
# STEP 7 — Write .env files
# ==============================================================================

Write-Step "Writing environment configuration"

$apiEnv = @"
PORT=$($Config.ApiPort)
DATABASE_URL=$($Config.DatabaseUrl)
NODE_ENV=production
SESSION_SECRET=$($Config.SessionSecret)
"@
Set-Content -Path (Join-Path $Config.AppRoot "artifacts\api-server\.env") -Value $apiEnv -Encoding UTF8
Write-Ok "API .env written"

# ==============================================================================
# STEP 8 — Enable IIS
# ==============================================================================

Write-Step "Enabling IIS and required Windows features"

$iisFeatures = @(
    "IIS-WebServerRole",
    "IIS-WebServer",
    "IIS-CommonHttpFeatures",
    "IIS-StaticContent",
    "IIS-DefaultDocument",
    "IIS-DirectoryBrowsing",
    "IIS-HttpErrors",
    "IIS-HttpRedirect",
    "IIS-ApplicationDevelopment",
    "IIS-CGI",
    "IIS-ISAPIExtensions",
    "IIS-ISAPIFilter",
    "IIS-WebServerManagementTools",
    "IIS-ManagementConsole",
    "IIS-HttpCompressionStatic",
    "IIS-HttpCompressionDynamic",
    "IIS-URLAuthorization",
    "IIS-RequestFiltering",
    "IIS-HttpLogging"
)

foreach ($feature in $iisFeatures) {
    $state = (Get-WindowsOptionalFeature -Online -FeatureName $feature -ErrorAction SilentlyContinue).State
    if ($state -ne "Enabled") {
        Enable-WindowsOptionalFeature -Online -FeatureName $feature -NoRestart -All | Out-Null
    }
}
Write-Ok "IIS features enabled"

# ==============================================================================
# STEP 9 — Install IIS URL Rewrite & ARR modules
# ==============================================================================

Write-Step "Installing IIS URL Rewrite and Application Request Routing"

# URL Rewrite Module
$urlRewriteKey = "HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite"
if (-not (Test-Path $urlRewriteKey)) {
    Write-Host "    Downloading URL Rewrite module..."
    $urlRewriteMsi = "$env:TEMP\urlrewrite2.msi"
    Invoke-WebRequest -Uri "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi" `
                      -OutFile $urlRewriteMsi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$urlRewriteMsi`" /qn /norestart" -Wait
    Write-Ok "URL Rewrite installed"
} else {
    Write-Ok "URL Rewrite already installed"
}

# ARR (Application Request Routing) for reverse proxy
$arrKey = "HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing"
if (-not (Test-Path $arrKey)) {
    Write-Host "    Downloading ARR module..."
    $arrMsi = "$env:TEMP\ARRv3_0.msi"
    Invoke-WebRequest -Uri "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi" `
                      -OutFile $arrMsi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$arrMsi`" /qn /norestart" -Wait
    Write-Ok "ARR installed"
} else {
    Write-Ok "ARR already installed"
}

# Enable ARR proxy
Import-Module WebAdministration -ErrorAction SilentlyContinue
$arrProxy = Get-WebConfigurationProperty -pspath "MACHINE/WEBROOT/APPHOST" `
    -filter "system.webServer/proxy" -name "enabled" -ErrorAction SilentlyContinue
if ($arrProxy.Value -ne $true) {
    Set-WebConfigurationProperty -pspath "MACHINE/WEBROOT/APPHOST" `
        -filter "system.webServer/proxy" -name "enabled" -value $true -ErrorAction SilentlyContinue
}
Write-Ok "ARR reverse proxy enabled"

# ==============================================================================
# STEP 10 — Copy frontend static files to IIS
# ==============================================================================

Write-Step "Deploying frontend static files to IIS"

if (-not (Test-Path $Config.IisSitePath)) {
    New-Item -ItemType Directory -Path $Config.IisSitePath -Force | Out-Null
}

$distPath = Join-Path $Config.AppRoot "artifacts\classmate\dist\public"
if (-not (Test-Path $distPath)) {
    throw "Frontend build output not found at: $distPath. Did the build succeed?"
}

Copy-Item -Path "$distPath\*" -Destination $Config.IisSitePath -Recurse -Force
Write-Ok "Frontend files copied to $($Config.IisSitePath)"

# --- Write IIS web.config ---
$webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- Reverse proxy: forward /api/* to the Node.js API server -->
        <rule name="API Proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://localhost:$($Config.ApiPort)/api/{R:1}" />
        </rule>
        <!-- SPA fallback: serve index.html for all non-file routes -->
        <rule name="SPA Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile"      negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <staticContent>
      <mimeMap fileExtension=".json"    mimeType="application/json" />
      <mimeMap fileExtension=".webp"   mimeType="image/webp" />
      <mimeMap fileExtension=".woff"   mimeType="font/woff" />
      <mimeMap fileExtension=".woff2"  mimeType="font/woff2" />
    </staticContent>
    <httpProtocol>
      <customHeaders>
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options"        value="SAMEORIGIN" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
"@
Set-Content -Path (Join-Path $Config.IisSitePath "web.config") -Value $webConfig -Encoding UTF8
Write-Ok "web.config written"

# ==============================================================================
# STEP 11 — Create IIS Site
# ==============================================================================

Write-Step "Configuring IIS website"

Import-Module WebAdministration

# Remove existing site with the same name (clean reinstall)
if (Get-WebSite -Name $Config.SiteName -ErrorAction SilentlyContinue) {
    Write-Warn "IIS site '$($Config.SiteName)' already exists — removing and recreating"
    Remove-WebSite -Name $Config.SiteName
}

# Stop Default Web Site if it's on port 80
$defaultSite = Get-WebSite -Name "Default Web Site" -ErrorAction SilentlyContinue
if ($defaultSite -and $defaultSite.State -eq "Started" -and $Config.SitePort -eq 80) {
    Write-Warn "Stopping Default Web Site (conflicts on port 80)"
    Stop-WebSite -Name "Default Web Site"
}

New-WebSite -Name $Config.SiteName `
            -Port $Config.SitePort `
            -PhysicalPath $Config.IisSitePath `
            -Force | Out-Null

Start-WebSite -Name $Config.SiteName
Write-Ok "IIS site '$($Config.SiteName)' created on port $($Config.SitePort)"

# ==============================================================================
# STEP 12 — Windows Service for API (NSSM)
# ==============================================================================

Write-Step "Installing NSSM (service manager)"
Invoke-Choco "nssm"

Write-Step "Registering Classmate API as a Windows Service"

$nodePath   = (Get-Command node).Source
$apiIndex   = Join-Path $Config.AppRoot "artifacts\api-server\dist\index.mjs"

if (-not (Test-Path $apiIndex)) {
    throw "API build not found at: $apiIndex"
}

# Remove existing service if present
$existingSvc = Get-Service -Name $Config.ServiceName -ErrorAction SilentlyContinue
if ($existingSvc) {
    Write-Warn "Service '$($Config.ServiceName)' exists — stopping and removing"
    if ($existingSvc.Status -eq "Running") { nssm stop $Config.ServiceName confirm }
    nssm remove $Config.ServiceName confirm
    Start-Sleep 2
}

# Create service
nssm install $Config.ServiceName $nodePath "--enable-source-maps `"$apiIndex`""

# Configure service settings
nssm set $Config.ServiceName AppDirectory       (Join-Path $Config.AppRoot "artifacts\api-server")
nssm set $Config.ServiceName AppStdout          "C:\Logs\classmate-api.log"
nssm set $Config.ServiceName AppStderr          "C:\Logs\classmate-api-error.log"
nssm set $Config.ServiceName AppRotateFiles      1
nssm set $Config.ServiceName AppRotateSeconds    86400
nssm set $Config.ServiceName Description        "Classmate API Server (Node.js/Express)"
nssm set $Config.ServiceName Start              SERVICE_AUTO_START

# Set environment variables for the service
$envString = "PORT=$($Config.ApiPort)" +
             "`nDATABASE_URL=$($Config.DatabaseUrl)" +
             "`nNODE_ENV=production" +
             "`nSESSION_SECRET=$($Config.SessionSecret)"
nssm set $Config.ServiceName AppEnvironmentExtra $envString

# Create log directory
New-Item -ItemType Directory -Path "C:\Logs" -Force | Out-Null

# Start the service
nssm start $Config.ServiceName
Write-Ok "Service '$($Config.ServiceName)' registered and started"

# Wait for API to be ready
Write-Host "    Waiting for API to start on port $($Config.ApiPort)..."
$apiReady = Wait-ForPort -Port $Config.ApiPort -TimeoutSec 45
if ($apiReady) {
    Write-Ok "API is responding on port $($Config.ApiPort)"
} else {
    Write-Warn "API did not respond in time. Check C:\Logs\classmate-api-error.log"
}

# ==============================================================================
# STEP 13 — Firewall rule for IIS site
# ==============================================================================

Write-Step "Adding Windows Firewall rule"
$fwRule = Get-NetFirewallRule -DisplayName "Classmate HTTP" -ErrorAction SilentlyContinue
if (-not $fwRule) {
    New-NetFirewallRule -DisplayName "Classmate HTTP" `
                        -Direction Inbound `
                        -Protocol TCP `
                        -LocalPort $Config.SitePort `
                        -Action Allow | Out-Null
    Write-Ok "Firewall rule added for port $($Config.SitePort)"
} else {
    Write-Ok "Firewall rule already exists"
}

# ==============================================================================
# DONE
# ==============================================================================

$computerName = $env:COMPUTERNAME
$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Ethernet* -ErrorAction SilentlyContinue |
       Select-Object -First 1).IPAddress
if (-not $ip) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
           Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" } |
           Select-Object -First 1).IPAddress
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  CLASSMATE DEPLOYED SUCCESSFULLY" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  App URL    : http://localhost:$($Config.SitePort)" -ForegroundColor White
if ($ip) {
Write-Host "  Network URL: http://${ip}:$($Config.SitePort)" -ForegroundColor White
}
Write-Host ""
Write-Host "  Database   : $($Config.DbName) @ localhost:$($Config.DbPort)" -ForegroundColor White
Write-Host "  API Service: $($Config.ServiceName)  (port $($Config.ApiPort), internal only)" -ForegroundColor White
Write-Host "  Logs       : C:\Logs\classmate-api.log" -ForegroundColor White
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor Yellow
Write-Host "    nssm restart $($Config.ServiceName)    — restart the API" -ForegroundColor Gray
Write-Host "    nssm status  $($Config.ServiceName)    — check API status" -ForegroundColor Gray
Write-Host "    iisreset                       — restart IIS" -ForegroundColor Gray
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
