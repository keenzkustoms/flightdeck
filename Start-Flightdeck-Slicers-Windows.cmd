@echo off
setlocal
title Flightdeck Slicer Browsers

cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell was not found on this Windows install.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start-slicer-browsers.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Flightdeck slicer browser setup stopped with error code %EXITCODE%.
  pause
  exit /b %EXITCODE%
)

pause
