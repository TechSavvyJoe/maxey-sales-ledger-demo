@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Sales Ledger needs Node.js 22 or newer.
  echo Install Node.js, then double-click this launcher again.
  pause
  exit /b 1
)

node launcher\server.mjs
set launch_status=%errorlevel%
if not "%launch_status%"=="0" pause
exit /b %launch_status%
