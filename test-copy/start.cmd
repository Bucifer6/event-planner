@echo off
cd /d "%~dp0"
echo Starting the EventDesk test copy. The first start takes several minutes.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Could not start. Is Docker Desktop installed and running?
  pause
  exit /b 1
)
echo.
echo Ready in about a minute at http://localhost:3000
echo To read a sign-in code, double-click sign-in-code.cmd
pause
