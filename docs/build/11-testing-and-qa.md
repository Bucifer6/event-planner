# 11 — Testing and quality checks, as they exist

**What this is, in plain English.** An honest account of how the product is checked. First,
the automated checks that really exist and how to run them. Then, just as important, the
checks that do **not** exist — the original plan asked for browser tests, accessibility
scans and load tests, and none of those was set up. Finally, a step-by-step checklist a
non-developer can follow in the running app, and the list of evidence that only people can
gather.

A PRD rule to keep in mind (section 12): a release is blocked by any unresolved unauthorised
access, duplicate money posting, unexplained overbooking, lost approved records or wrongly
reversed facts.

## The layers that exist

| Layer | What it is | How to run it | Runs in CI |
| --- | --- | --- | --- |
| **Unit and integration tests** | Vitest. Most tests call the real business rules in `@ed/core` against a real PostgreSQL 16 database — not mocks. Each test file gets its own private database from `setupTestDb()` (`packages/db/src/testing.ts`), cloned from a template built from the current schema and SQL guards, so files run in parallel safely | `pnpm test` (whole suite) · `pnpm exec vitest run packages/core/test/money.test.ts` (one file) · `pnpm exec vitest run --project @ed/core` (one package) | yes |
| **Translation parity** | Romanian and English have exactly the same keys in every namespace (75 at the time of writing); plural branches match | `pnpm --filter @ed/i18n test` (also part of `pnpm test`) | yes |
| **Source-scan tests** | Tests that read the source code to prove an absence: no pricing or checkout route while monetisation is off; no rating, star or testimonial wording in the directory code; every core module is in the `@ed/core/all` loader; the MCP tool list equals the fixed catalogue | Part of `pnpm test` (`apps/web/test/monetization-off.test.ts`, `packages/core/test/directory.test.ts`, `all.test.ts`, `packages/mcp/test/tools.test.ts`) | yes |
| **Type checks and lint** | TypeScript strict mode across all packages and apps; ESLint | `pnpm typecheck` · `pnpm lint` | yes |
| **Builds** | Production build of the app and static export of the public site | `pnpm build` | yes |
| **Public-site privacy gate (D1)** | Scans the exported public site: no reference to another origin, no cookie-setting code | `node scripts/check-public-d1.mjs` (run by `pnpm build`) | yes |
| **Security-header check (SEC5)** | Boots the built app and inspects real responses: CSP with a nonce and no unsafe sources, every script tag carrying the nonce, HSTS, nosniff, referrer policy, no framing | `node scripts/check-headers.mjs` (needs `pnpm build` and a migrated database) | yes |
| **HTTP smoke test** | Boots the built app and walks the signed-out journey: health, sign-in page in Romanian, directory, an unknown guest link, the console staying shut, `/mcp` refusing without a token, state-changing routes refusing a foreign origin | `node scripts/smoke.mjs` (same needs) | yes |
| **Dependency audit** | Fails on a high or critical advisory | `pnpm audit --audit-level=high` | yes |

"Runs in CI" means the step is written in `.github/workflows/ci.yml`. **The workflow has never
run on GitHub.** Every step was run by hand on the build machine.

### The numbers

At the last full run (14 November 2026, including the help centre and the security-review
fixes): **69 test files, 724 tests, all passing**, with 0 type errors and 0 lint errors. The
files added after the inventory below was written are `apps/web/test/help.test.ts`, the three
`security-review.test.ts` files, `packages/shared/test/errors.test.ts` and
`packages/core/test/account-purge-occasions.test.ts`. The per-file counts below are the number of test cases declared in each
file's source at the time of writing (parameterised cases expand when run, which is why the
total run is higher than the sum).

## Test inventory

### Foundation

