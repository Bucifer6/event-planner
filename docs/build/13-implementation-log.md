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

## Release B + R0-10/13/15 (v0.2.0 candidate, branch vibe/release-b-db71a4)

- **B1/B2**: budget categories with estimate/committed/invoiced/paid/forecast as
  separate columns; expenses with independent approval and payment states; finance
  grant enforced server-side (D2) — tested (finance-less member gets 403).
- **B3**: balanced shared-cost ledger with per-currency settlement view (zero-sum
  invariant tested); unbalanced splits rejected.
- **B4/B5/B12**: suppliers, booking state transitions (audited), immutable versioned
  briefings with supplier acknowledgement, final-order snapshots + delta rows for
  later guest changes (principle 4), payment deadlines feeding the finance digest.
- **B6**: deliveries/hired/returns; `receivedQty` changes only via an audited
  `Correction` — enforced by a DB trigger (direct UPDATE rejected, tested).
- **B7**: event-day view (Ready/Running/Waiting/Done) over the same task rows,
  Midnight Candlelight dark theme via prefers-color-scheme.
- **B8**: readiness decisions Hold/Proceed/Proceed-with-conditions requiring at
  least one evidence reference (tested).
- **B9/B10**: cancel/postpone/close as What-if previews (nothing applied silently);
  closeout lists unpaid balances/returns/deposits, saves lessons, closes the
  occasion and starts the INF6 retention clock.
- **B11**: PWA manifest + offline service-worker shell; downloadable briefing PDF
  (pdfkit) generated from the same records.
- **R0-10**: `packages/storage` upload pipeline — S3-compatible (operator-configurable,
  EU) with local-disk dev transport; PNG/JPG re-encoded server-side via sharp
  (metadata stripped, SEC4); PDFs served only with `Content-Disposition:
  attachment` + sandboxed CSP (`/api/media/*`); malware scan before visibility;
  fair-use limits counted at upload (Q6 100 MiB/occasion, Q9 200 MiB/business,
  10 MiB/file, formats per Q9).
- **R0-13**: staff console — six roles, staff 2FA mandatory (TOTP via otpauth, S5),
  console session 12h/30min-idle, second-person approval queue with single-operator
  restricted mode (W9, tested), audit viewer (W8), dashboard counts (W1), W6
  monetization switch OFF by default with two-person enable (MON2, tested).
- **R0-15**: MCP server at `/mcp` (stateless Streamable-HTTP JSON-RPC, Bearer personal
  tokens hashed + revocable + 30-day inactivity expiry job), fixed versioned tool
  catalogue announced on initialize/tools/list (MCP8), per-token consent warning
  before first use (MCP4), read tools bounded by own grants (MCP2), propose tools
  bounded by write grants returning a proposal id — never applying (MCP3/SEC15),
  per-call `McpCallLog` (MCP1), external-assistant labelling (MCP5), no
  admin/payment/other-account tools (MCP6). All tested.
- Still open: R0-02 infra IaC, R0-14 GitHub-App deploy pipeline (Deploy model
  exists), release P (business module), releases C/D/E.

## Release P (v0.3.0 candidate, branch vibe/release-p-db71a4)

- **P-01**: business accounts (email required, P29), ≤5 listings per business, fixed
  picklists only — 1–5 of the 21 seeded categories, ≤5 counties, 1–20 localities that
  must belong to the chosen counties; free text rejected by construction (tested).
  P18 admin rules (owner-only admin create/remove) in `packages/core/src/business.ts`.
- **P-02/W2**: moderation queue `packages/core/src/moderation.ts` — every revision
  (create + edit) is pending until a `listing_moderator` who is NOT a business member
  approves (tested: member-approver FORBIDDEN, live-stays-up until approval, decided
  revisions immutable). W3 suspension/restriction with recorded reason.
