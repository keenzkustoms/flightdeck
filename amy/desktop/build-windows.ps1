# Build Amy desktop one-folder dist (Windows).
$ErrorActionPreference = "Stop"
$Desktop = $PSScriptRoot
$Jarvis = Split-Path -Parent $Desktop
Set-Location $Desktop

function Resolve-AmyPython {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
    "C:\Users\Kidabah\flightdeck\.venv\Scripts\python.exe"
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "No suitable Python found."
}

$Python = Resolve-AmyPython
Write-Host "Using $Python"

Write-Host "Ensuring notes graph exists..."
& $Python (Join-Path $Jarvis "build.py")

Write-Host "Installing build deps..."
& $Python -m pip install -r (Join-Path $Desktop "requirements.txt")

Write-Host "PyInstaller -> dist/Amy ..."
& $Python -m PyInstaller --noconfirm --clean (Join-Path $Desktop "amy.spec")

$Out = Join-Path $Desktop "dist\Amy"
if (-not (Test-Path (Join-Path $Out "Amy.exe"))) {
  throw "Build failed - Amy.exe not found in $Out"
}

Write-Host ""
Write-Host "Built: $Out\Amy.exe"
Write-Host "First run creates %APPDATA%\Amy\config.json - add API keys there."
Write-Host "Chrome tabs still need Load unpacked -> amy\amy-hands\chrome-extension"
Write-Host "Pi browser Amy is unchanged."
