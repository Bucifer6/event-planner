# 13 — Implementation log

State of the `build/eventdesk-app` branch (built 13–14 November 2026). The PRD wins; the numbered
plan files say what; `15-conventions.md`, `16-design.md`, `17-ui-rules.md` and `18-contracts.md`
say how. Deviations decided during the build are listed at the top of `15-conventions.md`
(Drizzle instead of Prisma; the "Maison" design language; per-namespace i18n files).

## What is built

| Release | Scope | Status |
| --- | --- | --- |
| 0 | Monorepo, CI/release/deploy workflows, Terraform reference stack, Docker images, public site, app shell + PWA, security headers/CSP/CSRF/SSRF, uploads + storage, sign-in (email code, one-tap link, anonymous accounts, TOTP), sessions, rate limiting, job queue + worker, staff console (roles, approvals, audit viewer), deploy pipeline, MCP server, What-if engine, legal/compliance scaffolding, deletion with 7-day undo | Built. Passkeys are a seam only (TOTP is the available second step). |
| A | Occasions, brief, templates, tasks (list/board/calendar), delegation, roles + grants, households, invitations, guest links, RSVP, date polls, shared capacity, contributions, overview + daily digest, guest import, exports | Built |
| B | Budget (five columns), expenses + receipts, shared-cost ledger, suppliers, bookings, versioned briefings, order snapshots + deltas, deliveries with corrections, payment deadlines, event-day view, readiness decisions, cancel/postpone previews, closeout + lessons, briefing PDF | Built |
| P | Business accounts, listings, moderation queue, factual badges, honest directory with daily rotation, enquiries, venue drawings + space model, flower catalogues + quote flow, business occasions/library/branding/handover, discovery + claiming, listing statistics, dormant billing + monetization switch (OFF), Featured (inactive), full console, MCP tool catalogue (23 tools) | Built. Monetization is OFF; no pricing or checkout is reachable. |
| C | Seating + fit checks, programme + cues, stationery designer + print PDFs, menus + quantities, public event page + registration + waitlist, private requests, guest seat, print pack with QR, guest event page, gift estimator, promotion exports, arrangement designer, AI wording suggestions (provider off by default) | Built |
| D | Itinerary across time zones + import, subgroups + activities, packing lists, transport + rooms, multi-currency settlement | Built |
| E | Rehearsal, QR check-in + guest flow, limited offline capture, sustainability goals | Built. The offline service-worker path and camera scanning are implemented but not exercised in a real browser on a device. |

## Verification at the last commit

- `pnpm typecheck`: 0 errors. `pnpm lint`: 0 errors.
- `pnpm test`: 63 files, 681 tests, all passing against PostgreSQL 16.
- `pnpm --filter @ed/web build`, `pnpm --filter @ed/public build`: succeed.
- `node scripts/check-public-d1.mjs`: no external origins, no cookies on the public site.
- `node scripts/check-headers.mjs` and `node scripts/smoke.mjs` against the production build: all checks pass.
- Initial migration `packages/db/drizzle/0000_*.sql` applies to an empty database (167 tables) and the seeds run.

## Not verified here

- GitHub Actions workflows, the Docker image build and Terraform have never run (no runner, Docker daemon or `terraform` in the build environment). The first staging deploy is their test.
- No browser end-to-end suite (Playwright browsers cannot be downloaded in the build environment); pages were checked with headless Chrome screenshots during the build instead.
- Stripe, the fiscal-invoicing provider, the email provider, the malware scanner and the AI text provider are operator-configured seams with sandbox/dev implementations only.
- PRD milestone gates (M1–M7) involve real people and are not met by code alone.

## Open operator decisions

See `10-operator-decisions.md` and the checklist in `14-deploy-runbook.md` §4. Every one is an
env/config value or a console setting with a placeholder; none was guessed.
