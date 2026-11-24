@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo Папка node_modules не найдена. Сначала запусти install.bat (установит зависимости в эту папку).
  pause && exit /b 1
)

REM Если нет .env — создаём из примера (заполни R2_*-ключи в блокноте).
if not exist .env (
  if exist .env.example (
    copy .env.example .env >nul
    echo Создан .env из примера. Открой local\.env и впиши R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.
  )
)

echo Запуск локального сервиса Threads Digest (порт 8080)...
echo Для остановки закрой это окно (Ctrl+C).
echo.
node server.js
pause
