#!/usr/bin/env bash
# Runs INSIDE the worker/tools image. Takes one encrypted PostgreSQL backup and stores it in
# the backup bucket (INF10, SEC9). Used by the deploy pipeline before migrations and, as
#   BACKUP_COMMAND="bash /app/scripts/deploy/container-backup.sh daily"
# by the worker's daily backup job (02:30 Europe/Bucharest).
#
#   container-backup.sh [label]        label defaults to "manual"
#
# Environment (names only):
#   DATABASE_URL
#   BACKUP_AGE_RECIPIENT     PUBLIC age key ("age1…"). The matching private key is the
#                            customer-managed backup key: it is NOT on this host and is never
#                            stored next to the backups (SEC9). Rotation = a new recipient;
#                            keep the old private key until a pre-rotation backup has been
#                            restored with it (see container-restore-test.sh).
#   BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT (S3-compatible, EU), BACKUP_S3_REGION
#   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY   (omit both to use the host's role)
#   BACKUP_S3_SSE_KMS_KEY_ID optional: also encrypt at rest with this bucket key
#
# Nothing is written to disk unencrypted and no value above is printed. Retention (30 days)
# is the bucket's lifecycle rule, not this script: backups are never deleted from here.
set -euo pipefail
LABEL="${1:-manual}"
[[ "$LABEL" =~ ^[A-Za-z0-9._-]{1,60}$ ]] || { echo "backup: bad label" >&2; exit 2; }
for name in DATABASE_URL BACKUP_AGE_RECIPIENT BACKUP_S3_BUCKET; do
  [ -n "${!name:-}" ] || { echo "backup: missing environment variable: $name" >&2; exit 2; }
done
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] || { echo "backup: BACKUP_AGE_RECIPIENT must be a public age key (age1…)" >&2; exit 2; }

if [ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" ]; then
  export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
fi
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-eu-central-1}"
S3=(aws s3)
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && S3=(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3)
SSE=()
[ -n "${BACKUP_S3_SSE_KMS_KEY_ID:-}" ] && SSE=(--sse aws:kms --sse-kms-key-id "$BACKUP_S3_SSE_KMS_KEY_ID")

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="postgres/$(date -u +%Y/%m)/eventdesk-${STAMP}-${LABEL}.dump.age"

# custom-format dump → age (public-key encryption) → bucket; a failure anywhere fails the pipe
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" \
  | "${S3[@]}" cp - "s3://${BACKUP_S3_BUCKET}/${KEY}" "${SSE[@]}" --only-show-errors

SIZE="$("${S3[@]}" ls "s3://${BACKUP_S3_BUCKET}/${KEY}" | awk '{print $3}')"
[ "${SIZE:-0}" -gt 1024 ] || { echo "backup: the stored object is missing or too small" >&2; exit 1; }
echo "backup: stored ${KEY} (${SIZE} bytes, encrypted)"
