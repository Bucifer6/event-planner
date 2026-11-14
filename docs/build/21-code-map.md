# 21 — Code map (generated)

**What this is:** an index of where everything lives, generated from the code by
`node scripts/gen-codemap.mjs`. Do not edit it by hand — change the code, then regenerate.
A test (`apps/web/test/codemap.test.ts`) fails when this file is out of date.

Start with [`AGENTS.md`](../../AGENTS.md) for the rules; use this file to find things.

## 1. Domain modules — `packages/core/src/<name>.ts` (import as `@ed/core/<name>`)

All business rules and access checks live here. "Used by" lists the web actions and
routes that import the module; "Tests" lists the test files that exercise it.

| Module | Purpose | Tables (schema file) | Web actions | Routes that import it | Tests |
| --- | --- | --- | --- | --- | --- |
| `access` | Who may see or change an occasion: membership, roles, the finance and private-request grants, business-team access. Every occasion read starts here. | — | — | `/occasions/[id]/budget/expenses/[expenseId]` `/occasions/[id]/budget` `/occasions/[id]/flowers` `/occasions/[id]/guests/import/upload` … +9 more | `bizoccasions.test.ts` `money.test.ts` `planning.test.ts` `security-review.test.ts` |
| `accounts` | The signed-in person's account: profile, display name, fresh sign-in check for sensitive actions, account deletion and purge. | `schema/accounts.ts` | `app/actions/account.ts` `app/actions/auth.ts` `app/actions/integration.ts` | `/account/delete` `/account/email` `/account` `/account/security` … +8 more | `account-purge-occasions.test.ts` `deletion.test.ts` `integration-wiring.test.ts` |
| `aitext` | AI wording suggestions for invitations and messages: provider seam, 10-per-month limit, nothing applied without the user accepting. | `schema/aitext.ts` | `app/actions/aitext.ts` | `/occasions/[id]/promotion` `/occasions/[id]/stationery` | `aitext.test.ts` |
| `all` | Imports every core module so all import-time registrations exist in every process (web, worker, tests). | — | — | — | — |
| `appearance` | The look of the whole app (Maison, Atelier, Riviera, Jardin, Studio), chosen by a platform administrator in the console. Changes appearance only. | — | `app/console/appearance/actions.ts` | `/console/appearance` | `appearance.test.ts` |
| `approvals` | Second-person approvals for irreversible staff actions; single-operator mode queues them. | — | `app/actions/console.ts` | `/console/approvals` | `billing.test.ts` `complianceaccess.test.ts` `deploys.test.ts` `discovery-claims.test.ts` … +1 more |
| `arrangementkit` | Pure, client-safe helpers for the flower arrangement designer: forms, sketch layout, indicative cost, version diff. | — | — | `/occasions/[id]/flowers` | `arrangements.test.ts` |
| `arrangements` | Flower arrangement designs and their versions, quote requests from a design, the arrangement What-if kind. | `schema/arrangements.ts` | `app/actions/arrangements.ts` | `/occasions/[id]/flowers` | `arrangements.test.ts` |
| `audit` | Writes one append-only audit row for a state change. Call it from every mutation. | — | — | — | `audit.test.ts` `idempotency.test.ts` |
| `auditview` | Staff-only reading and CSV export of the audit log. There is no way to change audit rows. | — | — | `/console/audit/export` `/console/audit` | `staff.test.ts` |
| `billing` | Dormant billing: Stripe test-mode client, signed webhook handling, subscriptions, grace and lapse, refunds, prices. Refuses everything while monetisation is off. | `schema/billing.ts` | `app/actions/billing.ts` | `/business/[businessId]/plan` `/api/webhooks/stripe` `/console/commercial` | `billing.test.ts` |
| `bizoccasions` | Occasions owned by a business: creation, team access settings, branding shown to guests, business reports. | `schema/bizoccasions.ts` | `app/actions/bizoccasions.ts` | `/business/[businessId]/branding` `/business/[businessId]/occasions/[occasionId]` `/business/[businessId]/occasions` `/business/[businessId]/reports` … +1 more | `bizoccasions.test.ts` `integration-wiring.test.ts` |
| `bookings` | A supplier booking's state, agreed amount, quote file and its recorded transitions. | — | `app/actions/suppliers.ts` | `/occasions/[id]/suppliers/[supplierId]` | `deliveries.test.ts` `eventday.test.ts` `suppliers.test.ts` |
| `briefingpdf` | The downloadable occasion briefing PDF and the shared PDF toolkit (fonts, colours, margins) other PDFs reuse. | — | — | — | `eventday.test.ts` |
| `briefings` | Immutable supplier briefing versions, what changed between them, and the supplier's acknowledgement through a scoped link. | — | `app/actions/suppliers.ts` | `/occasions/[id]/suppliers/[supplierId]` `/s/[token]` | `eventday.test.ts` `programme.test.ts` `requests.test.ts` `suppliers.test.ts` |
| `budget` | Budget by category with five separate amounts (estimate, committed, invoiced, paid, forecast); requires the finance grant. | `schema/budget.ts` | `app/actions/budget.ts` | `/occasions/[id]/budget/expenses/[expenseId]` `/occasions/[id]/budget` | `lifecycle.test.ts` `money.test.ts` `security-review.test.ts` |
| `business` | Business accounts and their team: membership, roles, status, lapse helpers, factual badges, notices. | `schema/business.ts` | `app/actions/business.ts` `app/actions/listings.ts` `app/actions/moderation.ts` | `/business/[businessId]/branding` `/business/[businessId]/catalogues/[catalogueId]` `/business/[businessId]/catalogues` `/business/[businessId]/enquiries` … +9 more | `arrangements.test.ts` `billing.test.ts` `bizoccasions.test.ts` `business-listings.test.ts` … +7 more |
| `capacity` | The one shared count of places for an occasion; atomic claim, adjust and release so two people cannot take the last place. | — | `app/actions/guests.ts` | `/occasions/[id]/guests/settings` | `guests-rsvp.test.ts` `publicpage.test.ts` |
| `catalogues` | Flower catalogues a business publishes (through moderation) and the public read API for them. | `schema/catalogues.ts` | `app/actions/catalogues.ts` | `/business/[businessId]/catalogues/[catalogueId]` `/business/[businessId]/catalogues` `/occasions/[id]/flowers` | `arrangements.test.ts` `catalogues.test.ts` |
| `checkin` | Arrivals on the day: QR or name check-in, corrections with a reason, guest-flow counts and projection. | — | `app/actions/operate.ts` | `/occasions/[id]/operate/checkin` `/occasions/[id]/operate` | `operate.test.ts` |
| `claims` | A business claiming an unclaimed directory listing: emailed code or moderator check, then second-person approval. | — | `app/actions/claims.ts` `app/actions/discovery.ts` | `/claim/[listingId]` `/console/discovery` | `discovery-claims.test.ts` |
| `closeout` | Cancel, postpone and close an occasion through previews; closeout list; lessons carried to the next occasion. | — | `app/actions/lifecycle.ts` | `/occasions/[id]/settings/closeout` `/occasions/new` | `lifecycle.test.ts` |
| `comms` | Staff notices to businesses only; never to planner-entered contacts. | `schema/comms.ts` | `app/actions/comms.ts` | `/console/communications` | `featured.test.ts` |
| `compliance` | Launch checklist, legal-document publication gate for sign-up, launch records. | `schema/compliance.ts` | `app/actions/console.ts` | `/console/launch` | `staff.test.ts` |
| `complianceaccess` | Time-boxed, three-person-approved staff access to one person's records, and the data-subject export. | `schema/complianceaccess.ts` | `app/console/compliance/actions.ts` | `/console/compliance/[id]/export` `/console/compliance` | `complianceaccess.test.ts` |
| `context` | The request context every core function receives (database, actor, time, locale) and the actor types. | — | `app/actions/auth.ts` | `/occasions/[id]/print/[key]` `/occasions/[id]/promotion/download/[asset]` `/occasions/[id]/stationery/pdf` `/occasions/[id]/stationery/thumb` … +10 more | `account-purge-occasions.test.ts` `aitext.test.ts` `appearance.test.ts` `arrangements.test.ts` … +38 more |
| `contributions` | "Who brings what": needs with quantities and atomic claims by guests and members. | — | `app/actions/contributions.ts` | `/occasions/[id]/contributions` | `contributions.test.ts` `security-review.test.ts` |
| `cookies` | The exact set of three cookies the app uses and its signature for the cookie notice. Client-safe. | — | — | — | `platform.test.ts` |
| `corrections` | Records a correction to a fact (payment, received quantity, arrival) with before, after, who and why. | `schema/corrections.ts` | — | — | `money.test.ts` |
| `delegations` | Offering a task to someone; accept or decline with a reason; a decline returns the task to the delegator. | — | `app/actions/tasks.ts` | — | `planning.test.ts` |
| `deletion` | Generic deletion requests with a seven-day undo, used by accounts and occasions. | — | — | `/account/delete` `/occasions/[id]/settings` | `account-purge-occasions.test.ts` `deletion.test.ts` `enquiries.test.ts` `lifecycle.test.ts` … +2 more |
| `deliveries` | Deliveries, hired items and returns; received quantities are facts changed only by correction. | `schema/deliveries.ts` | `app/actions/deliveries.ts` | `/occasions/[id]/deliveries` | `deliveries.test.ts` `eventday.test.ts` `suppliers.test.ts` |
| `deploys` | Staff deploy requests: tag and CI checks, second-person approval, dispatch to GitHub, recorded stages and rollbacks. | `schema/deploys.ts` | `app/actions/deploys.ts` | `/api/deploys/record` `/console/deploys` | `deploys.test.ts` |
| `digest` | The daily digest email per member, with sections other domains register. | — | — | — | `deliveries.test.ts` `planning.test.ts` |
| `directory` | The public directory: search results, daily organic rotation that cannot be bought, public listing view, task-to-directory links. | `schema/directory.ts` | `app/actions/directory.ts` | `/console/directory` `/directory/listing/[id]/enquire` `/directory/listing/[id]` `/directory` | `directory.test.ts` `discovery-claims.test.ts` `featured.test.ts` |
| `discovery` | Finding businesses from public sources into moderated, unclaimed listings; one claim invitation; removal and objection handling. | `schema/discovery.ts` | `app/actions/claims.ts` `app/actions/discovery.ts` | `/claim/[listingId]/remove` `/console/discovery/drafts/[id]` `/console/discovery` `/console/discovery/sources/[id]` … +1 more | `discovery-claims.test.ts` |
| `drawings` | Venue spaces per listing: drawing upload, two-point calibration, markings in real millimetres, parking facts, moderated versions. | `schema/drawings.ts` | `app/actions/drawings.ts` | `/business/[businessId]/listings/[listingId]/spaces/[spaceId]` `/business/[businessId]/listings/[listingId]/spaces` | `drawings-seating.test.ts` `security-review.test.ts` |
| `enquiries` | Planner-to-business enquiries and quote requests: what is shared, limits, thread states, the 48-hour nudge, accepting a quote. | `schema/enquiries.ts` | `app/actions/enquiries.ts` | `/business/[businessId]/enquiries/[enquiryId]` `/business/[businessId]/enquiries/[enquiryId]/reply` `/business/[businessId]/enquiries` `/occasions/[id]/suppliers/enquiries/[enquiryId]` … +2 more | `arrangements.test.ts` `discovery-claims.test.ts` `enquiries.test.ts` |
| `eventday` | The event-day view over the same task rows: four states, the one "now" item, times of day. | `schema/eventday.ts` | `app/actions/eventday.ts` | `/occasions/[id]/day` | `eventday.test.ts` |
| `expenses` | Expenses with receipts; approval and payment are independent; a paid expense changes only by correction. | — | `app/actions/budget.ts` | `/occasions/[id]/budget/expenses/[expenseId]` `/occasions/[id]/budget` | `lifecycle.test.ts` `money.test.ts` `security-review.test.ts` |
| `exports` | Registry and runner for CSV/PDF exports shown on the print page; CSV escaping. | — | — | `/occasions/[id]/print/[key]` `/occasions/[id]/print` | `deliveries.test.ts` `drawings-seating.test.ts` `eventday.test.ts` `featured.test.ts` … +11 more |
| `featured` | Paid placement slots. Returns nothing while monetisation is off; never changes organic order. | `schema/featured.ts` | `app/actions/featured.ts` | `/console/commercial` | `featured.test.ts` |
| `fetching` | robots.txt checking for outbound discovery fetches. | — | — | — | `platform.test.ts` |
| `fitcheck` | Pure fit check of a room plan: seats, area, aisles; unknown dimensions are excluded, never counted as fitting. | — | — | — | `spacemodel.test.ts` |
| `geography` | Counties, localities and directory categories: lookups for forms and staff management. | — | `app/actions/directory.ts` | `/console/commercial` `/console/communications` `/console/directory` `/console/discovery/drafts/[id]` … +4 more | `business-listings.test.ts` `directory.test.ts` |
| `gifts` | The private gift estimator for a planner; visible to that account only, never exported. | `schema/gifts.ts` | `app/actions/gifts.ts` | `/occasions/[id]/gifts` | `gifts.test.ts` |
| `guestevent` | What a guest sees about the event: page URL, navigation link, the accessible-journey facts. | — | `app/actions/publicpage.ts` | `/occasions/[id]/public-page` | `publicpage.test.ts` `requests.test.ts` |
| `guestimport` | Importing a guest list from CSV or XLSX through a preview, with duplicate detection and size limits. | — | `app/actions/guests.ts` | `/occasions/[id]/guests/import` `/occasions/[id]/guests/import/upload` | `guestimport.test.ts` `security-review.test.ts` |
| `guests` | Households and named adult guests; children are only ever a count. Guest list export. | `schema/guests.ts` | `app/actions/guests.ts` | `/occasions/[id]/guests/[householdId]` `/occasions/[id]/guests/export` `/occasions/[id]/guests` `/occasions/[id]/programme` | `bizoccasions.test.ts` `contributions.test.ts` `drawings-seating.test.ts` `eventday.test.ts` … +8 more |
| `handover` | Handing a business-owned occasion to the client: ownership moves and all business-side access ends. | — | `app/actions/bizoccasions.ts` | `/business/[businessId]/occasions/[occasionId]` | `bizoccasions.test.ts` |
| `idempotency` | Runs a mutation once per key so a double tap or retry does not apply twice. | — | — | — | `idempotency.test.ts` |
| `incidents` | The plain-language incident message shown on guest-facing pages. | `schema/incidents.ts` | `app/actions/console.ts` | `/console/incidents` | `platform.test.ts` `staff.test.ts` |
| `invitations` | Guest links: token hashing, expiry, revocation, the guest's own view, guest-page sections other domains register. | — | `app/actions/guests.ts` | `/g/[token]` | `bizoccasions.test.ts` `contributions.test.ts` `drawings-seating.test.ts` `featured.test.ts` … +7 more |
| `invitationtext` | Custom invitation wording, including proposals from an external assistant. | — | `app/actions/integration.ts` | `/occasions/[id]/guests/settings` `/g/[token]` | — |
| `invoicing` | Fiscal invoicing seam (sandbox provider only) and its webhook handling. | — | — | `/api/webhooks/invoicing` | `billing.test.ts` `security-review.test.ts` |
| `itinerary` | Trip legs across time zones and importing bookings from pasted text or .ics through a preview. | — | `app/actions/travel.ts` | `/occasions/[id]/operate/rehearsal` `/occasions/[id]/travel/groups` `/occasions/[id]/travel/itinerary/import` `/occasions/[id]/travel/itinerary` … +1 more | `operate.test.ts` `travel.test.ts` |
| `ledger` | The shared-cost ledger: who paid, who benefits, balances that sum to zero per currency, settlement. | `schema/ledger.ts` | `app/actions/ledger.ts` `app/actions/travel.ts` | `/occasions/[id]/ledger` | `lifecycle.test.ts` `money.test.ts` `travel.test.ts` |
| `library` | A business's reusable templates, checklists, supplier contacts and files, applied to its occasions. | — | `app/actions/bizoccasions.ts` | `/business/[businessId]/library` `/business/[businessId]/occasions/[occasionId]` | `bizoccasions.test.ts` |
| `lifecycle` | Registries for cancel/postpone impact rows and closeout sections; the closed-occasion write guard. | `schema/lifecycle.ts` | — | — | `deliveries.test.ts` `lifecycle.test.ts` `publicpage.test.ts` |
| `listings` | Business listings: drafts, validation against fixed categories and places, submission, unclaimed listings, suspension. | — | `app/actions/discovery.ts` `app/actions/listings.ts` `app/actions/moderation.ts` | `/business/[businessId]/listings/[listingId]` `/business/[businessId]/listings/new` `/business/[businessId]` `/console/businesses/[id]` … +4 more | `arrangements.test.ts` `bizoccasions.test.ts` `business-listings.test.ts` `catalogues.test.ts` … +6 more |
| `listingstats` | Response statistics shown on a listing, published only above a threshold and never affected by payment. | — | — | `/business/[businessId]/listings/[listingId]` | `directory.test.ts` `enquiries.test.ts` |
| `members` | Occasion team: invitations by email, roles, grants, removal, ownership transfer. | — | `app/actions/members.ts` | `/occasions/[id]/team/[memberId]` `/occasions/[id]/team` `/invite/[token]` | `integration-wiring.test.ts` `planning.test.ts` `security-review.test.ts` |
| `menus` | Menus, guests' meal choices as counts, food and drink quantities, pushing them into a supplier order. | `schema/menus.ts` | `app/actions/menus.ts` `app/actions/requests.ts` | `/occasions/[id]/menu` `/e/[slug]/r/[token]` | `menus.test.ts` `publicpage.test.ts` `security-review.test.ts` |
| `moderation` | The single moderation queue for listings, drawings, catalogues and parking facts; the live version stays up while a change waits. | — | `app/actions/drawings.ts` `app/actions/listings.ts` `app/actions/moderation.ts` | `/console/moderation/[id]` `/console/moderation` | `arrangements.test.ts` `business-listings.test.ts` `catalogues.test.ts` `directory.test.ts` … +4 more |
| `monetization` | The monetisation switch (off by default), its approvals, notice period and the permanent free tier. | — | `app/actions/billing.ts` | `/console/commercial` | `billing.test.ts` `bizoccasions.test.ts` |
| `occasions` | Occasions themselves: create, edit, move the date through a preview, delete with undo, purge. | `schema/occasions.ts` | `app/actions/deliveries.ts` `app/actions/occasions.ts` | `/occasions/[id]/budget/expenses/[expenseId]` `/occasions/[id]/budget` `/occasions/[id]/deliveries` `/occasions/[id]/flowers` … +18 more | `bizoccasions.test.ts` `enquiries.test.ts` `featured.test.ts` `integration-wiring.test.ts` … +6 more |
| `offline` | Offline capture of arrivals and own checklist ticks, reconciled once on reconnect; conflicts are never merged silently. | — | `app/actions/operate.ts` | `/occasions/[id]/operate/checklist` `/occasions/[id]/operate/offline` `/occasions/[id]/operate` `/api/occasions/[id]/offline` | `operate.test.ts` |
| `orders` | Final-order snapshots per booking and the deltas when replies change afterwards. | — | `app/actions/suppliers.ts` | `/occasions/[id]/suppliers/[supplierId]` | `menus.test.ts` `suppliers.test.ts` |
| `overview` | The occasion overview: next milestone, overdue work, unaccepted delegations, blockers, plus registered sections. | — | — | `/occasions/[id]` | `deliveries.test.ts` `eventday.test.ts` `lifecycle.test.ts` `planning.test.ts` |
| `packing` | Packing lists, stored as task checklists. | — | `app/actions/travel.ts` | `/occasions/[id]/travel/packing` `/occasions/[id]/travel` | `travel.test.ts` |
| `payments` | Supplier payment deadlines (finance grant), paid facts, the move-payment preview, booking money for the budget. | — | `app/actions/suppliers.ts` | `/occasions/[id]/suppliers/[supplierId]` `/occasions/[id]/suppliers` | `deliveries.test.ts` `eventday.test.ts` `security-review.test.ts` `suppliers.test.ts` |
| `plannotes` | Planner-side notes created from assistant proposals: supplier shortlists and budget notes. | `schema/plannotes.ts` | `app/actions/integration.ts` | `/occasions/[id]/proposals` | — |
| `polls` | Date polls: candidate dates, household votes, confirming a date. Votes never reserve places. | — | `app/actions/polls.ts` | `/occasions/[id]/polls` | `guests-rsvp.test.ts` |
| `printpack` | Print-ready PDFs: QR labels, QR invitations, table cards, to-scale room plan. | — | — | — | `printpack.test.ts` |
| `programme` | The programme of the day, versioned cue lists, performer briefings, one notification per guest-visible change. | `schema/programme.ts` | `app/actions/programme.ts` | `/occasions/[id]/programme` | `programme.test.ts` `publicpage.test.ts` `security-review.test.ts` |
| `promotion` | Generated copy, image cards, calendar file and poster to download. Nothing is posted or spent. | `schema/promotion.ts` | `app/actions/promotion.ts` | `/occasions/[id]/promotion/download/[asset]` `/occasions/[id]/promotion` | `promotion.test.ts` |
| `publicpage` | The public event page settings and lookup, with conditional registration questions. | `schema/publicpage.ts` | `app/actions/publicpage.ts` | `/occasions/[id]/public-page` `/e/[slug]` | `publicpage.test.ts` `requests.test.ts` |
| `qr` | Stable QR ids for invitations, resolving a QR to the guest's own view, drawing QR codes. | — | — | `/g/q/[qrId]` | `printpack.test.ts` `security-review.test.ts` |
| `ratelimit` | Rate limits on three axes (email, IP, device), the public-form bot guard, the security log and its retention. | — | `app/actions/auth.ts` `app/actions/claims.ts` `app/actions/console.ts` … +3 more | `/sign-in/anonymous/new` `/claim/[listingId]/remove` `/console/operations` `/e/[slug]` … +4 more | `discovery-claims.test.ts` `publicpage.test.ts` `ratelimit.test.ts` `requests.test.ts` … +2 more |
| `readiness` | Hold / proceed / proceed-with-conditions decisions, each with evidence. | — | `app/actions/eventday.ts` | `/occasions/[id]/day` | `eventday.test.ts` |
| `registrations` | Public registrations for an event, the waiting list and its atomic promotion. | — | `app/actions/publicpage.ts` | `/occasions/[id]/public-page` `/e/[slug]` `/e/[slug]/r/[token]` | `publicpage.test.ts` `requests.test.ts` |
| `rehearsal` | Read-only simulation of the day from registered timeline sources, with conflicts in words. | — | — | `/occasions/[id]/operate/rehearsal` | `operate.test.ts` |
| `reports` | Content reports (notice and action): intake, review, decision and the reason given to the affected party. | — | `app/actions/console.ts` `app/actions/report.ts` | `/console/businesses/[id]` `/console/reports/[id]` `/console/reports` `/report` | `business-listings.test.ts` `staff.test.ts` |
| `requests` | Private dietary and access requests, visible only with the private-requests grant; purged after closeout. | `schema/requests.ts` | `app/actions/requests.ts` | `/occasions/[id]/requests` `/e/[slug]/r/[token]` | `requests.test.ts` `security-review.test.ts` |
| `retention` | Registry and runner for retention (purge) rules. | — | — | — | `discovery-claims.test.ts` `lifecycle.test.ts` `platform.test.ts` `requests.test.ts` … +1 more |
| `rooms` | Rooms and room assignments for trips, with atomic capacity. | — | `app/actions/travel.ts` | `/occasions/[id]/travel` `/occasions/[id]/travel/rooms` | `operate.test.ts` `travel.test.ts` |
| `rsvp` | Household replies, custom questions and answers, counts summary; a reply claims places atomically. | — | `app/actions/guests.ts` `app/actions/rsvp.ts` | `/occasions/[id]/guests` `/occasions/[id]/guests/settings` `/g/[token]` | `drawings-seating.test.ts` `eventday.test.ts` `guests-rsvp.test.ts` `lifecycle.test.ts` … +5 more |
| `seating` | The occasion's space model, tables, seat assignments, meal stages, publishing seats to guests, seating What-if kinds. | `schema/seating.ts` | `app/actions/seating.ts` `app/actions/space.ts` | `/occasions/[id]/seating` `/occasions/[id]/space` | `drawings-seating.test.ts` `menus.test.ts` `printpack.test.ts` `security-review.test.ts` … +1 more |
| `spacemodel` | Pure, client-safe room plan model: geometry, calibration maths, rendering a plan to SVG. | — | `app/actions/drawings.ts` `app/actions/space.ts` | `/business/[businessId]/listings/[listingId]/spaces/[spaceId]` `/occasions/[id]/space` | `drawings-seating.test.ts` `security-review.test.ts` `spacemodel.test.ts` |
| `staff` | Staff members, roles, console access (needs two-step), dashboard counters, audited settings. | `schema/staff.ts` | `app/actions/console.ts` | `/console/access` `/console/approvals` `/console/audit/export` `/console/compliance/[id]/export` … +2 more | `aitext.test.ts` `integration-wiring.test.ts` `staff.test.ts` |
| `stationery` | Invitation and stationery versions, the proof gate before a print PDF, digital invitation style. | `schema/stationery.ts` | `app/actions/stationery.ts` | `/occasions/[id]/stationery` `/occasions/[id]/stationery/pdf` `/occasions/[id]/stationery/thumb` `/g/[token]` | `printpack.test.ts` `promotion.test.ts` `security-review.test.ts` `stationery.test.ts` |
| `stationerycollections` | Invitation collection data: palettes, per-occasion palette sets, edition artwork, Romanian embroidery charts, occasion motifs, starter wordings. | — | — | — | `stationery.test.ts` |
| `stationerykit` | The stationery designs (eight house designs and the invitation collections) as data and the layout engine that draws the same thing to SVG and PDF. Server only. | — | `app/actions/stationery.ts` | `/occasions/[id]/promotion` `/occasions/[id]/stationery` | `stationery.test.ts` |
| `stats` | Daily counters without visitor identifiers and the nightly collectors. | `schema/stats.ts` | — | — | `directory.test.ts` `stats.test.ts` |
| `subgroups` | Trip subgroups, optional activities with atomic places, participant settlement view. | — | `app/actions/travel.ts` | `/occasions/[id]/travel/groups` `/occasions/[id]/travel/itinerary/import` `/occasions/[id]/travel/itinerary` `/occasions/[id]/travel/packing` … +3 more | `travel.test.ts` |
| `suppliers` | Suppliers in a plan, the scoped supplier link, linking a directory listing to a supplier and booking. | `schema/suppliers.ts` | `app/actions/catalogues.ts` `app/actions/suppliers.ts` | `/occasions/[id]/menu` `/occasions/[id]/operate` `/occasions/[id]/programme` `/occasions/[id]/requests` … +2 more | `deliveries.test.ts` `enquiries.test.ts` `eventday.test.ts` `featured.test.ts` … +5 more |
| `sustainability` | Optional sustainability goals with measured values; unknown never counts as meeting a goal. | — | `app/actions/operate.ts` | `/occasions/[id]/operate` `/occasions/[id]/operate/sustainability` | `operate.test.ts` |
| `tasks` | Tasks: one query behind the list, board and calendar views; status, checklists, dependencies. | `schema/tasks.ts` | `app/actions/tasks.ts` | `/occasions/[id]/print` `/occasions/[id]/tasks/[taskId]` `/occasions/[id]/tasks/new` `/occasions/[id]/tasks` | `bizoccasions.test.ts` `eventday.test.ts` `integration-wiring.test.ts` `lifecycle.test.ts` … +3 more |
| `tasks-proposals` | A task list proposed by an external assistant, applied only when the planner confirms. | — | — | — | — |
| `templates` | Occasion templates with due dates relative to the occasion date, re-run as a diff; day helpers. | `schema/templates.ts` | `app/actions/ledger.ts` `app/actions/occasions.ts` | `/occasions/[id]/budget/expenses/[expenseId]` `/occasions/[id]/budget` `/occasions/[id]/deliveries` `/occasions/[id]/ledger` … +4 more | `lifecycle.test.ts` `planning.test.ts` |
| `transport` | Transport legs for trips with atomic seat claims. | — | `app/actions/travel.ts` | `/occasions/[id]/travel` `/occasions/[id]/travel/transport` | `operate.test.ts` `travel.test.ts` |
| `tx` | Runs a function inside a database transaction with a context bound to it. | — | — | — | `audit.test.ts` `money.test.ts` |
| `whatif` | The What-if engine: create a preview, confirm applies it once, discard changes nothing. | `schema/whatif.ts` | `app/actions/guests.ts` `app/actions/whatif.ts` | `/business/[businessId]/occasions/[occasionId]` `/occasions/[id]/guests/[householdId]` `/occasions/[id]/guests/import` `/occasions/[id]/polls` … +4 more | `arrangements.test.ts` `bizoccasions.test.ts` `contributions.test.ts` `deliveries.test.ts` … +8 more |
| `wiring` | Glue between domains that must not import each other: enquiry counts for business reports and the console. | — | — | — | — |
| `wiring-programme` | Glue: feeds the programme into the rehearsal timeline. | — | — | — | — |

