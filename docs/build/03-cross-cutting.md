# 03 — Cross-cutting build specs (every work item must satisfy these)

These turn PRD sections 10 (S/D/Q/L), 16 (PAY), 18 (INF) and the SEC group into implementation
rules. Each rule names its PRD IDs; the traceability file maps them to work items.

## Sign-in and accounts (S1–S8, INF4, SEC1–SEC16)

- **Email accounts:** six-digit code by email (S1). Code expires after 15 min, max 5 attempts; new
  code max 3×/account/hour and 10/day (INF4). The same email carries a single-use one-tap link,
  expiring with the code; if a mail scanner consumes the link, the code still works and the
  consumed-link page offers one new code request, rate-limited (SEC14). Codes single-use; a newer
  code invalidates older ones (SEC1). Sign-in emails state staff never ask for a code and that an
  unrequested code means probing (SEC1).
- **Anonymous accounts (S7/S8):** random generated username + user-chosen password, no email/phone/
  name. Passwords Argon2id, per-account salt. Wrong username or password → one identical generic
  failure (SEC1). Ten single-use recovery codes shown once with an explicit unrecoverability
  warning; sensitive actions use a recovery code instead of an emailed code; adding an email later
  converts to an email account (S1); removing email returns to anonymous rules after fresh codes.
- **Sessions (S3, SEC3, SEC12):** 30 days, or 14 days idle; cookies Secure, HttpOnly, SameSite=Lax;
  server-side revocable; account page lists active sessions (device, last seen) with one-tap
  "sign out everywhere" that also revokes all MCP tokens; changing login email does the same.
  Nothing security-relevant in localStorage.
- **Sensitive actions (S4):** ownership transfer, deletion, login-email change, capability grants,
  business purchases, member changes — fresh emailed code within 10 minutes.
- **Opt-in 2FA (S2):** TOTP (any authenticator app) or passkey on the same device; ten recovery
  codes; enable/disable needs a fresh emailed code; never required or nudged in the sign-in flow.
- **Staff (S5):** two-step mandatory; staff console session 12 h or 30 min idle.
- **Rate limiting (SEC16, SEC11):** three independent axes — per email, per IP, per disclosed
  device cookie: code requests ≤3/email/hour and ≤10/IP/hour; code entry ≤5/code and ≤20/IP/hour;
  escalating backoff per address, never a lockout; all limits return the same generic message with
  a retry time whether or not the account exists; events go to the security log without recording
  account existence. Public forms (RSVP, public registration, enquiry, claim requests): per-IP +
  per-link limits, honeypot field, time-to-submit floor, no third-party CAPTCHA (D1).
- **Tokens (SEC8):** sign-in codes and MCP tokens stored hashed only; UI shows at most last 4
  chars; staff can never read them.

## Guest links and scoped access (S6, SEC2, SEC7)

- Invitation/guest links: ≥128-bit random token, hashed at rest, individually revocable, optional
  expiry (never / RSVP deadline / closeout), rate-limited per link against brute force.
- A link exposes only its own household's view — never the whole guest list (A6, SEC2).
- External links on guest pages (navigation, unclaimed-listing contact routes) use
  `rel="noopener noreferrer"`; referrer policy `same-origin` (SEC5, SEC7).
- Guest notifications (no account): email to the household lead captured at RSVP; households
  without email see a "changed since your last visit" marker on the link (INF5).

## Uploads and files (INF3, SEC4, Q6, Q9)

- S3-compatible store; signed upload URLs issued by the web service; private objects only via
  scoped links; fair-use counted at upload time (planners 100 MiB/occasion + 500 emails/day +
  10 AI text results/month, Q6; businesses 200 MiB assets, 10 MiB/file, PNG/JPG images, PDF for
  drawings only, Q9 — over-limit business is told which asset to remove; nothing auto-deleted).
- Images (PNG/JPG) re-encoded server-side (sharp), stripping embedded content. PDFs stored as-is
  but served only from `media.eventdesk.ro` with `Content-Disposition: attachment; noinline`.
- Every file malware-scanned before it becomes visible (scanner product is operator-configurable).

## Security middleware (SEC5, SEC6, SEC10, SEC13)

- Strict CSP (no inline scripts; public site: no third-party origins at all, D1), HSTS,
  `X-Content-Type-Options: nosniff`, referrer policy same-origin; CSP asserted by a CI test every
  release (SEC5, Q1).
- CSRF protection on all state-changing requests (Server Actions: framework-provided; route
  handlers: token check).
- SSRF guard for every background fetch (discovery BD1, map links): URL validation, private and
  link-local ranges blocked, fetch size/time capped, robots.txt honoured (SEC6).
- Audit log append-only at DB level (SEC10). Secrets in the secret store only, annual rotation,
  console shows rotation dates not values (SEC13).

