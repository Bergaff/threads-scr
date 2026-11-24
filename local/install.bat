@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Кэш npm — в папке батника, а не на C:\Users\... (чтобы всё было локально)
set "npm_config_cache=%~dp0.npm-cache"

echo [1/3] Проверяем Node.js...
where node >nul 2>nul || (echo ОШИБКА: Node.js не найден. Скачай и установи https://nodejs.org (LTS) && pause && exit /b 1)

echo [2/3] Проверяем ffmpeg (в PATH либо ffmpeg.exe в этой папке)...
set "FFMPEG_OK=0"
where ffmpeg >nul 2>nul && set "FFMPEG_OK=1"
if exist ffmpeg.exe set "FFMPEG_OK=1"
if "%FFMPEG_OK%"=="0" (echo ОШИБКА: ffmpeg не найден. Положи ffmpeg.exe и его DLL в эту папку ИЛИ добавь ffmpeg в PATH && pause && exit /b 1)

echo [3/3] Устанавливаем npm-зависимости (в папку node_modules рядом)...
call npm install
if errorlevel 1 (echo ОШИБКА при npm install && pause && exit /b 1)

echo.
echo Готово. Дальше запусти run-all.bat (сервер + туннель).
pause
