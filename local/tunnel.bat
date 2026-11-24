@echo off
cd /d "%~dp0"

set "CF_EXE=cloudflared"
if exist cloudflared.exe set "CF_EXE=cloudflared.exe"
where cloudflared >nul 2>nul || if not exist cloudflared.exe (
  echo ERROR: cloudflared not found. Put cloudflared.exe in this folder, or install it to PATH.
  echo Download: https://github.com/cloudflare/cloudflared/releases
  pause && exit /b 1
)

echo Exposing localhost:8080 via Cloudflare Tunnel.
echo Copy the URL shown below, e.g. https://XXXX.trycloudflare.com
echo Use it for VIDEO_RENDERER_URL and PROXY_GATEWAY_URL on Cloudflare.
echo.
%CF_EXE% tunnel --url http://localhost:8080
pause
