# 12 — Security review record

**Date:** 14 November 2026 · **Branch:** `build/eventdesk-app` · **Reviewer:** an independent
security pass that had not seen the code being written.

This file replaces the earlier checklist (written before the build) with what was actually
checked, what was wrong, what was fixed and what is still open. The PRD (`docs/PRD.md`) remains
the source of the requirements (SEC1–SEC16, S1–S8, D1–D6, MCP1–MCP8, INF5/INF6, MON1/MON5).

## 1. Scope and method

**In scope:** the web app (`apps/web`: every Server Action, every Route Handler, page-level
reads, `proxy.ts`), the domain layer (`packages/core`), sign-in and sessions (`packages/auth`),
the MCP endpoint (`packages/mcp`), uploads and file serving (`packages/storage`), email
(`packages/email`), the worker and job queue (`packages/jobs`, `apps/worker`), the shared SSRF
guard, the Dockerfile, the reference ingress (`infra/reference-docker-host`), the GitHub
workflows and the dependency tree.

**How:**

1. Entry points were enumerated (49 Server Action files — 48 under `app/actions` and the
   console compliance one — and 18 route handlers) and followed to the core
   function that does the work. A script listed every exported core function with no visible
   access check (215 of them); each one reachable from the web or MCP was read to find where
   its check happens.
2. Targeted reading of the places where independent mistakes usually hide: token handling,
   rate limiting, file parsers, process execution, outbound requests, webhooks, logging,
   CSV/SVG/PDF output, redirects, link targets.
3. **Dynamic tests** against a real PostgreSQL test database — two accounts and two occasions,
   a guest link, a member without grants, formula and markup payloads, forged headers, crafted
   files. They are kept as regression tests (section 3 names them).
4. Two attacks were measured by hand before fixing (numbers in the findings table).
5. `pnpm audit`, a scan of tracked files for secrets, and a read of the workflows.

**Not done:** no penetration test of a running production stack, no browser or device testing,
no test against real external services. Section 5 lists what that leaves unverified.

## 2. Findings

Severity: **High** = an outsider can take the service down or reach data; **Medium** = a real
weakness that needs a condition (a role, a particular hosting setup, an insider) or breaks a
PRD security rule; **Low** = hardening; **Info** = noted, no action needed now.

