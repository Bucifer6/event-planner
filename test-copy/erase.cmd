@echo off
cd /d "%~dp0"
echo This deletes ALL data in the test copy.
pause
docker compose down -v
echo Erased.
pause