| File | Cases | Covers |
| --- | --- | --- |
| `packages/auth/test/auth.test.ts` | 26 | Email code sign-in, one-tap link and the mail-scanner path, anonymous accounts, sessions, fresh confirmation, opt-in two-step (S1–S4, S7, S8, INF4, SEC1, SEC3, SEC8, SEC12, SEC14) |
| `packages/auth/test/signup-next.test.ts` | 7 | The return path after sign-in cannot be an open redirect; the legal gate on sign-up |
| `packages/core/test/ratelimit.test.ts` | 12 | The three sign-in axes, back-off, public-form protection (SEC11, SEC16) |
| `packages/core/test/staff.test.ts` | 19 | Console guard, approvals and single-operator mode, audit viewer, dashboard, legal gate, launch checklist, content reports (S5, W1, W8, W9, SEC10, LAU1, LAU2, LAU8, LAU9) |
| `packages/core/test/complianceaccess.test.ts` | 4 | The three-person rule for compliance access |
| `packages/core/test/deploys.test.ts` | 20 | Deploy rules against a fake GitHub (DEP1–DEP7) |
| `packages/core/test/whatif.test.ts` | 10 | Preview, confirm once, discard, authorisation, expiry |
| `packages/core/test/idempotency.test.ts` | 5 | A repeated action applies once (Q4) |
| `packages/core/test/audit.test.ts` | 5 | Audit entries |
| `packages/db/test/audit-append-only.test.ts` | 4 | The database refuses to change or delete audit entries (SEC10) |
| `packages/core/test/deletion.test.ts` | 5 | Deletion requests with the seven-day undo (D6) |
| `packages/core/test/platform.test.ts` | 7 | Retention runner, incidents, cookie set, robots.txt |
| `packages/core/test/stats.test.ts` | 6 | Daily statistics with no visitor identifier (INF11, D4) |
| `packages/core/test/all.test.ts` | 1 | Every core module is in the loader |
| `packages/core/test/integration-wiring.test.ts` | 2 | Cross-domain wiring |
| `packages/storage/test/storage.test.ts` | 14 | Upload pipeline, scan gate, fair use, signed uploads (SEC4, Q6, Q9) |
| `packages/email/test/email.test.ts` | 7 | Templates, bilingual rendering, suppression, daily cap (L5, SEC1, Q6) |
| `packages/jobs/test/queue.test.ts`, `builtin.test.ts` | 13, 4 | Queue leasing, retries, schedules; backup command runner |
| `packages/shared/test/*.test.ts` (5 files) | 21 | Environment check, ids, money, time zones, SSRF guard |
| `packages/i18n/test/parity.test.ts`, `format.test.ts` | 7, 9 | Key parity; money, date and time formats (L1–L3) |
| `apps/web/test/headers.test.ts` | 12 | CSP, header set, the media-host rule, cross-site checks, cookie notice (SEC4–SEC6, LAU1) |
| `apps/web/test/action.test.ts` | 7 | The Server Action wrapper: validation, error mapping, typed input kept |

### Releases A and B

| File | Cases | Covers |
| --- | --- | --- |
| `packages/core/test/planning.test.ts` | 28 | Access and grants, team, templates and date moves, tasks in three views, delegation, overview and digest, exports, occasion deletion (A1–A5, A10–A12, D2, D6) |
| `packages/core/test/guests-rsvp.test.ts` | 13 | Children are never persons, households, guest links, replies, date polls, shared capacity under parallel requests (A6–A8, S6, SEC2, INF5) |
| `packages/core/test/contributions.test.ts` | 2 | Contribution claims, last unit (A9) |
| `packages/core/test/guestimport.test.ts` | 4 | CSV and XLSX import with preview (A13) |
| `packages/core/test/money.test.ts` | 18 | Budget, expenses, shared-cost ledger, paid facts and corrections (B1–B3) |
| `packages/core/test/suppliers.test.ts` | 11 | Suppliers, bookings, briefings, supplier link, final orders and deltas (B4, B5) |
| `packages/core/test/deliveries.test.ts` | 10 | Deliveries and returns, corrections, payment deadlines (B6, B12) |
| `packages/core/test/eventday.test.ts` | 5 | Event-day view, readiness decisions, briefing PDF (B7, B8, B11) |
| `packages/core/test/lifecycle.test.ts` | 9 | Cancel, postpone, closeout, lessons (B9, B10) |

### Release P

