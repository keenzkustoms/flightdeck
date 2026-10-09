# Start Amy desktop (dev / unpackaged).
$ErrorActionPreference = "Stop"
$DesktopDir = $PSScriptRoot
$Amy = Split-Path -Parent $DesktopDir
$Launch = Join-Path $DesktopDir "launch.py"
Set-Location $Amy

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
  throw "No suitable Python found (need 3.12+ with pip)."
}

$Python = Resolve-AmyPython
Write-Host "Using $Python"

& $Python -c "import webview" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing desktop deps…"
  & $Python -m pip install -r (Join-Path $DesktopDir "requirements.txt")
}

Write-Host "Amy desktop → %APPDATA%\Amy\config.json + localhost :4700 / Hands :4701"
& $Python $Launch @args
exit $LASTEXITCODE
