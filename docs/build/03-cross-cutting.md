# 03 — Rules that apply everywhere, as implemented

**What this is, in plain English.** Some rules cut across every screen: how people sign in,
how private links work, how abuse is limited, what happens to uploaded files, how email is
sent, how languages work, and how payments stay switched off. This file says how each is
actually implemented, names the PRD requirement it answers, and marks plainly anything the
original plan asked for that was **not built**.

Evidence for each rule (the module and the test) is in `09-traceability.md`.

## Sign-in and accounts (S1–S8, INF4, SEC1, SEC3, SEC12, SEC14)

**Email accounts.** A six-digit code by email; no password. The code lasts 15 minutes and
allows 5 attempts; a newer code invalidates older ones; a code is single-use. The same email
carries a one-tap link that is single-use and expires with the code. If a mail scanner has
already opened the link, the code still works and the "link already used" page offers one new
code request (`packages/auth/src/codes.ts`). Asking for a code behaves the same whether or
not the account exists — same answer, same email wording, and a minimum answer time
(`AUTH_TIMING_FLOOR_MS`) so timing does not give it away. Sign-in emails say that staff never
ask for a code.

**Anonymous accounts.** A generated username and a password the person chooses; no email,
phone or name. Passwords are hashed with Argon2id. A wrong username and a wrong password give
one identical failure. Ten single-use recovery codes are shown once, with a plain warning
that the account cannot be recovered without them. Adding an email later turns it into an
email account (`packages/auth/src/anonymous.ts`, `login-email.ts`).

**Sessions.** A random token in the `ed_session` cookie — HttpOnly, SameSite=Lax, Secure in
production; only its hash is stored. 30 days at most, 14 days idle. The account page lists
active sessions (device type, last seen) and has "sign out everywhere", which also revokes
every MCP token; changing the login email does the same. Nothing security-relevant is kept in
the browser's local storage — the only key there records that the cookie notice was read
(the offline capture queue of Release E uses IndexedDB and holds arrivals and checklist ticks
waiting to be sent).

**Sensitive actions.** Ownership transfer, deletion, login-email change, grant and member
changes need a fresh confirmation within 10 minutes: an emailed code, or a recovery code for
anonymous accounts (`requireFreshAuth` in `packages/core/src/accounts.ts`).

**Two-step sign-in.** Opt-in, never required of planners and never mentioned in the sign-in
flow. The second factor is a standard authenticator app (TOTP) with ten recovery codes;
turning it on or off needs a fresh confirmation.

> **Not built: passkeys.** The PRD (S2) allows "or, on the same device, a passkey".
> `packages/auth/src/passkeys.ts` is a documented seam (`PASSKEYS_AVAILABLE = false`), the
> `passkey_credentials` table exists and is unused, and no passkey screen is shown.

**Staff.** Two-step is mandatory: the console does not open without it. The console has its
own session — 12 hours from the two-step sign-in, ended after 30 minutes without console
activity, never reopened (`packages/core/src/staff.ts`).

**New accounts and the legal gate (LAU1).** An account can be created only once the terms,
privacy policy and cookie notice are recorded as published in the console
(`packages/auth/src/signup.ts`, `packages/core/src/compliance.ts`). The one exception is a
local machine: while nothing has been recorded and `APP_URL` is a localhost address, sign-up
is open.

## Rate limits and bot protection (SEC11, SEC16)

`packages/core/src/ratelimit.ts`. The sign-in surface is limited on three independent axes —
email address, IP address and a plain disclosed device cookie (`ed_device`):

| Limit | Default |
| --- | --- |
| Code requests per email | 3 per hour, 10 per day |
| Code requests per IP / per device | 10 per hour each |
| Attempts per code | 5 |
| Code entries per IP / per device | 20 per hour each |
| Password entries per anonymous username | 10 per hour |

An address that keeps tripping gets a growing wait, capped — never a lockout. Every limit
answers with the same generic message and a retry time. Events go to `security_log` with
hashed keys and no record of whether an account exists. The defaults can be changed in the
console (*Operațiuni*), as an approval request that a second person must approve (setting
`security.signInLimits`).

Public forms that need no account (guest replies, poll votes, contribution claims, menu
choices, private requests, public registration, the supplier's acknowledgement, content
reports, removal requests) use `checkPublicForm`: a per-IP limit (30 per hour by default), a per-link limit (120 per hour),
a hidden honeypot field and a minimum time between showing and submitting the form
(3 seconds). No third-party CAPTCHA.

The client address is read from the header named by `TRUSTED_IP_HEADER` (default
`x-forwarded-for`); which header can be trusted depends on the hosting (operator decision).

## Guest, supplier, registration and QR links (S6, SEC2, SEC7, INF5)

| Link | Path | Scope | Module |
| --- | --- | --- | --- |
| Guest invitation | `/g/<token>` | One household's own view; never the guest list | `packages/core/src/invitations.ts` |
| Printed QR | `/g/q/<qrId>` | Same view, from a separate 192-bit identifier that can be rotated | `packages/core/src/qr.ts` |
| Supplier | `/s/<token>` | One booking: its briefing, order and acknowledgement | `packages/core/src/suppliers.ts`, `briefings.ts` |
| Public registrant | `/e/<slug>/r/<token>` | The person's own registration | `packages/core/src/registrations.ts` |
| Team invitation | `/invite/<token>`, `/business/invite/<token>` | Accept one invitation; expires after 14 days | `members.ts`, `business.ts` |