## 2. Database — `packages/db/src/schema/<file>.ts`

| Schema file | Tables |
| --- | --- |
| `accounts.ts` | `accounts` `sessions` `sign_in_codes` `magic_links` `recovery_codes` `totp_secrets` `passkey_credentials` `rate_limit_buckets` `rate_limit_backoffs` `security_log` `email_outbox` `email_suppressions` `email_daily_counters` `deletion_requests` |
| `aitext.ts` | `ai_text_usage` `ai_text_results` |
| `arrangements.ts` | `arrangement_designs` `arrangement_versions` `arrangement_quote_requests` |
| `billing.ts` | `monetization_switch` `monetization_history` `monetization_reminders` `billing_acceptances` `subscriptions` `processor_events` `invoices` `refund_requests` |
| `bizoccasions.ts` | `business_profiles` `business_occasion_seats` `occasion_handovers` `business_library_items` `business_library_links` |
| `budget.ts` | `budget_categories` `expenses` |
| `business.ts` | `businesses` `business_members` `business_fact_checks` `business_notices` `listings` `listing_categories` `listing_localities` `listing_revisions` `listing_stats` |
| `catalogues.ts` | `flower_catalogues` `catalogue_items` |
| `comms.ts` | `platform_notices` `platform_notice_sends` |
| `compliance.ts` | `content_reports` |
| `complianceaccess.ts` | `compliance_access_grants` |
| `corrections.ts` | `corrections` |
| `deliveries.ts` | `deliveries` `delivery_items` |
| `deploys.ts` | `deploys` |
| `directory.ts` | `categories` `counties` `localities` `directory_link_prefs` |
| `discovery.ts` | `discovery_sources` `discovery_runs` `discovery_batches` `discovery_drafts` `objection_records` `discovery_suppressions` `listing_claims` |
| `drawings.ts` | `spaces` `drawing_versions` `listing_parking` |
| `enquiries.ts` | `enquiries` `enquiry_messages` `enquiry_stat_events` `quote_links` |
| `eventday.ts` | `task_day_state` `readiness_decisions` |
| `featured.ts` | `featured_slots` |
| `gifts.ts` | `gift_guide_settings` `gift_estimates` |
| `guests.ts` | `occasion_guest_settings` `rsvp_questions` `households` `guests` `invitations` `rsvp_responses` `rsvp_answers` `date_polls` `date_poll_options` `date_poll_votes` `occasion_capacity` `capacity_claims` `contribution_needs` `contribution_claims` |
| `incidents.ts` | `incidents` |
| `jobs.ts` | `jobs` `job_schedules` `job_runs` |
| `ledger.ts` | `ledger_participants` `ledger_entries` `ledger_shares` |
| `lifecycle.ts` | `lessons` |
| `mcp.ts` | `mcp_tokens` `mcp_call_log` |
| `menus.ts` | `menus` `menu_items` `meal_choices` `menu_settings` |
| `occasions.ts` | `occasions` `occasion_members` |
| `operate.ts` | `check_ins` `offline_items` `check_item_revisions` `sustainability_goals` `sustainability_measurements` |
| `plannotes.ts` | `plan_notes` |
| `platform.ts` | `audit_log` `idempotency_keys` `platform_settings` |
| `programme.ts` | `programme_items` `programme_cue_versions` `programme_state` `programme_changes` |
| `promotion.ts` | `promotion_copies` |
| `publicpage.ts` | `public_pages` `public_registrations` |
| `requests.ts` | `private_requests` `guest_journeys` |
| `seating.ts` | `space_models` `plan_items` `seat_assignments` `meal_stages` `stage_item_states` `seating_plans` |
| `staff.ts` | `staff_members` `console_sessions` `approval_requests` `approval_decisions` |
| `stationery.ts` | `stationery_sets` `stationery_versions` |
| `stats.ts` | `stats_daily` |
| `storage.ts` | `assets` `storage_usage` |
| `suppliers.ts` | `suppliers` `bookings` `booking_events` `supplier_links` `briefing_versions` `briefing_acks` `order_snapshots` `order_deltas` `payment_deadlines` |
| `tasks.ts` | `tasks` `task_check_items` `task_dependencies` `delegations` `reminder_digests` |
| `templates.ts` | `templates` `template_tasks` |
| `travel.ts` | `subgroups` `subgroup_members` `itinerary_legs` `activities` `activity_optins` `packing_lists` `transport_legs` `transport_seats` `rooms` `room_assignments` `exchange_notes` |
| `whatif.ts` | `whatif_previews` |

