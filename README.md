# EventDesk.ro

Event planning platform for the Romanian market. The product spec is
[`docs/PRD.md`](docs/PRD.md) (v4.9); the executable build plan derived from it is
[`docs/build/`](docs/build/). Nothing in the build plan overrides the PRD — on conflict,
the PRD wins and the conflict is reported.

## Status

- **Docs only on `main` until Release 0 lands.** This branch adds the working foundation:
  monorepo scaffold, database schema + migrations, auth (email code + magic link +
  anonymous Argon2id accounts), security middleware, i18n (ro-RO default, en toggle),
  the "Garden Soirée" design system, job queue + worker, and Release A (plan and invite:
  occasions, templates, tasks, delegation, roles/grants, household invitations with
  scoped guest links, atomic capacity RSVP, date polls, atomic contribution claims,
  What-if previews, CSV/XLSX guest import, exports, daily digest job).
- Releases B, P, C, D, E follow per `docs/build/` (each needs its own go-ahead).

## Stack (fixed by PRD Q7/INF9)

Next.js + PostgreSQL + one web service + one worker, pnpm monorepo:

```
apps/web/       app.eventdesk.ro — Next.js App Router + Server Actions (+ /api/health, /mcp later)
apps/public/    eventdesk.ro — static export, zero cookies, zero third-party scripts (D1)
apps/worker/    the single worker process draining the Postgres job queue
packages/db/     Prisma schema, migrations, seed (all DB access lives here)
packages/core/   domain logic shared by web + worker (occasions, tasks, RSVP, …)
packages/auth/   sign-in codes, magic links, Argon2id anonymous accounts, sessions, rate limits
packages/i18n/   messages/ro.json + messages/en.json — the only place UI strings live (L1/L2)
packages/ui/     "Garden Soirée" design tokens + components (PRD section 21)
packages/email/  transactional email client + bilingual templates (L5) + suppression list (INF2)
packages/jobs/   Postgres job queue (FOR UPDATE SKIP LOCKED) + job registry
packages/shared/ ids, token hashing, time/locale formatting, errors
```

## Develop

```bash
pnpm install
pnpm db:up            # embedded PostgreSQL into .pgdata/, writes .env DATABASE_URL
pnpm migrate:dev      # create/apply migrations (packages/db)
pnpm db:seed          # seven launch templates + monetization switch OFF
pnpm dev              # apps/web on :3000
pnpm dev:worker       # worker draining jobs
pnpm dev:public       # public site on :3001
pnpm test             # unit + integration (integration spins its own embedded Postgres)
pnpm build            # all apps
```

Secrets never live in the repo (SEC13): copy `.env.example` to `.env`; in production they
come from the platform secret store. Operator-only decisions (providers, legal entity,
prices, launch counties, staffing) are listed in `docs/build/10-operator-decisions.md` and
read from env config, never hard-coded.

## Run with Docker (local evaluation copy)

```bash
docker compose up --build
# App: http://localhost:3000  ·  Public site: http://localhost:3001  ·  Postgres: localhost:5432
# Seed demo data + get a sign-in code:
docker compose exec web sh -c "pnpm --filter @eventdesk/db exec prisma db seed"
docker compose exec db sh -c "psql -U postgres -d eventdesk -c 'SELECT subject, body FROM \"EmailOutbox\" ORDER BY \"createdAt\" DESC LIMIT 1;'"
```

All published ports bind to `127.0.0.1` only — nothing is exposed beyond the host.
In the compose setup `EMAIL_PROVIDER=dev`, so sign-in codes are written to the
`EmailOutbox` table and never sent. The app image (`apps/web/Dockerfile`, also built by
the deploy workflow) runs migrations on boot and serves either service:
`docker compose up web` / `worker` (`CMD ["web"]`, `command: ["worker"]`).
`apps/public/Dockerfile` serves the static export with nginx (D1: no cookies, no
third-party scripts). Stop and wipe everything with `docker compose down -v`.

## Conventions

- Branches: `feat/<work-item>-<slug>` from `main`; PRs to `main` with the checklist in
  `docs/build/README.md`. Releases are annotated tags `vX.Y.Z` cut from protected `main`;
  a tag is deployable only when CI passed on that exact commit (DEP7). Never force-push
  `main` or a release tag.
- All user-facing strings live only in `packages/i18n/messages/ro.json` and `en.json`
  (default `ro-RO`, L1/L2). Locale formatting: RON, dd.mm.yyyy, 24h, Europe/Bucharest (L3/INF8).
- Money in integer minor units (bani). Timestamps stored UTC. IDs are cuid2; guest-link
  tokens are ≥128-bit random and stored hashed (SEC2/SEC8).
- `AuditLog` is append-only, enforced by a DB trigger (SEC10).
- Security headers (SEC5) are set in `apps/web/middleware.ts` and asserted in CI.