Tokens are random (128 bits or more), stored only as hashes, individually revocable.
A guest link can expire never, at the RSVP deadline, or at closeout. An unknown, revoked or
expired link all give the same plain "no longer valid" page. Links are rate-limited per link.
Guest pages open in the invitation's language, with a one-tap switch.

Guests have no account, so changes reach them by email to the household lead's address (given
when the household replies) — once per change — and through a "changed since your last
visit" marker on the link.

External links use the `ExternalLink` component (`rel="noopener noreferrer"`), and the
referrer policy is `same-origin`, so a private link is not leaked to another site.

## Uploads and files (INF3, SEC4, Q6, Q9)

`packages/storage`. Files go in through `POST /api/uploads` (or a signed direct upload) for a
registered *upload purpose*, which decides who may upload and whether a PDF is allowed.

- The type is decided from the file's first bytes, never from its name.
- PNG and JPG are decoded and re-encoded server-side, which strips metadata and anything
  appended. PDFs are stored as they are.
- A file is not readable until the malware scan says it is clean. The scanner is the
  operator's (`MALWARE_SCANNER=command` or `http`); with none configured, **production refuses
  uploads**. Development uses a stand-in that recognises the standard EICAR test string.
- Files are served only through short-lived signed links from the media origin, with a
  sandboxing policy and `nosniff`; PDFs always as downloads (`Content-Disposition:
  attachment`), re-encoded images inline. The media host answers
  nothing but `/api/media/*`.
- Fair use, counted at upload time in the same transaction: 100 MiB per occasion, 200 MiB per
  business, 10 MiB per file. PDFs are accepted only for venue drawings, supplier quotes, receipts and
  business library files (PRD Q9 names drawings only on the business side; library files are
  an addition). Over the limit,
  the upload is refused and nothing is deleted automatically.
- PDF drawings need a picture to calibrate on: the web image installs poppler's `pdftoppm`.
  Without it a PDF drawing is stored but cannot be calibrated.

*Verified by tests with a local folder as the store. Not verified against a real S3-compatible
store, a real scanner or a separate media domain.*

## Security headers and request safety (SEC5, SEC6, SEC7)

- `apps/web/proxy.ts` sets a strict Content-Security-Policy with a per-request nonce (no
  inline scripts, no third-party origins), HSTS in production, `nosniff`,
  `Referrer-Policy: same-origin` and no framing. Checked by `apps/web/test/headers.test.ts`
  and, on real responses of the built app, by `scripts/check-headers.mjs`.
- Server Actions carry the framework's own cross-site protection; Route Handlers that change
  state check the request's origin (`apps/web/lib/csrf.ts`). Webhooks and `/mcp` authenticate
  by signature or token instead.
- Every server-side fetch of an address that came from a user or the web goes through
  `safeFetch` (`packages/shared/src/ssrf.ts`): http and https only, private, loopback and
  link-local ranges blocked (including after DNS resolution), size and time capped. Discovery
  also honours `robots.txt` (`packages/core/src/fetching.ts`).
- The audit log is append-only at the database level (`02-data-model.md`).
- Secrets come only from the environment; boot errors print names, never values.

> **Not built: rotation dates in the console.** SEC13 says the console shows each secret's
> last rotation date. There is no such field. Record rotation dates in your own operations
> log (or as a note on the LAU5 item of the launch checklist) until one is added.

## Privacy and data (D1–D6, INF6, INF11, INF12)

- The public site sets no cookie and loads nothing from another origin; `pnpm build` fails if
  it does (`scripts/check-public-d1.mjs`).
- The app sets exactly three cookies: `ed_session` (session), `ed_device` (rate limiting),
  `ed_lang` (language). The in-app notice lists exactly these and is shown again only when
  the set changes (`packages/core/src/cookies.ts`).
- Access is checked in `@ed/core` on every read and write. Budget, expenses and shared costs
  need the finance grant; private requests need their own grant; the owner holds both.
- A business learns who a planner is only from an enquiry the planner sends, and the
  planner's email only if they tick the box.
- Statistics are daily server-side counts with no visitor identifier; the table has no column
  that could hold one.
- Encryption at rest (database volume, object store, backups) is an infrastructure property:
  described in `infra/terraform/`, **not applied or verified**.
- Retention and deletion: `02-data-model.md` lists every rule and the three places where the
  implementation differs from the PRD's table (audit log never purged; receipts counted from
  deletion; **occasions owned by a deleted account are not deleted**).

## Email (INF2, L5, Q6)

`packages/email`. Each domain registers its templates; an email is rendered from structured
blocks into plain text and simple HTML, Romanian first with English below. Before sending,
the pipeline checks the suppression list (hard bounces and complaints are never emailed
again) and the cap of 500 emails per occasion per day.

