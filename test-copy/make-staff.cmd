@echo off
cd /d "%~dp0"
set /p EMAIL=Email of the account to make staff: 
docker compose exec -T web node scripts/make-staff.mjs %EMAIL% platform_admin,listing_moderator,security_administrator
pause
