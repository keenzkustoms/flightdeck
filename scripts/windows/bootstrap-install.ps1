param(
    [int]$Port = 8000,
    [string]$DataArchive = "",
    [switch]$NoStartup,
    [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Find-CommandPath {
    param([string[]]$Names)
    foreach ($Name in $Names) {
        $Command = Get-Command $Name -ErrorAction SilentlyContinue
        if ($Command) { return $Command.Source }
    }
    return $null
}

function Test-Python {
    param([string]$Command)
    if (-not $Command) { return $false }
    try {
        $Version = & $Command --version 2>&1
        if ($LASTEXITCODE -ne 0) { return $false }
        return ($Version -match "Python\s+3\.(1[1-9]|[2-9][0-9])")
    } catch {
        return $false
    }
}

function Get-PythonCommand {
    $Candidates = @("py", "python", "python3")
    foreach ($Candidate in $Candidates) {
        $Path = Find-CommandPath @($Candidate)
        if (-not $Path) { continue }
        if ($Candidate -eq "py") {
            try {
                $Version = & py -3 --version 2>&1
                if ($LASTEXITCODE -eq 0 -and $Version -match "Python\s+3\.(1[1-9]|[2-9][0-9])") {
                    return "py -3"
                }
            } catch {}
        } elseif (Test-Python $Candidate) {
            return $Candidate
        }
    }
    return $null
}

function Install-WithWinget {
    param(
        [string]$PackageId,
        [string]$Name
    )
    $Winget = Find-CommandPath @("winget")
    if (-not $Winget) {
        throw "$Name is required, but winget is not available. Install $Name manually, then run this installer again."
    }
    Write-Host "Installing $Name with winget. Windows may ask for approval..."
    & winget install --id $PackageId --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "$Name install failed. Install it manually, then run this installer again."
    }
}

function Unblock-FlightdeckFiles {
    Write-Step "Unblocking Flightdeck files"
    Get-ChildItem -Path $AppDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in ".ps1", ".py", ".cmd", ".bat" } |
        ForEach-Object { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue }
}

function Get-FfmpegCompatibility {
    param([string]$FfmpegPath)
    if (-not $FfmpegPath) {
        return @{ Tested = $false; Detail = "ffmpeg not found" }
    }
    try {
        $VersionLine = (& $FfmpegPath -version 2>$null | Select-Object -First 1)
    } catch {
        return @{ Tested = $false; Detail = "ffmpeg found but version check failed: $($_.Exception.Message)" }
    }
    $Tested = $VersionLine -match "ffmpeg version\s+(5|6|7|8)(\.|\s|-)"
    $Suffix = if ($Tested) {
        "tested Flightdeck camera driver family"
    } else {
        "untested FFmpeg major version for Flightdeck camera proxy"
    }
    return @{ Tested = $Tested; Detail = "$VersionLine ($Suffix)" }
}

Write-Host "Flightdeck Windows bootstrap"
Write-Host "App dir: $AppDir"

Unblock-FlightdeckFiles

Write-Step "Checking Python"
$PythonCommand = Get-PythonCommand
if (-not $PythonCommand) {
    Install-WithWinget -PackageId "Python.Python.3.12" -Name "Python 3.12"
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
    $PythonCommand = Get-PythonCommand
}
if (-not $PythonCommand) {
    throw "Python 3.11 or newer was not found after install. Close this window, open a new PowerShell, and run the installer again."
}
Write-Host "Python ready: $PythonCommand"

Write-Step "Checking Git"
$GitPath = Find-CommandPath @("git")
if (-not $GitPath) {
    Install-WithWinget -PackageId "Git.Git" -Name "Git"
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
    $GitPath = Find-CommandPath @("git")
}
if ($GitPath) {
    Write-Host "Git ready: $GitPath"
} else {
    Write-Host "Git is still not available. Flightdeck can install from this folder, but updates will need Git later." -ForegroundColor Yellow
}

Write-Step "Checking ffmpeg"
$FfmpegPath = Find-CommandPath @("ffmpeg")
if (-not $FfmpegPath) {
    Install-WithWinget -PackageId "Gyan.FFmpeg" -Name "ffmpeg"
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
    $FfmpegPath = Find-CommandPath @("ffmpeg")
}
if ($FfmpegPath) {
    Write-Host "ffmpeg ready: $FfmpegPath"
    $FfmpegCompat = Get-FfmpegCompatibility -FfmpegPath $FfmpegPath
    if ($FfmpegCompat.Tested) {
        Write-Host $FfmpegCompat.Detail -ForegroundColor Green
    } else {
        Write-Host $FfmpegCompat.Detail -ForegroundColor Yellow
        Write-Host "Flightdeck is tested with Raspberry Pi OS/Debian apt FFmpeg 5.x and Gyan Windows FFmpeg 8.x." -ForegroundColor Yellow
    }
} else {
    throw "ffmpeg is required for Bambu camera streams but was not found after install. Install ffmpeg manually, then run this installer again."
}

Write-Step "Installing Flightdeck"
$InstallScript = Join-Path $ScriptDir "install-windows.ps1"
$Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $InstallScript, "-Port", $Port, "-PythonCommand", $PythonCommand)
if ($DataArchive) { $Args += @("-DataArchive", $DataArchive) }
if ($NoStartup) { $Args += "-NoStartup" }
if ($NoDesktopShortcut) { $Args += "-NoDesktopShortcut" }

& powershell.exe @Args
if ($LASTEXITCODE -ne 0) {
    throw "Flightdeck install script failed."
}

Write-Step "Starting Flightdeck"
$Pythonw = Join-Path $AppDir ".venv\Scripts\pythonw.exe"
$Launcher = Join-Path $ScriptDir "flightdeck-tray.py"
if (Test-Path $Pythonw) {
    Start-Process -FilePath $Pythonw -ArgumentList "`"$Launcher`"" -WorkingDirectory $AppDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Flightdeck is ready." -ForegroundColor Green
Write-Host "Open: http://127.0.0.1:$Port"
