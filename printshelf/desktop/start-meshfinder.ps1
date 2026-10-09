# Start MeshFinder in its own window, and keep a Start Menu shortcut.
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Launch = Join-Path $Here "launch.py"

function Resolve-MeshPython {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\pythonw.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe")
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  throw "Python 3.12 not found."
}

$Python = Resolve-MeshPython
$Menu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$LnkPath = Join-Path $Menu "MeshFinder.lnk"
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($LnkPath)
$lnk.TargetPath = $Python
$lnk.Arguments = "`"$Launch`""
$lnk.WorkingDirectory = $Here
$lnk.WindowStyle = 1
$lnk.Description = "MeshFinder"
$lnk.Save()

Start-Process -FilePath $Python -ArgumentList "`"$Launch`"" -WorkingDirectory $Here
