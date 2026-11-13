#!/usr/bin/env bash
# DEP4 step 4: health checks against the public URL of the web app.
#   scripts/deploy/health.sh <tag>
# 30 attempts, 10 s apart. Healthy = HTTP 200, { "ok": true } and the version that was just
# deployed (so an old release that is still answering does not count). Exit 1 = unhealthy.
# Works the same for every DEPLOY_TARGET: it only needs APP_URL.
set -euo pipefail
TAG="${1:?usage: health.sh <tag>}"
: "${APP_URL:?APP_URL is not set}"
ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
PAUSE="${HEALTH_PAUSE_SECONDS:-10}"
NEEDED="${HEALTH_CONSECUTIVE:-3}"

good=0
for i in $(seq 1 "$ATTEMPTS"); do
  body="$(curl --silent --show-error --max-time 8 --fail "${APP_URL%/}/api/health" 2>/dev/null || true)"
  if node -e '
    const [body, tag] = process.argv.slice(1);
    let j; try { j = JSON.parse(body); } catch { process.exit(1); }
    process.exit(j && j.ok === true && j.version === tag ? 0 : 1);
  ' "$body" "$TAG"; then
    good=$((good + 1))
    echo "health: attempt $i/$ATTEMPTS ok ($good/$NEEDED in a row)"
    if [ "$good" -ge "$NEEDED" ]; then echo "health: $TAG is healthy"; exit 0; fi
  else
    good=0
    echo "health: attempt $i/$ATTEMPTS not healthy yet"
  fi
  sleep "$PAUSE"
done
echo "health: $TAG did not become healthy after $ATTEMPTS attempts" >&2
exit 1
