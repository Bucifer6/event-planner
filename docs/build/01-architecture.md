# 01 — Architecture, environments and CI/CD

Stack is fixed by PRD Q7/INF9: **Next.js, PostgreSQL, one web service, one worker**, plus an
S3-compatible object store (INF3) and a transactional email provider (INF2). All production data is
hosted in the EU, Romania preferred (INF9). Everything else below is the concrete shape agents
should build; provider choices marked "operator-configurable" are listed in
`10-operator-decisions.md` and must be read from env config, never hard-coded.

## Domains (INF1, SEC4)

| Domain | Serves | Rules |
| --- | --- | --- |
| `eventdesk.ro` | Public site (`apps/public`), static export | No cookies, no third-party scripts (D1), self-hosted fonts preferred, SPF/DKIM/DMARC on the sending domain (LAU3) |
| `app.eventdesk.ro` | Web app (`apps/web`) and the MCP endpoint at `app.eventdesk.ro/mcp` (MCP8) | Strict CSP, HSTS, session cookies per SEC12 |
| `media.eventdesk.ro` | Uploaded PDFs (drawings, quotes) | `Content-Disposition: attachment; noinline`; never same origin as the app (SEC4) |

All transactional email is sent from `eventdesk.ro` or a subdomain with SPF, DKIM and DMARC
configured (INF1).

## Repository layout (monorepo, pnpm workspaces)

```
repo root (protected main; releases tagged vX.Y.Z)
├── apps/
│   ├── web/        app.eventdesk.ro — Next.js (App Router) + Server Actions; also serves /mcp
│   ├── public/     eventdesk.ro — Next.js static export; zero cookies, zero 3rd-party scripts
│   └── worker/     the single worker process (Node) draining the Postgres job queue
├── packages/
│   ├── db/         Prisma schema, migrations, seed, repository helpers (all DB access lives here)
│   ├── core/       domain logic shared by web + worker (occasions, tasks, budget, directory, …)
│   ├── auth/       sign-in codes, sessions, Argon2id passwords, TOTP, passkeys, rate limits
│   ├── i18n/       next-intl setup + messages/ro.json + messages/en.json (only place strings live)
│   ├── ui/         "Garden Soirée" design system: tokens (palette/type/radius), components, 44px targets
│   ├── email/      transactional email client + bilingual templates (L5) + suppression list
│   ├── storage/    S3-compatible client, signed upload URLs, upload pipeline (SEC4), fair-use counters
│   ├── jobs/       job queue (Postgres table, FOR UPDATE SKIP LOCKED leasing) + job definitions
│   ├── mcp/        MCP server (Streamable HTTP) + tool catalogue (MCP8)
│   └── shared/     validation (zod), errors, time (INF8), idempotency, logging
├── infra/          Terraform (or equivalent IaC) for EU hosting, object store, DNS, media domain
├── docs/           PRD.md, build/ (this plan)
└── .github/workflows/  ci.yml, release.yml, deploy.yml
```

Tooling: TypeScript strict everywhere, pnpm, ESLint + Prettier, Vitest (unit + integration against a
test Postgres), Playwright (e2e), k6 (load, run pre-release per Q5), zod for all input validation.

## Service topology

- **Web service** (`apps/web`): Next.js App Router. UI calls Server Actions; external integrations
  (webhooks, MCP, guest links with token auth) are Route Handlers. All writes go through
  `packages/core` so the worker can reuse the same domain code.
- **Worker** (`apps/worker`): one Node process, no HTTP surface. Drains the `jobs` table. Owns all
  scheduled/async work: email sending, daily digests (A10), retention purges (INF6/D5), backups +
  monthly restore test (INF10/SEC9), nightly directory statistics (INF11/D4), enquiry nudges
  (P32), discovery runs (BD7), deployment pipeline (DEP4), Stripe/e-Factura webhooks (dormant until
  MON ON), MCP token inactivity expiry (MCP1).
- **Database**: PostgreSQL 16, accessed only via Prisma in `packages/db`. Migrations run in the
  deploy job (`prisma migrate deploy`) after backup, before release swap (DEP4). Append-only
  `audit_log` enforced at the DB level: revoke UPDATE/DELETE from the app role, insert-only
  trigger (SEC10).
