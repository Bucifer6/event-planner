# 01 — Architecture, as built

**What this is, in plain English.** A map of how EventDesk.ro is put together: the three
programs that run (the app, the public site, the background worker), the shared building
blocks they use, how a request travels through them, and how a change gets from a developer's
branch to production. It describes the code in this repository on 14 November 2026.

**What has been run and what has not.** The app, the public site and the worker run on a
developer machine against PostgreSQL 16. The CI and deploy workflows, the container images,
the Terraform description and the deploy scripts have **never run** — they are written and
reviewed, not exercised. Read "as implemented" below as "as written in the repository".

The stack is fixed by PRD Q7/INF9: Next.js, PostgreSQL, one web service and one worker, plus
an S3-compatible object store (INF3) and a transactional email provider (INF2). Choices left
to the operator are in `10-operator-decisions.md` and are read from the environment or from
console settings, never hard-coded.

## The picture

```
                 visitors                    planners, guests, businesses, staff, AI assistants
                    │                                        │
                    ▼                                        ▼
        ┌──────────────────────┐              ┌───────────────────────────────────────┐
        │  apps/public         │              │  apps/web  (Next.js, Node)            │
        │  eventdesk.ro        │              │  app.eventdesk.ro                     │
        │  static HTML files   │              │                                       │
        │  no cookies,         │              │  proxy.ts ── security headers, nonce  │
        │  no third-party      │              │     │                                 │
        │  scripts             │              │     ▼                                 │
        └──────────────────────┘              │  pages (Server Components)            │
                                              │  Server Actions (app/actions/*)       │
          media.eventdesk.ro  ───────────────▶│  Route Handlers: /api/*, /mcp,        │
          (same web service, /api/media       │     /g /s /e /invite /claim links     │
           only: uploaded files as            └───────────────┬───────────────────────┘
           downloads)                                         │ calls
                                                              ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │  packages/core  — every business rule and every access check                     │
   │  uses: auth · email · storage · jobs · mcp · i18n · shared                       │
   └───────────────┬──────────────────────────────────────────────┬───────────────────┘
                   │ Drizzle ORM (packages/db)                    │ enqueue (same transaction)
                   ▼                                              ▼
        ┌──────────────────────┐   jobs table        ┌───────────────────────────────┐
        │  PostgreSQL 16       │◀────────────────────│  apps/worker (Node, no HTTP)  │
        │  167 tables          │   lease, run, mark  │  email, digests, retention,   │
        │  + trigger guards    │────────────────────▶│  statistics, backups, nudges  │
        └──────────────────────┘                     └──────┬─────────────┬──────────┘
                                                            │             │
                              object store (S3 or local folder)     email provider,
                              malware scanner (operator's)          backup command (operator's)
```

## Stack and versions

Taken from the `package.json` files; versions are pinned exactly.

| Piece | Version | Where |
| --- | --- | --- |
| Node.js | 22.12 or newer | root `engines` |
| pnpm | 10.28.0 | root `packageManager` |
| TypeScript | 5.9.3 (strict, `noUncheckedIndexedAccess`) | `tsconfig.base.json` |
| Next.js / React | 16.4.6 / 19.3.1 | `apps/web`, `apps/public` |
| next-intl | 4.15.1 | `apps/web`, `apps/public` |
| Drizzle ORM / drizzle-kit / pg | 0.45.4 / 0.31.11 / 8.23.1 | `packages/db` |
| zod | 4.6.7 | every package that validates input |
| Vitest | 5.1.0 | root; one project per package |
| ESLint / Prettier | 10.14.0 / 3.10.1 | root |
| sharp (image re-encoding) | 0.35.5 | `packages/storage`, `packages/core` |
| pdfkit / fontkit (PDFs) | 0.20.2 / 2.0.4 | `packages/core` |
| @node-rs/argon2, otpauth | 2.2.2, 9.6.0 | `packages/auth` |
| AWS SDK S3 client | 3.1169.0 | `packages/storage` |
| PostgreSQL | 16 | `docker-compose.dev.yml`, CI service, runbook |

There is no CSS framework and no component library: only `packages/ui`. Packages are consumed
as TypeScript source (no build step); the Next apps list them in `transpilePackages`.

## Domains (INF1, SEC4)

| Domain | Serves | Rules |
| --- | --- | --- |
| `eventdesk.ro` | `apps/public`, a static export served by Caddy in the reference target | No cookies, no third-party scripts (D1); checked by `scripts/check-public-d1.mjs` |
| `app.eventdesk.ro` | `apps/web`, including the MCP endpoint at `/mcp` | Strict CSP with a per-request nonce, HSTS in production, session cookie `ed_session` |
| `media.eventdesk.ro` | The same web service, restricted by `proxy.ts` to `/api/media/*` | Uploaded files only, as downloads, through short-lived signed links; no cookies on this origin |

