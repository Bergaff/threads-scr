@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/3] Проверяем Node.js...
where node >nul 2>nul || (echo ОШИБКА: Node.js не найден. Скачай и установи https://nodejs.org (LTS) && pause && exit /b 1)

echo [2/3] Проверяем ffmpeg (должен быть в PATH)...
where ffmpeg >nul 2>nul || (echo ОШИБКА: ffmpeg не найден в PATH. Скачай https://ffmpeg.org и добавь папку bin в PATH && pause && exit /b 1)

echo [3/3] Устанавливаем npm-зависимости...
call npm install
if errorlevel 1 (echo ОШИБКА при npm install && pause && exit /b 1)

echo.
echo Готово. Дальше запусти start.bat (или run-all.bat для сервера + туннеля).
pause