| Id | Severity | Area | What was wrong | Status | Files | Test |
| --- | --- | --- | --- | --- | --- | --- |
| F-02 | **High** | Guest-list import | A spreadsheet (.xlsx) is a compressed archive, and nothing limited how big it could become when unpacked: a 1 MB file took 0.8 GB of server memory (measured). The upload route also unpacked the file *before* checking who was asking, so someone with no account could do it. A handful of such requests would stop the app. | **Fixed** — the archive is measured with a hard cap (24 MiB) before the spreadsheet reader sees it, and the route checks "may this person manage the guest list" before it reads the upload. | `packages/core/src/guestimport.ts`, `apps/web/app/(app)/occasions/[id]/guests/import/upload/route.ts` | core `security-review.test.ts` › *F-02* (2 tests); web `security-review.test.ts` › *F-02* |
| F-01 | Medium | Rate limiting | The visitor's address was taken from the **first** entry of `X-Forwarded-For`. Behind an ingress that appends to that header (most cloud load balancers) the first entry is whatever the visitor typed, so every per-IP limit (sign-in, guest links, public forms, MCP token guessing) could be reset at will. Also: an IPv6 visitor could rotate through the 2^64 addresses of their own block; and an empty `TRUSTED_IP_HEADER=` (exactly what `.env.example` contains) made `/mcp` throw on every request. The reference Caddy ingress *replaces* the header, so that one setup was not affected by the first point. | **Fixed** — one helper reads only the entry our own ingress wrote; IPv6 is counted per /64; an empty setting means the default. | `apps/web/lib/client-ip.ts` (new), `apps/web/lib/ctx.ts`, `lib/guest.ts`, `lib/supplier-link.ts`, `app/e/_lib/public.ts`, `app/mcp/route.ts`, `packages/core/src/ratelimit.ts`, `.env.example` | web › *F-01* (6 tests, one against the real limiter); core › *F-01* (2 tests) |
| F-03 | Medium | Logs / privacy (SEC13, D-series) | When a database statement failed, the error text written to the server log — and stored in the job queue's `last_error` column — included the statement's **values**: email addresses, guest names, typed text. | **Fixed** — one function describes an error by its SQL (placeholders only), PostgreSQL code and call sites; every log line and the job queue use it. | `packages/shared/src/errors.ts`, `packages/jobs/src/log.ts`, `apps/web/lib/action-core.ts`, `apps/web/lib/session.ts`, both webhook routes, `app/api/auth/link/[token]/route.ts`, the guest export and import routes, `packages/core/src/business.ts`, `packages/mcp/src/server.ts` | shared `errors.test.ts` (3 tests); web › *F-03* (2 tests) |
| F-04 | Medium | PDF drawings (business area) | A PDF can declare a page 200 inches wide. Turning it into a picture at a fixed resolution took 1.86 GB of memory and 9 seconds for a 333-byte file (measured with the installed poppler 24.02). Any signed-in person who has created a business could do this repeatedly. | **Fixed** — the picture's long side is now fixed at 3,000 pixels whatever the page says (37 MB for the same file). *Visible change:* pictures made from PDF drawings now have a fixed size instead of 110 dpi. | `packages/core/src/drawings.ts` | core › *F-04* (checks the arguments; the memory numbers were measured by hand) |
| F-08 | Medium | Sensitive actions (S4) | A business owner could give the whole team access to money and private requests on every client occasion without the fresh emailed code the PRD requires for "capability grants". | **Fixed** — enforced in core; the page says so and links to the confirmation. | `packages/core/src/bizoccasions.ts`, `apps/web/app/(app)/business/[businessId]/occasions/page.tsx`, i18n `bizoccasions` (ro + en) | core `bizoccasions.test.ts` (stale confirmation refused) |
| F-09 | Medium (dormant) | Sensitive actions (S4) | Starting a purchase did not ask for the fresh code the PRD requires for "business purchases". Not reachable today: payments are switched off (MON1). | **Fixed** — enforced in core; notice on the plan page. | `packages/core/src/billing.ts`, `apps/web/app/(app)/business/[businessId]/plan/_paid.tsx`, i18n `billing` (ro + en) | core `billing.test.ts` (checkout refused without a fresh confirmation) |
| F-05 | Low | Two-step sign-in | An authenticator code is meant to work once. Several requests sent at the same instant with the same code were all accepted (reproduced: 8 parallel requests, more than one success). | **Fixed** — the code's time step is claimed in one conditional database update. | `packages/auth/src/totp.ts` | auth `security-review.test.ts` › *F-05* (fails on the old code) |
| F-06 | Low | Webhooks | The invoicing webhook read and parsed the request body before checking its secret, and compared the secret in a way that reveals its length. Both payment webhooks read the whole body before looking at its size (bounded at 10 MB by the framework). | **Fixed** — secret first (hashed, constant-time), declared size before reading. | `apps/web/app/api/webhooks/invoicing/route.ts`, `.../stripe/route.ts`, `packages/core/src/invoicing.ts` | core › *F-06*; web › *F-06* |
| F-07 | Low | MCP fair use (MCP6) | One request may carry a batch of 20 messages but was counted as one call, so the per-minute and per-day limits could be exceeded twenty times over. | **Fixed** — every message of a batch counts; a batch that would pass the limit runs nothing. Oversized bodies are refused by declared length. | `packages/mcp/src/server.ts` | mcp `mcp.test.ts` › *every message of a batch counts as a call* |
| N-01 | Medium | Staff console / privacy | The audit log stores a little planner content — household names, expense descriptions and amounts, budget lines, delivery titles — and three staff roles can read and export it. It is append-only, so these entries also outlive the deletion of the occasion or account. | **Needs decision** (section 7) | `packages/core/src/auditview.ts` and the `audit()` calls in `guests.ts`, `expenses.ts`, `budget.ts`, `deliveries.ts`, `itinerary.ts` | — |
| N-02 | Low | Supply chain | The GitHub workflows use actions by version tag (`@v4`), not by exact commit. A compromised action release would run in CI and in the deploy job. | **Needs decision** (section 7) | `.github/workflows/*.yml` | — |
| N-03 | Low | Stored credentials | Three things are weaker at rest than a hashed 256-bit token, each by design: the printed-invitation QR ids are stored readable (they must be reprintable); recovery codes are 49 bits with a fast hash and their last four characters stored; the six-digit claim code is hashed without a salt for its 15 minutes. All only matter if the database itself leaks. | **Accepted** (noted for the owner in section 7) | `packages/core/src/qr.ts`, `packages/auth/src/recovery.ts`, `packages/core/src/claims.ts` | — |
| N-04 | Low | Dependencies | Two moderate advisories, neither reachable in production (section 6). | **Accepted** | `pnpm-lock.yaml` | — |
| N-05 | Info | Sign-in | The one-tap link signs the browser in on a plain page visit, as every emailed sign-in link does; someone could send a victim a link to the *sender's* account. Low value to an attacker; no change proposed. | Accepted | `apps/web/app/api/auth/link/[token]/route.ts` | — |
| N-06 | Info | Privacy | The security log keeps visitor IP addresses and had no retention rule. | **Fixed after the review** (90-day rule; see D-4) | `packages/core/src/ratelimit.ts` | — |
| N-07 | Info | Sensitive actions | Cancelling a subscription does not ask for a fresh code. The PRD lists purchases, not cancellations; left as it is. | Accepted | `packages/core/src/billing.ts` | — |

