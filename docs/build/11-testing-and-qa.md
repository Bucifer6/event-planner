# 11 — Automated testing and QA plan

Every work item's acceptance criteria are executed as automated tests. This file defines the test
layers, what each release must cover, and the bug-check list that gates a release. PRD section 12:
a release is blocked by any unresolved unauthorised access, duplicate money posting, unexplained
overbooking, lost approved records, or wrongly reversed facts.

## Test layers and tooling (wired in `ci.yml`, R0-01)

| Layer | Tool | Runs | Covers |
| --- | --- | --- | --- |
| Unit | Vitest | every PR | `packages/core`, `packages/auth`, `packages/jobs` domain rules; 100% coverage required on money math, atomic capacity/claim paths, grant checks; ≥80% on `packages/core` overall |
| Integration | Vitest + test Postgres | every PR | repositories, Server Actions, route handlers; atomicity under parallel requests (A8, A9); idempotency/double-submit (Q4); grant enforcement server-side (D2); retention/backup/stats jobs; webhook signature verification (P24) |
| E2E | Playwright, throttled phone profile | every PR (smoke) + full suite on `main` and release tags | critical journeys per release (below); perf budgets Q3 (guest page content <2.5 s, interaction <200 ms); 320px + axe-core (Q2); drag has equal tap path (Q8/Q10, A12) |
| Security tests | Vitest/Playwright in CI | every PR | CSP/headers assertions (SEC5); enumeration-safe sign-in (SEC1); hashed tokens (SEC8); rate-limit trip per axis (SEC16); upload pipeline: re-encode, media-domain PDF, scan gate (SEC4); CSRF negative tests (SEC6); SSRF guard blocks private ranges (SEC6); `rel="noopener noreferrer"` (SEC7); audit log UPDATE/DELETE fail at DB level (SEC10); honeypot/time-floor bot tests (SEC11); no third-party script on public site (D1) |
| Load | k6 | nightly on staging + pre-release + on release tags | Q5 qualification: 1,000 attendees, 50 concurrent operators, 10,000 tasks per occasion; error rate <0.1% |
| Dependency audit | `pnpm audit` + OSV | every PR (fail on high+) and on tags | DEP7: a tag is deployable only with green CI on that exact commit |
| A11y | axe-core in e2e + manual pass | every release | WCAG 2.2 AA at 320px (Q2); design gates (section 21) |

Policies: tests use seeded data only, never production data; flaky tests are quarantined (max 3,
must be fixed before the next release tag); a release tag requires zero failing tests and zero
open quarantine; coverage reports are attached to the release PR.

## Per-release test plans (journeys = happy path + negative paths)

### Release 0 (foundation, gate M0)
- Sign-in: code request/entry happy path; non-existing email identical response/timing band (SEC1);
  code expiry 15 min; 5-attempt limit; single-use; newer code invalidates older; rate limits per axis
  with generic message + retry time (SEC16); one-tap link single-use + mail-scanner consumed path
  (SEC14); anonymous account: generic failure, Argon2id hash in DB (assert hash format, not value),
  recovery codes, unrecoverable warning (S7/S8); sessions 30d/14d-idle, sign-out-everywhere revokes
  MCP tokens (SEC3); sensitive action needs fresh code ≤10 min (S4); staff 2FA enforced (S5)
