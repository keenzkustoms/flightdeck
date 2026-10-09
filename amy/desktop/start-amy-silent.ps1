# Launch Amy with no PowerShell / Hands console windows — only the Amy frame.
$ErrorActionPreference = "Stop"
$DesktopDir = $PSScriptRoot
$Amy = Split-Path -Parent $DesktopDir
$Launch = Join-Path $DesktopDir "launch.py"

function Resolve-AmyPythonW {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\pythonw.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\pythonw.exe"),
    "C:\Users\Kidabah\flightdeck\.venv\Scripts\pythonw.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
    "C:\Users\Kidabah\flightdeck\.venv\Scripts\python.exe"
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  throw "No suitable Python found for Amy desktop."
}

$Python = Resolve-AmyPythonW
Set-Location $Amy
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Python
$psi.Arguments = "`"$Launch`""
$psi.WorkingDirectory = $Amy
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
[System.Diagnostics.Process]::Start($psi) | Out-Null
