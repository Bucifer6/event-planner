#!/bin/sh
# App image entrypoint: apply migrations (idempotent; DEP4 runs them in the deploy job
# too), then start the requested service. Usage: docker run <image> [web|worker|...]
set -e
cd /app
if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  pnpm --filter @eventdesk/db exec prisma migrate deploy
fi
case "${1:-web}" in
  web)
    exec pnpm --filter @eventdesk/web exec next start -p "${PORT:-3000}"
    ;;
  worker)
    exec pnpm --filter @eventdesk/worker start
    ;;
  *)
    exec "$@"
    ;;
esac
