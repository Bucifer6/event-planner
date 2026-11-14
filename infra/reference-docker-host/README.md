# Reference deploy target: a Docker host over SSH (`DEPLOY_TARGET=ssh-docker`)

This is the **one implemented** target of `scripts/deploy/*.sh`. It is a reference, not a
hosting decision: any Linux host with Docker, reachable over SSH, in the EU (INF9). The
Terraform compute module (`infra/terraform/modules/compute`) creates such a host on the
reference cloud; a rented server at a Romanian provider works the same way.

## What lives on the host (`/opt/eventdesk`, owned by the `deploy` user)

| File | Written by | Contains |
| --- | --- | --- |
| `docker-compose.yml` | operator, copied from this folder | the services: `web`, `worker`, `public`, `tools`, `ingress` |
| `Caddyfile` | operator, copied from this folder | TLS and the three host names |
| `ingress.env` | host bootstrap / operator | `APP_HOST`, `MEDIA_HOST`, `PUBLIC_HOST`, `ACME_EMAIL` (not secrets) |
| `app.env` (mode 0600) | `render-env`, from the secret store | the application environment (names in `.env.example`) |
| `render-env` (optional) | host bootstrap | fetches the secret **by reference** and rewrites `app.env`; the deploy scripts run it before each step if it exists |
| `release.env` | deploy scripts | which images run now (`WEB_IMAGE`, `WORKER_IMAGE`, `PUBLIC_IMAGE`, `APP_VERSION`) |
| `release.prev.env` | deploy scripts | the release before this one |

No secret is in an image, in `docker-compose.yml` or in the repository. On a host that has
no secret-store agent, the operator writes `app.env` by hand (mode 0600) and omits
`render-env`.

## One-time setup (operator)

1. Install Docker Engine and the Compose plugin; create the `deploy` user (key-only SSH,
   member of the `docker` group); create `/opt/eventdesk`. The Terraform host does this itself.
2. Copy `docker-compose.yml` and `Caddyfile` from this folder to `/opt/eventdesk/`.
3. Write `ingress.env` and make `app.env` available (see the table).
4. Sign the host in to the image registry **read-only**: `docker login <registry>` as `deploy`.
5. Start the ingress once: `docker compose up -d ingress`. Web, worker and public start with
   the first deploy.
6. Record the host key for the pipeline: `ssh-keyscan -p 22 <host>` → verify the fingerprint
   out of band → GitHub environment secret `DEPLOY_SSH_KNOWN_HOSTS`.

## What the pipeline does here

| Step | Script | On the host |
| --- | --- | --- |
| backup | `scripts/deploy/backup.sh <tag>` | `docker compose run --rm tools bash scripts/deploy/container-backup.sh pre-deploy-<tag>` |
| migrate | `scripts/deploy/migrate.sh <tag>` | pulls the new worker image, `docker compose run --rm tools pnpm db:migrate` |
| switch | `scripts/deploy/roll.sh <tag>` | writes `release.env`, `docker compose up -d --wait web worker public` |
| health | `scripts/deploy/health.sh <tag>` | (from the runner) `GET https://app.<domain>/api/health` until it reports `<tag>` |
| rollback | `scripts/deploy/rollback.sh <to> <from>` | refuses if `irreversible.txt` lists a release in between; otherwise switches `release.env` back |

A rollback changes `release.env` and restarts containers. It never touches the database or
the buckets.

## Daily backup and monthly restore test

The worker runs both jobs (02:30 daily, 04:30 on the 1st); they are configured with two
variables in the application secret:

```
BACKUP_COMMAND=bash /app/scripts/deploy/container-backup.sh daily
RESTORE_TEST_COMMAND=bash /app/scripts/deploy/container-restore-test.sh
```

The restore test needs the **private** backup key (`BACKUP_AGE_IDENTITY_FILE`) and a scratch
database (`RESTORE_TEST_DATABASE_URL`). Keeping that key permanently on the same host as the
backups would defeat SEC9; mount it only for the test, or run the test from a separate,
restricted machine. This is an operator decision recorded in the runbook.
