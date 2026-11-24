@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo node_modules not found, running npm install...
  call npm install
  if errorlevel 1 (echo ERROR during npm install && pause && exit /b 1)
)

if not exist .env (
  if exist .env.example (
    copy .env.example .env >nul
    echo Created .env from example. Edit local/.env and set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
  )
)

echo Starting Threads Digest local service on port 8080 (Ctrl+C to stop)...
node server.js
pause
