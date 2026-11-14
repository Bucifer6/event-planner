@echo off
cd /d "%~dp0"
echo The most recent sign-in email:
echo.
docker compose exec -T postgres psql -U ed -d eventdesk_test -At -c "select body_text from email_outbox order by created_at desc limit 1"
echo.
pause
