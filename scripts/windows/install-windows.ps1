param(
    [string]$DataDir = "$env:LOCALAPPDATA\Flightdeck",
    [int]$Port = 8000,
    [string]$PythonCommand = "python",
    [switch]$NoStartup,
    [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$VenvDir = Join-Path $AppDir ".venv"
$PythonArgs = $PythonCommand -split "\s+"
$Python = $PythonArgs[0]
$PythonExtraArgs = @()
if ($PythonArgs.Length -gt 1) {
    $PythonExtraArgs = $PythonArgs[1..($PythonArgs.Length - 1)]
}

Write-Host "== Flightdeck Windows install =="
Write-Host "App dir:  $AppDir"
Write-Host "Data dir: $DataDir"
Write-Host "Port:     $Port"

New-Item -ItemType Directory -Force -Path $DataDir, (Join-Path $DataDir "uploads"), (Join-Path $DataDir "print_library"), (Join-Path $DataDir "logs") | Out-Null

if (-not (Test-Path (Join-Path $VenvDir "Scripts\python.exe"))) {
    & $Python @PythonExtraArgs -m venv $VenvDir
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvPythonw = Join-Path $VenvDir "Scripts\pythonw.exe"
& $VenvPython -m pip install --no-cache-dir --upgrade pip
& $VenvPython -m pip install --no-cache-dir -r (Join-Path $AppDir "requirements-windows.txt")

$EnvPath = Join-Path $AppDir ".env"
$envLines = @(
    "FLIGHTDECK_RUNTIME=windows",
    "FLIGHTDECK_SERVICE_MANAGER=Windows tray",
    "FLIGHTDECK_INSTANCE_NAME=Windows",
    "FLIGHTDECK_DATA_DIR=$DataDir",
    "FLIGHTDECK_PRINT_LIBRARY=$(Join-Path $DataDir "print_library")",
    "FLIGHTDECK_HOST=0.0.0.0",
    "FLIGHTDECK_PORT=$Port",
    "FLIGHTDECK_URL=http://127.0.0.1:$Port"
)
Set-Content -Path $EnvPath -Value $envLines -Encoding UTF8

$PrinterConfig = Join-Path $DataDir "printers.yaml"
if (-not (Test-Path $PrinterConfig)) {
    Copy-Item (Join-Path $AppDir "printers.yaml.example") $PrinterConfig
}

$env:FLIGHTDECK_DATA_DIR = $DataDir
$env:FLIGHTDECK_PRINT_LIBRARY = Join-Path $DataDir "print_library"
& $VenvPython -c "from app import db; db.init()"

$Launcher = Join-Path $ScriptDir "flightdeck-tray.py"
$IconPath = Join-Path $AppDir "app\static\flightdeck.ico"
if (-not (Test-Path $IconPath)) {
    $IconPath = Join-Path $AppDir "app\static\icon-192.png"
}

function New-FlightdeckShortcut {
    param(
        [string]$ShortcutPath
    )
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $VenvPythonw
    $Shortcut.Arguments = "`"$Launcher`""
    $Shortcut.WorkingDirectory = $AppDir
    $Shortcut.IconLocation = $IconPath
    $Shortcut.Description = "Start Flightdeck tray"
    $Shortcut.Save()
}

if (-not $NoStartup) {
    $Startup = [Environment]::GetFolderPath("Startup")
    $ShortcutPath = Join-Path $Startup "Flightdeck Tray.lnk"
    New-FlightdeckShortcut -ShortcutPath $ShortcutPath
    Write-Host "Startup shortcut: $ShortcutPath"
}

if (-not $NoDesktopShortcut) {
    $Desktop = [Environment]::GetFolderPath("Desktop")
    $DesktopShortcut = Join-Path $Desktop "Flightdeck.lnk"
    New-FlightdeckShortcut -ShortcutPath $DesktopShortcut
    Write-Host "Desktop shortcut: $DesktopShortcut"
}

Write-Host ""
Write-Host "Flightdeck is installed for Windows."
Write-Host "Start now:"
Write-Host "  & `"$VenvPythonw`" `"$Launcher`""
Write-Host ""
Write-Host "Open:"
Write-Host "  http://127.0.0.1:$Port"