## Privacy and data (D1–D6, INF6, INF11, INF12)

- Public site: no cookies, no third-party script (D1). In-app cookie notice lists exactly three
  cookies (session, SEC16 device rate-limit cookie, language preference), states none is for
  tracking, re-shown only when the cookie set changes (LAU1).
- Access grants are checked in `packages/core` on every read and write — private requests, finance,
  guest contacts only to holders of that specific grant (D2). A business learns who a planner is
  only from an enquiry the planner sends (D3).
- All statistics are server-side daily aggregates of application events computed by the nightly
  worker; no client-side tracking, no session recording, no visitor identifier (D4, INF11).
- Encryption at rest everywhere: Postgres volume, object store (SSE with customer-managed key),
  encrypted backups (INF12, INF10). App-level per-file encryption deliberately not used (INF12).
- Retention per the INF6 table in `02-data-model.md`; deletion with 7-day undo and a retained-data
  statement (D6).

## Internationalization and locale (L1–L5, INF8)

- Primary UI language Romanian; every string externalized in `ro.json` and `en.json` from launch —
  no hard-coded strings; default `ro-RO`, diacritics (ș ț ă â î) correct and searchable (L1).
- English is a full account-level and per-guest-link toggle; guest link opens in the invitation's
  language, switchable in one tap; the toggle changes wording only, never data (L2).
- Locale formatting: RON amounts with "RON" suffix (1.990 RON), dates dd.mm.yyyy, Romanian weekday/
  month names, 24-hour times; English toggle switches conventions (L3). All times stored UTC,
  displayed Europe/Bucharest (INF8).
- Moderated content is Romanian-first; optional English version with "numai în română" fallback
  note (L4). Emails bilingual, Romanian first (L5).

## Quality and performance (Q1–Q10)

- Current + previous iOS Safari and Android Chrome, plus desktop (Q1); usable at 320 px, WCAG 2.2
  AA target (Q2) — axe checks in CI.
- Guest pages: main content < 2.5 s, interaction < 200 ms (Q3) — measured in e2e on a throttled
  phone profile.
- Double-tap / repeated action applies once (Q4) — idempotency keys + DB constraints + tests.
- Qualification: 1,000 attendees, 50 concurrent operators, 10,000 tasks per occasion (Q5) — k6
  script run pre-release.
- Drag interactions at phone width: ≥44 px targets, magnified dragged item, snap tolerance,
  cancel-by-drag-back; every drag has an equal tap path (Q8, Q10, A12).
- Installable PWA with offline shell and downloadable briefing (B11, Q1).

## AI text feature (INF7, MCP5)

- The in-app AI text feature is invitation/message wording suggestions only, with explicit
  "generat cu AI" labelling and an edit box before use; 10 results/month per account (Q6); model
  and provider are operator-configurable and recorded in the console; nothing is generated without
  the user seeing the result first (INF7). External-assistant content is labelled
  "creat cu un asistent extern" (MCP5).

## Payments (dormant until MON ON) (P24–P26, PAY1–PAY5, MON1–MON5)

- While monetization is OFF: no pricing, checkout or card-entry UI exists anywhere (MON1); the
  directory shows organic results only — Featured does not exist (MON5); console shows the
  free-phase cost dashboard (W6).
- Built but dormant: Stripe Billing (operator SRL/PFA, Romanian IBAN); features switch only from a
  verified webhook, never from a browser redirect (P24); checkout order Apple Pay → Google Pay →
  card, no local bank-app integrations, BT Pay explicitly out of scope (PAY1, PAY2); 14-day grace,
  cancel at period end (P25); refunds/credits need request + second person (P26); fiscal invoices
  via SmartBill/Oblio webhook through RO e-Factura, TVA shown separately (199 RON + 21% = 240.79
  RON), prices stated excl. TVA everywhere (PAY3, PAY4); one processor at launch, Stripe first,
  Netopia fallback, decision revisited at M2 (PAY5). The MON switch itself needs live-billing
  acceptance in test mode first, second-person approval and 60-day notice with 30/7-day reminders
  (MON2–MON4, P28).

## Security review checklist for every PR touching a user-facing surface

Enumeration-safe responses (SEC1) · token hashing (SEC8) · rate limits on new endpoints (SEC16)
· bot protection on new public forms (SEC11) · upload handling per SEC4 · headers/CSP (SEC5) ·
CSRF (SEC6) · SSRF guard on new fetches (SEC6) · referrer safety on new external links (SEC7) ·
audit entries for new state changes (SEC10) · no secrets (SEC13) · idempotency (Q4) · strings in
both locales (L1/L2) · 320px + 44px + axe (Q2, A12) · guest-page perf (Q3).
