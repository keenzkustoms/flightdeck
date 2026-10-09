# Start Cindy Vinyl in its own window, and keep a Start Menu shortcut.
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Launch = Join-Path $Here "launch.py"
$Icon = Join-Path $env:LOCALAPPDATA "CindyVinyl\cindy-vinyl.ico"
if (-not (Test-Path $Icon)) {
  $Icon = Join-Path $Here "..\static\cindy-vinyl.ico"
}

function Resolve-VinylPython {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\pythonw.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe")
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  throw "Python 3.12 not found."
}

$Python = Resolve-VinylPython
$Menu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$LnkPath = Join-Path $Menu "Cindy Vinyl.lnk"
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($LnkPath)
$lnk.TargetPath = $Python
$lnk.Arguments = "`"$Launch`""
$lnk.WorkingDirectory = $Here
$lnk.WindowStyle = 1
$lnk.Description = "Cindy Vinyl"
if (Test-Path $Icon) { $lnk.IconLocation = $Icon }
$lnk.Save()

Start-Process -FilePath $Python -ArgumentList "`"$Launch`"" -WorkingDirectory $Here
