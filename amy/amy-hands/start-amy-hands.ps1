# Start Amy Hands in a visible console (folders + Chrome tabs companion).
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

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

if (-not (Test-Path "$Root\config.json")) {
  Copy-Item "$Root\config.example.json" "$Root\config.json"
}

# Free :4701 if something stale is holding it
Get-NetTCPConnection -LocalPort 4701 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400

$Python = Resolve-AmyPython
Write-Host "Using $Python"
Write-Host "Amy Hands starting on :4701 (leave this window open)"

# Visible console so you can see Hands is alive
Start-Process -FilePath $Python -ArgumentList "`"$Root\amy_hands.py`"" -WorkingDirectory $Root

$ext = Join-Path $Root "chrome-extension"
Write-Host ""
Write-Host "Chrome tabs need the unpacked extension:"
Write-Host "  1) chrome://extensions"
Write-Host "  2) Developer mode ON"
Write-Host "  3) Load unpacked -> $ext"
Write-Host ""

Start-Sleep -Seconds 1
try {
  $h = Invoke-RestMethod "http://127.0.0.1:4701/health"
  Write-Host "Hands health OK - $($h.name)"
} catch {
  Write-Host "Hands not answering yet - check the new console window for errors"
}
