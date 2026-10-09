param(
    [string]$DataDir = "$env:LOCALAPPDATA\Flightdeck",
    [string]$Username = "flightdeck",
    [string]$Password = "flightdeck",
    [int]$OrcaPort = 3011,
    [int]$BambuPort = 3012,
    [switch]$OrcaOnly,
    [switch]$BambuOnly,
    [switch]$Force,
    [switch]$InstallDockerDesktop,
    [switch]$SkipFlightdeckSettings,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$OrcaName = "flightdeck-orcaslicer"
$BambuName = "flightdeck-bambustudio"
$OrcaImage = "lscr.io/linuxserver/orcaslicer:latest"
$BambuImage = "lscr.io/linuxserver/bambustudio:latest"
$Tz = if ($env:TZ) { $env:TZ } else { "Australia/Sydney" }

function Write-Step {
    param([string]$Message)
    Write-Host "== $Message =="
}

function Get-DockerPath {
    $Docker = Get-Command docker.exe -ErrorAction SilentlyContinue
    if (-not $Docker -and $InstallDockerDesktop) {
        $Winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $Winget) {
            throw "Docker Desktop is required, but winget is not available. Install Docker Desktop manually, then run this again."
        }
        Write-Host "Docker was not found. Installing Docker Desktop with winget..."
        & $Winget.Source install --id Docker.DockerDesktop --exact --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Desktop install failed. Install it manually, then run this again."
        }
        $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
        $Docker = Get-Command docker.exe -ErrorAction SilentlyContinue
    }
    if (-not $Docker) {
        throw "Docker was not found. Install Docker Desktop, or run this helper with -InstallDockerDesktop."
    }
    return $Docker.Source
}

function Wait-DockerReady {
    $DockerPath = Get-DockerPath
    try {
        & $DockerPath info *> $null
        if ($LASTEXITCODE -eq 0) { return $DockerPath }
    } catch {
        # Docker Desktop may simply be closed; try to start it below.
    }

    $DockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $DockerDesktop) {
        Write-Host "Docker Desktop is not ready. Starting it now..."
        Start-Process -FilePath $DockerDesktop -WindowStyle Hidden
    }

    $Deadline = (Get-Date).AddSeconds(120)
    do {
        Start-Sleep -Seconds 3
        try {
            & $DockerPath info *> $null
            if ($LASTEXITCODE -eq 0) { return $DockerPath }
        } catch {
            # Keep waiting until the deadline.
        }
    } while ((Get-Date) -lt $Deadline)

    throw "Docker Desktop did not become ready within 120 seconds."
}

function Get-ContainerState {
    param(
        [string]$DockerPath,
        [string]$Name
    )
    $state = & $DockerPath inspect -f "{{.State.Status}}" $Name 2>$null
    if ($LASTEXITCODE -ne 0) { return "" }
    return ($state | Select-Object -First 1).Trim()
}

function Get-ContainerImage {
    param(
        [string]$DockerPath,
        [string]$Name
    )
    $image = & $DockerPath inspect -f "{{.Config.Image}}" $Name 2>$null
    if ($LASTEXITCODE -ne 0) { return "" }
    return ($image | Select-Object -First 1).Trim()
}

function Ensure-SlicerContainer {
    param(
        [string]$DockerPath,
        [string]$Name,
        [string]$Image,
        [string]$ConfigDir,
        [string]$PrintDir,
        [int]$HostPort,
        [string]$Title
    )

    New-Item -ItemType Directory -Force -Path $ConfigDir, $PrintDir | Out-Null

    $state = Get-ContainerState -DockerPath $DockerPath -Name $Name
    $imageNow = if ($state) { Get-ContainerImage -DockerPath $DockerPath -Name $Name } else { "" }

    if ($CheckOnly) {
        if ($state) {
            Write-Host "${Name}: $state ($imageNow)"
        } else {
            Write-Host "${Name}: not created"
        }
        return
    }

    if ($state -and -not $Force) {
        if ($state -eq "running") {
            Write-Host "$Name is already running."
            return
        }
        Write-Host "Starting existing $Name container..."
        & $DockerPath start $Name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not start $Name." }
        return
    }

    if ($state -and $Force) {
        Write-Host "Removing existing $Name container..."
        & $DockerPath rm -f $Name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not remove $Name." }
    }

    Write-Host "Pulling $Image..."
    & $DockerPath pull $Image
    if ($LASTEXITCODE -ne 0) { throw "Could not pull $Image." }

    Write-Host "Creating $Name on https://127.0.0.1:$HostPort ..."
    & $DockerPath run -d `
        --name $Name `
        --restart unless-stopped `
        --security-opt seccomp=unconfined `
        -e "PUID=1000" `
        -e "PGID=1000" `
        -e "TZ=$Tz" `
        -e "CUSTOM_USER=$Username" `
        -e "PASSWORD=$Password" `
        -e "TITLE=$Title" `
        -e "FILE_MANAGER_PATH=/prints" `
        -p "$HostPort`:3001" `
        --shm-size=1g `
        -v "$ConfigDir`:/config" `
        -v "$PrintDir`:/prints" `
        $Image | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create $Name." }
}

function Test-SlicerUrl {
    param(
        [string]$Url,
        [string]$Label
    )
    $Curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $Curl) {
        Write-Host "${Label}: curl.exe not found, skipping URL probe."
        return
    }
    & $Curl.Source -k -sS -u "$Username`:$Password" -m 10 -D - $Url -o NUL | Select-String -Pattern "^HTTP/" | Select-Object -First 1
}

