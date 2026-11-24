@echo off
chcp 65001 >nul
cd /d "%~dp0"

where cloudflared >nul 2>nul || (echo ОШИБКА: cloudflared не найден. Скачай https://github.com/cloudflare/cloudflared/releases && pause && exit /b 1)

echo Пробрасываем localhost:8080 наружу через Cloudflare Tunnel.
echo Скопируй полученный URL (https://****.trycloudflare.com) и пропиши его в
echo VIDEO_RENDERER_URL и PROXY_GATEWAY_URL (через wrangler secret put на Клауде).
echo.
cloudflared tunnel --url http://localhost:8080
pause
