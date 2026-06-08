$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$VenvPythonw = Join-Path $AppDir ".venv\Scripts\pythonw.exe"
$Launcher = Join-Path $ScriptDir "flightdeck-tray.py"
$IconPath = Join-Path $AppDir "app\static\flightdeck.ico"
if (-not (Test-Path $IconPath)) {
    $IconPath = Join-Path $AppDir "app\static\icon-192.png"
}

if (-not (Test-Path $VenvPythonw)) {
    throw "Flightdeck venv not found. Run scripts\windows\install-windows.ps1 first."
}

$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Flightdeck.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $VenvPythonw
$Shortcut.Arguments = "`"$Launcher`""
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.IconLocation = $IconPath
$Shortcut.Description = "Start Flightdeck tray"
$Shortcut.Save()

Write-Host "Desktop shortcut created: $ShortcutPath"
