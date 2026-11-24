@echo off
cd /d "%~dp0"

REM Keep npm cache next to this folder, not in C:\Users...
set "npm_config_cache=%~dp0.npm-cache"

echo [1/3] Checking Node.js...
where node >nul 2>nul || (echo ERROR: Node.js not found. Install LTS from https://nodejs.org && pause && exit /b 1)

echo [2/3] Checking ffmpeg (in PATH, or ffmpeg.exe in this folder)...
set "FFMPEG_OK=0"
where ffmpeg >nul 2>nul && set "FFMPEG_OK=1"
if exist ffmpeg.exe set "FFMPEG_OK=1"
if "%FFMPEG_OK%"=="0" (echo ERROR: ffmpeg not found. Put ffmpeg.exe and its DLLs in this folder, or add ffmpeg to PATH && pause && exit /b 1)

echo [3/3] Installing npm dependencies into local node_modules...
call npm install
if errorlevel 1 (echo ERROR during npm install && pause && exit /b 1)

echo.
echo Done. Now run run-all.bat to start the server and the tunnel.
pause