**Counts:** High 1 (fixed) · Medium 6 (5 fixed, 1 needs decision) · Low 5 (3 fixed, 1 needs
decision, 1 accepted) + 1 accepted dependency item · Info 3.

## 3. Verified with no finding

"Test" means a test that runs in `pnpm test`; "read" means the code was read and nothing else.

**Access control (D2, SEC2, SEC15)**

- *Another occasion's objects by id* — **test**: core `security-review.test.ts` › *V-01 … 30+
  entry points*: the owner of one occasion calls 30 read and write functions (tasks, guests,
  invitations, QR, RSVP, suppliers, supplier links, expenses, budget, payment deadlines,
  programme, menus, seating, contributions, team) with the ids of another; every call is refused
  and nothing changed in the database.
- *A foreign id slipped into a form of my own occasion* — **test**: › *V-01 … (occasionId mine,
  object theirs)*: 10 mixed attempts (category, programme item, menu, need, seats both ways,
  member edit and removal, parent task, plan item) link or change nothing.
- *What-if previews* — **test**: › *V-01 … preview of another occasion*: cannot be read,
  confirmed or discarded from outside; a manager without the finance grant cannot confirm a
  money change. Existing `whatif.test.ts` covers "applies once", "parallel double confirm",
  "expired cannot be confirmed" and "an external assistant can only propose".
- *Finance and private-requests grants on secondary paths* — **test**: › *V-02*: a manager with
  no grants cannot see or run the budget, ledger, payments or private-requests exports; a
  contributor cannot run the seven manager-only exports; the supplier export has no amount
  column; no export they can run contains the occasion's amounts. Existing `requests.test.ts` ›
  *ONLY holders of the privateRequests grant read them … everywhere*.
- *Guest link = one household* — **test**: › *V-05*: the view names no other household; eight
  planner functions are closed to a guest; an RSVP naming another household lands on the
  guest's own; a private request is visible to its sender only (and its text is not echoed).
- *Asset ids from another owner* (photos, logos, receipts, quotes, catalogue pictures) — **read**:
  each save checks the file belongs to the same business or occasion before storing the id.
- *Supplier link* — **read**: one booking, no amounts, no guest list.
- *Staff console* — **read** + existing `staff.test.ts` (roles not implied by each other,
  two- and three-person approvals, single-operator mode, audit export).
- *Business team after handover (P22, MCP7)* — **read** of `access.ts`; existing
  `bizoccasions.test.ts`.
- *Web layer never elevates privilege* — **read**: the only `systemCtx` uses in `apps/web` are
  the three webhooks and the deploy-record endpoint, each behind its own secret.

**Sign-in and sessions (SEC1, SEC3, SEC8, SEC12, SEC14, SEC16, S1–S8)**

- Codes, links and session tokens stored hashed; codes single-use, newer invalidates older,
  5 attempts — **read** + existing `auth.test.ts`.
- Open redirect on `next` — **test**: existing `signup-next.test.ts` › *refuses everything else*
  (39 payloads) plus auth `security-review.test.ts` › *V-06* (21 more).
- Anonymous-account passwords: Argon2id, 19 MiB, 2 passes — **read**.
- Cookies `HttpOnly`, `SameSite=Lax`, `Secure` in production — **read** of `lib/session.ts`.
- Fresh confirmation (S4) enforced in core for ownership transfer, deletion (account and
  occasion), login-email change, member changes (occasion and business), two-step on/off, MCP
  tokens, cancel/postpone/close, handover — **read** (grep of every `requireFreshAuth` call
  against the PRD list; the two gaps are F-08 and F-09).
