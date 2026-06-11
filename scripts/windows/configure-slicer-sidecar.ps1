param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string]$Url = "http://127.0.0.1:3003"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$EnvPath = Join-Path $AppDir ".env"

if (-not (Test-Path $EnvPath)) {
    New-Item -ItemType File -Path $EnvPath -Force | Out-Null
}

function Set-FlightdeckEnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )
    $line = "$Key=$Value"
    $lines = @(Get-Content -Path $Path -ErrorAction SilentlyContinue)
    $found = $false
    $updated = foreach ($existing in $lines) {
        if ($existing -match "^\s*$([regex]::Escape($Key))=") {
            $found = $true
            $line
        } else {
            $existing
        }
    }
    if (-not $found) {
        $updated += $line
    }
    Set-Content -Path $Path -Value $updated -Encoding UTF8
}

Set-FlightdeckEnvValue -Path $EnvPath -Key "FLIGHTDECK_SLICER_SIDECAR_CMD" -Value $Command
Set-FlightdeckEnvValue -Path $EnvPath -Key "FLIGHTDECK_SLICER_SIDECAR_URL" -Value $Url.TrimEnd("/")

Write-Host "Configured Flightdeck slicer sidecar auto-start."
Write-Host "Command: $Command"
Write-Host "Health:  $($Url.TrimEnd('/'))/health"
Write-Host ""
Write-Host "Restart Flightdeck from the tray, or log out/in, to start supervising the sidecar."
