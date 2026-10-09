# One-time helper: register cindyvinyl:// so Vinyl can Open folders/files in Explorer.
# Right-click → Run with PowerShell, or:
#   powershell -ExecutionPolicy Bypass -File install-cindy-open.ps1

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "CindyVinyl"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$helper = Join-Path $dir "open.ps1"
@'
param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference = "Stop"
$log = Join-Path $env:LOCALAPPDATA "CindyVinyl\open.log"
function Write-Log([string]$msg) {
  try {
    $line = "{0:u} {1}" -f (Get-Date), $msg
    Add-Content -Path $log -Value $line -Encoding UTF8
  } catch {}
}
try {
  Write-Log "url=$Url"
  # Browser may hand us cindyvinyl://open/<b64> or with trailing junk.
  $raw = $Url.Trim()
  if ($raw.StartsWith("cindyvinyl:", [StringComparison]::OrdinalIgnoreCase)) {
    $raw = $raw.Substring("cindyvinyl:".Length)
  }
  $raw = $raw.TrimStart("/")
  $select = $false
  if ($raw.StartsWith("select/", [StringComparison]::OrdinalIgnoreCase)) {
    $select = $true
    $payload = $raw.Substring("select/".Length)
  } elseif ($raw.StartsWith("open/", [StringComparison]::OrdinalIgnoreCase)) {
    $payload = $raw.Substring("open/".Length)
  } else {
    $payload = $raw
  }
  # Drop query/hash junk if any.
  $payload = ($payload -split "[?#]", 2)[0]

  # Prefer base64 payload (new Vinyl); fall back to path-style for old links.
  $unc = $null
  $b64 = $payload.Replace("-", "+").Replace("_", "/")
  while ($b64.Length % 4 -ne 0) { $b64 += "=" }
  try {
    $unc = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  } catch {
    $decoded = [uri]::UnescapeDataString($payload)
    $unc = "\\" + $decoded.Replace("/", "\")
  }
  $unc = $unc.Trim().Trim('"')
  if (-not $unc.StartsWith("\\")) {
    $unc = "\\" + $unc.TrimStart("\")
  }
  Write-Log "select=$select unc=$unc"
  if ([string]::IsNullOrWhiteSpace($unc) -or $unc -eq "\\") {
    throw "Empty UNC path"
  }

  if ($select) {
    # explorer wants a single /select,path argument
    Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList @("/select,$unc")
  } else {
    Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList @($unc)
  }
  Write-Log "ok"
} catch {
  Write-Log "ERROR $($_.Exception.Message)"
  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show(
      "Cindy Vinyl could not open Explorer.`n`n$($_.Exception.Message)`n`nLog: $log",
      "Cindy Vinyl Open",
      "OK",
      "Error"
    ) | Out-Null
  } catch {}
  exit 1
}
'@ | Set-Content -Path $helper -Encoding UTF8

# Use cmd so %1 quoting is less fragile than a bare powershell protocol command.
$launcher = Join-Path $dir "open.cmd"
@"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$helper" "%~1"
"@ | Set-Content -Path $launcher -Encoding ASCII

$cmd = "`"$launcher`" `"%1`""
$base = "HKCU:\Software\Classes\cindyvinyl"
New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name "(default)" -Value "URL:Cindy Vinyl Open"
New-ItemProperty -Path $base -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name "(default)" -Value $cmd

Write-Host ""
Write-Host "Cindy Vinyl Open helper installed / updated."
Write-Host "  Helper : $helper"
Write-Host "  Launcher: $launcher"
Write-Host "  Protocol: cindyvinyl://"
Write-Host ""
Write-Host "Back in Vinyl, hard-refresh, then On Cindy -> Open."
Write-Host "Press Enter to close."
[void][System.Console]::ReadLine()
