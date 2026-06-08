@echo off
setlocal
title Flightdeck Windows Installer

cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell was not found on this Windows install.
  echo Install PowerShell or run Flightdeck from a machine with PowerShell available.
  pause
  exit /b 1
)

echo Starting Flightdeck Windows installer...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\bootstrap-install.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Flightdeck install stopped with error code %EXITCODE%.
  echo Read the messages above, then run this installer again.
  pause
  exit /b %EXITCODE%
)

echo Flightdeck install finished.
pause