| File | Cases | Covers |
| --- | --- | --- |
| `packages/core/test/business-listings.test.ts` | 26 | Business accounts, team roles, picklists, moderation, badges, restriction, lapse, unclaimed listings, merges (P1–P4, P18, P23, P29, W2–W4) |
| `packages/core/test/directory.test.ts` | 18 | Seeds, rotation that payment cannot change, public pages, task link, statistics, no-ratings scan (P2, P5–P7, P31) |
| `packages/core/test/enquiries.test.ts` | 18 | Enquiry fields, limits, thread states, nudges, quotes (P8–P12, P32, P33, F5, F6) |
| `packages/core/test/drawings-seating.test.ts` | 20 | Calibration, moderation, parking, space model, seating, guest seat (V3–V11, C-01, C-08) |
| `packages/core/test/spacemodel.test.ts` | 20 | Geometry, fit checks, stages (V6, V7, C-02) |
| `packages/core/test/catalogues.test.ts` | 5 | Flower catalogues (F1, F2) |
| `packages/core/test/discovery-claims.test.ts` | 17 | Discovery, duplicates, drafts, claim invitation, objections, claims (BD1–BD7, P30, W5) |
| `packages/core/test/bizoccasions.test.ts` | 10 | Business occasions, library, branding, reports, handover (P17–P22, MCP7) |
| `packages/core/test/billing.test.ts` | 11 | The switch, notice, Stripe webhook with locally signed payloads, grace, refunds, TVA (MON1–MON4, P24–P28, PAY1–PAY5) |
| `packages/core/test/featured.test.ts` | 7 | Featured placement and notices to businesses only (P13–P16, MON5, W7) |
| `apps/web/test/monetization-off.test.ts` | 4 | No pricing or checkout route or wording while off (MON1) |
| `packages/mcp/test/mcp.test.ts`, `tools.test.ts`, `jobs.test.ts` | 16, 19, 1 | Tokens, consent, scopes, every tool's access boundary, proposals only (MCP1–MCP8, SEC15) |

### Releases C, D and E

| File | Cases | Covers |
| --- | --- | --- |
| `packages/core/test/programme.test.ts` | 9 | Programme, cues, change notices once (C-03, C-10) |
| `packages/core/test/stationery.test.ts` | 12 | The stationery kit and versions (C-04) |
| `packages/core/test/menus.test.ts` | 5 | Menus, choices, quantities (C-05) |
| `packages/core/test/publicpage.test.ts` | 10 | Public page, registration, waiting list (C-06) |
| `packages/core/test/requests.test.ts` | 6 | Private requests and their grant (C-07) |
| `packages/core/test/printpack.test.ts` | 9 | QR codes and print PDFs (C-09) |
| `packages/core/test/gifts.test.ts` | 5 | Gift estimator (C-11) |
| `packages/core/test/promotion.test.ts` | 6 | Promotion texts and assets (C-12) |
| `packages/core/test/arrangements.test.ts` | 6 | Arrangement designer (C-13, F3, F4) |
| `packages/core/test/aitext.test.ts` | 9 | AI wording: off by default, monthly limit, what leaves the server (INF7) |
| `packages/core/test/travel.test.ts` | 12 | Itinerary, subgroups, packing, transport, rooms, settlement (D-01…D-05) |
| `packages/core/test/operate.test.ts` | 13 | Rehearsal, check-in, offline capture, sustainability (E-01…E-04) |

Test files added after the last full run (security review, help centre) are not listed here;
see `13-implementation-log.md` and `12-security-review.md`.

## What is NOT covered

Read this section before deciding the product is ready for real users.

