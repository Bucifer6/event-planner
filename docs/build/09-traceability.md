# 09 — Traceability: every PRD requirement, as built

**What this is, in plain English.** The checklist for judging whether the product is complete.
Every requirement id in the product document (`../PRD.md`, v4.9) has a row here saying
whether it was built, where in the code it lives, and which automated test covers it. Where
something is missing, the row says what. The summary of everything that is not simply "Built"
is in [the gap list](#the-gap-list) at the end — read that first if you have five minutes.

**How to read the status column.**

| Status | Means |
| --- | --- |
| **Built** | The code exists and an automated test covers the rule. Tests ran on the build machine against PostgreSQL 16 (63 files, 681 tests at the last full run, 14 November 2026) |
| **Built, not verified in production** | The code exists and its logic is tested, but it depends on something that has never been run for real: a browser on a phone, a real email provider, object store or scanner, GitHub, a deployed server |
| **Partly** | Some of the requirement is missing; the row says what |
| **Not built** | Nothing implements it |
| **Operator-owned** | It is a decision, a procedure or evidence that people must provide; the software can at most record it |

**Nothing in this repository has been deployed.** "Built" therefore never means "seen working
in production". Test file names are relative to the package's `test/` folder: `core/…` is
`packages/core/test/…`, `web/…` is `apps/web/test/…`, and so on. "No automated test found"
means a search of the test files for the id and for the behaviour found nothing.

## Principles (PRD §5)

The eight principles are enforced as the invariants listed, with code and test, in
[`README.md`](README.md#the-twelve-invariants-and-where-each-is-enforced).

## Release A — plan and invite

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| A1 | Built | `core/occasions` (`createOccasion`: date, range or poll); `/occasions/new`. No payment step exists | `core/planning.test.ts`; `web/monetization-off.test.ts` |
| A2 | Built | `core/templates` (seven full templates, 24 starter templates for the further kinds, + blank, offsets, re-run diff); date move is the What-if kind `occasion.moveDate` | `core/planning.test.ts` ("templates and date-relative scheduling (A2)") |
| A3 | Built | `core/tasks` (`queryTasks`, list/board/calendar views, checklist, dependencies, child tasks); `/occasions/[id]/tasks` | `core/planning.test.ts` ("one record, three views") |
| A4 | Built | `core/delegations` | `core/planning.test.ts` ("delegation by offer and acceptance") |
| A5 | Built | `core/access`, `core/members`; roles and the two grants; suggested labels for botez and nuntă (`suggestedLabelKeys`); `/occasions/[id]/team` | `core/planning.test.ts` ("occasion access", "team") |
| A6 | **Partly** | `core/guests`, `core/invitations`, `core/rsvp`; `/g/[token]`. Household reply by the lead, custom questions one per screen, children as a number only, free-text warning. **Missing:** "each person's attendance is recorded per session" — a reply stores the number of adults and children attending, not each named person, and an occasion has no separate sessions | `core/guests-rsvp.test.ts` |
| A7 | Built | `core/polls`; `/occasions/[id]/polls` | `core/guests-rsvp.test.ts` |
| A8 | Built | `core/capacity` (one conditional UPDATE decides); shared with public registration | `core/guests-rsvp.test.ts`, `core/publicpage.test.ts` (parallel last place) |
| A9 | Built | `core/contributions` | `core/contributions.test.ts` |
| A10 | Built, not verified in production | `core/overview`, `core/digest`; jobs `digest.plan`, `digest.send`. Digest delivery needs a real email provider | `core/planning.test.ts` ("overview and daily digest") |
| A11 | Built | `occasions.purpose`, `occasions.priorities`, `tasks.priority_index`; settings page | `core/planning.test.ts` (brief fields) |
| A12 | **Partly** | Built to the rule through `@ed/ui` (48 px controls) and a tap path for every drag (`apps/web/components/plan/SeatingEditor.tsx`). **Missing:** any automated or device check at phone width | No automated test found |
| A13 | Built | `core/guestimport` (CSV and XLSX, mapping preview, duplicates, diff, What-if `guests.import`) | `core/guestimport.test.ts` |
| Exports (A) | Built | `core/exports` and the registry; `/occasions/[id]/print` | `core/planning.test.ts` ("exports (A12, P16)") |

## Release B — budget and deliver

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| B1 | Built | `core/budget`; five amounts kept separate | `core/money.test.ts` |
| B2 | Built | `core/expenses`; receipts through `@ed/storage`; database guard for paid expenses | `core/money.test.ts` |
| B3 | Built | `core/ledger`; per-currency balances and settlement | `core/money.test.ts` |
| B4 | Built | `core/suppliers`, `core/bookings`, `core/briefings`; supplier link `/s/[token]` | `core/suppliers.test.ts` |
| B5 | Built | `core/orders`; database trigger writes `order_deltas` | `core/suppliers.test.ts`, `core/menus.test.ts` |
| B6 | Built | `core/deliveries`; corrections for received and returned quantities | `core/deliveries.test.ts` |
| B7 | Built | `core/eventday`; `/occasions/[id]/day` | `core/eventday.test.ts` |
| B8 | Built | `core/readiness`; append-only guard | `core/eventday.test.ts` |
| B9 | Built | `core/closeout` (What-if `occasion.cancel`, `occasion.postpone`), `core/lifecycle` registry | `core/lifecycle.test.ts` |
| B10 | Built | `core/closeout` (`getCloseout`, lessons), `/occasions/[id]/settings/closeout` | `core/lifecycle.test.ts` |
| B11 | Built, not verified in production | `apps/web/app/manifest.ts`, `apps/web/public/sw.js`, `/offline`; briefing PDF `core/briefingpdf`. Installing and the offline shell were not tried on a phone | `core/eventday.test.ts` (briefing PDF); no test of installation |
| B12 | Built | `core/payments` (deadlines, finance-only digest section, What-if `payment.move`) | `core/deliveries.test.ts` (payment deadline cases) |

## Release P — directory and listings

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| P1 | Built | `core/business`, `core/listings`; limits on listings, categories, localities, counties | `core/business-listings.test.ts` |
| P2 | Built | Seeds `packages/db/src/seed/categories.ts`, `geography.ts`; picklists only | `core/business-listings.test.ts`, `core/directory.test.ts` |
| P3 | Built | `core/moderation`; approver must not be a member; live version stays up | `core/business-listings.test.ts`, `core/catalogues.test.ts` |
| P4 | Built | `core/business` (`recordFactCheck`, `getBusinessBadges`); a constraint allows only two badge kinds. The ONRC check is a staff member recording what they saw, not an automated lookup | `core/business-listings.test.ts` |
| P5 | Built | `core/directory` (`organicOrder`, daily rotation, no input from payment) | `core/directory.test.ts` |
| P6 | Built | `/directory`, `/directory/[category]/[county]`, `…/[locality]`, pre-filled from an occasion (`getDirectoryPrefill`). These pages are public but live on the app domain, not on the static public site | `core/directory.test.ts` |
| P7 | Built | `core/directory` (`suggestDirectoryLink`, dismiss per account or occasion) | `core/directory.test.ts` |

## Venue drawings

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| V1 | Built, not verified in production | `core/drawings`; PNG, JPG, PDF. A PDF needs poppler's `pdftoppm` on the server to be calibrated | `core/drawings-seating.test.ts` |
| V2 | Built | `core/drawings` (`saveMarkings`: areas, table inventory) | `core/drawings-seating.test.ts`, `core/spacemodel.test.ts` |
| V3 | Built | Moderation kind `drawing` | `core/drawings-seating.test.ts` |
| V4 | Built | `core/seating` (`attachVenueSpace`; What-if `space.updateDrawing`); immutable `drawing_versions` | `core/drawings-seating.test.ts` |
| V5 | Built | What-if `space.addCustomTable`; shown as "masă proprie" | `core/drawings-seating.test.ts` |
| V6 | Built | `core/fitcheck` | `core/drawings-seating.test.ts`, `core/spacemodel.test.ts` |
| V7 | Built | `core/drawings` (`calibrateSpace`, `assertCalibrated`) | `core/drawings-seating.test.ts`, `core/spacemodel.test.ts` |
| V8 | Built | Markings: points of interest and fixtures; fixtures take part in fit checks | `core/spacemodel.test.ts`, `core/drawings-seating.test.ts` |
| V9 | Built | `core/seating` (`getGuestSpaceView`); guest section `spaceView` | `core/drawings-seating.test.ts` |
| V10 | Built | `core/drawings` (`submitParking`, `parkingView`); moderation kind `parking` | `core/drawings-seating.test.ts` |
| V11 | Built | `core/drawings` (`drawnParkingSpaces`; a mismatch is shown as unknown) | `core/drawings-seating.test.ts` |

## Flower catalogues and arrangement designer

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| F1 | Built | `core/catalogues`; moderation kind `catalogue` | `core/catalogues.test.ts` |
| F2 | Built | `listPublicCatalogues`; shown on the listing | `core/catalogues.test.ts` |
| F3 | Built | `core/arrangements`, `core/arrangementkit`; `/occasions/[id]/flowers` | `core/arrangements.test.ts` |
| F4 | Built | Upload with notes in the quote request (`sendQuoteRequest`) | `core/arrangements.test.ts` |
| F5 | Built | `core/enquiries` (`sendQuoteRequest`, `buildQuoteRequestPayload`) | `core/enquiries.test.ts`, `core/arrangements.test.ts` |
| F6 | Built | `core/enquiries` (`acceptQuote`, `getQuoteLink`), `quote_links` versions | `core/enquiries.test.ts`, `core/arrangements.test.ts` |

## MCP — external AI assistants

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| MCP1 | Built | `packages/mcp/src/tokens.ts`; `/account/assistants`; endpoint `/mcp`; 30-day inactivity job | `mcp/mcp.test.ts` |
| MCP2 | Built | Read tools call core with the token's account; read-only transaction | `mcp/mcp.test.ts`, `mcp/tools.test.ts` |
| MCP3 | Built | Propose tools create What-if previews only | `mcp/tools.test.ts`, `core/whatif.test.ts` |
| MCP4 | Built | Consent per token (`acceptMcpConsent`, `MCP_CONSENT_DATA_CLASSES`) | `mcp/mcp.test.ts` |
| MCP5 | Built | Label "creat cu un asistent extern" on previews and resulting records | `mcp/mcp.test.ts`, `mcp/tools.test.ts` |
| MCP6 | Built | Fixed catalogue with a deny-list of names; per-token call limits (60 a minute, 2,000 a day by default). The PRD speaks of the account's fair-use budget; the code uses its own per-token limits | `mcp/mcp.test.ts`, `mcp/tools.test.ts` |
| MCP7 | **Partly** | A business member's personal token reaches the business's occasions through their team membership, and stops at handover because that membership ends (`revokeBusinessMcpTokens` also exists). **Missing:** a way to create a token scoped to the business — `mcp_tokens.business_id` is never set and there is no screen for it | `mcp/tools.test.ts`, `core/bizoccasions.test.ts` |
| MCP8 | Built | `MCP_TOOL_CATALOGUE` (23 tools), versioned, served by the endpoint. It holds the PRD's 16 tools plus `whoami`, `list_occasions`, `list_households`, `list_pending_proposals`, `list_suppliers`, `get_seating_summary`, `list_directory_filters` | `mcp/tools.test.ts` |

## Admin console

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| W1 | Built | `/console`; `core/staff` (`getDashboard`, counters — counts only). Revenue is empty while monetisation is off; health is the worker's queue metrics | `core/staff.test.ts` |
| W2 | Built | `/console/moderation`; waiting time against `moderation.targetHours` | `core/business-listings.test.ts` |
| W3 | Built | `/console/businesses`; `setBusinessStatus`, `suspendListing`; in-app notice | `core/business-listings.test.ts`, `core/bizoccasions.test.ts` |
| W4 | Built | `/console/directory`; `core/geography` (create, rename, merge, retire, publish) | `core/business-listings.test.ts`, `core/directory.test.ts` |
| W5 | Built | `/console/discovery`; batches with one reason | `core/discovery-claims.test.ts` |
| W6 | Built | `/console/commercial`: the switch, its history, the free-phase dashboard; prices, subscriptions and refunds are dormant | `core/billing.test.ts`, `web/monetization-off.test.ts` |
| W7 | **Partly** | `/console/communications`: notices to businesses, never to planner-entered contacts (`core/comms`). **Missing:** publishing the "For businesses" page and the public guides from the console — they are static pages of `apps/public` whose text is in `packages/i18n/messages/*/site.json` and `guides.json`, changed by a code release | `core/featured.test.ts` (notice recipients) |
| W8 | Built | `/console/access`, `/console/audit` (+ CSV export), `/console/compliance` (three-person rule) | `core/staff.test.ts`, `core/complianceaccess.test.ts` |
| W9 | Built | `core/approvals`, `isSingleOperatorMode`; `/console/approvals` | `core/staff.test.ts`, `core/billing.test.ts`, `core/discovery-claims.test.ts` |
| W10 | Built, not verified in production | `/console/deploys`; `core/deploys`. Never connected to a real GitHub repository | `core/deploys.test.ts` (fake GitHub) |

## Deployments

All seven are **Built, not verified in production**: the rules are in
`packages/core/src/deploys.ts` and tested with a fake GitHub (`core/deploys.test.ts`); the
workflow, images and scripts have never run.

| Id | Note |
| --- | --- |
| DEP1 | GitHub App installation token minted server-side; never sent to a browser. The App itself, and the private organisation repository, are operator-owned |
| DEP2 | Live release, tags with CI status, commits between; deploy by tag only |
| DEP3 | Approval action `deploy.production`; emergency path for a security administrator, audit-marked |
| DEP4 | **Deviation from the PRD:** the pipeline runs in GitHub Actions (`.github/workflows/deploy.yml`), not as a worker job, because the worker cannot replace the release it is part of. Order: build → backup → migrate → switch → health → automatic rollback |
| DEP5 | One-person rollback; `scripts/deploy/rollback.sh` refuses when `irreversible.txt` lists a release in between |
| DEP6 | `deploys` table and audit actions; one deploy at a time |
| DEP7 | The console refuses a tag without a green `release-ci`; **branch and tag protection are GitHub settings the operator must switch on** |

## Business discovery

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| BD1 | **Partly** | `core/discovery`: sources `business_page` (a business's own published page) and `licensed_dataset` (a file the operator supplies) work. **Missing:** the ONRC source is an adapter seam (`registerOnrcAdapter`); nothing in the repository talks to ONRC | `core/discovery-claims.test.ts` |
| BD2 | Built | `discovery_drafts`; `createUnclaimedListing` only on approval | `core/discovery-claims.test.ts`, `core/business-listings.test.ts` |
| BD3 | Built | `dedupeKeysFor`; duplicates queued for a person | `core/discovery-claims.test.ts` |
| BD4 | Built | Approval by a listing moderator; label "Adăugat de EventDesk — nefiind revendicat încă" | `core/discovery-claims.test.ts` |
| BD5 | Built, not verified in production | One claim invitation, only to a published email (`sendClaimInvitation`) | `core/discovery-claims.test.ts` |
| BD6 | Built | `submitObjection`, `decideObjection`; 30-day due date; suppression of removed businesses | `core/discovery-claims.test.ts` |
| BD7 | Built | Sources with rate limit and on/off switch; `discovery_runs` | `core/discovery-claims.test.ts` |

## Enquiries, claims and listing statistics

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| P8 | Built | `core/enquiries` (`sendEnquiry`, `getEnquiryPrefill`); `/directory/listing/[id]/enquire` | `core/enquiries.test.ts` |
| P9 | Built | `emailShared` only when ticked | `core/enquiries.test.ts` |
| P10 | Built | `findOrCreateSupplierForListing`, `ensureBooking` | `core/enquiries.test.ts`, `core/suppliers.test.ts` |
| P11 | Built | 10 per occasion, 30 per account per day; close and report | `core/enquiries.test.ts` |
| P12 | Built | Quote PDF on a message; `acceptQuote` | `core/enquiries.test.ts` |
| P29 | Built | Unclaimed listings: label, public contact route, no enquiries or uploads | `core/business-listings.test.ts`, `core/directory.test.ts`, `core/enquiries.test.ts` |
| P30 | Built | `core/claims`; code to the published address or a moderator's recorded check; second-person approval `listing.claim`; `/claim/[listingId]` | `core/discovery-claims.test.ts` |
| P31 | Built | `core/listingstats`; shown from 10 answered enquiries; no ratings anywhere (source-scan test) | `core/directory.test.ts`, `core/enquiries.test.ts` |
| P32 | Built, not verified in production | Jobs `enquiries.notify-arrival`, `enquiries.nudge-48h`; needs a real email provider | `core/enquiries.test.ts` |
| P33 | Built | Thread states; re-send once after 7 days | `core/enquiries.test.ts` |

## Featured placement (dormant)

P13, P14, P15, P16 — **Built, dormant.** `packages/core/src/featured.ts` returns no cards while
monetisation is off; at most three cards, random, labelled; `expectedShare` is
min(1, 3 ÷ (n + 1)); Featured content is absent from plans, guest pages, emails and exports.
Tests: `core/featured.test.ts`; `core/planning.test.ts`, `core/printpack.test.ts`,
`core/eventday.test.ts`, `mcp/tools.test.ts` for P16.

## Business plan

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| P17 | Built | `core/bizoccasions` (`createBusinessOccasion`) | `core/bizoccasions.test.ts` |
| P18 | Built | `core/business` (`canManageRole`) | `core/business-listings.test.ts`, `core/bizoccasions.test.ts` |
| P19 | Built | `core/library` | `core/bizoccasions.test.ts` |
| P20 | Built | `saveBranding`, `getOccasionBranding` (accent colour is checked for readable contrast) | `core/bizoccasions.test.ts` |
| P21 | Built | `getBusinessReport`, `recordAssetUse` (daily totals) | `core/bizoccasions.test.ts` |
| P22 | Built | `core/handover` (What-if `bizoccasion.handover`); history kept in `occasion_handovers` | `core/bizoccasions.test.ts` |
| P23 | Built | `isBusinessLapsed`, `assertBusinessCanCreate`; library links keep files readable | `core/business-listings.test.ts`, `core/bizoccasions.test.ts`, `core/billing.test.ts`, `core/catalogues.test.ts` |

## Billing, monetisation switch and payments

Everything here is switched off. "Dormant" means the code and its tests exist; none of it has
been run against Stripe, an invoicing provider or ANAF.

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| P24 | Built, dormant — not verified against Stripe | `core/billing` (`handleStripeWebhook`, signature check); `/api/webhooks/stripe` | `core/billing.test.ts`, `web/monetization-off.test.ts` |
| P25 | Built, dormant | 14 days of grace; cancel at period end; `billing.sweep` | `core/billing.test.ts` |
| P26 | Built, dormant | `requestRefund` + approval `billing.refund` | `core/billing.test.ts` |
| P27 | — | Superseded by MON1 in the PRD | — |
| P28 | Built, dormant | 60-day notice; reminders at 60, 30 and 7 days; permanent free tier (`PERMANENT_FREE_TIER`) | `core/billing.test.ts` |
| MON1 | Built | No pricing or checkout reachable; the business plan page shows the free phase | `web/monetization-off.test.ts`, `core/billing.test.ts` |
| MON2 | Built | `core/monetization`; approvals `monetization.enable` / `disable`; history | `core/billing.test.ts` |
| MON3 | Built, dormant | Prices from the setting `billing.prices` (placeholders 199 / 1.990 / 149 RON) | `core/billing.test.ts` |
| MON4 | **Partly** | The switch refuses without a recorded acceptance (`recordBillingAcceptance`). **Missing:** the acceptance itself — a real test-mode run of Stripe, invoicing and the TVA position — which is the operator's evidence for gate M2 | `core/billing.test.ts` |
| MON5 | Built | Featured provider returns nothing while off | `core/featured.test.ts`, `core/directory.test.ts`, `mcp/tools.test.ts` |
| PAY1 | **Partly** | Checkout is Stripe's hosted page (`createCheckoutSession`); the order of wallet buttons is left to Stripe through `STRIPE_PAYMENT_METHOD_CONFIGURATION`. Never seen working | `core/billing.test.ts` (request shape only) |
| PAY2 | Built | No bank-app integration exists | `core/billing.test.ts` |
| PAY3 | **Partly** | `core/invoicing`: provider registry, job `invoicing.issue`, webhook `/api/webhooks/invoicing`. **Missing:** an adapter for SmartBill, Oblio or any other provider, and any e-Factura transmission | `core/billing.test.ts` (with a test provider) |
| PAY4 | Built | `priceWithTva`; prices stored excluding TVA; 199 + 21% = 240,79 | `core/billing.test.ts` |
| PAY5 | Operator-owned | One processor (Stripe) is coded; the decision is revisited at M2 | — |

## Later releases (C, D, E)

The PRD lists these as rows without ids; the ids are the work items of
`08-releases-C-D-E.md`.

| Id | PRD row | Status | Where | Test |
| --- | --- | --- | --- | --- |
| C-01 | Layouts and seating on the space model, drag with a tap path | Built, not verified in production | `core/seating`, `core/spacemodel`; `SeatingEditor.tsx` (drag was not tried on a phone) | `core/drawings-seating.test.ts`, `core/spacemodel.test.ts` |
| C-02 | Fit checks at every stage of the meal | Built | `core/fitcheck`, `meal_stages`, `applyStage` | `core/spacemodel.test.ts`, `core/drawings-seating.test.ts` |
| C-03 | Programme, cue list, performer briefings | Built | `core/programme` | `core/programme.test.ts` |
| C-04 | Stationery designer with proofs and print PDF | Built, not verified in production | `core/stationery`, `core/stationerykit`, `core/stationerycollections` (the invitation collections: 64 more designs in five ranges, per-occasion palettes, starter wordings). In the container image the Bodoni and Hanken `.ttf` files may not be present, in which case the PDF falls back to DejaVu (`STATIONERY_FONT_DIR`) | `core/stationery.test.ts` |
| C-05 | Menus, meal choices, quantities | Built | `core/menus` | `core/menus.test.ts` |
| C-06 | Public event page, registration, waiting list, conditional questions | Built | `core/publicpage`, `core/registrations`; `/e/[slug]` | `core/publicpage.test.ts` |
| C-07 | Private requests; accessible guest journey | Built | `core/requests`, `core/guestevent` | `core/requests.test.ts` |
| C-08 | Guest seat, only once published | Built | `core/seating` (`publishSeating`, `getGuestSeat`) | `core/drawings-seating.test.ts` |
| C-09 | Print pack with QR | Built | `core/printpack`, `core/qr` | `core/printpack.test.ts` |
| C-10 | Venue link; programme change notices, once per change | Built, not verified in production | `core/guestevent`, `core/programme` (job `programme.notify`) | `core/programme.test.ts` |
| C-11 | Gift estimator | Built | `core/gifts` (placeholder table the user can change) | `core/gifts.test.ts` |
| C-12 | Promotion exports | Built | `core/promotion` | `core/promotion.test.ts` |
| C-13 | Visual arrangement designer | Built | `core/arrangements`, `core/arrangementkit` | `core/arrangements.test.ts` |
| D-01 | Itinerary across time zones, booking import | Built | `core/itinerary` (What-if `itinerary.import`) | `core/travel.test.ts` |
| D-02 | Subgroups and optional activities | Built | `core/subgroups` | `core/travel.test.ts` |
| D-03 | Packing lists | Built | `core/packing` | `core/travel.test.ts` |
| D-04 | Transport legs and rooms | Built | `core/transport`, `core/rooms` | `core/travel.test.ts` |
| D-05 | Currencies and settlement | Built | `core/subgroups` (`getTripSettlement`), `core/ledger` | `core/travel.test.ts` |
| E-01 | Rehearsal | Built | `core/rehearsal` (reads only) | `core/operate.test.ts` |
| E-02 | QR check-in and guest-flow estimates | Built, not verified in production | `core/checkin`; camera scanning in `CheckInBoard.tsx` was not tried on a device | `core/operate.test.ts` |
| E-03 | Limited offline capture | Built, not verified in production | `core/offline`; `apps/web/components/offline`; service worker not exercised on a device | `core/operate.test.ts` |
| E-04 | Sustainability goals | Built | `core/sustainability` | `core/operate.test.ts` |

## Sign-in and security

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| S1 | Built, not verified in production | `packages/auth/src/codes.ts`; needs a real email provider to deliver | `auth/auth.test.ts` |
| S2 | **Partly** | TOTP and recovery codes built (`packages/auth/src/totp.ts`). **Missing:** passkeys (`passkeys.ts` is a seam) | `auth/auth.test.ts` |
| S3 | Built | `packages/auth/src/sessions.ts` (30 days / 14 idle) | `auth/auth.test.ts` |
| S4 | Built | `requireFreshAuth`; `packages/auth/src/fresh.ts`. "Business purchases" are dormant | `auth/auth.test.ts`, `core/planning.test.ts`, `core/deletion.test.ts`, `core/lifecycle.test.ts`, `core/bizoccasions.test.ts` |
| S5 | Built | `core/staff` (`getConsoleAccess`, console sessions) | `core/staff.test.ts` |
| S6 | Built | `core/invitations`, `core/suppliers` | `core/guests-rsvp.test.ts`, `core/suppliers.test.ts` |
| S7 | Built | `packages/auth/src/anonymous.ts` | `auth/auth.test.ts` |
| S8 | Built | Argon2id; identical failure; recovery codes; `login-email.ts` | `auth/auth.test.ts` |
| SEC1 | Built | Same answer and timing floor; single-use codes; email wording | `auth/auth.test.ts`, `email/email.test.ts` |
| SEC2 | Built | Random tokens, hashed, revocable, expiry modes, per-link limits | `core/guests-rsvp.test.ts`, `core/suppliers.test.ts`, `core/printpack.test.ts` |
| SEC3 | Built | Session list; sign out everywhere revokes MCP tokens | `auth/auth.test.ts`, `mcp/mcp.test.ts` |
| SEC4 | Built, not verified in production | `packages/storage` (pipeline, scan gate); media host rule in `proxy.ts`. No real scanner or separate media domain was used | `storage/storage.test.ts`, `web/headers.test.ts` |
| SEC5 | Built | `apps/web/proxy.ts`, `apps/web/lib/security.ts` | `web/headers.test.ts`; `scripts/check-headers.mjs` |
| SEC6 | Built | `apps/web/lib/csrf.ts`; `packages/shared/src/ssrf.ts`; `core/fetching` | `web/headers.test.ts`, `shared/ssrf.test.ts`, `core/platform.test.ts`, `core/discovery-claims.test.ts` |
| SEC7 | Built | `ExternalLink` in `@ed/ui`; `Referrer-Policy: same-origin` | Header in `web/headers.test.ts`; no automated test found for the link attribute |
| SEC8 | Built | Hash-only storage; last four characters shown | `auth/auth.test.ts`, `mcp/mcp.test.ts`, `email/email.test.ts` |
| SEC9 | Operator-owned | Backups are encrypted with an `age` public key in `scripts/deploy/container-backup.sh`; the rotation procedure is in the runbook. Never run | — |
| SEC10 | Built | Trigger `001_audit_append_only.sql`; read-only viewer | `db/audit-append-only.test.ts`, `core/staff.test.ts` |
| SEC11 | Built | `checkPublicForm` | `core/ratelimit.test.ts`, `core/publicpage.test.ts`, `core/discovery-claims.test.ts` |
| SEC12 | Built | Cookie flags; nothing security-relevant in local storage | `auth/auth.test.ts` |
| SEC13 | **Partly** | Secrets only from the environment; boot errors print names only (`packages/shared/src/env.ts`). **Missing:** the console does not show each secret's last rotation date. The secret store is the operator's | `shared/env.test.ts` |
| SEC14 | Built | Consumed-link page offers one new code | `auth/auth.test.ts` |
| SEC15 | Built | Propose tools bounded by the account's write access; proposals record the token | `mcp/mcp.test.ts`, `mcp/tools.test.ts` |
| SEC16 | Built | Three axes, back-off, generic message; defaults changeable in the console by approval | `core/ratelimit.test.ts` |

## Privacy and data

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| D1 | Built | `apps/public` static export | `scripts/check-public-d1.mjs` (part of `pnpm build`; not a Vitest test) |
| D2 | Built | `requireMember`, `requireFinance`, private-request grant | `core/planning.test.ts`, `core/money.test.ts`, `core/requests.test.ts`, `core/suppliers.test.ts`, `core/deliveries.test.ts`, `core/guests-rsvp.test.ts` |
| D3 | Built | Enquiry is the only route; no MCP tool sends one | `core/enquiries.test.ts`, `mcp/tools.test.ts` |
| D4 | Built | `core/stats`; `stats_daily` has no identifier column | `core/stats.test.ts`, `core/directory.test.ts`, `core/bizoccasions.test.ts` |
| D5 | **Partly** | See INF6 | `core/platform.test.ts`, `core/requests.test.ts` |
| D6 | **Partly** | Seven-day undo and the retained-data statement for accounts and occasions (`core/deletion`, `core/accounts`, `core/occasions`). When an account is finally deleted its occasions go to their longest-standing project manager or are deleted with it. **Missing:** the statement says the audit log is kept 2 years while nothing ever deletes it | `core/deletion.test.ts`, `core/planning.test.ts`, `core/account-purge-occasions.test.ts` |

## Platform and quality

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| Q1 | **Partly** | A responsive web app exists. **Missing:** any test on current and previous iOS Safari and Android Chrome | Header tests only (`web/headers.test.ts`) |
| Q2 | **Partly** | Built to the rule (`@ed/ui`, contrast pairs in `16-design.md`). **Missing:** an accessibility audit and a 320 px check | No automated test found |
| Q3 | **Not verified** | No measurement of the guest-page targets exists | No automated test found |
| Q4 | Built | Unique constraints, conditional updates, `withIdempotency` | `core/idempotency.test.ts`, `core/guests-rsvp.test.ts`, `core/publicpage.test.ts`, `core/operate.test.ts`, `core/travel.test.ts`, `core/staff.test.ts` |
| Q5 | **Not verified** | No load test exists | No automated test found |
| Q6 | Built | 100 MiB per occasion, 500 emails a day per occasion, 10 AI results a month | `storage/storage.test.ts`, `email/email.test.ts`, `core/aitext.test.ts` |
| Q7 | Built | Next.js, PostgreSQL, one web service, one worker | — |
| Q8 | Built, not verified in production | `SeatingEditor.tsx`: drag with snap and collision issues, plus a tap path; `snapPosition` in `core/spacemodel` | `core/spacemodel.test.ts` (geometry only) |
| Q9 | Built | 200 MiB per business, 10 MiB per file, PNG/JPG; PDF for drawings — and also for business library files, which the PRD does not mention | `storage/storage.test.ts` |
| Q10 | Built, not verified in production | `SeatingEditor.tsx`: 44 px grip, magnified and lifted item, snap tolerance, cancel by dropping back | No automated test found |
| INF1 | Operator-owned | Domains and DNS; the split into public site, app and media origin is built | `scripts/check-public-d1.mjs`, `web/headers.test.ts` |
| INF2 | **Partly** | Pipeline, suppression list, caps and bounce webhook built (`packages/email`). **Missing:** an integration with an actual provider (`http` is a generic seam) | `email/email.test.ts` |
| INF3 | Built, not verified in production | `packages/storage` (S3 transport, signed uploads and links, counters). Tested with a local folder only | `storage/storage.test.ts` |
| INF4 | Built | 15 minutes, 5 attempts, 3 per hour, 10 per day | `auth/auth.test.ts`, `core/ratelimit.test.ts` |
| INF5 | Built, not verified in production | Lead email captured at reply; "changed since your last visit" marker | `core/guests-rsvp.test.ts`, `core/programme.test.ts` |
| INF6 | **Partly** | Sixteen retention rules (`02-data-model.md`), including the security log at 90 days. **Missing or different:** audit log never purged (PRD: 2 years); email outbox has no rule; receipts counted from deletion, not closeout | `core/platform.test.ts`, `core/lifecycle.test.ts`, `core/requests.test.ts`, `core/enquiries.test.ts` |
| INF7 | Built | `core/aitext`; provider off by default; **no AI vendor integrated** (operator's choice). The provider and model in use are written to the setting `aitext.provider`, but no console screen displays it | `core/aitext.test.ts`, `core/stationery.test.ts` |
| INF8 | Built | UTC storage; `@ed/shared/time`, `@ed/i18n/format` | `shared/time.test.ts`, `i18n/format.test.ts`, `core/travel.test.ts` |
| INF9 | Operator-owned | Hosting vendor and region | — |
| INF10 | Built, not verified in production | Jobs `backup.run`, `backup.restore-test`; `scripts/deploy/container-backup.sh`, `container-restore-test.sh`. Never run; the commands and keys are the operator's | `jobs/builtin.test.ts` (command runner only) |
| INF11 | Built | `core/stats` | `core/stats.test.ts`, `core/directory.test.ts`, `core/enquiries.test.ts` |
| INF12 | Operator-owned | Encryption at rest is described in `infra/terraform/` (not applied) | — |

## Language

| Id | Status | Where | Test |
| --- | --- | --- | --- |
| L1 | Built | `packages/i18n/messages` (75 namespaces × 2). The parity test proves the two languages match; nothing mechanically proves no string is hard-coded | `i18n/parity.test.ts` |
| L2 | Built | Account locale, `ed_lang` cookie, guest-link language | `i18n/parity.test.ts`, `core/guests-rsvp.test.ts` |
| L3 | Built | `@ed/i18n/format` | `i18n/format.test.ts` |
| L4 | Built | Romanian-first content with the "numai în română" note | `core/directory.test.ts`, `core/enquiries.test.ts` |
| L5 | Built | Bilingual templates; console Romanian-first | `email/email.test.ts` |

## Launch obligations and gates

All **Operator-owned**. The console records them (`/console/launch`, `core/compliance`; tests in
`core/staff.test.ts`); it cannot make them true.

| Id | What the software provides | What people must do |
| --- | --- | --- |
| LAU1 | Sign-up stays closed until the three documents are recorded as published; cookie notice listing exactly three cookies; legal page texts on the public site | Have the texts reviewed and adopted; record them in the console |
| LAU2 | Fields for the ANSPDCP and DPIA references | The formalities and the DPIA |
| LAU3 | — | Authenticate and warm up the sending domain |
| LAU4 | The security review (`12-security-review.md`) | Commission the external penetration test |
| LAU5 | `/api/health`, queue metrics, alert webhook, incident banner, restore procedure in the runbook | Choose the monitor and the watched channel; run a restore |
| LAU6 | "For businesses" page; Featured rules in code | Written business terms |
| LAU7 | Runbook template (`14-deploy-runbook.md` §9) | Names, phone numbers, two people on call |
| LAU8 | Content-report intake and decisions (`/report`, `/console/reports`) | The contact point and ANCOM registration |
| LAU9 | An accessibility statement page on the public site | An actual evaluation, then the statement |
| M0 | Automated side exists | Confirm on the deployed sites |
| M1–M5 | — | Pilots, interviews, sandbox acceptance, listings, notice, income (see `README.md`) |

## The gap list

Everything that is not simply "Built", in one place.

**Not built**

1. **Passkeys** as a second factor (S2). Two-step sign-in is authenticator-app only.
2. **Business-scoped assistant tokens** (MCP7): no way to create one. Business members' personal
   tokens do reach business occasions and stop at handover.
3. **Per-person, per-session attendance** (A6): replies are household counts.
4. **Publishing the "For businesses" page and guides from the console** (W7): they change by
   code release.
5. **Secret rotation dates in the console** (SEC13).
6. **Purging the audit log after 2 years** (INF6); no retention for the email outbox.

8. **Showing the AI provider and model in use on a console screen** (INF7): they are recorded
   in a setting only.

**Seams — a plug-in point exists, no real service is connected**

9. Email provider (INF2) · malware scanner (SEC4) · object store other than a local folder
   (INF3) · Stripe (P24–P26, PAY1) · fiscal invoicing and e-Factura (PAY3) · ONRC data source
   (BD1) · AI text provider (INF7).

**Never run**

10. GitHub workflows, container images, Terraform, the deploy and backup scripts, the GitHub
   App connection (DEP1–DEP7, W10, INF10, SEC9).

**Not verified**

11. No browser end-to-end suite, no accessibility audit, no performance measurement, no load
    test, no device testing (A12, Q1, Q2, Q3, Q5, Q8, Q10); the installable app, offline
    capture and camera check-in were not tried on a phone (B11, E-02, E-03).

**Operator-owned**

12. LAU1–LAU9, the gates M0–M5, INF1, INF9, INF12, SEC9, PAY5, the billing acceptance for
    MON4, branch and tag protection for DEP7, and every item in `10-operator-decisions.md`.

## Where the code differs from the PRD

Noticed while checking; none was resolved silently.

- **DEP4** — the deploy pipeline runs in GitHub Actions, not as a worker job.
- **Design language** — "Maison" replaces PRD §21 "Garden Soirée" (owner's decision).
- **A6** — household counts instead of per-person, per-session attendance.
- **INF6** — audit log kept indefinitely; receipts kept 7 years from deletion rather than from
  closeout; an account's occasions outlive the account.
- **MCP6** — per-token call limits instead of the account's fair-use budget.
- **MCP8** — 23 tools where the PRD's table lists 16; the seven extra are read tools.
- **Q9** — PDFs are also accepted for business library files.
- **P6** — the public directory pages are served by the app (`app.eventdesk.ro/directory`),
  not by the static public site.
- **Gates** — the PRD defines M0–M5; older notes in this folder said "M1–M7".