SQL guards (`packages/db/src/sql`, re-applied on every migrate/push/test run):

- `001_audit_append_only.sql` — SEC10:
- `010_corrections_append_only.sql` — Principle 4:
- `020_finance_fact_guards.sql` — Principle 4 (B2, B3):
- `020_listing_revisions_immutable.sql` — P3 / W2:
- `020_suppliers_guards.sql` — B4 / B5 / B12:
- `021_delivery_facts.sql` — B6 / principle 4:
- `022_readiness_append_only.sql` — B8:
- `030_drawing_versions_immutable.sql` — P-06 / V4:
- `040_operate_guards.sql` — RELEASE E.
- `040_stationery_guards.sql` — Release C:

## 3. Extension points (registries)

Add behaviour by registering, not by editing another domain. Every module that registers at
import time is loaded in every process through `@ed/core/all`.

| Registry | Defined in | Registered from |
| --- | --- | --- |
| `onAccountPurge` | `packages/core/src/accounts.ts` | `core/src/aitext.ts` `core/src/business.ts` `core/src/gifts.ts` `core/src/occasions.ts` `mcp/src/tokens.ts` |
| `onContentReportDecided` | `packages/core/src/reports.ts` | `core/src/listings.ts` |
| `onDrawingVersionPublished` | `packages/core/src/drawings.ts` | `core/src/seating.ts` |
| `onOccasionHandover` | `packages/core/src/handover.ts` | — |
| `onOccasionPurge` | `packages/core/src/occasions.ts` | `core/src/arrangements.ts` `core/src/checkin.ts` `core/src/enquiries.ts` `core/src/expenses.ts` `core/src/gifts.ts` `core/src/guestevent.ts` … +14 more |
| `onSignOutEverywhere` | `packages/auth/src/sessions.ts` | `mcp/src/tokens.ts` |
| `registerAllJobs` | `packages/jobs/src/registry.ts` | — |
| `registerApprovalAction` | `packages/core/src/approvals.ts` | `core/src/complianceaccess.ts` `core/src/deploys.ts` |
| `registerAssetAccess` | `packages/storage/src/assets.ts` | `core/src/business.ts` `core/src/occasions.ts` |
| `registerBudgetSource` | `packages/core/src/budget.ts` | `core/src/payments.ts` |
| `registerBuiltinTools` | `packages/mcp/src/builtin.ts` | — |
| `registerCloseoutSection` | `packages/core/src/lifecycle.ts` | `core/src/deliveries.ts` `core/src/expenses.ts` `core/src/ledger.ts` `core/src/payments.ts` |
| `registerDashboardCounter` | `packages/core/src/staff.ts` | `core/src/business.ts` `core/src/listings.ts` `core/src/moderation.ts` `core/src/wiring.ts` |
| `registerDigestSection` | `packages/core/src/digest.ts` | `core/src/budget.ts` `core/src/payments.ts` |
| `registerEmailProvider` | `packages/email/src/providers.ts` | — |
| `registerExport` | `packages/core/src/exports.ts` | `core/src/briefingpdf.ts` `core/src/budget.ts` `core/src/checkin.ts` `core/src/itinerary.ts` `core/src/ledger.ts` `core/src/menus.ts` … +8 more |
| `registerGuestSection` | `packages/core/src/invitations.ts` | — |
| `registerInvoicingProvider` | `packages/core/src/invoicing.ts` | — |
| `registerJobs` | `packages/core/src/billing.ts` | `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` `core/src/comms.ts` … +27 more |
| `registerJobs` | `packages/core/src/budget.ts` | `core/src/billing.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` `core/src/comms.ts` … +27 more |
| `registerJobs` | `packages/core/src/business.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` `core/src/comms.ts` … +27 more |
| `registerJobs` | `packages/core/src/catalogues.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/claims.ts` `core/src/closeout.ts` `core/src/comms.ts` … +27 more |
| `registerJobs` | `packages/core/src/claims.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/closeout.ts` `core/src/comms.ts` … +27 more |
| `registerJobs` | `packages/core/src/closeout.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/comms.ts` … +27 more |
| `registerJobs` | `packages/core/src/comms.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/digest.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/directory.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/discovery.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/enquiries.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/expenses.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/invoicing.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/ledger.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/listings.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/listingstats.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/monetization.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/occasions.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/payments.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/programme.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/registrations.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/reports.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/requests.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/retention.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/stats.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/whatif.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/core/src/wiring.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/mcp/src/tokens.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/storage/src/assets.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/jobs/src/auth-cleanup.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/jobs/src/builtin.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerJobs` | `packages/jobs/src/registry.ts` | `core/src/billing.ts` `core/src/budget.ts` `core/src/business.ts` `core/src/catalogues.ts` `core/src/claims.ts` `core/src/closeout.ts` … +27 more |
| `registerLifecycleImpact` | `packages/core/src/lifecycle.ts` | `core/src/closeout.ts` `core/src/deliveries.ts` `core/src/expenses.ts` `core/src/ledger.ts` `core/src/payments.ts` `core/src/registrations.ts` |
| `registerMcpTool` | `packages/mcp/src/registry.ts` | `mcp/src/builtin.ts` `mcp/src/index.ts` `mcp/src/tools-arrangements.ts` `mcp/src/tools-directory.ts` `mcp/src/tools-money.ts` `mcp/src/tools-planning.ts` … +1 more |
| `registerModerationKind` | `packages/core/src/moderation.ts` | `core/src/catalogues.ts` `core/src/drawings.ts` `core/src/listings.ts` |
| `registerOnrcAdapter` | `packages/core/src/discovery.ts` | — |
| `registerOverviewSection` | `packages/core/src/overview.ts` | `core/src/budget.ts` `core/src/closeout.ts` `core/src/ledger.ts` `core/src/payments.ts` `core/src/readiness.ts` |
| `registerRetentionRule` | `packages/core/src/retention.ts` | `core/src/claims.ts` `core/src/discovery.ts` `core/src/expenses.ts` `core/src/occasions.ts` `core/src/ratelimit.ts` `core/src/reports.ts` … +5 more |
| `registerStatCollector` | `packages/core/src/stats.ts` | `core/src/listingstats.ts` `jobs/src/registry.ts` |
| `registerStationeryFonts` | `packages/core/src/stationerykit.ts` | `core/src/stationery.ts` |
| `registerTemplate` | `packages/email/src/templates.ts` | `email/src/send.ts` |
| `registerTimelineSource` | `packages/core/src/rehearsal.ts` | `core/src/wiring-programme.ts` |
| `registerUploadPurpose` | `packages/storage/src/assets.ts` | `core/src/bizoccasions.ts` `core/src/bookings.ts` `core/src/business.ts` `core/src/drawings.ts` `core/src/enquiries.ts` `core/src/expenses.ts` … +1 more |
| `registerWhatIf` | `packages/core/src/whatif.ts` | — |
| `setBusinessEnquiryProvider` | `packages/core/src/bizoccasions.ts` | `core/src/wiring.ts` |
| `setEnquiryStatsProvider` | `packages/core/src/listingstats.ts` | `core/src/enquiries.ts` |
| `setEventPageUrlProvider` | `packages/core/src/printpack.ts` | — |
| `setFeaturedProvider` | `packages/core/src/directory.ts` | `core/src/featured.ts` |
| `setOccasionLister` | `packages/mcp/src/builtin.ts` | `mcp/src/tools-planning.ts` |
| `setPdfRasteriser` | `packages/core/src/drawings.ts` | — |
| `setPlatformEnquiryCounter` | `packages/core/src/billing.ts` | `core/src/wiring.ts` |
| `setScanner` | `packages/storage/src/scan.ts` | — |
| `setStorageTransport` | `packages/storage/src/transport.ts` | — |