| Gap | What it means | PRD |
| --- | --- | --- |
| **No browser end-to-end tests** | Nothing drives a real browser through sign-in, creating an occasion, a guest replying, and so on. The tests prove the rules and the smoke test proves pages are served; nothing proves that buttons, forms and screens work together. Pages were looked at as screenshots during the build, not tested | Q1, A12 |
| **No accessibility audit** | No automated scan (axe) and no manual pass with a screen reader or keyboard only. The components were built to WCAG rules; that is intent, not evidence | Q2, LAU9 |
| **No check at 320 px or on real phones** | No current or previous iOS Safari or Android Chrome device has opened the app. Dragging tables, the installable app, offline capture and camera QR scanning are untested on a device | Q1, Q8, Q10, B11, E-02, E-03 |
| **No performance measurement** | The guest-page targets (content in 2.5 s, interaction in 200 ms) have never been measured | Q3 |
| **No load test** | The qualification targets (1,000 attendees, 50 concurrent operators, 10,000 tasks per occasion) have never been tried | Q5 |
| **No external service** | No real email has been sent; no file stored in an S3 bucket; no malware scanner called; no Stripe, invoicing or AI provider contacted; no ONRC data read | INF2, INF3, SEC4, P24, PAY3, INF7, BD1 |
| **The migration is not what the tests use** | The test harness builds its database from the schema files directly. The committed migration was applied once by hand to an empty database (167 tables) | — |
| **Workflows, images, Terraform, deploy and backup scripts** | Never run. The first staging deployment is their test | DEP1–DEP7, INF10 |
| **Coverage percentages** | The plan asked for coverage thresholds; none is measured | — |
| **No penetration test** | The security review in `12-security-review.md` is a code review, not an external test | LAU4 |

## Manual checklist, release by release

For a non-developer, in the running app (see the root `README.md` to start it). Use two
browsers — or one normal and one private window — so you can be two people at once. Tick each
line only if you saw the expected result.

### Before you start

- [ ] The app opens at <http://localhost:3000> and shows the sign-in page in Romanian.
- [ ] The public site opens at <http://localhost:3001>. Open the browser's developer tools →
      *Application* → *Cookies*: there are none.

### Release 0 — accounts and safety

1. [ ] Ask for a code with an email address. **Expect:** a screen asking for six digits. Read
       the code from the database (README step 6) and enter it. **Expect:** you are signed in
       and see "Ocazii".
2. [ ] Sign out. Ask for a code for an address that has never been used. **Expect:** exactly
       the same screen and wording as for a known address.
3. [ ] Enter a wrong code five times. **Expect:** the code stops working and you are asked to
       request a new one, with no hint about whether the account exists.
4. [ ] Ask for a code four times in a row for one address. **Expect:** the fourth is refused
       with a time to try again.
5. [ ] On the sign-in page choose the anonymous account. **Expect:** a generated username, a
       password you choose, ten recovery codes shown once with a clear warning.
6. [ ] *Cont* → sessions. **Expect:** this device listed. Sign in from the second browser,
       press "sign out everywhere" in the first. **Expect:** the second browser is signed out
       on its next click.
7. [ ] *Cont → Verificare în doi pași*: turn it on with an authenticator app. Sign out and in.
       **Expect:** a second step asking for the app's code.
8. [ ] Switch the language to English. **Expect:** all wording changes; no data changes.
9. [ ] *Cont → Șterge contul* (use a throwaway account). **Expect:** it asks for a fresh code,
       says what is kept and for how long, and offers an undo for seven days.

### Release A — plan and invite

1. [ ] Create an occasion (a wedding, a date eight months away). **Expect:** no payment or
       plan choice anywhere.
2. [ ] Start it from the wedding template. **Expect:** tasks spread before the date.
3. [ ] *Setări* → move the date by a month. **Expect:** a "Ce-ar fi dacă?" preview listing the
       tasks that move. Discard: nothing changed. Do it again and confirm: dates moved.
4. [ ] *Sarcini*: open the list, the board and the calendar. **Expect:** the same tasks in each;
       changing a status in one shows in the others.
5. [ ] *Echipă și roluri*: invite the second browser's account as "Ajutor" without the finance
       grant. Accept in the second browser. **Expect:** that person does not see *Buget*.
6. [ ] Delegate a task to them. **Expect:** it is an offer. Decline it with a reason in the
       second browser. **Expect:** it returns to you.
7. [ ] *Invitați*: add a household of two adults with an email; copy its link. Open the link in
       a private window. **Expect:** only that household's invitation — no other guest.
