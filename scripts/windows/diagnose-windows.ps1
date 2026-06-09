$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$DataDir = Join-Path $env:LOCALAPPDATA "Flightdeck"
$LogPath = Join-Path $DataDir "logs\flightdeck.log"
$Python = Join-Path $AppDir ".venv\Scripts\python.exe"

function Section {
    param([string]$Name)
    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
}

Write-Host "Flightdeck Windows diagnostics"
Write-Host "App dir:  $AppDir"
Write-Host "Data dir: $DataDir"

Section "Version"
git -C $AppDir log --oneline -1 2>$null

Section "Python"
if (Test-Path $Python) {
    & $Python --version
} else {
    Write-Host "Missing venv Python: $Python" -ForegroundColor Red
}

Section "Dependency imports"
if (Test-Path $Python) {
    & $Python -c "import uvicorn, fastapi, pystray, PIL; print('imports ok')"
}

Section "ffmpeg"
$Ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($Ffmpeg) {
    Write-Host "ffmpeg: $($Ffmpeg.Source)"
    $FfmpegVersion = ffmpeg -version 2>$null | Select-Object -First 1
    Write-Host $FfmpegVersion
    if ($FfmpegVersion -match "ffmpeg version\s+(5|6|7|8)(\.|\s|-)") {
        Write-Host "ffmpeg compatibility: tested Flightdeck camera driver family" -ForegroundColor Green
    } else {
        Write-Host "ffmpeg compatibility: untested FFmpeg major version for Flightdeck camera proxy" -ForegroundColor Yellow
        Write-Host "Flightdeck is tested with Raspberry Pi OS/Debian apt FFmpeg 5.x and Gyan Windows FFmpeg 8.x." -ForegroundColor Yellow
    }
} else {
    Write-Host "ffmpeg not found on PATH" -ForegroundColor Red
}

Section "Port 8000"
netstat -ano | findstr ":8000"

Section "Flightdeck processes"
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -in @("python.exe", "pythonw.exe") -and $_.CommandLine -match "flightdeck|uvicorn" } |
    Select-Object ProcessId, Name, CommandLine |
    Format-List

Section "App import"
if (Test-Path $Python) {
    Push-Location $AppDir
    & $Python -c "import app.main; print('app import ok')"
    Pop-Location
}

Section "Latest log"
if (Test-Path $LogPath) {
    Get-Content $LogPath -Tail 80
} else {
    Write-Host "No log found yet: $LogPath" -ForegroundColor Yellow
}
