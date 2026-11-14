# 13 — Implementation log (the status page)

**What this is, in plain English.** The one-page answer to "where are we?". It says what has
been built, what was checked and how, and what has not been checked at all. If another
document seems to disagree with this one, this page and `09-traceability.md` are the ones
that were verified against the code.

State of the `build/eventdesk-app` branch, built 13–14 November 2026. The PRD
(`../PRD.md`) wins over everything; the numbered plan files `04`–`08` record the intended
scope; `15`–`18` say how the code is organised. Three deviations from the plan were decided
during the build and are listed at the top of `15-conventions.md`: Drizzle instead of Prisma,
the "Maison" design language, and per-namespace translation files.

## What is built

| Release | Scope | Status |
| --- | --- | --- |
| 0 | Monorepo, CI/release/deploy workflows, Terraform reference stack, Docker images, public site, app shell and installable app, security headers/CSP/CSRF/SSRF guard, uploads and storage, sign-in (email code, one-tap link, anonymous accounts, TOTP), sessions, rate limiting, job queue and worker, staff console (roles, approvals, audit viewer), deploy pipeline, MCP server, What-if engine, legal and compliance scaffolding, deletion with 7-day undo | Built. **Passkeys are a seam only** — TOTP is the available second step |
| A | Occasions, brief, templates, tasks (list, board, calendar), delegation, roles and grants, households, invitations, guest links, RSVP, date polls, shared capacity, contributions, overview and daily digest, guest import, exports | Built. Replies are household counts, not per-person, per-session attendance (A6) |
| B | Budget (five amounts), expenses and receipts, shared-cost ledger, suppliers, bookings, versioned briefings, order snapshots and deltas, deliveries with corrections, payment deadlines, event-day view, readiness decisions, cancel and postpone previews, closeout and lessons, briefing PDF | Built |
| P | Business accounts, listings, moderation queue, factual badges, honest directory with daily rotation, enquiries, venue drawings and space model, flower catalogues and quote flow, business occasions, library, branding, handover, discovery and claiming, listing statistics, dormant billing and the monetisation switch (OFF), Featured (inactive), full console, MCP tool catalogue (23 tools) | Built. Monetisation is OFF; no pricing or checkout is reachable. The ONRC discovery source, Stripe and fiscal invoicing are seams. No business-scoped assistant token; guides and the "For businesses" page are not editable from the console |
| C | Seating and fit checks, programme and cues, stationery designer and print PDFs, menus and quantities, public event page with registration and waiting list, private requests, guest seat, print pack with QR, guest event page, gift estimator, promotion exports, arrangement designer, AI wording suggestions (provider off by default) | Built |
| D | Itinerary across time zones and import, subgroups and activities, packing lists, transport and rooms, multi-currency settlement | Built |
| E | Rehearsal, QR check-in and guest flow, limited offline capture, sustainability goals | Built. The offline service-worker path and camera scanning are implemented but **not exercised in a real browser on a device** |

Since the last full verification run, two pieces of work were in progress in parallel with
this documentation pass: a **help centre** (`apps/web/app/help`, `apps/web/components/help`,
help namespaces in `packages/i18n/messages`) and the **security review** with its fixes
(`12-security-review.md`, `security-review.test.ts` files). Their own reports say what they
verified; they are not included in the figures below.

## Verification at the last full run (14 November 2026)

Before the help centre and the security-review fixes:

- `pnpm typecheck`: 0 errors. `pnpm lint`: 0 errors.
- `pnpm test`: **63 files, 681 tests**, all passing against PostgreSQL 16. For today's exact
  number run `pnpm test` or see the latest CI run once CI exists — test files have been added
  since and this page does not claim a count nobody re-ran.
- `pnpm --filter @ed/web build`, `pnpm --filter @ed/public build`: succeed.
- `node scripts/check-public-d1.mjs`: no external origins, no cookies on the public site.
- `node scripts/check-headers.mjs` and `node scripts/smoke.mjs` against the production build:
  all checks pass.
- Initial migration `packages/db/drizzle/0000_eminent_the_stranger.sql` applies to an empty
  database (167 tables — re-counted from the schema files and the migration during the
  documentation pass) and the seeds run.

All of this was done by hand on the build machine. What each test file covers is in
`11-testing-and-qa.md`.

## Not verified here

- **GitHub Actions workflows, the Docker image build and Terraform have never run** (no
  runner, Docker daemon or `terraform` in the build environment). The deploy and backup
  scripts have never touched a host. The first staging deployment is their test.
- **No browser end-to-end suite** (Playwright browsers could not be downloaded in the build
  environment); pages were checked with headless-Chrome screenshots during the build instead.
- **No accessibility audit** (no axe scan, no screen-reader or keyboard-only pass), **no
  performance measurement** (Q3), **no load test** (Q5), **no test on real phones** (Q1).
- **No external service has been contacted.** Stripe, the fiscal-invoicing provider, the
  email provider, the malware scanner, an S3-compatible store, the ONRC data source and the
  AI text provider are operator-configured seams with sandbox or development stand-ins only.
- **Nothing is deployed.** No statement in these documents means "seen working in production".
- **The PRD's gates M0–M5 and launch obligations LAU1–LAU9 involve real people** and are not
  met by code alone. (Earlier versions of this page said "M1–M7"; the PRD defines M0–M5.)

## Known gaps

The full list with evidence is the gap list in `09-traceability.md`. In short:

1. Passkeys (S2) — not built.
2. Business-scoped assistant tokens (MCP7) — no way to create one.
3. Per-person, per-session attendance (A6) — replies are household counts.
4. Console publishing of the "For businesses" page and guides (W7) — not built.
5. Secret rotation dates in the console (SEC13) — not built.
6. **Occasions owned by a deleted account are not deleted** (D6, INF6) — needs a decision and
   a fix before real users.
7. Audit log is never purged (PRD: 2 years); the security log and email outbox have no
   retention rule (INF6).
8. The AI provider and model in use are recorded but not shown on a console screen (INF7).

## Open operator decisions

See `10-operator-decisions.md` (every decision with its setting) and the checklist in
`14-deploy-runbook.md` §4. Every one is an environment value or a console setting with a
placeholder; none was guessed.