- **Object store**: S3-compatible, EU region (operator-configurable endpoint, INF3). Buckets:
  private assets (signed URLs only) and the media domain bucket for PDFs (SEC4).
- **Email provider**: operator-configurable transactional provider with EU delivery (INF2).
  Bounce/complaint webhooks feed a suppression list; hard-bounced addresses are never emailed
  again; daily limits (Q6) enforced server-side before the provider is called.

## Data flow rules

- All timestamps stored in UTC; displayed in Europe/Bucharest with Romanian month/weekday names;
  DST handled in the display layer only (INF8, L3).
- Every mutating Server Action / route accepts an idempotency key; unique constraints + conditional
  updates make double-taps apply once (Q4, A8, A9).
- Money is stored as integer minor units (bani) per currency; RON at launch (L3, B3).
- Atomic capacity/claim operations use `SELECT … FOR UPDATE` or conditional `UPDATE … WHERE`
  returning rowCount; rowCount 0 ⇒ "last place taken" response (A8, A9).
- Facts (arrivals, payments, received stock) change only via a `correction` record that keeps
  before/after and actor (principle 4; SEC10 audit).

## Environments, secrets, hosting (INF9, SEC13)

- `dev` (local dockerised Postgres + MinIO-compatible local S3 + mailhog-style catcher), `staging`,
  `production`. All non-dev environments in the EU (Romania preferred) — operator-configurable
  vendor, see `10-operator-decisions.md`.
- Secrets (Stripe keys, email provider credentials, GitHub App credentials, backup encryption
  keys, MCP signing material) live only in the platform secret store (operator-configurable
  product), injected as env vars, never in repo, logs or build output; rotate at least annually or
  on staff departure; the console shows last-rotation dates, never values (SEC13, SEC8).
- Backup encryption key is customer-managed and held separately from backups; rotation tested by
  restoring a pre-rotation backup before retiring the old key (SEC9, INF10).
- `infra/` provisions: app hosting, Postgres (daily encrypted backups, 30-day retention, INF10),
  object store (versioning, 30-day recovery, INF10), media domain, DNS for the three domains,
  monitoring/alerting channel (LAU5).

## CI (GitHub Actions) — required by DEP7

`ci.yml` on every PR and on `main`:
1. install (pnpm, frozen lockfile)
2. lint + typecheck
3. unit + integration tests (Vitest, test Postgres)
4. build all three apps
5. dependency audit (`pnpm audit` + OSV scan; fail on high+)
6. e2e smoke (Playwright) on an ephemeral preview of `apps/web`
7. a11y: axe-core on critical flows; CSP/header assertions (SEC5); 320px viewport checks

`release.yml` on tag `v*`: runs the full CI on that exact commit and records the result; protected
`main` + protected tags per DEP7. `deploy.yml` is triggered only from the console flow (DEP2–DEP4),
never directly from a push.

## Deployment pipeline (W10, DEP1–DEP7) — build shape

- Console ↔ one private, organization-owned GitHub repo via a GitHub App scoped to that repo only
  (DEP1); credentials server-side only, shown nowhere in the browser.
- Console shows live release + commit hash, available tags, commits between live and candidate
  (DEP2); deploy by **tag only**, never a branch head; production deploys need second-person
  approval, queued under single-operator mode (DEP3, W9); emergency SecurityAdministrator path is
  audit-marked (DEP3).
- Deploy job (runs in the worker, Q7): backup DB → `prisma migrate deploy` → swap release →
  health checks → on failure automatic rollback to previous release with reason shown (DEP4).
  Rollback never deletes data; a non-reversible migration stops rollback and says so (DEP5).
- Every deploy audit-logged: hash, tag, requester, approver, result, duration, rollbacks (DEP6);
  deploys disabled while one is running. Console refuses a tag whose CI is not green on that commit
  (DEP7), except the audit-logged emergency path.
- Runbook for launch day is an operator obligation (LAU7); the console exposes the deploy history.

## Monitoring and incident response (LAU5)

Health endpoint feeding deploy rollback (DEP4/DEP5), error-rate and queue-depth alerts to the
operator channel, documented restore procedure (RTO 4h, RPO 24h with daily backups, INF10),
incident log in the console, and a plain-language "ceva nu funcționează" status message on
guest-facing pages — never a stack trace.
