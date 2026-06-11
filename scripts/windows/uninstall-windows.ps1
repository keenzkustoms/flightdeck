param(
    [switch]$KeepData,
    [switch]$RemoveData,
    [switch]$RemoveVenv
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$Startup = [Environment]::GetFolderPath("Startup")
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPaths = @(
    (Join-Path $Startup "Flightdeck Tray.lnk"),
    (Join-Path $Desktop "Flightdeck.lnk")
)
$DataDir = "$env:LOCALAPPDATA\Flightdeck"
$VenvDir = Join-Path $AppDir ".venv"

if ($KeepData -and $RemoveData) {
    throw "Choose either -KeepData or -RemoveData, not both."
}

Write-Host "== Flightdeck Windows uninstall =="
Write-Host "App dir:  $AppDir"
Write-Host "Data dir: $DataDir"

Write-Host "Stopping Flightdeck tray/backend processes..."
$escapedAppDir = [regex]::Escape($AppDir)
$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Name -in @("python.exe", "pythonw.exe")) -and
        ($_.CommandLine -match "flightdeck-tray\.py" -or $_.CommandLine -match "uvicorn") -and
        ($_.CommandLine -match $escapedAppDir)
    }

foreach ($Proc in $processes) {
    try {
        Stop-Process -Id $Proc.ProcessId -Force -ErrorAction Stop
        Write-Host "Stopped process $($Proc.ProcessId): $($Proc.Name)"
    } catch {
        Write-Host "Could not stop process $($Proc.ProcessId): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

foreach ($ShortcutPath in $ShortcutPaths) {
    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-Host "Removed shortcut: $ShortcutPath"
    }
}

if ($RemoveVenv -and (Test-Path $VenvDir)) {
    Write-Host "Removing virtual environment: $VenvDir"
    Remove-Item $VenvDir -Recurse -Force
}

if ($RemoveData -and (Test-Path $DataDir)) {
    Write-Host "Removing data dir: $DataDir"
    Remove-Item $DataDir -Recurse -Force
} else {
    Write-Host "Keeping data dir: $DataDir"
}

Write-Host ""
Write-Host "Flightdeck Windows tray install removed."
if (-not $RemoveData) {
    Write-Host "Run again with -RemoveData to delete restored data/history/uploads."
}