## The programs

### `apps/web` — the app

Next.js App Router. Route groups and what they are for (about 140 pages and route handlers at
the time of writing; the full list is easiest to see with `find apps/web/app -name page.tsx -o
-name route.ts`):

| Path | Who | What |
| --- | --- | --- |
| `(auth)/sign-in…`, `/sign-out` | anyone | Email code, one-tap link, anonymous accounts, the second step |
| `(app)/occasions/…` | signed-in planners and team members | The occasion and its sections (list in `apps/web/lib/occasion-nav.ts`) |
| `(app)/business/…` | business members | Listings, spaces and drawings, catalogues, enquiries, team, library, branding, reports, plan |
| `(app)/account/…` | signed-in people | Profile, security, login email, assistants (MCP tokens), deletion |
| `/directory/…` | anyone | The directory: category × county (× locality) pages, a listing, the enquiry form (sign-in required to send) |
| `/g/[token]`, `/g/q/[qrId]` | guests | The household's invitation and the page a printed QR opens |
| `/s/[token]` | suppliers | A supplier's scoped view of its own booking and briefing |
| `/e/[slug]`, `/e/[slug]/r/[token]` | the public | A published event page with registration; a registrant's own page |
| `/invite/[token]`, `/business/invite/[token]` | invited people | Accept a team invitation |
| `/claim/[listingId]…` | businesses | Claim an unclaimed listing, or ask for its removal |
| `/report` | anyone | Report content (DSA notice and action) |
| `/console/…` | staff with two-step sign-in | The management console (list in `apps/web/app/console/_nav.ts`) |
| `/mcp` | external AI assistants with a token | The MCP endpoint |
| `/api/health` | monitoring, deploy pipeline | `{ ok, version }` after a database ping |
| `/api/uploads`, `/api/media/[...key]` | signed-in users; anyone with a signed link | Upload a file; download one |
| `/api/webhooks/email`, `/stripe`, `/invoicing` | providers | Bounces and complaints; dormant payment and invoicing events |
| `/api/deploys/record` | the deploy workflow | Progress reports, authenticated by a machine token |
| `/api/auth/link/[token]`, `/api/occasions/[id]/offline` | the app itself | One-tap sign-in; offline capture sync |
| `/offline`, `manifest.ts`, `public/sw.js` | installed app | The offline shell of the installable app (B11) |
| `/help`, `/help/[slug]` | anyone; a staff section for staff | The help centre (added 14 November 2026; see `18-contracts.md`) |

### `apps/public` — the public site

Next.js static export under `app/[locale]/`: home, how it works, for businesses, guides,
terms, privacy, cookies, moderation rules, accessibility statement and a status page, in
Romanian and English, plus `sitemap` and `robots`. It imports only `@ed/i18n`, `@ed/shared`
and `@ed/ui`; it has no database access and sets no cookie.

### `apps/worker` — the background worker

One Node process with no HTTP surface (`apps/worker/src/index.ts`). It checks the
environment, registers every job and schedule (`packages/jobs/src/registry.ts`) and loops:
lease jobs with `FOR UPDATE SKIP LOCKED`, run them, mark them done or failed with back-off.
Delivery is at-least-once, so every handler is idempotent. It writes queue metrics to the
setting `ops.queueMetrics` every minute and stops cleanly on `SIGTERM`.

## Packages and what each is responsible for

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `@ed/shared` | Ids (cuid2), token hashing, money in minor units, time zones, zod helpers, `AppError`, boot-time environment check, the SSRF guard | — |
| `@ed/db` | Drizzle schema (46 files, 167 tables), the migration, SQL guards, seeds, the test-database harness | shared |
| `@ed/i18n` | Messages (75 namespaces × Romanian and English, 14 of them the help centre), locale formatting | shared |
| `@ed/ui` | The "Maison" components, tokens, icons, fonts | — |
| `@ed/core` | **All business rules and all access checks.** about a hundred modules, one per domain (plus the loader and two wiring files) | db, shared, i18n, email, storage, jobs |
| `@ed/auth` | Sign-in codes and links, anonymous accounts, sessions, fresh confirmation, TOTP, recovery codes | core, db, email, shared |
| `@ed/email` | Template registry, bilingual rendering, the send pipeline, providers, suppression list | core, db, i18n, shared |
| `@ed/storage` | Upload pipeline, scan gate, signed links, fair-use counters, S3 or local transport | core, db, shared |
| `@ed/jobs` | Queue, schedules, runner, metrics, the registry of all jobs | core, db, storage, auth, mcp, shared |
| `@ed/mcp` | The MCP server, tokens, the 23-tool catalogue | auth, core, db, i18n, jobs, shared |

