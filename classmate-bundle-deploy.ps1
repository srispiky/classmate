#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Config = @{
    DbName          = "classmate_db"
    DbUser          = "classmate_user"
    DbPassword      = "ClassmateDb@2024!"
    DbPort          = 5432
    AppAlias        = "classmate"
    IisSitePath     = "C:\inetpub\classmate"
    ApiPort         = 8080
    ServiceName     = "ClassmateAPI"
    SessionSecret   = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
    BundleRoot      = $PSScriptRoot
    PostgresPassword = ""
    DatabaseUrl     = ""
}

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }

function Invoke-Choco {
    param([string]$Package, [string[]]$Extra = @())
    $installed = choco list --local-only $Package 2>$null | Select-String $Package
    if ($installed) {
        Write-Ok "$Package already installed"
        return
    }
    Write-Host "    Installing $Package..."
    choco install $Package -y --no-progress @Extra
    if ($LASTEXITCODE -ne 0) { throw "Failed to install $Package" }
    Write-Ok "$Package installed"
}

function Wait-ForPort {
    param([int]$Port, [int]$TimeoutSec = 30)
    $end = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $end) {
        try {
            $c = New-Object System.Net.Sockets.TcpClient("localhost", $Port)
            $c.Close()
            return $true
        }
        catch { Start-Sleep 1 }
    }
    return $false
}

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

Write-Step "Validating bundle contents"
$needed = @("api-dist\index.mjs", "frontend\index.html", "classmate_db_export.sql")
foreach ($item in $needed) {
    $full = Join-Path $Config.BundleRoot $item
    if (-not (Test-Path $full)) {
        Write-Host "    [FAIL] Missing: $full" -ForegroundColor Red
        Write-Host "    Run this script from inside the classmate-deploy folder." -ForegroundColor Red
        exit 1
    }
}
Write-Ok "Bundle valid: $($Config.BundleRoot)"
Set-Location $Config.BundleRoot

Write-Step "Checking Chocolatey"
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:PATH += ";$env:ALLUSERSPROFILE\chocolatey\bin"
    Write-Ok "Chocolatey installed"
}
else {
    Write-Ok "Chocolatey already available"
}

Write-Step "Installing Node.js LTS"
Invoke-Choco "nodejs-lts"
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("PATH", "User")
Write-Ok "Node.js: $(node --version)"

Write-Step "Checking PostgreSQL"
$psqlPath = Find-PsqlPath
$pgRunning = Wait-ForPort -Port $Config.DbPort -TimeoutSec 5

if ($psqlPath -and $pgRunning) {
    Write-Ok "PostgreSQL already installed and running"
    Write-Ok "psql found at: $psqlPath"
    $pgBinDir = Split-Path $psqlPath -Parent
    if ($env:PATH -notlike "*$pgBinDir*") {
        $env:PATH += ";$pgBinDir"
    }
    Write-Host ""
    Write-Host "    Your existing PostgreSQL installation was detected." -ForegroundColor Yellow
    Write-Host "    Enter the 'postgres' superuser password (set during install):" -ForegroundColor Yellow
    $secure = Read-Host "    postgres password" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $Config.PostgresPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
else {
    Write-Host "    PostgreSQL not found - installing via Chocolatey..."
    Invoke-Choco "postgresql16" "--params" "/Password:$($Config.DbPassword)"
    $pgBin = "C:\Program Files\PostgreSQL\16\bin"
    if (-not (Test-Path $pgBin)) {
        $pg = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
              Sort-Object Name -Descending | Select-Object -First 1
        if ($pg) { $pgBin = Join-Path $pg.FullName "bin" }
    }
    $env:PATH += ";$pgBin"
    $pgReady = Wait-ForPort -Port $Config.DbPort -TimeoutSec 60
    if (-not $pgReady) {
        Write-Warn "Not responding - trying to start service..."
        Get-Service | Where-Object { $_.Name -like "postgresql*" } | Start-Service
        if (-not (Wait-ForPort -Port $Config.DbPort -TimeoutSec 30)) {
            throw "PostgreSQL failed to start"
        }
    }
    $Config.PostgresPassword = $Config.DbPassword
    Write-Ok "PostgreSQL installed and running"
}

Write-Step "Setting up database"
$env:PGPASSWORD = $Config.PostgresPassword
$testResult = psql -U postgres -tAc "SELECT 1" 2>&1
if ($testResult -notlike "*1*") {
    Write-Host "    [FAIL] Cannot connect as postgres user." -ForegroundColor Red
    Write-Host "    Error: $testResult" -ForegroundColor Red
    Write-Host "    Check your password and try again." -ForegroundColor Red
    exit 1
}
Write-Ok "Connected to PostgreSQL as superuser"

$userExists = psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$($Config.DbUser)'" 2>&1
if ($userExists -notlike "*1*") {
    psql -U postgres -c "CREATE USER $($Config.DbUser) WITH PASSWORD '$($Config.DbPassword)';" | Out-Null
    Write-Ok "User '$($Config.DbUser)' created"
}
else {
    psql -U postgres -c "ALTER USER $($Config.DbUser) WITH PASSWORD '$($Config.DbPassword)';" | Out-Null
    Write-Ok "User '$($Config.DbUser)' already exists"
}

$dbExists = psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$($Config.DbName)'" 2>&1
if ($dbExists -like "*1*") {
    Write-Warn "Database '$($Config.DbName)' exists - dropping for a clean import"
    psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$($Config.DbName)';" | Out-Null
    psql -U postgres -c "DROP DATABASE $($Config.DbName);" | Out-Null
}
psql -U postgres -c "CREATE DATABASE $($Config.DbName) OWNER $($Config.DbUser);" | Out-Null
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $($Config.DbName) TO $($Config.DbUser);" | Out-Null
Write-Ok "Database '$($Config.DbName)' ready"

$env:PGPASSWORD = $Config.DbPassword
$sqlFile = Join-Path $Config.BundleRoot "classmate_db_export.sql"
Write-Host "    Importing data..."
psql -U $Config.DbUser -d $Config.DbName -f $sqlFile
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Database imported successfully"
}
else {
    Write-Warn "Import finished with warnings (usually safe to continue)"
}