function Save-FlightdeckSlicerSettings {
    $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
    $AppDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
    $Python = Join-Path $AppDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $Python)) {
        Write-Host "Flightdeck venv was not found; skipping slicer URL settings."
        return
    }
    $PrintDir = Join-Path $DataDir "print_library"
    $env:FLIGHTDECK_DATA_DIR = $DataDir
    $env:FLIGHTDECK_PRINT_LIBRARY = $PrintDir
    $env:FLIGHTDECK_ORCA_BROWSER_URL = "https://127.0.0.1:$OrcaPort"
    $env:FLIGHTDECK_BAMBU_BROWSER_URL = "https://127.0.0.1:$BambuPort"
    $env:FLIGHTDECK_BROWSER_SLICER_USER = $Username
    $env:FLIGHTDECK_BROWSER_SLICER_PASSWORD = $Password
    $Code = @"
import os
from app import db
db.init()
settings = db.get_all_settings()
db.set_setting('orcaslicer_docker_url', os.environ['FLIGHTDECK_ORCA_BROWSER_URL'])
db.set_setting('bambustudio_docker_url', os.environ['FLIGHTDECK_BAMBU_BROWSER_URL'])
db.set_setting('orcaslicer_browser_username', os.environ['FLIGHTDECK_BROWSER_SLICER_USER'])
db.set_setting('orcaslicer_browser_password', os.environ['FLIGHTDECK_BROWSER_SLICER_PASSWORD'])
db.set_setting('slicer_open_mode', settings.get('slicer_open_mode') or 'desktop_orca')
db.set_setting('slicer_use_api', settings.get('slicer_use_api') or 'false')
"@
    & $Python -c $Code
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Flightdeck slicer URLs saved."
    } else {
        Write-Host "Could not save Flightdeck slicer URL settings." -ForegroundColor Yellow
    }
}

$DockerPath = Wait-DockerReady
$PrintDir = Join-Path $DataDir "print_library"
$RunOrca = -not $BambuOnly
$RunBambu = -not $OrcaOnly

Write-Step "Flightdeck slicer browsers"
Write-Host "Data dir: $DataDir"
Write-Host "Prints:   $PrintDir"

if ($RunOrca) {
    Ensure-SlicerContainer `
        -DockerPath $DockerPath `
        -Name $OrcaName `
        -Image $OrcaImage `
        -ConfigDir (Join-Path $DataDir "orcaslicer") `
        -PrintDir $PrintDir `
        -HostPort $OrcaPort `
        -Title "OrcaSlicer - Flightdeck"
}

if ($RunBambu) {
    Ensure-SlicerContainer `
        -DockerPath $DockerPath `
        -Name $BambuName `
        -Image $BambuImage `
        -ConfigDir (Join-Path $DataDir "bambustudio") `
        -PrintDir $PrintDir `
        -HostPort $BambuPort `
        -Title "Bambu Studio - Flightdeck"
}

if (-not $CheckOnly) {
    Start-Sleep -Seconds 5
}

Write-Step "Status"
& $DockerPath ps --filter "name=flightdeck-orcaslicer" --filter "name=flightdeck-bambustudio" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"

if (-not $CheckOnly) {
    Write-Step "Browser URLs"
    if ($RunOrca) {
        Write-Host "OrcaSlicer:   https://127.0.0.1:$OrcaPort"
        Test-SlicerUrl -Url "https://127.0.0.1:$OrcaPort/" -Label "OrcaSlicer"
    }
    if ($RunBambu) {
        Write-Host "Bambu Studio: https://127.0.0.1:$BambuPort"
        Test-SlicerUrl -Url "https://127.0.0.1:$BambuPort/" -Label "Bambu Studio"
    }
    Write-Host ""
    Write-Host "Login: $Username / $Password"
    Write-Host "Use the same host with your Tailscale IP if you access it from another device."
    if (-not $SkipFlightdeckSettings) {
        Save-FlightdeckSlicerSettings
    }
}
