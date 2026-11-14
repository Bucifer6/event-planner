@echo off
cd /d "%~dp0"
docker compose down
echo Stopped. Your test data is kept.
pause