The rule that keeps this manageable: **web, worker and MCP never contain business rules or
access checks; they call `@ed/core`.** A core function has the shape `fn(ctx, input)`, where
`ctx` says who is acting (`account`, `guest`, `staff`, `mcp`, `system` or `anonymous`), on
which database connection, at what time. It validates `input` with zod, checks access, does
the work, writes an audit entry, and throws an `AppError` with a translation key when it
refuses.

## How a request flows

1. **`apps/web/proxy.ts`** (Next 16's name for middleware) runs first. It refuses anything
   but `/api/media/*` on the media host, creates a nonce and sets the security headers.
2. **A page** (a Server Component) calls `getCtx()` or `requireCtx()` from
   `apps/web/lib/ctx.ts`. That resolves the actor from the session cookie
   (`apps/web/lib/session.ts`), the locale and the client address, and builds the `Ctx`.
   Console pages use `requireConsole()` (`apps/web/app/console/_lib.ts`); guest pages resolve
   the link token through `apps/web/lib/guest.ts`.
3. The page calls **core** functions to read. Core checks membership and grants on every read.
4. **A change** is a Server Action in `apps/web/app/actions/<domain>.ts`, wrapped by
   `action()` (`apps/web/lib/action.ts`), which resolves the `Ctx`, validates the form,
   calls core and turns any `AppError` into `{ ok: false, error }` with a translated message
   and the typed values echoed back. Route Handlers that change state check the request's
   origin (`apps/web/lib/csrf.ts`).
5. Core reads and writes through **Drizzle** on PostgreSQL, usually inside `inTx`. Work that
   should happen later (an email, a nudge) is enqueued **in the same transaction**, so it
   exists only if the change committed.
6. The **worker** picks the job up and runs it with a system actor.

## Sign-in and sessions

Detailed in `03-cross-cutting.md`. In short: email accounts sign in with a six-digit code or
the one-tap link in the same email; anonymous accounts with a generated username and a
password hashed with Argon2id. A session is a random token in the `ed_session` cookie
(Secure in production, HttpOnly, SameSite=Lax) whose SHA-256 is stored in `sessions`; it
lasts 30 days or 14 days idle and can be revoked server-side. Sensitive actions need a fresh
confirmation within ten minutes. Two-step sign-in is opt-in and authenticator-app (TOTP)
only — **passkeys are not built** (`packages/auth/src/passkeys.ts` is a documented seam).
Staff must have two-step on; the console keeps its own session (12 hours, 30 minutes idle).

Guests, suppliers and public registrants have no account: their link carries a random token
of at least 128 bits, stored only as a hash, that resolves to a narrowly scoped actor.

## The registries pattern

Features in different domains have to meet — the budget needs supplier payments, the guest
page needs the menu, the worker needs everybody's clean-up — without the modules importing
each other in circles. Each meeting point is a **registry**: one module owns a list, other
modules add an entry when they are loaded.

| Registry | Owner | What plugs in |
| --- | --- | --- |
| What-if kinds | `core/whatif` (`registerWhatIf`) | 20 kinds of previewable change |
| Occasion exports | `core/exports` (`registerExport`) | CSV and PDF downloads on the *Print and export* page |
| Overview and digest sections | `core/overview`, `core/digest` | Budget alerts, payments due, readiness, shared-cost balances |
| Lifecycle impact and closeout sections | `core/lifecycle` | What a cancel, postponement or close affects; what is still open at closeout |
| Purge hooks | `core/occasions` (`onOccasionPurge`), `core/accounts` (`onAccountPurge`) | Each domain's clean-up when an occasion or account is finally deleted |
| Retention rules | `core/retention` (`registerRetentionRule`) | 15 nightly purge rules |
| Statistics collectors | `core/stats` (`registerStatCollector`) | Nightly aggregates |
| Moderation kinds | `core/moderation` (`registerModerationKind`) | `listing`, `drawing`, `parking`, `catalogue` |
| Approval actions | `core/approvals` (`registerApprovalAction`) | 9 actions that need a second (or third) person |
| Guest-page sections | `core/invitations` (`registerGuestSection`) | Polls, seat, programme, menu, contributions, venue, space view, private request |
| Rehearsal timeline sources | `core/rehearsal` (`registerTimelineSource`) | Tasks, itinerary, transport, activities, deliveries, programme |
| Budget sources | `core/budget` (`registerBudgetSource`) | Supplier payments feeding committed and paid amounts |
| Console dashboard counters | `core/staff` (`registerDashboardCounter`) | Counts only, never content |
| Upload purposes and asset access | `@ed/storage` | Who may upload what, and who may read it |
| Email templates | `@ed/email` (`registerTemplate`) | Each domain's emails |
| Jobs and schedules | `@ed/jobs` (`defineJob`, `defineSchedule`) | 25 jobs, 10 schedules |
| MCP tools | `@ed/mcp` (`registerMcpTool`) | The fixed 23-tool catalogue |

Two small modules exist only to connect domains that must not import each other:
`core/wiring` (enquiry counts for the business report, the free-phase dashboard and the
console counters) and `core/wiring-programme` (the programme as a rehearsal timeline source).

### The `@ed/core/all` loader, and why it exists

A registry entry exists only in a process that has loaded the module that registers it. Early
in the build this caused real faults: a preview could be created in one place and not be
confirmable in another because the kind was not registered there. `packages/core/src/all.ts`
imports **every** core module, and both long-running programs import it once —
`apps/web/instrumentation-node.ts` at web start and `packages/jobs/src/registry.ts` in the
worker. A test (`packages/core/test/all.test.ts`) fails if a module file is missing from the
list, so a new domain cannot be forgotten.

## The What-if engine (principle 3)

`packages/core/src/whatif.ts`. A change that deserves a second look — moving the date,
importing guests, cancelling, moving a payment, anything an AI assistant proposes — is first
stored as a **preview** in `whatif_previews`: its kind, its input and a list of before → after
rows. The person sees it on the occasion's *Ce-ar fi dacă?* page and confirms or discards it.
`confirmPreview` re-checks access, runs the kind's `apply` inside a transaction and marks the
preview applied; a second confirmation applies nothing. A preview whose basis changed is
refused rather than applied. Pending previews expire after 7 days. Only account and staff
actors can confirm; an MCP token can only create.

## Corrections and fact guards (principle 4)

Some rows are records of something that happened: a payment made, a quantity received, an
arrival, a published briefing, an approved drawing. The database itself protects them with
triggers (`packages/db/src/sql/`, listed in `02-data-model.md`). A fact can change only inside
a transaction that has written a row to `corrections` (old value, new value, reason, who) and
set the transaction-local flag `ed.correction`; rows that are immutable can only be removed
while the whole occasion is being purged (flag `ed.purge`). Only `@ed/core` sets either flag.

## Background jobs

Defined with `defineJob` next to the domain that owns them and registered in
`packages/jobs/src/registry.ts`. Times are Europe/Bucharest.

| Schedule | Job | What it does |
| --- | --- | --- |
| daily 00:20 | `stats.nightly` | Daily aggregates, listing response statistics |
| daily 02:30 | `backup.run` | Runs `BACKUP_COMMAND` (operator's); records the result |
| daily 03:10 | `auth.purge-expired` | Used and expired codes and links, dead sessions, old rate-limit windows |
| daily 03:20 | `accounts.purge-due` | Accounts whose 7-day undo has passed |
| daily 03:20 | `billing.sweep` | Dormant: grace periods and period ends |
| daily 03:30 | `retention.purge` | Runs every retention rule, including occasions due for deletion |
| daily 03:50 | `mcp.expire-inactive` | MCP tokens unused for 30 days |
| daily 07:30 | `digest.plan` → `digest.send` | One digest per member per day |
| hourly :20 | `publicpage.promote-sweep` | Promotes people from waiting lists |
| monthly, 1st 04:30 | `backup.restore-test` | Runs `RESTORE_TEST_COMMAND` (operator's) |

Event-driven jobs: `enquiries.notify-arrival`, `enquiries.nudge-48h`, `programme.notify`,
`lifecycle.notify-guests`, `publicpage.promoted-email`, `publicpage.lifecycle-notify`,
`business.notice-email`, `comms.notice-email`, `discovery.run`, `discovery.claim-invitation`,
`monetization.notice-reminder`, `monetization.notice-email`, `invoicing.issue`,
`billing.refund-execute`.

The production deploy is **not** a worker job (PRD DEP4 says it is): it runs in GitHub
Actions, because the worker cannot replace the release it is itself part of. The worker keeps
the daily backup and the monthly restore test. This deviation is recorded in
`14-deploy-runbook.md` and `09-traceability.md`.

## Storage and uploads

`packages/storage`. A file's type is decided by its first bytes; PNG and JPG are decoded and
re-encoded with sharp (which drops metadata and anything appended); PDFs are stored as they
are. Nothing is readable until a malware scan reports it clean — production refuses to start
accepting uploads with `MALWARE_SCANNER=none`. Bytes live in an S3-compatible store or, in
development, a local folder. Reads go through short-lived signed links on the media origin.
Fair-use counters (100 MiB per occasion, 200 MiB per business, 10 MiB per file) are updated
in the same transaction as the asset row.

## Languages

All text lives in `packages/i18n/messages/<ro|en>/<namespace>.json`; a test keeps the two key
sets identical. Romanian is the default; English is a full toggle held in the `ed_lang`
cookie, and guest links open in the invitation's language. Dates, money and times are
formatted only by `@ed/i18n/format` (1.990 RON, dd.mm.yyyy, 24-hour, Europe/Bucharest).
Timestamps are stored in UTC.

## MCP — external AI assistants

`packages/mcp`, served at `/mcp` by `apps/web/app/mcp/route.ts`. A person creates a token on
*Cont → Asistenți AI* (`/account/assistants`) with a scope of read-only or read-and-propose. Read tools run inside a
read-only database transaction and return only what the person's own grants allow. Propose
tools create What-if previews labelled as coming from an external assistant; nothing is
applied until the person confirms in the app. The catalogue is fixed at 23 tools
(`MCP_TOOL_CATALOGUE` in `packages/mcp/src/tools.ts`), versioned and served by the endpoint
itself. Each call is logged (tool and token only, never arguments or results) and
rate-limited.

## The staff console

`apps/web/app/console`. Sixteen sections, each shown only to the roles that may use it; every
page and every core function re-checks the role. Six staff roles; one person may hold
several. Anything irreversible is a request in `approval_requests` that only another staff
member can approve; with one staff member the platform is in single-operator mode and such
requests wait without effect. The audit log has a viewer and a CSV export and no write path.
The day-to-day guide is `19-operations.md`.

## Environments and secrets

- **Development:** `docker-compose.dev.yml` starts PostgreSQL 16 (plus MinIO and Mailpit,
  which the default settings do not use: uploads go to a local folder and emails to the
  `email_outbox` table).
- **Staging and production:** described, not created. `infra/terraform/` is a reference stack
  that has not been applied; `infra/reference-docker-host/` is the one implemented deploy
  target (a Docker host reached over SSH). Hosting vendor and region are the operator's
  decision (EU, Romania preferred).
- **Secrets** come from the environment only. `packages/shared/src/env.ts` refuses to boot
  with a missing or invalid value and prints variable names, never values. In production it
  insists on `https` and on a media origin different from the app's. Every name is in
  `.env.example`.

## CI, release and deployment, as written

- **`ci.yml`** (pull requests, `main`, and when called by `release.yml`): install with a
  frozen lockfile → lint → type checks → tests against a PostgreSQL 16 service → build the
  app → build the public site → the D1 gate → dependency audit (fails on high or critical) →
  migrate and seed a database → security-header check → HTTP smoke test. A second job builds
  the three container images without pushing them.
- **`release.yml`** (on a `v*` tag): checks the tag is annotated and on `main`, runs the CI on
  that commit and posts the commit status `release-ci`.
- **`deploy.yml`** (`workflow_dispatch` only, started by the console through a GitHub App):
  refuses anything but a release tag on `main` → asks the console to confirm the deploy id →
  checks `release-ci` → builds and pushes the images → encrypted database backup →
  `pnpm db:migrate` → switch web, worker and public → health checks (30 × 10 s) → on failure
  automatic rollback → reports every stage back to the console.
- **`Dockerfile`**: three targets — `web` (Next standalone output, with poppler for PDF
  drawings and the DejaVu fonts), `worker` (the repository run with tsx, plus the PostgreSQL
  client, `age` and the AWS CLI for backups) and `public` (the static export served by Caddy).
- **`scripts/deploy/*.sh`**: backup, migrate, roll, health and rollback for the reference
  target; `rollback.sh` refuses when `irreversible.txt` lists a release in between.

There is **no Playwright, axe or k6** step, although the original plan called for them
(`11-testing-and-qa.md` says what replaces them and what is simply missing).

## Monitoring and incidents (LAU5)

`/api/health` for the pipeline and an outside monitor; worker queue metrics on
`/console/operations` and, when thresholds are crossed, to `OPS_ALERT_WEBHOOK_URL`; job runs
(backup, restore test, retention, statistics) logged in `job_runs`; an incident opened in the
console shows a plain message on guest-facing pages. Which monitoring product and which alert
channel is the operator's decision.
