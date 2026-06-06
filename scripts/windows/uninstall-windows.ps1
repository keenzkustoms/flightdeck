param(
    [switch]$KeepData
)

$ErrorActionPreference = "Stop"
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "Flightdeck Tray.lnk"
$DataDir = "$env:LOCALAPPDATA\Flightdeck"

if (Test-Path $ShortcutPath) {
    Remove-Item $ShortcutPath -Force
    Write-Host "Removed startup shortcut."
}

if (-not $KeepData -and (Test-Path $DataDir)) {
    Write-Host "Removing data dir: $DataDir"
    Remove-Item $DataDir -Recurse -Force
} elseif ($KeepData) {
    Write-Host "Keeping data dir: $DataDir"
}

Write-Host "Flightdeck Windows tray install removed."
