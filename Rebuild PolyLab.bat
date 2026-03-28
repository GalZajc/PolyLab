@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Building PolyLab...
call npm run build
if errorlevel 1 goto :fail

echo PolyLab rebuilt successfully.
pause
exit /b 0

:fail
echo.
echo Failed to rebuild PolyLab.
pause
exit /b 1