8. [ ] Reply yes for two adults and "+2 copii". **Expect:** only a number is asked about
       children. Type a child's name and age in a free-text answer. **Expect:** a warning.
9. [ ] Set the capacity to exactly the places taken plus one; add two more households and
       reply yes for both at almost the same moment in two windows. **Expect:** one succeeds,
       the other is told the last place was taken.
10. [ ] *Sondaj de date*: add two dates, vote from a guest link, confirm one. **Expect:** votes
        did not change the places taken.
11. [ ] *Cine ce aduce*: add a need of 2 units, claim both from one guest link, try to claim
        from another. **Expect:** refused.
12. [ ] *Invitați → import*: upload a small CSV with one existing and one new household.
        **Expect:** column mapping, then a preview marking one as skipped/changed and one as
        new; nothing happens until you confirm.
13. [ ] *Tipărire și export*: download the tasks CSV. **Expect:** only this occasion's data.

### Release B — budget and deliver

1. [ ] *Buget*: add categories with estimates; leave one estimate empty. **Expect:** it shows
       "necunoscut", not 0.
2. [ ] Add an expense with a receipt photo, approve it, then mark it paid. **Expect:** approval
       and payment are separate. Try to change the paid amount. **Expect:** only a correction
       with a reason is offered, and the history shows it.
3. [ ] *Cheltuieli comune*: add an entry paid by one person for three. **Expect:** balances per
       person that add up to zero.
4. [ ] *Furnizori*: add a supplier, move the booking through its states, publish a briefing,
       open the supplier link in a private window and acknowledge it. **Expect:** the link
       shows only this booking; a changed briefing is a new version.
5. [ ] Fix a final order; then change a guest's reply. **Expect:** the order is unchanged and a
       "schimbări după comanda finală" notice appears.
6. [ ] *Livrări și retururi*: record 10 received of 12. Try to edit it. **Expect:** only a
       correction with a reason.
7. [ ] Add a payment deadline in the past. **Expect:** it appears as overdue on the overview
       for you, and not for the helper without the finance grant.
8. [ ] *Ziua evenimentului*: move tasks between Ready, Running, Waiting, Done. **Expect:** the
       same tasks as in *Sarcini*.
9. [ ] Record a readiness decision. **Expect:** it asks for evidence and cannot be edited after.
10. [ ] *Setări* → cancel or postpone. **Expect:** a preview of everything affected first.
11. [ ] Download the briefing PDF. **Expect:** a readable PDF with Romanian diacritics.
12. [ ] In Chrome, use "Install app". **Expect:** it installs; with the network off it shows
        the offline page rather than an error. *(Also try on a real phone.)*

### Release P — businesses, directory, console

You need two staff accounts (README step 7) and a business account.

1. [ ] *Afacere*: create a business and a listing choosing categories and localities from
       lists. **Expect:** no free-text place field. Submit it.
2. [ ] As a staff moderator, *Moderare*: approve it. **Expect:** it appears in *Firme*. Edit the
       listing as the business. **Expect:** the old version stays live until approved.
3. [ ] Make the business owner's account a staff moderator and try to approve their own
       listing. **Expect:** refused.
4. [ ] Open the same category and county on two different days (or compare with a colleague).
       **Expect:** a different order; nothing labelled "Promovat".
5. [ ] From an occasion, send an enquiry to the listing. **Expect:** pre-filled, editable
       fields; your email shared only if you tick the box; the supplier appears in *Furnizori*.
6. [ ] As the business, reply and attach a PDF as a quote; accept it as the planner.
       **Expect:** it lands in the supplier record.
7. [ ] Venue listing: upload a drawing, try to mark tables before calibrating. **Expect:**
       refused until two points with a known distance are set.
8. [ ] *Comercial* in the console. **Expect:** monetisation OFF, a free-phase dashboard, no
       price a business can pay. As the business, open *Plan*. **Expect:** the free phase, no
       checkout.
9. [ ] With one staff member only, request a staff role change. **Expect:** it waits; nothing
       happens until a second person approves. The requester cannot approve it.
10. [ ] *Jurnal audit*. **Expect:** your actions listed, with filters and an export, and no way
        to edit.