- Security middleware: header/CSP assertions; CSRF negative; SSRF negative (127.0.0.1, 169.254.x,
  file://); upload: PNG re-encode strips metadata, PDF only via media domain with
  attachment+noinline, scan-before-visible (SEC4); audit append-only (SEC10)
- i18n: every screen has ro+en strings (lint), diacritics searchable, locale formats (RON,
  dd.mm.yyyy, 24h) (L1–L3); 320px axe clean (Q2)
- Public site: zero cookies, zero third-party scripts (D1, automated)
- Worker: job retry/idempotency; nightly stats contain no visitor identifiers (INF11)
- Deploy: tag with failing CI refused (DEP7); forced health-check failure rolls back automatically
  (DEP4); non-reversible migration stops rollback with message (DEP5)

### Release A
- Occasion create/activate with no payment UI anywhere (MON1) (A-01)
- Template apply → tasks at 12/9/6/3/1-month offsets; date move → What-if preview → confirm applies,
  discard changes nothing; re-run diff, no duplicates (A-02)
- Task CRUD + List/Board/Calendar same records (A-03); delegation accept/decline returns to
  delegator (A-04); contributor without finance grant gets 403 server-side (A-05, D2)
- Invitation link: ≥128-bit token, hashed at rest, revoke/expiry 403, per-link rate limit (SEC2);
  household RSVP incl. children count only + free-text child-data warning (A-06); one question per
  screen; language toggle (L2); shared link sees only own household (SEC2)
- Date poll votes never change capacity (A-07); parallel RSVPs on last place: exactly one wins (A-08,
  Q4); parallel contribution claims: exactly one wins (A-09)
- Overview + daily digest contents (A-10); CSV/XLSX import mapping preview, duplicate detection,
  confirmed diff (A-13); export contains own occasion only, no Featured fields (P16) (A-12)

### Release B
- Budget five states separate; finance-less 403 (B-01); expense approval vs payment independent (B-02);
  ledger balances to zero any split, per currency (B-03)
- Supplier/booking states; briefing versions immutable + acknowledgement; scoped supplier link shows
  only own booking (B-04, S6); snapshot immutable, later RSVP change → delta (B-05)
- Received quantity cannot be overwritten directly; correction creates audit trail (B-06, SEC10)
- Event-day states from same task records (B-07); readiness decision requires evidence (B-08);
  cancel/postpone preview lists all affected (B-09); closeout list + retention clock (B-10)
- PWA installs, offline shell, briefing PDF downloads (B-11); overdue instalment in finance digest
  only; What-if shows money effect of moving a payment (B-12)
- Load: Q5 targets on a B-shaped occasion (k6)

### Release P (gate M2)
- Listing create validates picklists (21 categories, 41 counties + Bucharest, no free text) (P-01)
- Moderation: pending revision leaves live unchanged; business member cannot approve own (P-02, P-03)
- Directory: daily-rotated organic order, payment cannot influence (test + code note); public pages
  ro+en; dismissible task link names no business (P-04); stats are daily aggregates only (D4/INF11)
- Enquiries: fields exactly P8; email only if ticked (P9); thread in supplier record (P10); limits
  10/occasion + 30/account/day enforced server-side, flower quotes count against both (P11); state
  machine incl. "sent <date>"; re-send once after 7 days no duplicate (P33); nudges stop after 2nd
  (P32)
- Drawings: uncalibrated unusable for space model/fit checks (V7); booked-venue update arrives as
  What-if proposal, never silent (V4); custom tables marked custom (V5); unknown dims excluded from
  fit checks (V6); guest space view read-only (V9); parking known/unknown, never blank (V10/V11)
- Catalogue + quote flow: request carries exactly F5 fields (P-07); accepted quote lands in supplier
  record + budget; design↔quote version delta (F6)
- Business occasions: admin cannot promote admin (P18); handover revokes business access incl. MCP
  tokens, keeps history (P22, MCP7); lapse leaves occasions + in-use assets working (P23)
- Discovery: drafts never public until approved (BD2); dedup queued for humans (BD3); unclaimed label
  + contact route, no enquiries (P29); single claim invitation only to public email (BD5); objection
  ≤30 days recorded (BD6); kill switch + run log (BD7); SSRF/robots respected (SEC6)
- Claim: code to published address; moderator verification path recorded (P30)
- Monetization dormant: grep + e2e prove no checkout/pricing/card UI while OFF (MON1); no Featured
  cards anywhere (MON5); webhook-only feature grants (P24); switch ON without billing acceptance
  refused (MON4); sandbox fiscal invoice via e-Factura with TVA line (PAY3/PAY4) (P-12)
- Featured (test mode only): ≤3 cards, random, labelled verbatim, organic untouched; absent from
  plans/guest pages/emails/exports/offline (P13–P16)
- Console: each W item has screen + server-side enforcement test; W3 restriction survives logout; W8
  three-person compliance access (P-14); single-operator queue inert until second person (W9)
- MCP: read tools return only own grants (finance-less contributor sees no budget, cannot
  propose_budget); propose tools create proposals only, applied via What-if confirm (MCP3, SEC15);
  `search_directory` returns directory order/labels verbatim (D3); per-call audit (MCP1); per-token
  consent warning (MCP4) (P-15)

### Releases C/D/E
- One e2e journey + negative tests per work item in `08-releases-C-D-E.md` (e.g., C-08: unpublished
  seating invisible to guests; C-10: one notification per change, no referrer leak; E-03: offline
  capture reconciles once, conflicts surfaced)

## Bug-check checklist before any release tag (run by an agent + operator sign-off)

- [ ] All acceptance criteria of the release's merged work items green; zero quarantined flaky tests
- [ ] Release blockers (PRD §12): no unresolved unauthorised access; no duplicate money posting; no
  unexplained overbooking; no lost approved records; no wrongly reversed facts — each proven by a
  named failing-then-passing test
- [ ] Security test layer green; `12-security-review.md` checklist items for the release all verified
- [ ] Load test (k6) meets Q5; guest-page perf budgets Q3 measured on the release tag
- [ ] axe-core clean at 320px on all new/changed screens; every drag has a tap path
- [ ] Strings 100% externalized ro+en; locale formats verified (L3)
- [ ] Dependency audit clean (high+); CI green on the tag commit (DEP7)
- [ ] Exploratory manual pass: 5 users per pilot journey, 4/5 unaided where the gate requires it (M1)
- [ ] Rollback drill: deploy previous tag, health checks green, data intact (DEP5)
- [ ] Traceability `09-traceability.md` shows no unmapped Must requirement for the release
