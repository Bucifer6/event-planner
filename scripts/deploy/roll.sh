#!/usr/bin/env bash
# DEP4 step 3: switch web + worker + public site to the new release.
#   scripts/deploy/roll.sh <tag>
# The release that was running is remembered (release.prev.env) so rollback.sh can put it back.
source "$(dirname "$0")/lib.sh"
TAG="${1:-}"; require_tag "$TAG"

case "$DEPLOY_TARGET" in
  ssh-docker)
    ssh_docker_check
    remote "$DEPLOY_DIR" "$IMAGE_PREFIX" "$TAG" <<'REMOTE'
cd "$1"
# optional host hook: refresh app.env from the secret store, by reference (SEC13)
if [ -x ./render-env ]; then ./render-env; fi
umask 077
printf 'WEB_IMAGE=%s/web:%s\nWORKER_IMAGE=%s/worker:%s\nPUBLIC_IMAGE=%s/public:%s\nAPP_VERSION=%s\n' \
  "$2" "$3" "$2" "$3" "$2" "$3" "$3" > release.next.env
docker compose --env-file release.next.env pull -q web worker public
if [ -f release.env ]; then cp release.env release.prev.env; fi
mv release.next.env release.env
# compose replaces each container and waits until all three report healthy
docker compose --env-file release.env up -d --remove-orphans --wait --wait-timeout 180 web worker public
docker image prune -f --filter "until=336h" >/dev/null 2>&1 || true
REMOTE
    ;;
  *) unsupported_target roll.sh ;;
esac