$Config.DatabaseUrl = "postgresql://" + $Config.DbUser + ":" + $Config.DbPassword + "@localhost:" + $Config.DbPort + "/" + $Config.DbName

Write-Step "Enabling IIS features"
$iisFeatures = @(
    "IIS-WebServerRole", "IIS-WebServer", "IIS-CommonHttpFeatures", "IIS-StaticContent",
    "IIS-DefaultDocument", "IIS-DirectoryBrowsing", "IIS-HttpErrors",
    "IIS-ApplicationDevelopment", "IIS-ISAPIExtensions", "IIS-ISAPIFilter",
    "IIS-WebServerManagementTools", "IIS-ManagementConsole",
    "IIS-HttpCompressionStatic", "IIS-RequestFiltering", "IIS-HttpLogging"
)
foreach ($f in $iisFeatures) {
    $state = (Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction SilentlyContinue).State
    if ($state -ne "Enabled") {
        Enable-WindowsOptionalFeature -Online -FeatureName $f -NoRestart -All | Out-Null
    }
}
Write-Ok "IIS features enabled"

Write-Step "Installing URL Rewrite module"
if (-not (Test-Path "HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite")) {
    $msi = Join-Path $env:TEMP "urlrewrite2.msi"
    $url = "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi"
    Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
    Write-Ok "URL Rewrite installed"
}
else {
    Write-Ok "URL Rewrite already installed"
}

Write-Step "Installing ARR module"
if (-not (Test-Path "HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing")) {
    $msi = Join-Path $env:TEMP "ARRv3_0.msi"
    $url = "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi"
    Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
    Write-Ok "ARR installed"
}
else {
    Write-Ok "ARR already installed"
}

Import-Module WebAdministration -ErrorAction SilentlyContinue
$arrEnabled = Get-WebConfigurationProperty -pspath "MACHINE/WEBROOT/APPHOST" -filter "system.webServer/proxy" -name "enabled" -ErrorAction SilentlyContinue
if ($arrEnabled.Value -ne $true) {
    Set-WebConfigurationProperty -pspath "MACHINE/WEBROOT/APPHOST" -filter "system.webServer/proxy" -name "enabled" -value $true -ErrorAction SilentlyContinue
}
Write-Ok "ARR proxy enabled"

Write-Step "Deploying frontend to IIS"
if (-not (Test-Path $Config.IisSitePath)) {
    New-Item -ItemType Directory -Path $Config.IisSitePath -Force | Out-Null
}
$frontendSrc = Join-Path $Config.BundleRoot "frontend"
Copy-Item -Path "$frontendSrc\*" -Destination $Config.IisSitePath -Recurse -Force
Write-Ok "Frontend copied to $($Config.IisSitePath)"