- Sign-out-everywhere and email change revoke all sessions and MCP tokens — **read** + existing
  tests.

**Injection and output**

- SQL: no string-built queries, no `sql.raw`; the `ed.correction` / `ed.purge` switches are set
  with constant values only — **read** (grep).
- CSV formulas — **test**: core › *V-03*: an occasion whose every name starts with `=`, `+`,
  `-` or `@` is exported through every CSV export (8 or more) and the guest list; no cell
  starts a formula.
- SVG / XML — **test**: core › *V-04*: markup in table labels and titles is escaped in plan
  drawings; stationery text is drawn as outlines and none of it reaches the SVG. Colours come
  from fixed palettes (**read**).
- No `dangerouslySetInnerHTML`; user-supplied links are limited to `https://` (listings) or
  `http(s)://` (evidence notes) and rendered with `rel="noopener noreferrer"` — **read**.
- Content-Disposition file names are ASCII-reduced — **read**.
- Uploads: type decided by content, images re-encoded with a 50-megapixel cap, PDFs
  download-only from the media host — **read** + existing storage tests.
- Process execution (PDF rasteriser, malware scanner, backup command): arguments are fixed or
  server-generated paths; timeouts set — **read**.

**Outbound requests (SEC6)** — **read** of `packages/shared/src/ssrf.ts` and every `fetch`:
discovery and robots go through the guard (private, loopback, link-local, CGNAT, IPv4-in-IPv6
blocked; address checked again at connect time; redirects re-checked; size and time capped).
All other outbound calls go to operator-configured addresses. Existing `ssrf.test.ts`.

**Webhooks and machine endpoints** — Stripe signature over the raw body, 5-minute tolerance,
constant-time compare, each event handled once — **read** + existing `billing.test.ts`. `/mcp`
authenticates before reading the body, checks `Origin`, never reads cookies; read tools run in
a read-only database transaction — **read** + existing `mcp.test.ts`. CSRF check on all five
cookie-authenticated route handlers, before anything is read — **test**: web › *V-07*.

**Business rules** — capacity and claims races, idempotency, approvals (requester ≠ approver),
monetization OFF unreachable, Featured never reorders organic results, moderation
self-approval, children as a count — **existing tests only** (`featured.test.ts`,
`staff.test.ts`, `business-listings.test.ts`, `publicpage.test.ts`, `guests-rsvp.test.ts`,
`apps/web/test/monetization-off.test.ts`); not re-derived in this review.

**Headers and configuration** — CSP (nonce, no inline script, `frame-ancestors 'none'`,
`form-action 'self'`, `base-uri 'none'`, `object-src 'none'`), HSTS, nosniff — **read** +
existing `headers.test.ts`. `/api/uploads` is outside the proxy but still gets the static
headers from `next.config.ts` — **read**. No secrets, keys or `.env` in the repository —
pattern scan of tracked files. Containers run as non-root — **read**. Workflows: read-only
default permissions, inputs validated by regex before use, no untrusted value inside a `run:`
script, deploy secrets only in the `production` environment — **read**.

## 4. Verification run

| Check | Result |
| --- | --- |
| `pnpm typecheck` | all 13 workspaces pass |
| `pnpm lint` | clean |
| `pnpm test` (full) | 68 files, **723 tests, all pass** |
| `pnpm --filter @ed/i18n test` | pass (ro/en keys identical) |
| `node scripts/check-headers.mjs`, `node scripts/smoke.mjs` | **not run** — code that affects them changed (route handlers, request helpers) and `next build` was not run during the review. Run both after the next build. |

## 5. Not verified

- **A running production stack.** Real response headers on every response type (error pages,
  redirects, static files), HSTS behaviour, the media host answering only `/api/media/*`,
  cookie flags as a browser sees them.
- **The real ingress.** Whether the chosen hosting replaces or appends `X-Forwarded-For`, and
  how many proxies sit in front (see section 7, D-1). A wrong value does not open a hole after
  F-01, but it can make all visitors share one rate-limit bucket.
- **Whether `next/headers` throws on an empty header name.** The crash in F-01 was confirmed
  for `/mcp` (standard `Headers`); for ordinary pages it was not tested. Fixed either way.
- **External services:** Stripe, the invoicing provider, the email provider's webhook, GitHub,
  the malware scanner, the AI text provider — reviewed as code against their documented
  contracts, never called.
