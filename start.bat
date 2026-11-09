@echo off
setlocal
cd /d "%~dp0"
title Recycling CA Lab

rem -- make sure npm is available
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH.
  echo Install Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem -- first run: install dependencies
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting the dev server at http://localhost:3000 ...
echo Close this window (or press Ctrl+C) to stop it.

rem -- open the browser once the server is up
start /min "" cmd /c "timeout /t 5 /nobreak >nul & start """" http://localhost:3000"

call npm run dev
pause
