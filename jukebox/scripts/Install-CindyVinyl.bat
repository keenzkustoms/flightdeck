@echo off
setlocal EnableExtensions
title Install Cindy Vinyl

rem Self-contained — works from a network share (UNC). No .ps1 required beside this file.
set "VINYL_URL=http://192.168.4.77:4541"
set "VINYL_LAUNCH=%~dp0..\desktop\launch.py"
set "VINYL_PYTHON=%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"
if not "%~1"=="" set "VINYL_URL=%~1"
set "ICON_URL=http://192.168.4.77:4541/static/cindy-vinyl.ico"
set "ICON_DIR=%LOCALAPPDATA%\CindyVinyl"
set "ICON_PATH=%ICON_DIR%\cindy-vinyl.ico"

set "PS1=%TEMP%\Install-CindyVinyl-run.ps1"
> "%PS1%" echo $ErrorActionPreference = 'Stop'
>> "%PS1%" echo $Url = $env:VINYL_URL
>> "%PS1%" echo if (-not $Url) { $Url = 'http://192.168.4.77:4541' }
>> "%PS1%" echo $IconDir = $env:ICON_DIR
>> "%PS1%" echo $IconPath = $env:ICON_PATH
>> "%PS1%" echo $IconUrl = $env:ICON_URL
>> "%PS1%" echo if ($IconDir -and -not (Test-Path $IconDir)) { New-Item -ItemType Directory -Path $IconDir -Force ^| Out-Null }
>> "%PS1%" echo try {
>> "%PS1%" echo   if ($IconUrl -and $IconPath) { Invoke-WebRequest -Uri $IconUrl -OutFile $IconPath -UseBasicParsing -TimeoutSec 8 }
>> "%PS1%" echo } catch { $IconPath = $null }
>> "%PS1%" echo $edgeCandidates = @(
>> "%PS1%" echo   (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
>> "%PS1%" echo   (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
>> "%PS1%" echo )
>> "%PS1%" echo $chromeCandidates = @(
>> "%PS1%" echo   (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
>> "%PS1%" echo   (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
>> "%PS1%" echo   (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
>> "%PS1%" echo )
>> "%PS1%" echo $browser = $edgeCandidates + $chromeCandidates ^| Where-Object { $_ -and (Test-Path $_) } ^| Select-Object -First 1
>> "%PS1%" echo $launchPy = $env:VINYL_LAUNCH
>> "%PS1%" echo $pythonw = $env:VINYL_PYTHON
>> "%PS1%" echo $usePy = ($launchPy -and $pythonw -and (Test-Path -LiteralPath $launchPy) -and (Test-Path -LiteralPath $pythonw))
>> "%PS1%" echo if ($usePy) { $browser = $pythonw; $appArgs = [char]34 + $launchPy + [char]34 } else { $appArgs = '--app=' + $Url }
>> "%PS1%" echo if (-not $browser) { throw 'Install Microsoft Edge or Google Chrome first.' }
>> "%PS1%" echo $shell = New-Object -ComObject WScript.Shell
>> "%PS1%" echo $paths = @(
>> "%PS1%" echo   (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Cindy Vinyl.lnk'),
>> "%PS1%" echo   (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Cindy Vinyl.lnk')
>> "%PS1%" echo )
>> "%PS1%" echo foreach ($path in $paths) {
>> "%PS1%" echo   $dir = Split-Path -Parent $path
>> "%PS1%" echo   if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force ^| Out-Null }
>> "%PS1%" echo   $sc = $shell.CreateShortcut($path)
>> "%PS1%" echo   $sc.TargetPath = $browser
>> "%PS1%" echo   $sc.Arguments = $appArgs
>> "%PS1%" echo   if ($usePy) { $sc.WorkingDirectory = Split-Path -Parent $launchPy } else { $sc.WorkingDirectory = Split-Path -Parent $browser }
>> "%PS1%" echo   $sc.WindowStyle = 1
>> "%PS1%" echo   if ($IconPath -and (Test-Path $IconPath)) { $sc.IconLocation = $IconPath }
>> "%PS1%" echo   $sc.Description = 'Cindy Vinyl - play Cindy library'
>> "%PS1%" echo   $sc.Save()
>> "%PS1%" echo   Write-Host ("Created: $path")
>> "%PS1%" echo }
>> "%PS1%" echo Write-Host ""
>> "%PS1%" echo Write-Host ("Cindy Vinyl is ready. Opens: $Url")
>> "%PS1%" echo Write-Host ("Browser: $browser")
>> "%PS1%" echo if ($IconPath -and (Test-Path $IconPath)) { Write-Host ("Icon: $IconPath") }

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "ERR=%ERRORLEVEL%"
del "%PS1%" >nul 2>&1

if not "%ERR%"=="0" (
  echo.
  echo Install failed.
  pause
  exit /b 1
)

echo.
echo Done - look for "Cindy Vinyl" on the Desktop and Start Menu.
pause
endlocal
