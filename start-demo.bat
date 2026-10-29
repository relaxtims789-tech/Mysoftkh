@echo off
rem QR Attendance - add the demo company (camdemo, 120 employees, 30 days) and start
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\ (
  echo Installing packages, please wait...
  call npm install || goto :fail
)
if not exist apps\web\dist\index.html call npm run build || goto :fail
if not exist apps\api\dist\main.js call npm run build || goto :fail
node tools\run.mjs seed || goto :fail
echo.
echo Demo log-ins are in data\demo-logins.txt
node tools\run.mjs start
goto :eof
:fail
echo Something went wrong. See the messages above.
pause
