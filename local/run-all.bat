@echo off
cd /d "%~dp0"

set "CF_EXE=cloudflared"
if exist cloudflared.exe set "CF_EXE=cloudflared.exe"
where cloudflared >nul 2>nul || if not exist cloudflared.exe (
  echo ERROR: cloudflared not found. Put cloudflared.exe in this folder, or install it to PATH.
  echo Download: https://github.com/cloudflare/cloudflared/releases
  pause && exit /b 1
)

if not exist node_modules (
  echo node_modules not found, running npm install...
  call npm install
  if errorlevel 1 (echo ERROR during npm install && pause && exit /b 1)
)

start "Threads-Digest Server" cmd /k "node server.js"
start "Threads-Digest Tunnel" cmd /k "%CF_EXE% tunnel --url http://localhost:8080"

echo.
echo Two windows started: server (port 8080) and tunnel.
echo 1) Copy the tunnel URL from the tunnel window, e.g. https://XXXX.trycloudflare.com
echo 2) On Cloudflare, set it in secrets.json then run: wrangler secret bulk secrets.json
echo    Put that URL into VIDEO_RENDERER_URL and PROXY_GATEWAY_URL.
echo    The tunnel URL changes on every restart, so repeat step 2 after restarting.
pause