## 4. What-if kinds (preview → confirm)

| Kind | Registered in |
| --- | --- |
| `arrangement.applyDesign` | `packages/core/src/arrangements.ts` |
| `bizlibrary.apply` | `packages/core/src/library.ts` |
| `bizoccasion.handover` | `packages/core/src/handover.ts` |
| `budget.proposeEstimates` | `packages/core/src/plannotes.ts` |
| `budget.proposeNote` | `packages/core/src/plannotes.ts` |
| `guests.import` | `packages/core/src/guestimport.ts` |
| `guests.invitationText` | `packages/core/src/invitationtext.ts` |
| `guests.removeHousehold` | `packages/core/src/guests.ts` |
| `itinerary.import` | `packages/core/src/itinerary.ts` |
| `occasion.cancel` | `packages/core/src/closeout.ts` |
| `occasion.close` | `packages/core/src/closeout.ts` |
| `occasion.moveDate` | `packages/core/src/occasions.ts` |
| `occasion.postpone` | `packages/core/src/closeout.ts` |
| `payment.move` | `packages/core/src/payments.ts` |
| `plan.shortlistNote` | `packages/core/src/plannotes.ts` |
| `seating.applyLayout` | `packages/core/src/seating.ts` |
| `space.addCustomTable` | `packages/core/src/seating.ts` |
| `space.updateDrawing` | `packages/core/src/seating.ts` |
| `tasks.applyTemplate` | `packages/core/src/templates.ts` |
| `tasks.proposeList` | `packages/core/src/tasks-proposals.ts` |