11. [ ] *Cont → Asistenți AI*: create a read-only token. **Expect:** shown once; later only its
        last four characters; a plain warning about what data can leave.
12. [ ] *Descoperire*: add a source of kind "page" for a business website you control and run
        it. **Expect:** a draft, not a public listing, until a moderator approves.

### Releases C, D, E

1. [ ] *Planul sălii* and *Așezare la mese*: add tables, drag one, then move another using the
       on-screen controls only. **Expect:** both work; a table without dimensions is
       "necunoscut" and left out of the fit check.
2. [ ] Publish the seating. **Expect:** the guest link shows that household's table only; when
       unpublished, nothing.
3. [ ] *Program*: add moments, mark one visible to guests, change its time. **Expect:** the
       guest link shows the change marker once.
4. [ ] *Invitații*: choose a design, save a version, mark the proof checked, download the PDF.
5. [ ] *Meniu*: add dishes with a choice; choose from a guest link. **Expect:** counts only.
6. [ ] *Pagina publică*: publish, register from a private window, fill the capacity, register
       again. **Expect:** a waiting-list position.
7. [ ] Send a private dietary request from a guest link. **Expect:** visible only to people with
       the private-requests grant.
8. [ ] *Tipărire și export*: QR labels and table cards. **Expect:** print-ready PDFs; scanning a
       QR opens that household's invitation.
9. [ ] *Calculator dar*. **Expect:** a range, labelled as a cultural guide; nobody else sees it.
10. [ ] *Itinerar și cazare*: add a flight across time zones. **Expect:** local times at each
        end. Assign people to a room with fewer beds than people. **Expect:** refused.
11. [ ] *Repetiție și sosiri*: run the rehearsal. **Expect:** conflicts listed, nothing changed.
        Check a household in, then try to un-check. **Expect:** a correction with a reason.
12. [ ] On a phone, switch to aeroplane mode, record an arrival, reconnect. **Expect:** it syncs
        once.

Write down anything that did not match, with the step number and a screenshot.

## Evidence that people must gather

None of this can come from the repository.

| Gate | Evidence |
| --- | --- |
| **M0** | On the deployed sites: free activation works; the public site sets no cookie and loads no third-party script (browser developer tools, or `check-public-d1.mjs` against the deployed files) |
| **M1** | Pilot notes for four journeys (solo trip, birthday with delegated set-up, wedding catering change, public event with registration): five users each, at least four completing unaided. 20 published guides. Notes of 10 business interviews; 5 agreements to list; 3 written statements of willingness to pay |
| **M2** | A full test-mode run with real sandbox accounts: checkout, webhook, grace, refund, fiscal invoice with TVA through e-Factura. Published business terms |
| **M3** | Counts of approved listings per promoted category and county (console → *Director*); monthly enquiry numbers; the recorded decision on monetisation |
| **M4** | Approved terms, tax set-up and keys; the 60-day notice; 30 days without a wrong feature grant |
| **M5** | Three months of income and cost figures |
| **LAU4** | The penetration-test report and the fixes |
| **LAU5** | A restore performed from a real backup within 4 hours; an alert received by a person |
| **LAU9** | An accessibility evaluation (automated scan plus a manual keyboard and screen-reader pass at 320 px) |
| **Devices** | The manual checklist above repeated on a current and a previous iPhone (Safari) and Android phone (Chrome) |
| **Load** | A load test on staging against the Q5 targets, and a measurement of the guest page against Q3 |

## Before any release tag

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass; CI is green on the commit.
- [ ] `node scripts/check-headers.mjs` and `node scripts/smoke.mjs` pass.
- [ ] `pnpm audit --audit-level=high` is clean.
- [ ] The manual checklist was run for the areas that changed, on a phone as well.
- [ ] No open finding of high or critical severity in `12-security-review.md`.
- [ ] Any migration that older code cannot live with is listed in `scripts/deploy/irreversible.txt`.
- [ ] `09-traceability.md` and `CHANGELOG.md` are updated.
- [ ] On staging: deploy the tag, then roll back to the previous one and check the data is intact.
