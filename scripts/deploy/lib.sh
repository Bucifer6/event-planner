#!/usr/bin/env bash
# Shared by the deploy scripts. Sourced, not run.
#
# THE INTERFACE (what .github/workflows/deploy.yml relies on):
#
#   scripts/deploy/backup.sh    <tag>             encrypted database backup, before anything changes
#   scripts/deploy/migrate.sh   <tag>             `pnpm db:migrate` with the NEW release's code
#   scripts/deploy/roll.sh      <tag>             switch web + worker + public site to <tag>
#   scripts/deploy/health.sh    <tag>             30 × 10 s against /api/health; exit 1 = unhealthy
#   scripts/deploy/rollback.sh  <to-tag> <from-tag>
#                                                 switch back to <to-tag>; exit 3 = REFUSED because a
#                                                 migration shipped after <to-tag> cannot be reversed
#
# Each script switches on DEPLOY_TARGET. The hosting vendor is an operator decision
# (docs/build/10-operator-decisions.md), so exactly ONE target is implemented, as a reference:
#
#   DEPLOY_TARGET=ssh-docker   a generic Docker host reached over SSH; the release is three
#                              images run by docker compose (infra/reference-docker-host/).
#
# To deploy somewhere else, add a case for your target in each script — the contract above
# (arguments, exit codes, "never delete data") is all the workflow knows.
#
# Rules for every target: no secret is echoed; a rollback changes which release runs and
# NOTHING else — it never drops, truncates or restores data (DEP5).

set -euo pipefail

: "${DEPLOY_TARGET:?DEPLOY_TARGET is not set (reference implementation: ssh-docker)}"

TAG_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.]*)?$'

require_tag() {
  [[ "${1:-}" =~ $TAG_RE ]] || { echo "deploy: \"${1:-}\" is not a release tag (vX.Y.Z)" >&2; exit 2; }
}

unsupported_target() {
  echo "deploy: DEPLOY_TARGET=\"$DEPLOY_TARGET\" is not implemented. Add a case for it in scripts/deploy/$1 (see lib.sh for the contract)." >&2
  exit 2
}

# One-line, secret-free explanation for the console (picked up by the workflow).
set_reason() {
  if [[ -n "${DEPLOY_REASON_FILE:-}" ]]; then printf '%s' "$1" > "$DEPLOY_REASON_FILE"; fi
  echo "deploy: $1" >&2
}

# ── ssh-docker ───────────────────────────────────────────────────────────────
# DEPLOY_SSH_HOST, DEPLOY_SSH_USER, DEPLOY_SSH_PORT (default 22)
# DEPLOY_SSH_KEY_FILE        path of the private key (the workflow writes it from a secret)
# DEPLOY_SSH_KNOWN_HOSTS_FILE  pinned host key — a host that is not listed is refused
# DEPLOY_DIR                 directory on the host (default /opt/eventdesk)
# IMAGE_PREFIX               <registry>/<namespace>; images are $IMAGE_PREFIX/{web,worker,public}:<tag>

ssh_docker_check() {
  : "${DEPLOY_SSH_HOST:?DEPLOY_SSH_HOST is not set}"
  : "${DEPLOY_SSH_USER:?DEPLOY_SSH_USER is not set}"
  : "${DEPLOY_SSH_KEY_FILE:?DEPLOY_SSH_KEY_FILE is not set}"
  : "${DEPLOY_SSH_KNOWN_HOSTS_FILE:?DEPLOY_SSH_KNOWN_HOSTS_FILE is not set}"
  : "${IMAGE_PREFIX:?IMAGE_PREFIX is not set}"
  DEPLOY_DIR="${DEPLOY_DIR:-/opt/eventdesk}"
  [[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "deploy: DEPLOY_DIR has unexpected characters" >&2; exit 2; }
  [[ "$IMAGE_PREFIX" =~ ^[A-Za-z0-9._:/-]+$ ]] || { echo "deploy: IMAGE_PREFIX has unexpected characters" >&2; exit 2; }
}

# Runs a script (read from stdin) on the host with bash; extra args become $1, $2, …
remote() {
  ssh -p "${DEPLOY_SSH_PORT:-22}" \
    -i "$DEPLOY_SSH_KEY_FILE" \
    -o IdentitiesOnly=yes \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$DEPLOY_SSH_KNOWN_HOSTS_FILE" \
    -o ConnectTimeout=20 \
    -o ServerAliveInterval=30 \
    "$DEPLOY_SSH_USER@$DEPLOY_SSH_HOST" \
    bash -seuo pipefail -- "$@"
}