## 5. Background jobs

| Job | Defined in |
| --- | --- |
| `accounts.purge-due` | `packages/jobs/src/auth-cleanup.ts` |
| `auth.purge-expired` | `packages/jobs/src/auth-cleanup.ts` |
| `billing.refund-execute` | `packages/core/src/billing.ts` |
| `billing.sweep` | `packages/core/src/billing.ts` |
| `business.notice-email` | `packages/core/src/business.ts` |
| `digest.plan` | `packages/core/src/digest.ts` |
| `digest.send` | `packages/core/src/digest.ts` |
| `discovery.claim-invitation` | `packages/core/src/discovery.ts` |
| `discovery.run` | `packages/core/src/discovery.ts` |
| `enquiries.notify-arrival` | `packages/core/src/enquiries.ts` |
| `enquiries.nudge-48h` | `packages/core/src/enquiries.ts` |
| `invoicing.issue` | `packages/core/src/invoicing.ts` |
| `lifecycle.notify-guests` | `packages/core/src/closeout.ts` |
| `mcp.expire-inactive` | `packages/mcp/src/tokens.ts` |
| `monetization.notice-email` | `packages/core/src/comms.ts` |
| `monetization.notice-email` | `packages/core/src/monetization.ts` |
| `monetization.notice-reminder` | `packages/core/src/monetization.ts` |
| `programme.notify` | `packages/core/src/programme.ts` |
| `publicpage.lifecycle-notify` | `packages/core/src/registrations.ts` |
| `publicpage.promote-sweep` | `packages/core/src/registrations.ts` |
| `publicpage.promoted-email` | `packages/core/src/registrations.ts` |
| `retention.purge` | `packages/core/src/retention.ts` |
| `stats.nightly` | `packages/core/src/stats.ts` |

## 6. Web routes — `apps/web/app`

Route groups in brackets do not appear in the URL. `page` = a screen, `route` = an HTTP endpoint.