- **P-03/P-04**: factual badges only (ONRC registration, insurance-with-date); public
  directory `/directory` + `/directory/[id]` in ro+en (smoke-tested), search per
  category × county (+ locality). Organic order = sha256(UTC-day|listing|category|
  county), rotates daily, no payment field participates (tested: a Subscription row
  does not change order). MON5: while the switch is OFF no Featured renders at all;
  when ON, active Featured slots are excluded from organic order (tested).
- **P-05**: enquiries planner→business (`packages/core/src/enquiries.ts`): P8
  pre-filled free fields only, planner email only if ticked (P9); P10 creates/reuses
  the supplier record + booking so the thread sits in the plan (tested: 10 bookings);
  P11 limits 10/occasion + 30/account/day server-side (tested: 11th refused); P29
  unclaimed listings reject enquiries (tested); P33 state machine sent/awaiting/
  answered/closed + one re-send after 7 days on the same thread; P32 arrival email in
  the listing language + exactly one 48h nudge (`enquiry-nudge-48h` worker job,
  per-business off switch `Business.nudge48h`).
- **P-06 (V1–V11)**: drawings per space with stated real dimensions; V7 two-point
  calibration gates space-model attachment (tested: uncalibrated attach refused);
  V4 drawing updates arrive as What-if previews, never silent overwrites (tested:
  version 1→2 only after confirm); V5 custom tables; V6 fit check excludes unknown
  dims; V8 POIs/fixtures; V10/V11 parking facts known/unknown with mismatch→unknown.
  Web: business listing manage page + occasion `/space` page.
- **P-07 (F1/F2)**: flower catalogues on the listing page and public page;
  indicative prices never quotes (F3). Quote requests ride the enquiry flow (F5)
  and count against both P11 limits.
- **P-09 (BD1–BD7)**: discovery drafts from lawful sources, dedup queued for humans
  (tested), moderator approval → live unclaimed listing with source cited, exactly
  one claim invitation emailed only to a publicly listed address (tested via outbox),
  per-source kill switch, objections/removals honoured within 30 days and recorded.
- **P-10 (P30)**: claiming via emailed code (tested: wrong code rejected, right code
  claims + creates the business); moderator-verify fallback when no public email.
- **P-11 (P31/INF11/D4)**: nightly `listing-stats-nightly` worker job computes
  response stats from application events only; published only at ≥10 answered
  enquiries; `hideStats` suppresses (both tested). No visitor identifiers, no
  payment influence.
- **P-14/P-15**: console screens W2 moderation, W4 discovery (drafts/sources/
  objections), W3 businesses; MCP tools `search_directory`, `get_listing`,
  `list_catalogues`, `get_space_model` (read-only; space model bounded by own
  occasion grants, MCP2; unclaimed listings expose only the published route, P29).
- Schema: Release P models + `Business.nudge48h` (migration `release_p`,
  `release_p_nudge`); seed adds the 21 categories and 42 counties + localities.
- Tests: `packages/core/test/release-p.test.ts` — 9 tests; suite total 43 green
  (i18n sync test included, ro/en 430 keys each). `fileParallelism: false` in core
  vitest config (single shared embedded PG); release-b MON test made deterministic.
- Smoke (`scripts/smoke.mjs`, loopback only): health, SEC5 headers, RO UI, CSRF
  reject, guest 404, `/directory` 200 RO + seeded categories, unknown listing 404,
  `/business` auth-wall redirect — all OK.
- Still open: P-08 business occasions/branding/handover, P-12/P-13 dormant billing +
  Featured (by design until MON ON), R0-02 IaC, R0-14 deploy pipeline, releases C/D/E.

## Finish Release P (v0.4.0 candidate, branch vibe/release-p-finish-db71a4)

