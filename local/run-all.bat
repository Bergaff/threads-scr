@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Запуск сервера и туннеля в отдельных окнах. Закрывай эти окна, когда не нужно.

start "Threads-Digest Server" cmd /k "node server.js"
start "Threads-Digest Tunnel" cmd /k "cloudflared tunnel --url http://localhost:8080"

echo.
echo Запущены два окна: сервер (порт 8080) и туннель.
echo 1) В окне туннеля скопируй URL (https://****.trycloudflare.com).
echo 2) На Клауде выполни в PowerShell/git-bash:
echo      wrangler secret put VIDEO_RENDERER_URL
echo      wrangler secret put PROXY_GATEWAY_URL
echo    и вставь тот же URL в оба. (URL меняется при каждом перезапуске туннеля.)
echo.
echo Не закрывай окна, пока Worker должен рендерить/собирать.
pause
