# 13 — Implementation log (Release 0 foundation + Release A, first build)

This log records what the first code build implements, so reviewers can map it to the
work items in `04-foundation-release-0.md` and `05-release-A.md` without reading the diff.

## Implemented and tested (vitest: 22 tests green; `next build` green for web + public;
loopback smoke green)

- **R0-01** — pnpm monorepo scaffold (`apps/web`, `apps/public`, `apps/worker`, `packages/*`),
  TypeScript strict, Prettier, Vitest, `.github/workflows/ci.yml` (lint/typecheck → tests →
  builds → dependency audit → D1 public-site assertion → SEC5 header assertion).
- **R0-03 (partial)** — `packages/db` Prisma schema per `02-data-model.md`, migrations,
  seed (7 templates, monetization switch OFF), append-only `AuditLog` enforced by a DB
  trigger (SEC10, tested).
- **R0-04 (partial)** — email six-digit code sign-in (15 min, 5 attempts, 3/hour + 10/day,
  10/IP/hour, device-cookie axis), single-use one-tap magic link with the SEC14
  consumed-link path, enumeration-safe identical responses (SEC1), anonymous accounts
  with Argon2id + 10 single-use recovery codes + unrecoverability warning (S7/S8),
  sessions 30d/14d-idle stored as hashes, sign-out-everywhere revoking sessions + MCP
  tokens (SEC3). All hashed at rest (SEC8); rate-limit events to SecurityLog without
  recording account existence (SEC16). Tested.
- **R0-05** — three-axis rate limiter with escalating per-address backoff, never a
  lockout; SEC11 bot guard (per-IP/per-link limits, honeypot, time-to-submit floor)
  wired into the public RSVP form. Tested via rate-limit tests + RSVP tests.
- **R0-06** — i18n with strings only in `packages/i18n/messages/{ro,en}.json` (ro-RO
  default, en toggle, dictionary-sync test); locale formatting RON / dd.mm.yyyy / 24h /
  Europe/Bucharest over UTC storage (INF8/L3); `packages/ui` "Garden Soirée" tokens
  (cream/sage/ink/terracotta, Sora/Cormorant Garamond/DM Mono with named fallbacks,
  12–18px cards, pill buttons, ≥44px targets, 320px single column, dark "Midnight
  Candlelight" via prefers-color-scheme, Honest Directory mono labels, italic-grey
  "unknown").
- **R0-07** — public site static export with landing, "For businesses", legal shells
  (terms, privacy, cookie notice, accessibility statement), status page; CI asserts zero
  cookies and zero third-party scripts (D1).
- **R0-08 (partial)** — app shell, auth-guarded `(app)` routes, health endpoint
  (`/api/health`, feeds DEP4), PWA manifest + offline service-worker shell (B11 base).
- **R0-09 (partial)** — security headers via middleware (strict nonce CSP, HSTS,
  nosniff, same-origin referrer, frame-ancestors none) asserted in tests + CI; CSRF
  origin check on state-changing route handlers; SEC7 `rel="noopener noreferrer"`
  convention for external links.
- **R0-11 (dev transport)** — email service with suppression list, bilingual RO-first
  templates (L5), SEC1 sign-in email wording, Q6 500/day/occasion enforced server-side;
  dev provider writes to `EmailOutbox` (production provider is operator-configurable).
- **R0-12 (partial)** — Postgres job queue (`FOR UPDATE SKIP LOCKED` leasing) + single
  worker process with handlers: `send-email`, `daily-digest` (A10), `retention-purge`
  (INF6), `nightly-stats` (INF11/D4, no visitor identifiers).
- **R0-16** — What-if preview engine: create/confirm/discard, idempotent confirm
  (double-tap applies once, Q4), audit-logged; used by date moves and template re-runs.
  Tested.
- **R0-18 (partial)** — occasion deletion request with 7-day undo + retained-data
  statement (D6).
- **A-01…A-13** — occasions with brief (A1/A11), 7 templates with 12/9/6/3/1-month
  date-relative scheduling and diff-on-rerun (A2), tasks with owner/due/checklist/
  dependencies/children and List/Board/Calendar views over the same rows (A3),
  offer/accept/decline delegation returning to the delegator (A4), roles + separate
  finance/private-request grants enforced server-side (A5/D2), household invitations
  with ≥128-bit hashed, revocable, scoped guest links (A6/S6/SEC2), children as count
  only with free-text warning (A6), one-question-per-screen guest RSVP (A6), atomic
  shared capacity (A8, tested under parallel requests), date polls that never reserve
  capacity (A7), atomic contribution claims (A9, tested), overview + daily digest
  (A10), CSV/XLSX import with mapping preview + duplicate diff + confirm (A13), basic
  CSV export scoped to own occasion data with no Featured content (A12/P16).

## Deliberately not in this build (next work items)

- R0-02 infra IaC, R0-10 S3 upload pipeline (SEC4 re-encode/media domain), R0-13 staff
  console + approval queue UI (models exist), R0-14 GitHub-App deploy pipeline,
  R0-15 MCP server at `/mcp` (models exist: `McpToken`), R0-17 DSA intake route,
  TOTP/passkey enrolment UI (S2 models exist), release B (budget/suppliers/event-day),
  release P (directory/business/discovery/MON switch UI), releases C/D/E.
- Auth is exercised through `packages/*` integration tests and a loopback smoke test
  (`scripts/smoke.mjs`); Playwright e2e + k6 load (Q5) are wired in CI as next steps.