| URL | Kind | File |
| --- | --- | --- |
| `/` | page | `apps/web/app/page.tsx` |
| `/account` | page | `apps/web/app/(app)/account/page.tsx` |
| `/account/assistants` | page | `apps/web/app/(app)/account/assistants/page.tsx` |
| `/account/delete` | page | `apps/web/app/(app)/account/delete/page.tsx` |
| `/account/email` | page | `apps/web/app/(app)/account/email/page.tsx` |
| `/account/security` | page | `apps/web/app/(app)/account/security/page.tsx` |
| `/api/auth/link/[token]` | route | `apps/web/app/api/auth/link/[token]/route.ts` |
| `/api/deploys/record` | route | `apps/web/app/api/deploys/record/route.ts` |
| `/api/health` | route | `apps/web/app/api/health/route.ts` |
| `/api/media/[...key]` | route | `apps/web/app/api/media/[...key]/route.ts` |
| `/api/occasions/[id]/offline` | route | `apps/web/app/api/occasions/[id]/offline/route.ts` |
| `/api/uploads` | route | `apps/web/app/api/uploads/route.ts` |
| `/api/webhooks/email` | route | `apps/web/app/api/webhooks/email/route.ts` |
| `/api/webhooks/invoicing` | route | `apps/web/app/api/webhooks/invoicing/route.ts` |
| `/api/webhooks/stripe` | route | `apps/web/app/api/webhooks/stripe/route.ts` |
| `/business` | page | `apps/web/app/(app)/business/page.tsx` |
| `/business/[businessId]` | page | `apps/web/app/(app)/business/[businessId]/page.tsx` |
| `/business/[businessId]/branding` | page | `apps/web/app/(app)/business/[businessId]/branding/page.tsx` |
| `/business/[businessId]/catalogues` | page | `apps/web/app/(app)/business/[businessId]/catalogues/page.tsx` |
| `/business/[businessId]/catalogues/[catalogueId]` | page | `apps/web/app/(app)/business/[businessId]/catalogues/[catalogueId]/page.tsx` |
| `/business/[businessId]/enquiries` | page | `apps/web/app/(app)/business/[businessId]/enquiries/page.tsx` |
| `/business/[businessId]/enquiries/[enquiryId]` | page | `apps/web/app/(app)/business/[businessId]/enquiries/[enquiryId]/page.tsx` |
| `/business/[businessId]/enquiries/[enquiryId]/reply` | route | `apps/web/app/(app)/business/[businessId]/enquiries/[enquiryId]/reply/route.ts` |
| `/business/[businessId]/library` | page | `apps/web/app/(app)/business/[businessId]/library/page.tsx` |
| `/business/[businessId]/listings/[listingId]` | page | `apps/web/app/(app)/business/[businessId]/listings/[listingId]/page.tsx` |
| `/business/[businessId]/listings/[listingId]/spaces` | page | `apps/web/app/(app)/business/[businessId]/listings/[listingId]/spaces/page.tsx` |
| `/business/[businessId]/listings/[listingId]/spaces/[spaceId]` | page | `apps/web/app/(app)/business/[businessId]/listings/[listingId]/spaces/[spaceId]/page.tsx` |
| `/business/[businessId]/listings/new` | page | `apps/web/app/(app)/business/[businessId]/listings/new/page.tsx` |
| `/business/[businessId]/occasions` | page | `apps/web/app/(app)/business/[businessId]/occasions/page.tsx` |
| `/business/[businessId]/occasions/[occasionId]` | page | `apps/web/app/(app)/business/[businessId]/occasions/[occasionId]/page.tsx` |
| `/business/[businessId]/plan` | page | `apps/web/app/(app)/business/[businessId]/plan/page.tsx` |
| `/business/[businessId]/reports` | page | `apps/web/app/(app)/business/[businessId]/reports/page.tsx` |
| `/business/[businessId]/settings` | page | `apps/web/app/(app)/business/[businessId]/settings/page.tsx` |
| `/business/[businessId]/team` | page | `apps/web/app/(app)/business/[businessId]/team/page.tsx` |
| `/business/invite/[token]` | page | `apps/web/app/(app)/business/invite/[token]/page.tsx` |
| `/claim/[listingId]` | page | `apps/web/app/claim/[listingId]/page.tsx` |
| `/claim/[listingId]/remove` | page | `apps/web/app/claim/[listingId]/remove/page.tsx` |
| `/console` | page | `apps/web/app/console/page.tsx` |
| `/console/access` | page | `apps/web/app/console/access/page.tsx` |
| `/console/appearance` | page | `apps/web/app/console/appearance/page.tsx` |
| `/console/approvals` | page | `apps/web/app/console/approvals/page.tsx` |
| `/console/audit` | page | `apps/web/app/console/audit/page.tsx` |
| `/console/audit/export` | route | `apps/web/app/console/audit/export/route.ts` |
| `/console/businesses` | page | `apps/web/app/console/businesses/page.tsx` |
| `/console/businesses/[id]` | page | `apps/web/app/console/businesses/[id]/page.tsx` |
| `/console/commercial` | page | `apps/web/app/console/commercial/page.tsx` |
| `/console/communications` | page | `apps/web/app/console/communications/page.tsx` |
| `/console/compliance` | page | `apps/web/app/console/compliance/page.tsx` |
| `/console/compliance/[id]/export` | route | `apps/web/app/console/compliance/[id]/export/route.ts` |
| `/console/deploys` | page | `apps/web/app/console/deploys/page.tsx` |
| `/console/directory` | page | `apps/web/app/console/directory/page.tsx` |
| `/console/discovery` | page | `apps/web/app/console/discovery/page.tsx` |
| `/console/discovery/drafts/[id]` | page | `apps/web/app/console/discovery/drafts/[id]/page.tsx` |
| `/console/discovery/sources/[id]` | page | `apps/web/app/console/discovery/sources/[id]/page.tsx` |
| `/console/discovery/sources/new` | page | `apps/web/app/console/discovery/sources/new/page.tsx` |
| `/console/incidents` | page | `apps/web/app/console/incidents/page.tsx` |
| `/console/launch` | page | `apps/web/app/console/launch/page.tsx` |
| `/console/moderation` | page | `apps/web/app/console/moderation/page.tsx` |
| `/console/moderation/[id]` | page | `apps/web/app/console/moderation/[id]/page.tsx` |
| `/console/operations` | page | `apps/web/app/console/operations/page.tsx` |
| `/console/reports` | page | `apps/web/app/console/reports/page.tsx` |
| `/console/reports/[id]` | page | `apps/web/app/console/reports/[id]/page.tsx` |
| `/console/setup` | page | `apps/web/app/console/setup/page.tsx` |
| `/directory` | page | `apps/web/app/directory/page.tsx` |
| `/directory/[category]/[county]` | page | `apps/web/app/directory/[category]/[county]/page.tsx` |
| `/directory/[category]/[county]/[locality]` | page | `apps/web/app/directory/[category]/[county]/[locality]/page.tsx` |
| `/directory/listing/[id]` | page | `apps/web/app/directory/listing/[id]/page.tsx` |
| `/directory/listing/[id]/enquire` | page | `apps/web/app/directory/listing/[id]/enquire/page.tsx` |
| `/e/[slug]` | page | `apps/web/app/e/[slug]/page.tsx` |
| `/e/[slug]/r/[token]` | page | `apps/web/app/e/[slug]/r/[token]/page.tsx` |
| `/g/[token]` | page | `apps/web/app/g/[token]/page.tsx` |
| `/g/q/[qrId]` | page | `apps/web/app/g/q/[qrId]/page.tsx` |
| `/help` | page | `apps/web/app/help/page.tsx` |
| `/help/[slug]` | page | `apps/web/app/help/[slug]/page.tsx` |
| `/invite/[token]` | page | `apps/web/app/invite/[token]/page.tsx` |
| `/mcp` | route | `apps/web/app/mcp/route.ts` |
| `/occasions` | page | `apps/web/app/(app)/occasions/page.tsx` |
| `/occasions/[id]` | page | `apps/web/app/(app)/occasions/[id]/page.tsx` |
| `/occasions/[id]/budget` | page | `apps/web/app/(app)/occasions/[id]/budget/page.tsx` |
| `/occasions/[id]/budget/expenses/[expenseId]` | page | `apps/web/app/(app)/occasions/[id]/budget/expenses/[expenseId]/page.tsx` |
| `/occasions/[id]/contributions` | page | `apps/web/app/(app)/occasions/[id]/contributions/page.tsx` |
| `/occasions/[id]/day` | page | `apps/web/app/(app)/occasions/[id]/day/page.tsx` |
| `/occasions/[id]/deliveries` | page | `apps/web/app/(app)/occasions/[id]/deliveries/page.tsx` |
| `/occasions/[id]/flowers` | page | `apps/web/app/(app)/occasions/[id]/flowers/page.tsx` |
| `/occasions/[id]/gifts` | page | `apps/web/app/(app)/occasions/[id]/gifts/page.tsx` |
| `/occasions/[id]/guests` | page | `apps/web/app/(app)/occasions/[id]/guests/page.tsx` |
| `/occasions/[id]/guests/[householdId]` | page | `apps/web/app/(app)/occasions/[id]/guests/[householdId]/page.tsx` |
| `/occasions/[id]/guests/export` | route | `apps/web/app/(app)/occasions/[id]/guests/export/route.ts` |
| `/occasions/[id]/guests/import` | page | `apps/web/app/(app)/occasions/[id]/guests/import/page.tsx` |
| `/occasions/[id]/guests/import/upload` | route | `apps/web/app/(app)/occasions/[id]/guests/import/upload/route.ts` |
| `/occasions/[id]/guests/settings` | page | `apps/web/app/(app)/occasions/[id]/guests/settings/page.tsx` |
| `/occasions/[id]/ledger` | page | `apps/web/app/(app)/occasions/[id]/ledger/page.tsx` |
| `/occasions/[id]/menu` | page | `apps/web/app/(app)/occasions/[id]/menu/page.tsx` |
| `/occasions/[id]/operate` | page | `apps/web/app/(app)/occasions/[id]/operate/page.tsx` |
| `/occasions/[id]/operate/checkin` | page | `apps/web/app/(app)/occasions/[id]/operate/checkin/page.tsx` |
| `/occasions/[id]/operate/checklist` | page | `apps/web/app/(app)/occasions/[id]/operate/checklist/page.tsx` |
| `/occasions/[id]/operate/offline` | page | `apps/web/app/(app)/occasions/[id]/operate/offline/page.tsx` |
| `/occasions/[id]/operate/rehearsal` | page | `apps/web/app/(app)/occasions/[id]/operate/rehearsal/page.tsx` |
| `/occasions/[id]/operate/sustainability` | page | `apps/web/app/(app)/occasions/[id]/operate/sustainability/page.tsx` |
| `/occasions/[id]/polls` | page | `apps/web/app/(app)/occasions/[id]/polls/page.tsx` |
| `/occasions/[id]/print` | page | `apps/web/app/(app)/occasions/[id]/print/page.tsx` |
| `/occasions/[id]/print/[key]` | route | `apps/web/app/(app)/occasions/[id]/print/[key]/route.ts` |
| `/occasions/[id]/programme` | page | `apps/web/app/(app)/occasions/[id]/programme/page.tsx` |
| `/occasions/[id]/promotion` | page | `apps/web/app/(app)/occasions/[id]/promotion/page.tsx` |
| `/occasions/[id]/promotion/download/[asset]` | route | `apps/web/app/(app)/occasions/[id]/promotion/download/[asset]/route.ts` |
| `/occasions/[id]/proposals` | page | `apps/web/app/(app)/occasions/[id]/proposals/page.tsx` |
| `/occasions/[id]/public-page` | page | `apps/web/app/(app)/occasions/[id]/public-page/page.tsx` |
| `/occasions/[id]/requests` | page | `apps/web/app/(app)/occasions/[id]/requests/page.tsx` |
| `/occasions/[id]/seating` | page | `apps/web/app/(app)/occasions/[id]/seating/page.tsx` |
| `/occasions/[id]/settings` | page | `apps/web/app/(app)/occasions/[id]/settings/page.tsx` |
| `/occasions/[id]/settings/closeout` | page | `apps/web/app/(app)/occasions/[id]/settings/closeout/page.tsx` |
| `/occasions/[id]/space` | page | `apps/web/app/(app)/occasions/[id]/space/page.tsx` |
| `/occasions/[id]/stationery` | page | `apps/web/app/(app)/occasions/[id]/stationery/page.tsx` |
| `/occasions/[id]/stationery/pdf` | route | `apps/web/app/(app)/occasions/[id]/stationery/pdf/route.ts` |
| `/occasions/[id]/stationery/thumb` | route | `apps/web/app/(app)/occasions/[id]/stationery/thumb/route.ts` |
| `/occasions/[id]/suppliers` | page | `apps/web/app/(app)/occasions/[id]/suppliers/page.tsx` |
| `/occasions/[id]/suppliers/[supplierId]` | page | `apps/web/app/(app)/occasions/[id]/suppliers/[supplierId]/page.tsx` |
| `/occasions/[id]/suppliers/enquiries` | page | `apps/web/app/(app)/occasions/[id]/suppliers/enquiries/page.tsx` |
| `/occasions/[id]/suppliers/enquiries/[enquiryId]` | page | `apps/web/app/(app)/occasions/[id]/suppliers/enquiries/[enquiryId]/page.tsx` |
| `/occasions/[id]/tasks` | page | `apps/web/app/(app)/occasions/[id]/tasks/page.tsx` |
| `/occasions/[id]/tasks/[taskId]` | page | `apps/web/app/(app)/occasions/[id]/tasks/[taskId]/page.tsx` |
| `/occasions/[id]/tasks/new` | page | `apps/web/app/(app)/occasions/[id]/tasks/new/page.tsx` |
| `/occasions/[id]/team` | page | `apps/web/app/(app)/occasions/[id]/team/page.tsx` |
| `/occasions/[id]/team/[memberId]` | page | `apps/web/app/(app)/occasions/[id]/team/[memberId]/page.tsx` |
| `/occasions/[id]/travel` | page | `apps/web/app/(app)/occasions/[id]/travel/page.tsx` |
| `/occasions/[id]/travel/groups` | page | `apps/web/app/(app)/occasions/[id]/travel/groups/page.tsx` |
| `/occasions/[id]/travel/itinerary` | page | `apps/web/app/(app)/occasions/[id]/travel/itinerary/page.tsx` |
| `/occasions/[id]/travel/itinerary/import` | page | `apps/web/app/(app)/occasions/[id]/travel/itinerary/import/page.tsx` |
| `/occasions/[id]/travel/packing` | page | `apps/web/app/(app)/occasions/[id]/travel/packing/page.tsx` |
| `/occasions/[id]/travel/rooms` | page | `apps/web/app/(app)/occasions/[id]/travel/rooms/page.tsx` |
| `/occasions/[id]/travel/settlement` | page | `apps/web/app/(app)/occasions/[id]/travel/settlement/page.tsx` |
| `/occasions/[id]/travel/transport` | page | `apps/web/app/(app)/occasions/[id]/travel/transport/page.tsx` |
| `/occasions/new` | page | `apps/web/app/(app)/occasions/new/page.tsx` |
| `/offline` | page | `apps/web/app/offline/page.tsx` |
| `/report` | page | `apps/web/app/report/page.tsx` |
| `/s/[token]` | page | `apps/web/app/s/[token]/page.tsx` |
| `/sign-in` | page | `apps/web/app/(auth)/sign-in/page.tsx` |
| `/sign-in/anonymous` | page | `apps/web/app/(auth)/sign-in/anonymous/page.tsx` |
| `/sign-in/anonymous/new` | page | `apps/web/app/(auth)/sign-in/anonymous/new/page.tsx` |
| `/sign-in/anonymous/recover` | page | `apps/web/app/(auth)/sign-in/anonymous/recover/page.tsx` |
| `/sign-in/link/[token]` | page | `apps/web/app/(auth)/sign-in/link/[token]/page.tsx` |
| `/sign-in/two-step` | page | `apps/web/app/(auth)/sign-in/two-step/page.tsx` |
| `/sign-out` | page | `apps/web/app/(auth)/sign-out/page.tsx` |