- **P-08 (P17-P23)**: business-owned occasions creatable by any active member with the
  same planning features; team access via business membership ends at handover (P22,
  MCP7: business tokens stop passing getMember for that occasion); handover keeps
  history and transfers ownership to the client; plan lapse (P23) blocks only NEW
  business occasions/branding/library/listings — existing occasions and in-use
  drawings/catalogues stay fully usable (all tested). P20 branding (name/logo/accent)
  renders on guest pages pre-handover. P19 shared library. P21 cross-occasion
  dashboard with asset usage as daily totals, no visitor ids (D4). P7 dismissible
  directory link on tasks, switchable per account/occasion.
- **P-12 dormant billing (MON1-MON5, P24-P28, PAY1-PAY5)**: `/api/webhooks/stripe`
  verifies HMAC-SHA256 signatures (5-min tolerance) before anything flips (P24);
  browser redirects grant nothing. invoice.payment_failed → 14-day grace (P25);
  cancel-at-period-end → lapse → P23 guard. Checkout dormant (MON ON + key only),
  wallet order Apple Pay → Google Pay → card (PAY1/PAY2). Refunds/credits queue for a
  second person (P26/W9). e-Factura invoicing via SmartBill/Oblio webhook when
  configured, else SANDBOX fiscal ref; TVA separate, prices excl. TVA (PAY3/PAY4).
  MON4: switch ON refused without recorded test-mode billing acceptance; ON records
  the 60-day notice window (MON2/P28). MON5: Featured does not exist while OFF.
- **P-13 dormant Featured (P13-P16)**: up to 3 random cards per request, label
  verbatim "Promovat — plasare plătită", organic order untouched; P15 pre-purchase
  view min(1, 3/(n+1)) + 30-day search aggregates; P16 absence from exports tested.
- **P-14 console (full)**: W4 directory management (categories create/retire/publish,
  daily per category×county stats), W6 commercial (free-phase cost dashboard, switch +
  notice, billing acceptance, refund queue), W7 comms to businesses only, W8 access
  management + audit filters/export + 3-person compliance access, W10 deployments
  (GitHub App server-side creds, deploy by tag with green CI only, second-person or
  audit-marked emergency). LAU8 notice-and-action content reports reuse W3 + SEC10.
- **P-15 MCP**: propose_supplier_shortlist (notifies nobody, labels verbatim),
  propose_seating_layout (V6 fit-checked), propose_custom_table (V5),
  propose_arrangement_design (indicative cost, never a quote, F3),
  propose_budget_note (finance grant, SEC15) — all propose-only What-if previews,
  guest-role/finance-less denials tested.
- Schema: handover fields, planLapsedAt, library, asset-usage-daily,
  directory-search-daily, billing acceptance, compliance access, platform notices,
  content reports, subscription/invoice billing fields (migrations release_p_finish,
  release_p_billing). Tests: 55 total green (11 new core + 1 new MCP). Smoke extended.
- Still open: releases C/D/E, R0-02 IaC, operator launch obligations (LAU2-LAU5, LAU7).

## Release C (v0.5.0 candidate, branch vibe/release-c-db71a4)

- **C-01/C-08**: seating plan on the space model; the form IS the tap path (Q10), drag
  optional; publish action; guests see their own table/seat on their link and on the
  printed-invitation QR (`/g/q/[qrId]`, scoped id — raw token stays hashed, SEC2) ONLY
  after publish; unpublished never visible (tested via getGuestSeat/getGuestView).
- **C-02**: meal-stage fit checks against stated dims; unknown dims excluded and shown
  unknown (V6, tested).
- **C-03/C-10**: programme items with versioned cue lists; programmeRevision bumps per
  change; guests notified ONCE per revision (INF5, tested sent=1 then 0); guest event
  page `/e/[slug]` shows venue address + external nav link (rel="noopener noreferrer",
  SEC7), programme, menu, read-only space view (V9 POIs, V10 parking).
- **C-04**: invitation/stationery designer with versioned designs, proof approval gate
  before any print PDF (tested), print-ready PDF asset attached after proof.
- **C-05**: menus + diet tags + per-household meal choices; aggregated quantities for
  order snapshots (tested).
