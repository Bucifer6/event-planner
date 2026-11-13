#!/usr/bin/env bash
# DEP4 step 2: database migrations (`pnpm db:migrate` = drizzle migrations + SQL guards),
# run with the NEW release's code, after the backup and before the release is switched.
#   scripts/deploy/migrate.sh <tag>
# Migrations must be backward compatible with the release that is still running (expand,
# then contract in a later release). One that is not reversible must be listed in
# scripts/deploy/irreversible.txt — see rollback.sh.
source "$(dirname "$0")/lib.sh"
TAG="${1:-}"; require_tag "$TAG"

case "$DEPLOY_TARGET" in
  ssh-docker)
    ssh_docker_check
    remote "$DEPLOY_DIR" "$IMAGE_PREFIX" "$TAG" <<'REMOTE'
cd "$1"
# optional host hook: refresh app.env from the secret store, by reference (SEC13)
if [ -x ./render-env ]; then ./render-env; fi
docker pull -q "$2/worker:$3"
WEB_IMAGE="$2/web:$3" WORKER_IMAGE="$2/worker:$3" PUBLIC_IMAGE="$2/public:$3" APP_VERSION="$3" \
  docker compose run --rm -T tools pnpm db:migrate
REMOTE
    ;;
  *) unsupported_target migrate.sh ;;
esac
