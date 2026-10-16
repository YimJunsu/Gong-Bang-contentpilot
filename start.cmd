@echo off
rem Restart bloghelper: stop the old server on 5999, rebuild the UI, start minimized, open dashboard.
rem Always rebuilding avoids ChunkLoadError (an old server serving a replaced .next build).
cd /d "%~dp0"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5999 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
if not exist node_modules call npm install --silent
call npm run build
if errorlevel 1 (
  echo Build failed. See the messages above.
  pause
  exit /b 1
)
start "bloghelper" /min cmd /c "node server.mjs >> data\server.log 2>&1"
timeout /t 3 >nul
start "" http://localhost:5999