- **C-06**: public event page with slug, open/close, conditional questions; public
  registration endpoint with SEC11 bot guard (honeypot + time floor + rate limits) and
  ATOMIC capacity claim — one shared count, conditional UPDATE decides
  registered/waitlist (tested incl. duplicate rejection); waitlist promotion atomic.
- **C-07**: private dietary/access requests gated by the privateRequests grant (D2,
  tested); accessible guest journey published as static ro+en content.
- **C-09**: print pack PDF (pdfkit+qrcode) from the same records: invitation QRs ->
  scoped `/g/q/` views, table-card QR -> `/e/[slug]`, to-scale room plan; PDF served
  with attachment + sandboxed CSP.
- **C-11**: gift estimator — private per-planner ranges, labelled cultural guide, no
  sharing across planners (tested), free forever.
- **C-12**: promotion pack export-only (tested exportOnly; nothing posted/spent).
- **C-13/F3-F6**: arrangement designer — base form + catalogue items + stem counts,
  running indicative cost labelled indicative (tested); quote request via enquiry flow
  carrying only F5 fields (tested payload), accepted quote linked to design version (F6).
- Schema: SeatingPlan/SeatAssignment, MealStage, ProgrammeItem/Cue, InvitationDesign,
  Menu/MenuItem/MealChoice, PublicRegistration, PrivateRequest, GiftEstimate,
  ArrangementDesign, Occasion public/venue/programme fields, Invitation.qrId
  (migrations release_c, release_c_fields, release_c_qrid).
- Tests: 64 total green (9 new C tests). i18n ro/en 604 keys each.
- Still open: releases D/E, R0-02 IaC, operator launch obligations (LAU2-LAU5, LAU7).

## Release D (v0.6.0 candidate, branch vibe/release-d-db71a4)

- **D-01**: itinerary legs stored UTC (INF8), displayed in Europe/Bucharest AND the
  trip zone (`formatInZone`, DST-tested); booking imports arrive as What-if previews,
  applied only on explicit confirm (tested: nothing applied while pending).
- **D-02**: subgroups + optional activities; subgroup-scoped views respect grants (D2,
  tested: outsider FORBIDDEN, member-by-leadEmail and managers pass).
- **D-03**: packing lists with toggle (checklist reuse).
- **D-04**: transport legs; room allocation ATOMIC like capacity (A8 conditional
  UPDATE on occupants, rowCount decides; over-capacity refused, tested).
- **D-05**: settlement per currency grouped from the one ledger (B3, tested RON+EUR).
- Web: `/occasions/[id]/travel` page (itinerary, subgroups, packing, transport,
  rooms, settlement). Schema: ItineraryLeg, Subgroup(+Member), Activity, PackingItem,
  TransportLeg, Room(+Assignment) (migration release_d). Tests: 68 total green (4 new).
- Still open: release E, R0-02 IaC, operator launch obligations.

## Release E (v0.7.0 candidate, branch vibe/release-e-db71a4)

- **E-01**: rehearsal simulation `simulateDay` — read-only (principle 3): programme,
  itinerary legs, transport legs, activities and task due times merged into one UTC
  timeline; overlaps, tasks due inside a block and over-capacity rooms flagged; test
  asserts nothing is persisted (audit/check-in counts unchanged) and outsiders get
  FORBIDDEN.
- **E-02**: QR check-in `checkInByQr` via the C-09 scoped qrId — arrival marked through
  a Correction row + AuditLog (principle 4), idempotent per household (Q4, double scan
  tested); `guestFlowEstimates` (Q5) returns aggregates only — expected (RSVP yes),
  checked-in, not-arrived, 30-min arrival buckets and a rate-based projection capped at
  expected.