## 7. Server actions — `apps/web/app/actions` and console actions

| File | Exported actions |
| --- | --- |
| `apps/web/app/actions/account.ts` | `requestFreshCode` `confirmFresh` `saveLanguage` `signOutSession` `signOutEverywhereAction` `startTwoStep` `confirmTwoStep` `turnOffTwoStep` `newRecoveryCodes` `requestEmailCode` `confirmEmail` `removeLoginEmail` `deleteAccount` `undoDeleteAccount` |
| `apps/web/app/actions/aitext.ts` | `suggestTextAction` `acceptAiTextAction` |
| `apps/web/app/actions/arrangements.ts` | `saveArrangementAction` `archiveArrangementAction` `requestArrangementQuoteAction` |
| `apps/web/app/actions/auth.ts` | `setLanguage` `requestCode` `verifyCode` `resendFromLink` `verifyTwoStep` `anonymousSignUp` `anonymousSignIn` `anonymousRecover` `signOutAction` |
| `apps/web/app/actions/billing.ts` | `recordAcceptanceAction` `requestEnableAction` `requestDisableAction` `setMonthlyCostAction` `requestPriceChangeAction` `requestRefundAction` `sandboxCheckoutAction` `startCheckoutAction` `cancelSubscriptionAction` |
| `apps/web/app/actions/bizoccasions.ts` | `createBusinessOccasionAction` `takeBusinessSeatAction` `saveBrandingAction` `saveTeamGrantsAction` `addLibraryItemAction` `updateLibraryItemAction` `archiveLibraryItemAction` `applyLibraryItemAction` `shareLibraryFileAction` `proposeHandoverAction` |
| `apps/web/app/actions/budget.ts` | `addPresetCategories` `addCategory` `saveCategory` `deleteCategory` `addExpense` `saveExpense` `decideExpense` `payExpense` `correctPaidExpense` `removeExpense` |
| `apps/web/app/actions/business.ts` | `createBusinessAction` `saveBusinessSettings` `inviteBusinessMemberAction` `changeBusinessMemberRole` `removeBusinessMemberAction` `acceptBusinessInviteAction` `dismissBusinessNotices` |
| `apps/web/app/actions/catalogues.ts` | `createCatalogueAction` `renameCatalogueAction` `saveCatalogueItemAction` `removeCatalogueItemAction` `submitCatalogueAction` `discardCatalogueDraftAction` `retireCatalogueAction` |
| `apps/web/app/actions/claims.ts` | `startClaimAction` `resendClaimCodeAction` `verifyClaimCodeAction` `cancelClaimAction` `submitObjectionAction` |
| `apps/web/app/actions/comms.ts` | `sendNoticeAction` |
| `apps/web/app/actions/console.ts` | `approveApproval` `rejectApproval` `cancelApproval` `requestStaffRoles` `requestSignInLimits` `openIncident` `closeIncident` `saveLaunchItem` `saveLaunchRecords` `saveLegalPublished` `beginReportReview` `decideReport` `leaveConsole` |
| `apps/web/app/actions/contributions.ts` | `saveNeedAction` `removeNeedAction` `setMyContributionAction` `setGuestContributionAction` |
| `apps/web/app/actions/deliveries.ts` | `createDeliveryAction` `deleteDeliveryAction` `addDeliveryItemAction` `removeDeliveryItemAction` `recordReceiptAction` `recordReturnAction` `correctReceivedQtyAction` `correctReturnedQtyAction` `markDepositRecoveredAction` `correctDepositRecoveredAction` |
| `apps/web/app/actions/deploys.ts` | `requestDeployAction` `emergencyDeployAction` `rollbackAction` `abandonDeployAction` |
| `apps/web/app/actions/directory.ts` | `hideDirectoryLink` `showDirectoryLink` `addCategory` `renameCategory` `setCategoryFlag` `moveCategoryAction` `mergeCategoryAction` `addCounty` `renameCounty` `setCountyFlag` `mergeCountyAction` `addLocality` `renameLocality` `setLocalityFlag` `mergeLocalityAction` |
| `apps/web/app/actions/discovery.ts` | `createSourceAction` `updateSourceAction` `setSourceEnabledAction` `runSourceAction` `setDraftPlaceAction` `decideDraftsAction` `decideObjectionAction` `submitClaimAction` `rejectClaimAction` |
| `apps/web/app/actions/drawings.ts` | `createSpaceAction` `updateSpaceDetailsAction` `attachDrawingAction` `calibrateSpaceAction` `saveMarkingsAction` `submitSpaceAction` `withdrawSpaceRevisionAction` `retireSpaceAction` `submitParkingAction` |
| `apps/web/app/actions/enquiries.ts` | `sendEnquiryAction` `replyPlannerAction` `closeEnquiryAction` `resendEnquiryAction` `reportEnquiryAction` `acceptQuoteAction` |
| `apps/web/app/actions/eventday.ts` | `setDayStateAction` `addDayItemAction` `setDayDetailsAction` `recordReadinessAction` |
| `apps/web/app/actions/featured.ts` | `createFeaturedSlotAction` `endFeaturedSlotAction` |
| `apps/web/app/actions/gifts.ts` | `estimateGiftAction` `saveGiftEstimateAction` `deleteGiftEstimateAction` `saveGiftGuideAction` `resetGiftGuideAction` |
| `apps/web/app/actions/guests.ts` | `createHouseholdAction` `updateHouseholdAction` `addGuestAction` `removeGuestAction` `regenerateInvitationAction` `revokeInvitationAction` `setInvitationExpiryAction` `proposeRemoveHouseholdAction` `recordRsvpAction` `setRsvpDeadlineAction` `setCapacityAction` `saveRsvpQuestionAction` `removeRsvpQuestionAction` `moveRsvpQuestionAction` `sendInvitationEmailsAction` `remapGuestImportAction` |
| `apps/web/app/actions/integration.ts` | `saveDisplayName` `saveInvitationText` `removePlanNote` |
| `apps/web/app/actions/ledger.ts` | `addLedgerParticipant` `removeLedgerParticipant` `addSharedCost` `settleTransfer` `voidEntry` |
| `apps/web/app/actions/lifecycle.ts` | `proposeCancelAction` `proposePostponeAction` `proposeCloseAction` `saveLessonAction` |
| `apps/web/app/actions/listings.ts` | `saveListing` `withdrawListingRevision` `retireListingAction` `setListingStatsVisibility` |
| `apps/web/app/actions/mcp.ts` | `createAssistantToken` `acceptAssistantConsent` `revokeAssistantToken` |
| `apps/web/app/actions/members.ts` | `inviteMemberAction` `saveMemberLabel` `saveMemberAccess` `removeMemberAction` `transferOwnershipAction` `acceptInviteAction` |
| `apps/web/app/actions/menus.ts` | `saveMenuAction` `removeMenuAction` `saveMenuItemAction` `removeMenuItemAction` `saveMenuSettingsAction` `saveDrinkRuleAction` `removeDrinkRuleAction` `pushMenuToOrderAction` `setMealChoicesAction` |
| `apps/web/app/actions/moderation.ts` | `decideRevisionAction` `saveModerationTarget` `setBusinessStatusAction` `suspendListingAction` `restoreListingAction` `recordFactCheckAction` `withdrawFactCheckAction` |
| `apps/web/app/actions/occasions.ts` | `createOccasionAction` `saveOccasionDetails` `proposeMoveDateAction` `proposeTemplateAction` `deleteOccasionAction` `undoDeleteOccasionAction` |
| `apps/web/app/actions/operate.ts` | `checkInByQrAction` `checkInHouseholdAction` `correctCheckInAction` `resolveConflictAction` `createGoalAction` `deleteGoalAction` `recordMeasurementAction` |
| `apps/web/app/actions/polls.ts` | `addPollDatesAction` `removePollDateAction` `closePollAction` `confirmPollDateAction` `castPollVotesAction` |
| `apps/web/app/actions/programme.ts` | `saveProgrammeItemAction` `removeProgrammeItemAction` `setProgrammeVisibilityAction` `saveCueListAction` `includeProgrammeInBriefingAction` |
| `apps/web/app/actions/promotion.ts` | `savePromotionTextsAction` |
| `apps/web/app/actions/publicpage.ts` | `savePublicPageAction` `savePublicQuestionAction` `removePublicQuestionAction` `cancelRegistrationAction` `promoteRegistrationAction` `saveJourneyAction` `registerPublicAction` `cancelOwnRegistrationAction` |
| `apps/web/app/actions/report.ts` | `submitReport` |
| `apps/web/app/actions/requests.ts` | `setRequestStatusAction` `shareRequestCountsAction` `submitGuestRequestAction` `submitRegistrantRequestAction` |
| `apps/web/app/actions/rsvp.ts` | `submitRsvpAction` |
| `apps/web/app/actions/seating.ts` | `addTableAction` `addFixtureAction` `moveItemAction` `updateItemAction` `removeItemAction` `setStageItemAction` `addMealStageAction` `addDefaultStagesAction` `renameMealStageAction` `moveMealStageAction` `removeMealStageAction` `assignSeatsAction` `unassignSeatsAction` `setSeatNumberAction` `publishSeatingAction` `unpublishSeatingAction` |
| `apps/web/app/actions/space.ts` | `attachVenueSpaceAction` `createOwnSpaceAction` `updateOwnSpaceAction` `removeSpaceModelAction` `proposeDrawingUpdateAction` |
| `apps/web/app/actions/stationery.ts` | `previewStationeryAction` `saveStationeryAction` `markStationeryProofedAction` `setDigitalInvitationAction` |
| `apps/web/app/actions/suppliers.ts` | `createSupplierAction` `updateSupplierAction` `deleteSupplierAction` `setBookingStateAction` `updateBookingTermsAction` `attachQuoteAction` `removeQuoteAction` `publishBriefingAction` `createOrderSnapshotAction` `addPaymentDeadlineAction` `removePaymentDeadlineAction` `markPaymentPaidAction` `correctPaymentPaidAction` `proposeMovePaymentAction` `createSupplierLinkAction` `revokeSupplierLinkAction` `acknowledgeBriefingAction` |
| `apps/web/app/actions/tasks.ts` | `addTask` `saveTask` `changeTaskStatus` `removeTask` `addChecklistItem` `toggleChecklistItem` `removeChecklistItem` `addTaskDependency` `removeTaskDependency` `offerTaskAction` `acceptOfferAction` `declineOfferAction` `withdrawOfferAction` |
| `apps/web/app/actions/travel.ts` | `createLegAction` `updateLegAction` `deleteLegAction` `proposeImportAction` `createSubgroupAction` `setSubgroupPeopleAction` `deleteSubgroupAction` `createActivityAction` `deleteActivityAction` `optInAction` `createPackingListAction` `addPackingItemAction` `setPackingItemAction` `removePackingItemAction` `deletePackingListAction` `createTransportAction` `deleteTransportAction` `setTransportPeopleAction` `claimSeatAction` `createRoomAction` `updateRoomAction` `deleteRoomAction` `assignRoomAction` `unassignRoomAction` `addTripCostAction` `setExchangeNoteAction` |
| `apps/web/app/actions/uploads.ts` | `uploadFile` `deleteUpload` |
| `apps/web/app/actions/whatif.ts` | `confirmWhatIf` `discardWhatIf` |
| `apps/web/app/console/appearance/actions.ts` | `saveUiTheme` |
| `apps/web/app/console/compliance/actions.ts` | `requestComplianceAccessAction` `revokeComplianceAccessAction` |