Two providers exist: `dev` (nothing is sent; the message is kept in `email_outbox`, which is
how a local sign-in code is read) and `http` (a generic seam that posts the message to
`EMAIL_PROVIDER_URL` with `EMAIL_PROVIDER_API_KEY`). Bounces and complaints arrive at
`/api/webhooks/email`, authenticated by `EMAIL_WEBHOOK_SECRET`.

> **Seam, not an integration.** No specific email vendor is integrated or tested. The
> operator chooses one with EU delivery and either points the `http` provider at it (through
> a small adapter if its API differs) or registers a provider with `registerEmailProvider`.
> No real email has been sent by this code.

## Languages and formats (L1–L5, INF8)

- Every user-facing string is in `packages/i18n/messages/ro/` and `…/en/`, 75 namespaces
  each (14 of them the help centre); `packages/i18n/test/parity.test.ts` fails if the key sets differ.
- Romanian is the default. English is a full toggle at account level (and the `ed_lang`
  cookie) and per guest link; it changes wording only, never data.
- Formatting goes through `@ed/i18n/format` only: `1.990 RON`, `dd.mm.yyyy`, Romanian weekday
  and month names, 24-hour time; English conventions when English is on.
- Timestamps are stored in UTC and shown in Europe/Bucharest; travel legs carry their own
  time zones.
- Moderated business content is written in Romanian with an optional English version; where
  there is none, English readers see the Romanian text with a "numai în română" note.
- Plural forms are separate message keys chosen in code, not ICU plural syntax.

## Quality, phones and accessibility (Q1–Q10, A12)

**How it was approached.** One component library (`@ed/ui`) carries the rules so that screens
inherit them: 48 px controls, labels above inputs, errors in words beside the field, a
visible focus ring, bottom sheets instead of centred dialogs, a skip link, `aria-label` on
icon-only buttons, colour never used alone, `prefers-reduced-motion` respected, and colour
pairs chosen to meet WCAG AA (figures in `16-design.md`). Every drag interaction in the
seating editor has a tap path (select, then move with on-screen controls). Screens were
looked at as headless-Chrome screenshots at phone width during the build.

**What that does not prove.** None of the following from the original plan exists:

- no automated accessibility checks (axe) and no manual screen-reader or keyboard-only pass;
- no browser end-to-end tests (Playwright), so no automated check at 320 px;
- no measurement of the guest-page targets (Q3: content in 2.5 s, interaction in 200 ms);
- no load test for the qualification targets (Q5: 1,000 attendees, 50 operators, 10,000 tasks);
- no test on real iOS Safari or Android Chrome devices (Q1).

Double-submit safety (Q4) *is* tested: unique constraints, conditional updates and
`withIdempotency`, with tests for parallel last-place and last-unit claims.

The installable app (B11) has a manifest, a service worker with an offline shell and the
downloadable briefing PDF. The service worker and the offline capture queue have not been
exercised on a real device.

## AI text (INF7, Q6, MCP5)

`packages/core/src/aitext.ts`. Wording suggestions only (invitation, save-the-date, thanks,
message, promotion), returned to the person who asked, shown in an edit box labelled
"generat cu AI", and used only if they accept. Ten results per account per calendar month,
counted atomically. Only the kind of occasion, tone, language and what the person typed leave
the server — never a guest list or contact.

The provider is off by default (`AI_TEXT_PROVIDER`): `dev` composes from fixed templates;
`http` posts to `AI_TEXT_URL`. **No AI vendor is integrated**; that is the operator's choice.
Text created through an external assistant (MCP) is labelled "creat cu un asistent extern".

## Payments (dormant) (P24–P28, PAY1–PAY5, MON1–MON5)

Monetisation is **off** and nothing can be bought. While it is off: no pricing or checkout is
reachable by a business (the plan page shows the free phase), the directory shows organic
results only, and Featured does not exist. A test scans the routes and sources for pricing
and checkout (`apps/web/test/monetization-off.test.ts`).

Built and dormant in `packages/core/src/billing.ts`, `monetization.ts`, `invoicing.ts`,
`featured.ts`:

- the switch, which needs a recorded test-mode acceptance, a second person's approval and
  starts a 60-day notice with reminders at 60, 30 and 7 days;
- a Stripe client written against Stripe's HTTP API (checkout session, cancellation at period
  end, refunds), with webhook signature verification; feature grants change **only** from a
  verified webhook; 14 days of grace after a failed renewal;
- refunds and price changes as approval requests;
- fiscal invoices through a provider registered with `registerInvoicingProvider`, with TVA
  shown separately (199 RON + 21% = 240,79 RON);
- pilot prices as placeholders (199 / 1.990 / 149 RON, excluding TVA).

> **Seams, never run against the real services.** No Stripe account, key or webhook has been
> used; the tests use a fake HTTP layer and locally signed payloads. No SmartBill or Oblio
> adapter exists — only the registration point and the webhook. PAY1's order of wallet
> buttons is delegated to Stripe's hosted checkout through
> `STRIPE_PAYMENT_METHOD_CONFIGURATION` and has not been seen working. Gate M2 requires a
> real sandbox run before the switch may be turned on.
