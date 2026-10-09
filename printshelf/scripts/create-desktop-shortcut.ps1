# Creates a Desktop shortcut that opens PrintShelf in Edge/Chrome app mode.
param(
    [string]$Url = "https://flightdeck.tail7de73e.ts.net:8100",
    [ValidateSet("edge", "chrome", "auto")]
    [string]$Browser = "auto"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StaticDir = Join-Path $ScriptDir "..\static"
$IconPath = Join-Path $StaticDir "printshelf.ico"
if (-not (Test-Path $IconPath)) {
    $IconPath = Join-Path $StaticDir "icon-192.png"
}

function Find-BrowserPath {
    param([string]$Kind)
    $candidates = @()
    if ($Kind -eq "edge") {
        $candidates = @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
        )
    } elseif ($Kind -eq "chrome") {
        $candidates = @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
    }
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

$BrowserPath = $null
if ($Browser -eq "auto") {
    $BrowserPath = Find-BrowserPath "edge"
    if (-not $BrowserPath) { $BrowserPath = Find-BrowserPath "chrome" }
} else {
    $BrowserPath = Find-BrowserPath $Browser
}

if (-not $BrowserPath) {
    throw "Could not find Edge or Chrome. Install one, or pass -Browser edge|chrome."
}

$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "PrintShelf.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $BrowserPath
$Shortcut.Arguments = "--app=$Url"
$Shortcut.WorkingDirectory = Split-Path -Parent $BrowserPath
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = $IconPath
}
$Shortcut.Description = "Open PrintShelf"
$Shortcut.Save()

Write-Host "Desktop shortcut created: $ShortcutPath"
Write-Host "Opens: $Url"
Write-Host "Browser: $BrowserPath"