- **Timing of sign-in answers** on real hardware (SEC1) — the 400 ms floor is code-read only.
- **Browsers and devices:** service-worker caching, the offline check-in store, passkeys,
  mail-scanner behaviour on one-tap links.
- **Backups, key rotation and restore (SEC9), deletion and purge end to end** — existing tests
  only; no restore was performed.
- **Spreadsheets from unusual programs.** The new .xlsx check accepts ordinary archives
  (Excel, Google Sheets, LibreOffice shapes were considered; the repository's fixture passes).
  A file written in an exotic way would be refused as "unreadable" rather than imported.
- **PDF and font parsing libraries, `sharp`, `pdftoppm`** — treated as trusted components with
  limits around them; not fuzzed.
- **A human penetration test (LAU4).** Still required before the first real guest link.

## 6. Dependency audit (14 November 2026)

`pnpm audit --prod`: **1 moderate**. `pnpm audit` (all): **2 moderate**. No high or critical.

| Package | Advisory | Path | Why it stays |
| --- | --- | --- | --- |
| `esbuild` ≤ 0.24.2 | GHSA-67mh-4wv8-2f99 — its *development server* answers any website | `@ed/db` → `drizzle-kit` → `@esbuild-kit/*` | The esbuild dev server is never started: `drizzle-kit` is used only to generate and apply migrations. Forcing a newer esbuild under `drizzle-kit` risks breaking migrations and could not be tested safely here. Clears when `drizzle-kit` drops `@esbuild-kit`. |
| `minimatch` < 11.0.1 | GHSA-g3hv-75wg-m249 — slow on hostile patterns | `eslint` (development only) | Only the repository's own lint patterns reach it. Clears with the next `eslint` update. |

## 7. Needs the owner's decision

**D-1 · How many proxies sit in front of the app (operator setting).** The app now trusts only
the address its own ingress wrote. With the reference Caddy setup nothing needs setting. If a
CDN or load balancer is added in front, set `TRUSTED_PROXY_HOPS=2` (or name the provider's
header in `TRUSTED_IP_HEADER`); otherwise every visitor arriving through the same CDN node is
counted as one, and rate limits will trip for honest people. *Recommendation:* record the
value in the deploy runbook when hosting is chosen.

**D-2 · Planner content in the audit log (N-01).** Options: (a) leave it — the audit trail
stays fully readable for investigations; (b) keep recording it but show and export only *that
something changed* for planner-side entries, with the detail available through the existing
three-person compliance access; (c) stop recording names and descriptions at all (counts and
ids only). *Recommendation:* (b). It keeps the evidence and removes routine staff sight of
guest names and amounts. Decide also whether such entries should be erased when the occasion
is deleted — today nothing in the audit log ever is.

**D-3 · Pin GitHub Actions to exact commits (N-02).** Options: leave tags; or pin each action
to a commit and let Dependabot propose updates. *Recommendation:* pin, before the deploy
workflow is first used with real secrets.

**D-4 · How long the security log keeps IP addresses (N-06).** *Update, same day:* the recommended 90-day rule was added after this review (`security-log` retention rule in `packages/core/src/ratelimit.ts`); change `SECURITY_LOG_RETENTION_DAYS` if you want a different period. Originally: no rule existed. *Recommendation:*
90 days, as a retention rule next to the others.

**D-5 · Credentials that are readable or weak at rest (N-03).** Accepted for launch.
*Recommendation for later:* hash recovery codes with the same slow function as passwords.

## 8. Residual risk — in plain words

Nobody outside found a way in during this review, and the one serious weakness — a small
spreadsheet that could exhaust the server's memory, even from someone without an account — is
closed and tested. The rules about who may see what held up: across thirty-odd attempts one
planner could not read or change another's occasion, a guest link showed only its own
household, and a team member without the money permission could not get amounts through any
export.

What remains is mostly outside the code:

- This was a review of the code and of tests run on a development machine. It is **not** the
  independent penetration test the launch plan requires, and nothing was checked on the real
  servers.
- Some staff roles can see a few guest names and amounts in the audit log. That is a choice
  for you (D-2), not a break-in.
- The limits that slow down guessing depend on one hosting setting being right (D-1).
- Payments are switched off. The payment code was read and its tests pass, but it has never
  talked to the real payment company.
- Two low-risk library warnings are open; neither can be reached on the live site.

Before real guests are invited: rebuild and run the two automatic checks (headers and smoke
test), make the five decisions above, and have the external penetration test done.
