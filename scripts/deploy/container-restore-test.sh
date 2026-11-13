#!/usr/bin/env bash
# Runs INSIDE the worker/tools image. The monthly restore test (INF10): proves the newest
# backup can be DECRYPTED and RESTORED end to end — not just that a file exists. Use as
#   RESTORE_TEST_COMMAND="bash /app/scripts/deploy/container-restore-test.sh"
# (worker job on the 1st of each month, logged in the console under Operations), and by hand
# for a key rotation: restore a PRE-rotation backup with the OLD key before retiring it (SEC9).
#
#   container-restore-test.sh [s3-key]       default: the newest object under postgres/
#
# Environment (names only):
#   BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
#   BACKUP_AGE_IDENTITY_FILE   path of the PRIVATE age key, mounted for this run only (a
#                              secret-store mount). It must not live on the host otherwise.
#   RESTORE_TEST_DATABASE_URL  an EMPTY scratch database to restore into. Never production:
#                              the script refuses a URL equal to DATABASE_URL.
set -euo pipefail
for name in BACKUP_S3_BUCKET BACKUP_AGE_IDENTITY_FILE RESTORE_TEST_DATABASE_URL; do
  [ -n "${!name:-}" ] || { echo "restore-test: missing environment variable: $name" >&2; exit 2; }
done
[ -r "$BACKUP_AGE_IDENTITY_FILE" ] || { echo "restore-test: BACKUP_AGE_IDENTITY_FILE is not readable" >&2; exit 2; }
[ "$RESTORE_TEST_DATABASE_URL" != "${DATABASE_URL:-}" ] || { echo "restore-test: refusing to restore into DATABASE_URL" >&2; exit 2; }

if [ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" ]; then
  export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
fi
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-eu-central-1}"
S3=(aws s3)
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && S3=(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3)

KEY="${1:-}"
if [ -z "$KEY" ]; then
  KEY="$("${S3[@]}" ls --recursive "s3://${BACKUP_S3_BUCKET}/postgres/" | sort | tail -n 1 | awk '{print $4}')"
fi
[ -n "$KEY" ] || { echo "restore-test: no backup found" >&2; exit 1; }
echo "restore-test: restoring ${KEY}"

# the scratch database must be empty, so a leftover from another run cannot fake a pass
TABLES="$(psql "$RESTORE_TEST_DATABASE_URL" -At -c "select count(*) from information_schema.tables where table_schema in ('public', 'drizzle')")"
[ "$TABLES" = "0" ] || { echo "restore-test: the scratch database is not empty" >&2; exit 2; }

"${S3[@]}" cp "s3://${BACKUP_S3_BUCKET}/${KEY}" - --only-show-errors \
  | age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_TEST_DATABASE_URL"

RESTORED="$(psql "$RESTORE_TEST_DATABASE_URL" -At -c "select count(*) from information_schema.tables where table_schema = 'public'")"
AUDIT="$(psql "$RESTORE_TEST_DATABASE_URL" -At -c "select count(*) from audit_log")"
[ "$RESTORED" -gt 10 ] || { echo "restore-test: too few tables restored (${RESTORED})" >&2; exit 1; }
echo "restore-test: ok — ${RESTORED} tables, ${AUDIT} audit rows, decrypted and restored from ${KEY}"

# leave the scratch database empty for next time (it is a scratch database, not production)
psql "$RESTORE_TEST_DATABASE_URL" -q -c "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;" >/dev/null
