# Creates a Desktop shortcut that opens Cindy Vinyl in Edge/Chrome app mode.
# Prefer Install-CindyVinyl.ps1 for Desktop + Start Menu (LAN default).
param(
    [string]$Url = "http://192.168.4.77:4541",
    [ValidateSet("edge", "chrome", "auto")]
    [string]$Browser = "auto"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $here "Install-CindyVinyl.ps1") -Url $Url -Browser $Browser -DesktopOnly
