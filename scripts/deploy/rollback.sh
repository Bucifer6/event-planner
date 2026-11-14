#!/usr/bin/env bash
# DEP4 (automatic, after failed health checks) and DEP5 (manual, from the console):
#   scripts/deploy/rollback.sh <to-tag> <from-tag>
# Puts release <to-tag> back. It changes which release RUNS and nothing else: no data is
# dropped, truncated or restored, and no migration is undone.
#
# That is only safe when the older code can work with the newer database. A migration that
# breaks older code (dropped column, tightened constraint, rewritten data) must be declared
# in scripts/deploy/irreversible.txt by the release that ships it. If any release in
# (<to-tag>, <from-tag>] is listed there, this script REFUSES — exit 3, reason in
# $DEPLOY_REASON_FILE — and a person decides what to do (fix forward, or the restore
# procedure in docs/build/14-deploy-runbook.md). It never guesses.
source "$(dirname "$0")/lib.sh"
TO="${1:-}"; FROM="${2:-}"
require_tag "$TO"; require_tag "$FROM"

# version_le A B  → true when A <= B (sort -V understands vX.Y.Z)
version_le() { [ "$1" = "$2" ] || [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$1" ]; }

MARKERS="$(dirname "$0")/irreversible.txt"
if [ -f "$MARKERS" ]; then
  while read -r tag migration _; do
    case "$tag" in ''|\#*) continue ;; esac
    # listed release is newer than the target and not newer than the one being left
    if ! version_le "$tag" "$TO" && version_le "$tag" "$FROM"; then
      set_reason "rollback to $TO refused: migration ${migration:-?} of release $tag cannot be reversed; nothing was changed"
      exit 3
    fi
  done < "$MARKERS"
fi

case "$DEPLOY_TARGET" in
  ssh-docker)
    ssh_docker_check
    remote "$DEPLOY_DIR" "$IMAGE_PREFIX" "$TO" <<'REMOTE'
cd "$1"
# optional host hook: refresh app.env from the secret store, by reference (SEC13)
if [ -x ./render-env ]; then ./render-env; fi
umask 077
printf 'WEB_IMAGE=%s/web:%s\nWORKER_IMAGE=%s/worker:%s\nPUBLIC_IMAGE=%s/public:%s\nAPP_VERSION=%s\n' \
  "$2" "$3" "$2" "$3" "$2" "$3" "$3" > release.next.env
docker compose --env-file release.next.env pull -q web worker public
if [ -f release.env ]; then cp release.env release.failed.env; fi
mv release.next.env release.env
docker compose --env-file release.env up -d --remove-orphans --wait --wait-timeout 180 web worker public
REMOTE
    ;;
  *) unsupported_target rollback.sh ;;
esac
