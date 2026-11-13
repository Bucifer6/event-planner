#!/usr/bin/env bash
# DEP4 step 1: an encrypted database backup BEFORE migrations (INF10, SEC9).
#   scripts/deploy/backup.sh <tag>
# The dump is encrypted before it leaves the database network and stored in the backup
# bucket; the key that can decrypt it is not on the host (see container-backup.sh).
source "$(dirname "$0")/lib.sh"
TAG="${1:-}"; require_tag "$TAG"

case "$DEPLOY_TARGET" in
  ssh-docker)
    ssh_docker_check
    # Runs in the CURRENT release's tools container (it has pg_dump 16, age and an S3 client).
    # On the very first deploy there is no release yet: the new image is used instead.
    remote "$DEPLOY_DIR" "$IMAGE_PREFIX" "$TAG" <<'REMOTE'
cd "$1"
# optional host hook: refresh app.env from the secret store, by reference (SEC13)
if [ -x ./render-env ]; then ./render-env; fi
if [ -f release.env ]; then
  docker compose --env-file release.env run --rm -T tools bash scripts/deploy/container-backup.sh "pre-deploy-$3"
else
  docker pull -q "$2/worker:$3"
  WEB_IMAGE="$2/web:$3" WORKER_IMAGE="$2/worker:$3" PUBLIC_IMAGE="$2/public:$3" APP_VERSION="$3" \
    docker compose run --rm -T tools bash scripts/deploy/container-backup.sh "pre-deploy-$3"
fi
REMOTE
    ;;
  *) unsupported_target backup.sh ;;
esac