- **E-03**: limited offline capture — arrivals + own checklist ticks only; queued with a
  clientKey unique per occasion (Q4 upsert, replay tested); `reconcileOfflineQueue`
  processes pending items exactly once in transactions, marks applied/conflict; a tick
  whose task changed server-side after capture is surfaced as `changed_since_capture`
  and NOT merged (tested); offline arrivals create CheckIn via `offline_reconciled`
  with correction + audit. Web: POST/GET `/api/occasions/[id]/offline` for the PWA.
- **E-04**: sustainability goals vs measured quantities — `setSustainabilityGoal`
  (managers), `recordMeasurement` (any member; null = unknown), status unknown/measured/
  on_track/behind; unknown never counts as fitting (principle 5, tested).
- Web: `/occasions/[id]/operate` page (rehearsal, check-in + flow, offline queue,
  sustainability) + tab; server actions in `app/actions/releasee.ts`. Schema: CheckIn,
  OfflineSyncItem, SustainabilityGoal (migration release_e). Tests: 72 total green
  (4 new E tests). i18n ro/en 679 keys each.
- Still open: v1.0.0 production readiness (R0-02 IaC artifacts, R0-14 deploy runbook,
  LAU buildables, final QA).

## v1.0.0 (branch vibe/v1-db71a4)

- **R0-02 (artifacts)**: `infra/terraform/` — DNS (eventdesk.ro / app / media), managed
  encrypted Postgres with 30-day backups (KMS key managed separately, SEC9), S3-compatible
  EU media store with attachment-disposition policy (SEC4), app compute wired to a secret
  store by ARN only; every operator decision is a tfvar with placeholder default; NOT
  applied from this environment. Boot env validation: `packages/shared/src/env.ts`
  (assertBootEnv, names-only errors, SEC13, unit-tested) + self-contained
  `apps/web/instrumentation.ts` (production refuses to boot without DATABASE_URL/APP_URL).
- **R0-14 (artifacts)**: `.github/workflows/deploy.yml` — tag-triggered, production
  environment (DEP3 two-person approval via protection rules), DEP7 CI-green gate with
  audited emergency path, DEP4 order backup → migrate → release → health → auto-rollback
  (DEP5 rollback never deletes data), serialized deploys; `scripts/record-deploy.mjs`
  writes every deploy to the Deploy table (console W10); `docs/build/14-deploy-runbook.md`
  maps DEP1–DEP7 + LAU7 runbook.
- **LAU1**: in-app cookie notice (`CookieNotice`, SSR-visible, acknowledged in
  localStorage keyed by the cookie-set signature so it re-shows only when the cookie set
  changes); lists exactly ed_session/ed_device/ed_lang, states no tracking, links the
  public cookie notice. Web/core signature constants asserted equal in CI.
- **LAU5**: `Incident` model + console `/console/incidents` (security_administrator only,
  audit-logged); active incidents render a plain-language `IncidentBanner` on all
  guest-facing pages (/g/[token], /g/q/[qrId], /e/[slug]) linking the public status page.
- **LAU8**: public `/report` notice-and-action form on the app (per-IP rate limit SEC16,
  reporter contact hashed SEC8, reuses ContentReport + W3 moderation flow), linked from
  the public site; moderation rules in plain Romanian on /report and legal/terms.
- **LAU9**: accessibility statement ro+en already on the public site; console
  `/console/launch` renders the LAU1–LAU9 checklist and records the statement date +
  evaluation method as a PlatformSetting (staff-only, audit-logged).
- **QA**: `apps/web/test/a11y-320.test.ts` — 44px targets, no >320px fixed widths,
  device-width viewport, LAU1/5/8/9 wiring asserted in CI; smoke extended with /report
  and cookie-notice checks (10/10 OK).
- Schema: Incident, PlatformSetting (migration v1_readiness). Tests: 83 total green
  (61 core incl. 5 new v1 tests, 7 web incl. 6 a11y). i18n ro/en 723 keys each.
- Operator-owned gates remain on `/console/launch` (LAU2/3/4/6/7 + provider choices).

