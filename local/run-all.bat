@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM cloudflared: берём cloudflared.exe из этой папки, иначе из PATH
set "CF_EXE=cloudflared"
if exist cloudflared.exe set "CF_EXE=cloudflared.exe"
where cloudflared >nul 2>nul || if not exist cloudflared.exe (
  echo ОШИБКА: cloudflared не найден. Положи cloudflared.exe в эту папку
  echo         (скачать: https://github.com/cloudflare/cloudflared/releases) либо установи в PATH.
  pause && exit /b 1
)

REM Запуск сервера и туннеля в отдельных окнах. Закрывай эти окна, когда не нужно.
start "Threads-Digest Server" cmd /k "node server.js"
start "Threads-Digest Tunnel" cmd /k "%CF_EXE% tunnel --url http://localhost:8080"

echo.
echo Запущены два окна: сервер (порт 8080) и туннель.
echo 1) В окне туннеля скопируй URL (https://****.trycloudflare.com).
echo 2) На Клауде выполни в PowerShell/git-bash:
echo      wrangler secret bulk secrets.json
echo    (файл secrets.json — это заполненный secrets.example.json с туннель-URL в
echo     VIDEO_RENDERER_URL и PROXY_GATEWAY_URL). URL меняется при каждом перезапуске туннеля.
echo.
echo Не закрывай окна, пока Worker должен рендерить/собирать.
pause