## 8. Translations — `packages/i18n/messages/{ro,en}/<namespace>.json`

`account` `aitext` `arrangements` `auth` `billing` `bizoccasions` `briefing` `budget` `business` `catalogues` `claims` `common` `comms` `console` `contributions` `cookies` `corrections` `deliveries` `deploys` `digest` `directory` `discovery` `drawings` `emails` `enquiries` `eventday` `featured` `gifts` `guestevent` `guests` `guides` `help` `helpAccount` `helpBusiness` `helpGuests` `helpInvited` `helpMoney` `helpPlan` `helpPrivacy` `helpSpace` `helpStaff` `helpStart` `helpSuppliers` `helpTravel` `helpTrouble` `ledger` `legal` `lifecycle` `listings` `mcp` `menus` `moderation` `nav` `occasions` `operate` `overview` `platform` `polls` `printpack` `programme` `promotion` `publicpage` `report` `requests` `rsvp` `seating` `site` `space` `stationery` `suppliers` `tasks` `team` `templates` `travel` `whatif`

## 9. MCP tools — `packages/mcp/src`

| Tool | Scope | File |
| --- | --- | --- |
| `get_budget_summary` | read | `packages/mcp/src/tools-money.ts` |
| `get_listing` | read | `packages/mcp/src/tools-directory.ts` |
| `get_occasion` | read | `packages/mcp/src/tools-planning.ts` |
| `get_rsvp_summary` | read | `packages/mcp/src/tools-planning.ts` |
| `get_seating_summary` | read | `packages/mcp/src/tools-space.ts` |
| `get_space_model` | read | `packages/mcp/src/tools-space.ts` |
| `list_catalogues` | read | `packages/mcp/src/tools-directory.ts` |
| `list_directory_filters` | read | `packages/mcp/src/tools-directory.ts` |
| `list_households` | read | `packages/mcp/src/tools-planning.ts` |
| `list_occasions` | read | `packages/mcp/src/tools-planning.ts` |
| `list_pending_proposals` | read | `packages/mcp/src/tools-planning.ts` |
| `list_suppliers` | read | `packages/mcp/src/tools-money.ts` |
| `list_tasks` | read | `packages/mcp/src/tools-planning.ts` |
| `propose_arrangement_design` | propose | `packages/mcp/src/tools-arrangements.ts` |
| `propose_budget` | propose | `packages/mcp/src/tools-money.ts` |
| `propose_budget_note` | propose | `packages/mcp/src/tools-money.ts` |
| `propose_custom_table` | propose | `packages/mcp/src/tools-space.ts` |
| `propose_invitation_text` | propose | `packages/mcp/src/tools-planning.ts` |
| `propose_seating_layout` | propose | `packages/mcp/src/tools-space.ts` |
| `propose_supplier_shortlist` | propose | `packages/mcp/src/tools-directory.ts` |
| `propose_task_list` | propose | `packages/mcp/src/tools-planning.ts` |
| `search_directory` | read | `packages/mcp/src/tools-directory.ts` |
| `whoami` | read | `packages/mcp/src/builtin.ts` |

## 10. Shared UI — `packages/ui/src`

- Server-safe components (`components.tsx`): `cx` `Page` `Stack` `Cluster` `Grid` `VisuallyHidden` `Eyebrow` `Lead` `Unknown` `ValueOrUnknown` `PageHeader` `Section` `Card` `GiltRule` `Button` `LinkButton` `buttonClassName` `IconButton` `ExternalLink` `Field` `fieldDescribedBy` `TextField` `TextareaField` `SelectField` `Input` `Select` `Textarea` `Checkbox` `ChoiceChips` `Tag` `Fact` `PaidLabel` `Notice` `Figure` `Figures` `Meter` `BarList` `List` `Row` `DescriptionList` `Table` `EmptyState` `Skeleton` `DeltaList` `Seal` `Wordmark` `Invitation` `StepProgress`
- Interactive components (`client.tsx`): `SubmitButton` `Sheet` `SheetTrigger` `Stepper` `CopyButton` `FocusFirstError`
- Icons: `icons.tsx` · tokens: `tokens.css` · classes: `components.css`, `shell.css`

