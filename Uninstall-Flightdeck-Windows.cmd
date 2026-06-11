@echo off
setlocal
title Flightdeck Windows Uninstaller

cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell was not found on this Windows install.
  echo Run scripts\windows\uninstall-windows.ps1 from a machine with PowerShell available.
  pause
  exit /b 1
)

echo Starting Flightdeck Windows uninstaller...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall-windows.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Flightdeck uninstall stopped with error code %EXITCODE%.
  pause
  exit /b %EXITCODE%
)

echo Flightdeck uninstall finished.
pause
