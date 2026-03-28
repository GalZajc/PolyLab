@echo off
setlocal enabledelayedexpansion
title PolyLab - Setup And Run
color 0A

cd /d "%~dp0"

echo ========================================================
echo                 PolyLab - Setup And Run
echo ========================================================
echo Working Directory: %CD%
echo.
echo This script will:
echo   - Install Node.js if it is missing
echo   - Install npm dependencies
echo   - Build PolyLab
echo   - Launch PolyLab
echo.
echo Press any key to continue or CTRL+C to cancel...
pause >nul

if not exist "package.json" (
    echo [ERROR] package.json not found.
    echo Run this script from the PolyLab project folder.
    pause
    exit /b 1
)

set "TEMP_DIR=%TEMP%\PolyLabSetup"
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

echo.
echo [1/4] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Downloading Node.js 20 LTS...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.3/node-v20.18.3-x64.msi' -OutFile '%TEMP_DIR%\nodejs.msi'}"
    if not exist "%TEMP_DIR%\nodejs.msi" (
        echo [ERROR] Failed to download Node.js.
        pause
        exit /b 1
    )

    echo Installing Node.js silently...
    msiexec /i "%TEMP_DIR%\nodejs.msi" /qn /norestart
    timeout /t 10 /nobreak >nul
    call :RefreshPath

    where node >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Node.js installation failed.
        echo Please install Node.js manually from https://nodejs.org/
        pause
        exit /b 1
    )
    echo [OK] Node.js installed successfully.
) else (
    echo [OK] Node.js already installed.
)

echo.
echo [2/4] Installing npm dependencies...
if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
) else (
    echo [OK] node_modules already exists.
)

echo.
echo [3/4] Building PolyLab...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)
echo [OK] Build completed.

echo.
echo [4/4] Launching PolyLab...
if exist "Open PolyLab.bat" (
    start "" "%~dp0Open PolyLab.bat"
) else if exist "Launch PolyLab.vbs" (
    start "" wscript.exe "%~dp0Launch PolyLab.vbs"
) else (
    start "" "http://127.0.0.1:5173/"
    call npm run dev -- --host 127.0.0.1
)

echo.
echo PolyLab is ready.
echo Cleaning up temporary files...
rd /s /q "%TEMP_DIR%" >nul 2>&1
exit /b 0

:RefreshPath
set "SysPath="
set "UserPath="
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SysPath=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "UserPath=%%b"
if defined SysPath (
    if defined UserPath (
        set "PATH=!SysPath!;!UserPath!"
    ) else (
        set "PATH=!SysPath!"
    )
)
goto :eof
