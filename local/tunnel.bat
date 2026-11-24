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

echo Пробрасываем localhost:8080 наружу через Cloudflare Tunnel.
echo Скопируй полученный URL (https://****.trycloudflare.com) и пропиши его в
echo VIDEO_RENDERER_URL и PROXY_GATEWAY_URL (wrangler secret put на Клауде).
echo.
%CF_EXE% tunnel --url http://localhost:8080
pause