$proxyPort = $Config.ApiPort
$webConfigPath = Join-Path $Config.IisSitePath "web.config"
$xmlLines = @(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<configuration>',
    '  <system.webServer>',
    '    <rewrite>',
    '      <rules>',
    '        <rule name="Classmate API Proxy" stopProcessing="true">',
    "          <match url=""^api/(.*)"" />",
    "          <action type=""Rewrite"" url=""http://localhost:$proxyPort/api/{R:1}"" />",
    '        </rule>',
    '        <rule name="Classmate SPA Fallback" stopProcessing="true">',
    '          <match url=".*" />',
    '          <conditions logicalGrouping="MatchAll">',
    '            <add input="{REQUEST_FILENAME}" matchType="IsFile"      negate="true" />',
    '            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />',
    '          </conditions>',
    '          <action type="Rewrite" url="/classmate/index.html" />',
    '        </rule>',
    '      </rules>',
    '    </rewrite>',
    '    <staticContent>',
    '      <remove fileExtension=".json" />',
    '      <mimeMap fileExtension=".json"  mimeType="application/json" />',
    '      <remove fileExtension=".webp" />',
    '      <mimeMap fileExtension=".webp"  mimeType="image/webp" />',
    '      <remove fileExtension=".woff" />',
    '      <mimeMap fileExtension=".woff"  mimeType="font/woff" />',
    '      <remove fileExtension=".woff2" />',
    '      <mimeMap fileExtension=".woff2" mimeType="font/woff2" />',
    '    </staticContent>',
    '  </system.webServer>',
    '</configuration>'
)
$xmlLines | Set-Content -Path $webConfigPath -Encoding UTF8
Write-Ok "web.config written"

Write-Step "Configuring IIS virtual application"
Import-Module WebAdministration
if (Get-WebApplication -Site "Default Web Site" -Name $Config.AppAlias -ErrorAction SilentlyContinue) {
    Write-Warn "Virtual app '$($Config.AppAlias)' exists - removing"
    Remove-WebApplication -Site "Default Web Site" -Name $Config.AppAlias
}
$defaultSite = Get-WebSite -Name "Default Web Site" -ErrorAction SilentlyContinue
if (-not $defaultSite) {
    New-WebSite -Name "Default Web Site" -Port 80 -PhysicalPath "C:\inetpub\wwwroot" -Force | Out-Null
}
if ((Get-WebSite -Name "Default Web Site").State -ne "Started") {
    Start-WebSite -Name "Default Web Site"
}
New-WebApplication -Site "Default Web Site" -Name $Config.AppAlias -PhysicalPath $Config.IisSitePath -Force | Out-Null
Write-Ok "Virtual app '/classmate' created under Default Web Site"

Write-Step "Installing NSSM"
Invoke-Choco "nssm"

Write-Step "Registering API as Windows Service"
$nodePath = (Get-Command node).Source
$apiIndex = Join-Path $Config.BundleRoot "api-dist\index.mjs"

$existingSvc = Get-Service -Name $Config.ServiceName -ErrorAction SilentlyContinue
if ($existingSvc) {
    Write-Warn "Removing existing service"
    if ($existingSvc.Status -eq "Running") { nssm stop $Config.ServiceName confirm }
    nssm remove $Config.ServiceName confirm
    Start-Sleep 2
}

nssm install $Config.ServiceName $nodePath $apiIndex
nssm set $Config.ServiceName AppDirectory   $Config.BundleRoot
nssm set $Config.ServiceName AppStdout      "C:\Logs\classmate-api.log"
nssm set $Config.ServiceName AppStderr      "C:\Logs\classmate-api-error.log"
nssm set $Config.ServiceName AppRotateFiles  1
nssm set $Config.ServiceName Description    "Classmate API Server"
nssm set $Config.ServiceName Start          SERVICE_AUTO_START

$envVars = "PORT=" + $Config.ApiPort + "`n" +
           "DATABASE_URL=" + $Config.DatabaseUrl + "`n" +
           "NODE_ENV=production`n" +
           "SESSION_SECRET=" + $Config.SessionSecret
nssm set $Config.ServiceName AppEnvironmentExtra $envVars

New-Item -ItemType Directory -Path "C:\Logs" -Force | Out-Null
nssm start $Config.ServiceName

Write-Host "    Waiting for API on port $($Config.ApiPort)..."
if (Wait-ForPort -Port $Config.ApiPort -TimeoutSec 45) {
    Write-Ok "API is responding"
}
else {
    Write-Warn "API did not respond - check C:\Logs\classmate-api-error.log"
}

Write-Step "Adding firewall rule"
if (-not (Get-NetFirewallRule -DisplayName "Classmate HTTP" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Classmate HTTP" -Direction Inbound -Protocol TCP -LocalPort $Config.SitePort -Action Allow | Out-Null
    Write-Ok "Firewall rule added"
}
else {
    Write-Ok "Firewall rule already exists"
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { ($_.IPAddress -notlike "127.*") -and ($_.IPAddress -notlike "169.*") } |
       Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  CLASSMATE DEPLOYED SUCCESSFULLY" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  App URL    : http://localhost/$($Config.AppAlias)" -ForegroundColor White
if ($ip) {
    Write-Host "  Network URL: http://${ip}/$($Config.AppAlias)" -ForegroundColor White
}
Write-Host "  Logs       : C:\Logs\classmate-api.log" -ForegroundColor White
Write-Host "  Restart API: nssm restart $($Config.ServiceName)" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Green