## Post-v1.0.0 QA pass (bug check + security check + e2e), branch vibe/qa-pass-db71a4

- **Bug check**: typecheck 0 errors; 83 tests green; web/public/worker builds OK; prettier
  clean; `pnpm audit --audit-level=high` passes — the single moderate is transitive
  `uuid@8.3.2` pinned by `exceljs@4.4.0` (`^8.3.0`, cannot move without replacing the XLSX
  lib); the vulnerable path (v3/v5/v6 with a `buf` arg) is never used (exceljs calls v4
  only) — accepted risk. Static sweep: no TODO/FIXME, no `dangerouslySetInnerHTML`, no
  `eval`, no stray `console.log` outside worker job logs. Smoke 10/10.
- **Real bug found & fixed by e2e**: `/occasions/[id]/tasks` returned 500 — the checklist
  checkbox used `onChange` inside a server component ("Event handlers cannot be passed to
  Client Component props"). Fixed with a `CheckItemToggle` client component taking the
  bound server action as a prop. Sweep confirmed no other server component uses event
  handlers.
- **Security check**: every API route authenticated or intentionally public with its guard
  (media: scan-clean PDFs only + attachment/noinline/sandbox CSP; lang: same-origin;
  magic link: single-use; stripe webhook: signature; MCP: Bearer, JSON-RPC -32001 without;
  uploads/offline/print-pack: session + member/grant checks in core). No secrets in the
  repo (only `.env.example`; test-local PG credentials in test setup). SEC10 append-only
  AuditLog proven live (UPDATE/DELETE throw). Cookies httpOnly/secure-in-prod/lax; fixed
  `/api/lang` to keep the `secure` flag on `ed_lang` in production. All raw SQL
  parameterized. No server-side fetch of user-controlled URLs (only fixed vendor APIs),
  so no SSRF surface in this build. External links carry `rel="noopener noreferrer"`.
  localStorage holds only the cookie-notice acknowledgement (SEC12). Hardening note (not a
  spec violation): TOTP secrets are stored base32, not encrypted at rest — PRD SEC8 covers
  codes/tokens only.
- **E2E**: new `scripts/e2e.mjs` (36 checks, wired into CI) boots embedded PG + both apps
  and drives real HTTP journeys: public site pages with D1 assertions, anonymous negative
  paths (bad guest token 404, console redirect, MCP/webhook/upload/sign-out rejections),
  signed-in planner journey (dashboard, all occasion tabs incl. operate simulation, offline
  QR arrival queue→reconcile→visible, idempotent clientKey, bad kind 400, print-pack PDF +
  anonymous rejection), guest link + QR + public event page. Result: E2E ALL OK.

## v1.1.0 UI polish pass (branch vibe/ui-polish-db71a4)

Response to "looks unfinished": concrete gaps found by inspecting rendered pages, fixed:
- Webfonts were referenced in tokens (Sora / Cormorant Garamond / DM Mono) but never
  loaded — added self-hosted `@font-face` pointing at `/fonts/*.woff2` with READMEs in
  `apps/web/public/fonts` and `apps/public/public/fonts` (operator drops the files;
  D1-safe, system fallbacks apply until then).
- Public landing showed the dashboard empty-state copy to anonymous visitors — replaced
  with a proper hero (lead + 3 feature bullets + CTA), new `site.hero.*` i18n keys ro/en,
  hero styles in the public globals.
- Auth pages had no brand header — new `(auth)/layout.tsx` with the wordmark topbar.
- CSS polish layer in `tokens.css`: type scale + heading margins, list rows inside
  cards (no bullet dumps), `.card.link` (replaced 4 inline-style link cards), visible
  `:focus-visible`, hover states for buttons/tabs/cards, input focus + placeholder
  styling, `.wrap.wide` (1080px) for occasion + console screens (phone layout
  unchanged, A12).
- Verified: typecheck 0 errors, 83+ tests green, builds OK, D1 grep clean, e2e 38/38.
