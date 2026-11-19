@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Secret Hitler - Local Test

where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24.12 or newer, then double-click this file again.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0] > 24 || (v[0]===24 && v[1]>=12) ? 0 : 1)"
if errorlevel 1 (
  echo This test setup needs Node.js 24.12 or newer. Update Node.js and try again.
  pause
  exit /b 1
)
where corepack >nul 2>&1
if errorlevel 1 (
  echo Install Corepack once with: npm install --global corepack
  echo Then double-click this file again.
  pause
  exit /b 1
)

call corepack pnpm local:launch
set "LOCAL_TEST_LAUNCH_EXIT=%ERRORLEVEL%"
if not "%LOCAL_TEST_LAUNCH_EXIT%"=="0" (
  echo.
  echo Startup did not complete. The message above explains what needs attention.
  pause
)
exit /b %LOCAL_TEST_LAUNCH_EXIT%
