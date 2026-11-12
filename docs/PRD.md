---
name: "gathertable-prd-ro"
title: "EventDesk.ro — PRD (v4, Romanian market)"
type: "text/markdown"
---

# EventDesk.ro — Product Requirements Document (Romania edition, v4.9)

Nov 12, 2026 · v3 adapts the v2.3 UK draft for deployment in Romania: Romanian as the product's primary language, English as optional localization, RON pricing, Romanian legal entities and authorities. This document is written in English as the working spec; the product interface ships in Romanian first (L1). Based on the v14 build blueprint; blueprint sections in brackets. Nothing described here is built yet.

## Change log: UK v2.3 draft history, then the Romania edition

1. **Featured placement clarified** as the paid route ahead of non-paying businesses (revised P13–P16, principle 7 reworded). The paid advantage is prime position above organic results; the guardrails that remain are: payment never changes organic order, labels are honest, and paid content never leaks into plans, guest pages or exports.
2. **New: venue floor plans.** Businesses can upload drawings that define available space and standard table sizes (V1–V4).
3. **New: custom table sizes.** Planners can define custom table dimensions for seating layouts (V5).
4. **New: flower catalogues and a flower arrangement designer.** Businesses publish flower catalogues; planners design or upload an arrangement and send it to suppliers for a quote (F1–F6).
5. Seating and table layout requirements from release C are folded into the venue-space section so one space model drives layout, seating and fit checks.
6. **New: admin console.** A full website management console for the operator (W1–W9), expanding the existing staff-console requirements.
7. **New: business discovery.** A tool that automatically finds candidate businesses and creates unclaimed draft listings, so the directory starts populated (BD1–BD7). Drafts are human-approved before going live; only lawfully published business contact data is collected.
8. **New: assumption review.** A reviewer pass found ten silent assumptions; all are bridged in v2.2 (new P29–P30, V7, Q9, W9, and explicit definitions in P2, P11, P15, BD5). Findings and verdict are recorded in section 14.
9. **New: design language.** Five UI directions were designed and evaluated; one is adopted as the primary visual language with two situational surfaces and one cross-cutting convention (section 21).
10. **Romania edition (v3).** Market, language, currency and prices, geography, legal and compliance mapping, and the occasion mix change as follows in this document: Romanian primary language with English localization (L1, Q11); RON prices (Business plan 199 RON a month or 1,990 RON a year, Featured 149 RON a month, excluding TVA); counties and localities replace postcode areas, with Bucharest (Ilfov) and Cluj proposed as launch areas; EU GDPR under ANSPDCP and ePrivacy/Legea nr. 506/2004 replace UK PECR; badges and discovery sources map to the Romanian Trade Register (ONRC); botez and revelion join the first planner segment; label and badge wording is Romanian with an English toggle.
11. **Free-first monetization (v3.2).** At launch the entire product is free for everyone, including businesses: no payment UI exists anywhere and Stripe is not required for release P to go live. Monetization is a single platform-level switch in the admin console (W6), OFF by default; when it is later enabled, the Business plan and Featured placement become paid for new purchases after a 60-day public notice, and nothing is ever charged automatically. This supersedes the "launch offer" mechanic: the free phase is the launch offer. Requirements MON1–MON5 (section 8); gates M2–M4 reworded (section 12).
12. **Rename and fresh review (v4).** The platform is named **EventDesk.ro**; every reference, label and example is updated. A fresh coding-agent review (section 18) found eleven assumptions a builder would have had to make about infrastructure, notification channels, sign-in rules, retention, AI scope and time handling; all are bridged by the INF requirements and the retention table.
13. **Console deployments (v4.1).** The management page can update the platform directly from one private GitHub repository (W10, DEP1–DEP6): GitHub App integration scoped to that repo, tag-based deploys with second-person approval, backup-then-migrate job flow with automatic health-check rollback, and full deploy audit history.
14. **MCP server (v4.2).** Customers can connect their own AI assistant to EventDesk over Model Context Protocol (MCP1–MCP7): personal scoped tokens, read tools bounded by the user's own access grants, propose-only writes that pass the normal What if? confirmation, per-token consent warnings, external-assistant labelling, and no access to admin, payment or other accounts' data.
15. **User security hardening (v4.3).** A security review of every user-facing surface bridged ten risks with SEC1–SEC10: enumeration-safe sign-in with single-use codes, unguessable expiring guest links, sign-out-everywhere, re-encoded uploads and sandboxed PDF serving, strict CSP and security headers, CSRF and SSRF protections, referrer-leak prevention on scoped pages, hashed tokens, annual backup-key rotation, and an append-only audit log.
16. **Login rate limiting (v4.5).** The sign-in surface gets its own protection (SEC16): rate limits on three independent axes (per email, per IP, per device cookie), console-adjustable defaults, enumeration-safe throttle messages, escalating backoff without lockout, and security-log recording.
17. **Launch obligations (v4.6).** A final production-readiness pass added section 20 (LAU1–LAU7): legal documents (terms, privacy policy, cookie notice) before first signup, ANSPDCP formalities and DPIA for discovery and MCP, email-domain warm-up, an external penetration test before first guest link, monitoring with stated RTO/RPO, written business terms quoting the Featured rules, and a two-person launch runbook. These are operator gates, each with a named owning role.
18. **Regulatory duties (v4.7).** A legal-risk review added LAU8 (Digital Services Act: ANCOM registration, notice-and-action mechanism, moderation transparency, annual reporting) and LAU9 (European Accessibility Act: accessibility statement and complaint route); the discovery crawler's GDPR exposure is confirmed as covered by BD1–BD7, P29–P30 and the LAU2 DPIA.
19. **MCP controller position (v4.8).** A legal clarification is recorded in section 8's MCP design note: connecting a user's own AI assistant narrows the disclosure scope but does not transfer EventDesk's controller duties; the per-token warning, privacy-policy disclosure and transfer safeguards are stated as explicit obligations, and the LAU2 DPIA covers the MCP surface.
20. **Children as counts and anonymous accounts (v4.9).** A6 now states that children are never recorded as persons, only as an attending count per household, with a warning against typing child details into free-text questions. New S7–S8 add fully anonymous planner accounts: random username plus password, no email, equal features with visibly degraded email-dependent ones, Argon2id-hashed passwords, enumeration-safe failures, SEC16 rate limits, recovery codes instead of email recovery, and a stated unrecoverability warning. Business accounts still require an email (P29 claim verification).

## 1. Summary

EventDesk is a free web app, usable on phones, for planning any occasion as one project: a solo holiday, a group trip, a birthday or a wedding. Planners never pay. Businesses that serve planners fund the service through an optional Business plan and optional Featured placement in a business directory, which is the built-in way for a paying business to appear ahead of non-paying competitors.

| Item | Position |
| --- | --- |
| Planner price | Free for every occasion, no trial, no card |
| Business plan | 199 RON a month or 1,990 RON a year, excluding TVA (pilot price) |
| Featured placement | 149 RON a month per listing per category, excluding TVA (pilot price) |
| Launch position | Everything free at launch, planners and businesses; payments off; monetization enabled later from the admin console with 60 days' notice |
| Future pilot prices | Business plan 199 RON a month or 1,990 RON a year; Featured 149 RON a month per listing per category; both excluding TVA, charged only after monetization is switched on |
| Advertising | None anywhere in the product; Featured placement (once monetized) is the only paid visibility |
| First market | Romania, Romanian primary with English localization, RON |
| Review status | v13 text reviewed; v14 changes and this v2 draft not yet independently reviewed |

## 2. Problem and opportunity

People planning an occasion spread it across group chats, spreadsheets, shared notes and supplier emails. Nothing connects who is coming, who is bringing what, what it costs and what has actually been agreed.

- **Planners** lose track when something changes. Two extra guests after the catering deadline should raise a catering decision, not vanish in a chat thread.
- **Guests** are asked the same questions several times and cannot see what they committed to.
- **Small event businesses** (venues, caterers, bands, florists) pay for directory listings without knowing whether real enquiries follow.

The opportunity is one connected plan for the planner, with a directory inside it where a business is found at the moment the planner needs that kind of supplier, and where the planner can work with real supplier materials: venue drawings, table sizes, flower catalogues and arrangement designs. Demand from both sides is unvalidated (section 13).

## 3. Goals and non-goals

**Goals**

1. A planner can create, share and run a small occasion from a phone in minutes, with only an emailed sign-in code.
2. Every change shows its effect on cost, timing and commitments before it is applied (the "What if?" preview).
3. Guests can respond, vote on dates and claim contributions from a link, without installing anything.
4. Planners find and contact local businesses from inside their plan, sharing only what they choose.
5. Planners can design in the tool against real supplier data: arrange seating on a business's uploaded venue drawing, define custom table sizes, and compose or upload a flower arrangement to request quotes for.
6. Businesses get a free listing and free enquiries, and can pay for more visibility or a client workspace.
7. Business income covers running costs: three consecutive months at 1.2 times cost or better (gate M5).

**Non-goals**

- No third-party advertising, affiliate links or sale of planner data.
- No charge to planners, and no paid tier for personal use.
- No booking or paying a business through the platform; the directory is listings, enquiries and quote requests only.
- No native mobile apps, native ticket checkout, navigable 3D or automatic booking and rebooking.
- No arrangement, seating or layout task that can be done only by dragging: the tap path is a first-class citizen, not a fallback (Q10).
- No reviews or testimonials on listings.
- No automatic algorithmic matching that pushes specific businesses at planners; discovery stays planner-initiated (see principle 7).
- No businesses outside Romania at launch.

## 4. Users

| User | What they need to do | Pays |
| --- | --- | --- |
| Planner (occasion owner) | Create a plan, invite people, delegate work, track money, contact suppliers, design layouts and arrangements | No |
| Collaborator (project manager, workstream lead, contributor) | Accept and complete assigned work within their scope | No |
| Guest | RSVP for their household, vote on dates, claim contributions, make private requests | No |
| Supplier on a booking | See their own booking, briefing and tasks through a scoped link | No |
| Business (owner, admin, staff) | List in the directory, publish venue drawings and catalogues, answer enquiries and quote requests, run client occasions as a team | Optional |
| Client of a business | Take part in, or take over, an occasion a business runs for them | No |
| Platform staff | Moderate listings, drawings and catalogues, handle restrictions, approve refunds and prices | Operator |

The first planner segment is adults coordinating celebrations with shared contributions and budgets. For Romania the mix is: birthdays and parties first, then weddings, botez (christenings) and Revelion (New Year's Eve) gatherings, then group travel.

## 5. Product principles

1. **Free and frictionless for planners.** No payment, trial, card or mandatory two-step sign-in. Simple occasions start as a simple checklist.
2. **One record, many views.** A task, a seat or a payment exists once. Lists, timelines, layouts, phone views and event-day views all show that same record.
3. **Preview before applying.** Changes to dates, guests or suppliers show their knock-on effects first.
4. **Facts stay facts.** Arrivals, payments and received stock are changed only by an audited correction, never overwritten.
5. **Unknown stays visible.** A missing price, dimension or confirmation is shown as unknown, never guessed and never counted as ready.
6. **Private by default.** Guests, budgets and private requests are shared only with people given that specific access.
7. **Paid means position, never preference.** Payment buys clearly labelled Featured position above organic results. Payment never changes organic directory order, never buys planner data, and paid content never appears inside plans, guest pages or exports.
8. **A lapse never blocks an event.** If a business stops paying, its clients' occasions carry on, and previously published drawings and catalogues remain readable in plans that use them.

## 6. Releases

Six releases, built in this order. Each must be a complete, usable outcome on a phone before the next starts.

| Release | Outcome for the user | Main contents |
| --- | --- | --- |
| A | Create, delegate and track a private or shared occasion | Tasks and templates, sign-in, household RSVP, date polls, contribution claims, reminders, basic exports, staff basics |
| B | Budget and deliver a simple occasion | Budget and shared costs, suppliers and orders, deliveries, event-day run sheet, readiness checks, cancellation, closeout, installable app |
| P | Serve businesses | Business accounts, directory and listings, business discovery and admin console, venue drawings and flower catalogues, enquiries, monetization switch (dormant), Business plan features free during the free phase |
| C | Design and run a celebration | Seating and table layouts on venue drawings, custom table sizes, phased meal service, entertainment, invitations, menus, public registration, promotion exports |
| D | Plan a solo or group holiday | Itinerary, booking import, subgroups, packing, transport and rooms, currencies |
| E | Rehearse and operate complex occasions | Rehearsal simulation, guest flow, QR check-in, limited offline capture, sustainability goals |

Release P depends only on A and B. Releases C to E continue on their own schedule and are not gated by business income, but spending on them is reviewed at each gate (section 12). The flower arrangement designer sits at the C/P boundary: catalogues and quote flow ship with P's enquiry system, the visual designer ships with C.

## 7. Requirements: free planning (releases A and B)

Priority is Must for the release named. Blueprint sections are in brackets.

### Release A: plan and invite

| ID | Requirement | Blueprint |
| --- | --- | --- |
| A1 | Create an occasion with a title and a date, date range or poll; activate it free with no payment step | 2.1, 19.2 |
| A2 | Start from a template (picnic, aniversare, nuntă, botez, Revelion, voiaj solo, voiaj de grup) or blank; re-running a template shows a diff and creates no duplicates; template tasks are auto-scheduled relative to the occasion date (for example 12, 9, 6, 3 and 1 month stages), and moving the occasion date shifts the schedule as a previewed change, never silently | 2.4, 18.13 |
| A3 | Tasks with one accountable owner, due date, checklist, dependencies and child tasks; List, Board and Calendar views of the same records | 2.2, 2.5 |
| A4 | Delegation by offer and acceptance; declining returns the task to the delegator, never to a random person | 2.3 |
| A5 | Roles: owner, project manager, workstream lead, contributor, supplier, guest; finance and private-request access are separate grants; role labels are localized, and Romanian occasions offer naș/nasă (godparents) and damă/naș de cununie as suggested role labels for botez and nunță | 2.3, 18.5 |
| A6 | Household invitations: a lead can respond for their party; each person's attendance is recorded per session; the planner can add custom RSVP questions (menu choice, allergies, accommodation need, transport need, plus free-text questions), shown to guests one at a time on the guest link. Children are never recorded as persons: a household response states only the number of children attending (for example "+2 copii"), with no name, age, or any other data about a child, and the guest page states this explicitly; a planner or guest who types a child's details into a free-text question is warned that children's data should not be entered | 4.1 |
| A7 | Date polls with Yes, Maybe, No; the host confirms; votes never reserve places | 10 |
| A8 | RSVP with one capacity count shared by invited and public guests; two people cannot take the last place | 10, 18.10 |
| A9 | Guest contributions: claim, change and release against a stated need; two claims cannot take the same last units | 11.1 |
| A10 | Overview with next milestone, overdue work, unaccepted delegation and blockers; daily reminder digest | 2.8 |
| A11 | Event brief with purpose and two or three priorities that the plan links to | 2.14 |
| A12 | Every screen works at phone width with 44-pixel targets. Direct manipulation (dragging) is supported where it helps, and every drag action has an equivalent tap-based path of equal quality, so no action ever requires dragging (see Q10) | 15.2 |
| A13 | Guest list import from CSV or XLSX: column mapping previewed before applying, duplicates detected against existing guests by name and household, and the import shows a diff of what will be created, changed or skipped, applied only after the planner confirms | 18.13 |

### Release B: budget and deliver

| ID | Requirement | Blueprint |
| --- | --- | --- |
| B1 | Budget by category with estimate, committed, invoiced, paid and forecast shown separately | 3.2 |
| B2 | Expenses with receipts; approval and payment are separate states | 3.3 |
| B3 | Shared costs: who paid, who benefits, who owes whom, per currency, from one balanced ledger | 3.5, 18.6 |
| B4 | Supplier records with quotes, booking states and versioned briefings the supplier acknowledges | 4.3 |
| B5 | Final-order snapshots; later guest changes show as a delta, never a silent change to the agreed order | 4.4 |
| B6 | Deliveries, hired items and returns with received quantities | 4.6 |
| B7 | Event-day view: Ready, Running, Waiting, Done, from the same task records | 2.9 |
| B8 | Readiness decisions: Hold, Proceed, Proceed with conditions, tied to evidence | 2.15 |
| B9 | Cancel or postpone with a preview of everything affected | 12 |
| B10 | Closeout list of unpaid balances, returns and deposits; lessons carried to the next occasion | 4.9, 2.17 |
| B11 | Installable app with an offline shell and a downloadable briefing | 15.1, 16.5 |
| B12 | Supplier payment deadlines: advances, instalments and final balances carry due dates; the daily digest (A10) raises upcoming and overdue payments to whoever holds finance access, and the What if? preview (goal 2) shows the money effect of moving a payment | 3.2, 3.3 |

## 8. Requirements: business module (release P)

### Directory and listings

| ID | Requirement | Blueprint |
| --- | --- | --- |
| P1 | A business creates an account and up to five listings, each with 1 to 5 categories and 1 to 20 localities across up to 5 Romanian counties (județe) | 19.4, 19.5 |
| P2 | 21 categories at launch, fixed as this list, displayed in Romanian with an English toggle: Săli de evenimente (venues); Catering; Torturi și cofetărie; Baruri mobile; Trupe (inclusiv lăutari); Muzicieni și soliști; DJ; Fotografi; Videografi; Floriști; Decorațiuni și styling; Închiriere corturi; Închiriere echipamente de petrecere; Transport autocare și microbuze; Cazare; Animatori; Coafură și make-up; Invitații și tipografie; Mașini de nuntă; Securitate și personal de evenimente; Sonorizare, AV și lumini | 19.5 |
| P3 | Every listing revision is approved by a moderator who is not a member of that business; the live version stays up while an edit is pending | 19.5 |
| P4 | Factual badges only: "Verificat: înregistrare ONRC" (company registration at the Romanian Trade Register) and "Verificat: asigurare văzută până la \<data>"; no general "Verified" badge; checks are free | 19.5 |
| P5 | Organic results rotate daily in an order payment cannot change | 19.5 |
| P6 | Public directory pages per category and county (with locality pages where supply justifies them), plus an in-app "Găsește firme" directory pre-filled from the occasion | 19.5, 19.7 |
| P7 | One dismissible "Vezi firme de \<categorie> în \<zona>" link on relevant tasks; it names no business and can be switched off per account or occasion | 19.7 |

**Definitions used in this section.** Geography uses the 41 Romanian counties plus Bucharest as fixed picklist values; within a county, localities are a second picklist (for example Bucharest → S1–S6 sectors, Cluj → Cluj-Napoca, Turda, Câmpia Turzii); businesses cannot type free text. "Launch areas" and "promoted pairs" mean category × county combinations chosen by the operator (W4); proposed launch areas are Bucharest (and Ilfov) and Cluj.

### Venue drawings (new in v2)

| ID | Requirement | Blueprint |
| --- | --- | --- |
| V1 | A venue business can upload drawings of its spaces (PNG, JPG or PDF up to the fair-use limit), one drawing per space, with the space's real dimensions stated by the business | 19.5 (new) |
| V2 | On a drawing, the business marks available floor areas and its standard table inventory: table type, real dimensions and count available | new |
| V3 | A drawing is a listing asset: it is moderated with the listing (P3), and readable by any planner viewing that listing or holding an active booking with that venue | new |
| V4 | A planner who opens a booking with the venue gets the drawing into their plan as the occasion's space model, with a visible version and effective date; later drawing updates appear as a proposed change the planner accepts, never a silent overwrite (principle: facts stay facts) | new |
| V5 | The planner can add custom tables with their own name and dimensions to the space model, alongside or instead of the venue's standard inventory; custom tables are marked "custom" and are never presented as venue-supplied | new |
| V6 | Spaces and tables whose dimensions are unknown are shown as unknown and are excluded from fit checks (principle: unknown stays visible) | new |
| V7 | A drawing must be calibrated before its markings are accepted: the business marks two points on the drawing whose real distance apart they know, and the platform derives the scale from them; drawings without calibration are stored but cannot be used for space models or fit checks | new |
| V8 | On a calibrated drawing the business can mark points of interest (toilets, garderobă/cloakroom, bar, entrances and exits, photo corner, stage) and named fixtures beyond tables: dance floor, candy bar, photo cabin, scenă; fixtures have real dimensions like tables and take part in fit checks | new |
| V9 | Points of interest and fixtures flow to the guest-facing event page: a simple "how the space is laid out" view showing where the toilets, cloakroom and bar are, generated from the same space model, with no layout editing for guests | new |
| V10 | Venue states its parking facts, shown on the listing and on the guest-facing event page: whether parking exists on site, the number of spaces if known, on-street or paid options, the presence of accessible (blue-badge) spaces, and the walking distance from parking to the entrance; each fact is stated as known or unknown (principle 5), never guessed; a venue with no parking states "no parking on site" rather than leaving it blank | new |
| V11 | Where the venue marks parking areas on a calibrated drawing, they are drawn to scale with the space count, and the count on the drawing must match the stated number; a mismatch is flagged as unknown until the business confirms | new |

### Flower catalogues and arrangement designer (new in v2)

| ID | Requirement | Blueprint |
| --- | --- | --- |
| F1 | A florist (or styling) business can publish a catalogue: flower and foliage varieties with image, seasonality, indicative price per stem or bunch, and available colours; catalogue items are moderated with the listing | new |
| F2 | The catalogue is a listing asset, readable from the listing and from the in-app directory, and reusable across the business's occasions | new |
| F3 | A planner can design an arrangement in the app: pick a base form (hand-tied, table centrepiece, pedestal, arched, buttonhole and similar), add items from one or more businesses' catalogues, set stem counts, and see a running indicative cost built from published prices, shown as indicative, never as a quote | new |
| F4 | A planner can instead, or as well, upload a photo or sketch of a desired arrangement with notes (colours, flowers to include or avoid, size) | new |
| F5 | From a design or an upload, the planner sends a quote request to chosen businesses through the existing enquiry flow: the request carries the arrangement (design or image), occasion date, approximate guest count and any message, and nothing else; planner email is shared only if ticked | new, built on 19.8 |
| F6 | A business replies with a price as a quote (P12); an accepted quote lands in the supplier record and budget like any other quote; the design and the accepted quote are linked as versions, so a later change to either shows as a delta | new |

### MCP server for external AI assistants (new in v4.2)

Customers can connect their own AI assistant (any client speaking Model Context Protocol) to EventDesk to help with design, arrangement and planning work. The MCP server is the boundary: external AI sees exactly what the connecting user could see in the app, and can propose but never apply.

| ID | Requirement | Blueprint |
| --- | --- | --- |
| MCP1 | EventDesk exposes an MCP server at a documented endpoint; any planner or business member generates a personal connection token from account settings, choosing a scope of read-only or read-and-propose; tokens are revocable at any time, expire after 30 days of inactivity, are audit-logged per call, and are deleted with the account (D6) | new |
| MCP2 | Read tools expose only what the connecting user's own access grants allow (D2): their tasks, budget summaries, the occasion's space model (dimensions, tables, fixtures, parking facts), published flower catalogues and prices (F1, F3), RSVP counts and their own messages; no tool returns another user's data, private requests, or anything the user could not see in the app | new |
| MCP3 | Write access is propose-only: an external AI may draft seating layouts, arrangement designs, task lists, invitation wording and budget notes, and submit them as proposals; a proposal enters the normal What if? preview and is applied only by the user's explicit confirmation in the app; no external AI action is ever applied silently (principle 3) | new |
| MCP4 | Consent and disclosure: connecting an external AI means occasion data is sent to that AI's provider; the user sees a plain-language warning before the first use of each token, naming what classes of data can leave; disconnecting deletes the token immediately and ends access at once; EventDesk does not retain the external AI's outputs beyond the proposals themselves | new |
| MCP5 | Everything an external assistant creates arrives labelled "creat cu un asistent extern" (created with an external assistant) in the app history; AI-suggested text follows the same labelling rule as INF7; catalogue prices used by an assistant stay indicative, never a quote (F3) | new |
| MCP6 | Fair use and isolation: MCP calls count against the account's fair-use budget (Q6); the tool list is public documentation; no tool exposes the admin console, staff functions, another account, or anything payment- or monetization-related (MON, PAY) | new |
| MCP7 | A business may connect an assistant to its client occasions within its own team scopes (P17–P19); a client who has taken over an occasion (P22) inherits nothing: business tokens stop working at handover | new |
| MCP8 | The tool catalogue is fixed and versioned; tools are added only in new platform releases, and the catalogue is served by the MCP server itself so any assistant can discover it; every tool declares its scope (read or propose) and every propose tool returns a proposal id, never an applied change | new |

**MCP tool catalogue (v4.3).** Read tools return data within the user's own grants (MCP2); propose tools create proposals that enter the What if? preview (MCP3).

| Tool | Kind | Returns / does |
| --- | --- | --- |
| get_occasion | read | Occasion kind, date or poll state, guest count summary, roles the user holds |
| list_tasks | read | Tasks with owner, due date, status (own scope only) |
| get_budget_summary | read | Category totals: estimate, committed, invoiced, paid, forecast (finance access required) |
| get_space_model | read | Calibrated venue drawing (as geometry, not raw image), tables with dimensions, fixtures, points of interest, parking facts (V1–V11) |
| list_catalogues | read | Published flower catalogues with varieties, seasonality, indicative prices (F1) |
| get_rsvp_summary | read | Response counts and household attendance, never individual guest identities without the user's guest-list access |
| search_directory | read | Public directory search by category and county (P5–P6): returns listings with name, category, county/locality, factual badges (P4), unclaimed status (P29) and response statistics (P31), with Featured items returned in their labelled state ("Promovat — plasare plătită", P14) and never reordered, boosted or personalized by the assistant's own judgement; the tool returns exactly what the in-app directory returns, nothing more (D3) |
| get_listing | read | One listing's public view: description, categories, counties, drawings and catalogues where published (V3, F2), public contact route for unclaimed listings, response statistics; no planner-side data exists on a listing to expose |
| propose_budget | propose | A complete budget structure as a proposal: categories with estimates and notes, built on the occasion's existing categories (B1), entered as a What if? preview the user confirms; the proposal shows which numbers are estimates so nothing is ever presented as a quote or a fact (principle 5) |
| propose_supplier_shortlist | propose | A shortlist of directory businesses as a proposal attached to the plan: chosen listings, why each was picked in the assistant's own words, and their Featured/labelling state carried over verbatim; the shortlist is only a planner-side note, it notifies nobody, and the planner still sends any enquiry personally (P8) |
| propose_seating_layout | propose | A full or partial seating plan as a proposal against the space model, fit-checked (V6) |
| propose_custom_table | propose | A new custom table with name and dimensions (V5) |
| propose_arrangement_design | propose | An arrangement design from catalogue items with stem counts and indicative cost (F3), ready for quote requests (F5) |
| propose_invitation_text | propose | Invitation and stationery wording as text drafts, following the AI labelling rule (INF7, MCP5) |
| propose_task_list | propose | New tasks or checklist items as proposed additions to the plan |
| propose_budget_note | propose | Notes or estimate adjustments as proposed changes, shown in the What if? preview before applying |

No tool exists for: payments or subscriptions (MON, PAY), admin or staff functions (W-group), another account's data, publishing anything directly, or sending enquiries. Assistants that need more get more only when a new release adds a tool (MCP8).

**Directory assistance and the non-goal boundary (note).** The plan's non-goal is "no automatic algorithmic matching that pushes specific businesses at planners; discovery stays planner-initiated". A user's own assistant searching the public directory at the user's request, and proposing a shortlist the user reviews, is planner-initiated and is therefore permitted; what remains forbidden is the platform itself ranking, pushing or personalizing businesses at anyone. Two invariants keep the assistant from becoming a loophole: the search tool returns the directory's own honest order and labels verbatim (a paid Featured card arrives labelled or the assistant is lying, and the tool cannot lie), and no tool sends an enquiry, so a business still learns who a planner is only from a message the planner personally sends (D3). Suggested budgets (propose_budget) are estimates labelled as such; suggested suppliers (propose_supplier_shortlist) are notes in the user's plan until the user acts.

**Design note.** The MCP server turns EventDesk's records into a context source for any assistant a customer already uses, without EventDesk hosting, choosing or endorsing a model: the privacy boundary is the user's own access grants (MCP2), the trust boundary is propose-then-confirm (MCP3), and the consent boundary is the per-token warning (MCP4). The platform's own AI text feature (INF7) remains separate and unchanged.

**Controller position (v4.8).** Connecting an external assistant does not move EventDesk's GDPR responsibility to the user. When a read tool returns occasion data over MCP, EventDesk is the controller of that disclosure: the data leaves EventDesk's system, to a third party EventDesk cannot supervise, because EventDesk built the pipe. The user's instruction to connect their assistant sets the scope (their own grants, MCP2), but user initiation narrows the disclosure, it does not eliminate controller duties, and a controller cannot contract out of accountability by letting users self-serve. Three duties follow, all already implemented and now stated as obligations rather than side effects: transparency (the privacy policy and the per-token warning, MCP4, must name the recipient class "the AI assistant provider you choose", the data classes that can leave, and that EventDesk cannot control what that provider does with the data); lawfulness (the per-token consent covers the disclosure; the warning is shown before first use of each token, not buried in terms); and transfer safeguards (if the user's assistant provider is hosted outside the EEA, the disclosure is an international transfer that needs a Chapter V GDPR basis, which in practice means the privacy policy discloses this and recommends EEA-hosted assistants, and the DPIA in LAU2 covers the MCP surface). The user's assistant provider is a separate controller for what it does with the data after receiving it, and EventDesk's responsibility ends at the disclosure boundary: EventDesk stores no external AI outputs beyond the proposals themselves (MCP4), logs only tool and token identifiers (SEC15), and never becomes a processor for the external provider.

### Admin console (new in v2.1)

The operator's website management console. Extends the staff console defined by S5 and the six staff roles (19.12). Every action is audit-logged with actor, time and before/after values; all approvals need a second person.

| ID | Requirement | Blueprint |
| --- | --- | --- |
| W1 | Dashboard of the whole platform: accounts, occasions (counts and broad status only, not planner content), businesses, listings, enquiries, revenue, open moderation queue and system health | 19.12 |
| W2 | Listing moderation queue: approve, request changes or reject listing revisions, drawings and catalogue items (P3, V1, F1); queue shows waiting time against the moderation service target | 19.5 |
| W3 | Business management: suspend or restrict a business or listing with a recorded reason and user-visible status; restrictions survive staff session end; the business is notified through the app | 19.12 |
| W4 | Directory management: create, merge, rename or retire categories, counties and localities; publish or unpublish directory pages; view per-category and per-county statistics (daily totals, no visitor identifiers, D4) | 19.5 |
| W5 | Discovery management: run, pause and configure discovery sources (BD1–BD7); review discovery-produced drafts in batches; bulk approve, reject or discard with one recorded reason per batch | new |
| W6 | Commercial: the monetization switch (MON2) with its two-person approval and notice history; once monetization is ON, approve or reject Business plan and Featured subscriptions, apply credits and refunds (P26), and set and change pilot prices with a second-person approval; while OFF, the console shows the free-phase cost dashboard and nothing else is purchasable | 19.10, 19.17, MON |
| W7 | Communications: compose and send platform notices to businesses (never to planner-entered contacts, 19.11); publish the "For businesses" page and public guides content | 19.11 |
| W8 | Access and audit: manage the six staff roles per person; view the audit log with filters by actor, action, object and date; export audit extracts for compliance; compliance access to retained data needs three people (19.12) | 19.12 |
| W9 | Single-operator restricted mode: one person may hold all staff roles and run every non-approval function alone; actions that need a second approver (P3 moderation approval of own edits, P26 refunds, P30 claim verification, price changes) queue in the console until a second person holds a staff role; the console shows the queue, and queued actions have no effect until approved. This mode is recorded in the audit log, and the platform may not take live payments to businesses (M4) until at least two people hold staff roles | new |
| W10 | Deployments: from the management page an authorized staff member sees the connected private GitHub repository, its releases and the commits between the live version and any candidate release, and can trigger a deployment (DEP1–DEP6); deployment progress, health checks, result and rollback control are shown in the console | new |

### Deployments from the management page (new in v4.1)

The operator updates the platform directly from the admin console, from one private GitHub repository that is the single source of the code.

| ID | Requirement | Blueprint |
| --- | --- | --- |
| DEP1 | The console connects to exactly one private GitHub repository (organization-owned, not a personal account) through a GitHub App with installation-scoped access to that repository only; credentials live server-side, are never exposed to the browser, and can be revoked from the GitHub side at any moment; only PlatformAdmin or SecurityAdministrator roles can configure or disconnect the integration | new |
| DEP2 | From the management page an authorized staff member sees: the live release and its commit hash, available releases and tags, and the commits between the live version and any candidate release; a release is deployed by selecting its tag, never a bare branch head | new |
| DEP3 | Production deployment needs a second-person approval, consistent with the W-group rule and queued under single-operator mode (W9); an emergency security fix may be deployed by one SecurityAdministrator alone, and the audit log marks it as an emergency deploy with the reason recorded | new |
| DEP4 | A deployment runs as a job in the worker (Q7): a database backup is taken first (INF10), then migrations, then the new release; the console shows live progress; if post-deploy health checks fail, the deployment rolls back automatically to the previous release and the console shows why | new |
| DEP5 | Rollback to a previous release can be triggered by one staff member from the console; rollback never deletes data, and any migration that cannot be safely reversed stops the rollback and says so instead of guessing (principle: unknown stays visible) | new |
| DEP6 | Every deploy action is audit-logged with commit hash, tag, actors (requester and approver), result, duration and rollback events; the deploy history is visible in the console; deploys are disabled while a deploy is already running | new |
| DEP7 | Deployable tags are protected on the GitHub side: releases are cut from a protected main branch, and a tag is deployable only when the repository's CI (tests, build, dependency audit) has passed on that exact commit; the console shows the CI status with the release and refuses a deploy whose CI has not passed, except the emergency path (DEP3), which records the CI bypass in the audit log | new |

### Business discovery (new in v2.1)

| ID | Requirement | Blueprint |
| --- | --- | --- |
| BD1 | The platform can automatically find candidate Romanian businesses (venues, catering, florists, and other launch categories) from lawfully published public sources: the Romanian Trade Register (ONRC) public data, the business's own published website or social pages, and licensed datasets the operator contracts for | new |
| BD2 | Discovery creates an **unclaimed draft listing** per candidate: name, category guess, county and locality, public contact route, source URL and collection date; drafts are never live and never public until approved | new |
| BD3 | Deduplication against existing listings and other drafts by name, address and public identifiers; a suspected duplicate is queued for human decision, never auto-merged | new |
| BD4 | A ListingModerator approves each draft before it goes live as a minimal, factual listing labelled "Adăugat de EventDesk — nefiind revendicat încă"; the live version stays within what the public source supports, with the source cited in the moderation record | new |
| BD5 | Approved unclaimed listings receive no messaging from the platform beyond a single claim invitation, delivered by email to the business's published contact address; where the public source lists no email address, no invitation is sent and the listing waits for the business to find it; the invitation states who added the listing, how to claim it, how to correct it and how to be removed; claiming is verified under P30 | new |
| BD6 | No marketing is sent to any contact found by discovery; planner-entered contacts are never used (19.11); honour removal and objection requests within 30 days and record them | new |
| BD7 | Discovery configuration is a console function (W5): per-category and per-area targeting, rate limits per source, and a kill switch per source; every discovery run is logged with source, items found, drafts created and duplicates skipped | new |

**Why drafts, not live listings (note).** Auto-adding live listings risks EU GDPR problems under the Romanian supervisor (ANSPDCP) and ePrivacy/Legea nr. 506/2004 (business contact data used for a new purpose, unsolicited marketing), accuracy problems (a stale or wrong listing representing a real business), and moderation-bypass, since P3 requires human approval of every listing revision. Discovery therefore does the finding, humans do the publishing, and the business does the claiming.

### Enquiries

| ID | Requirement | Blueprint |
| --- | --- | --- |
| P8 | A planner sends a free enquiry with editable, pre-filled fields: occasion kind, date, approximate guests, county and locality, optional budget band, message | 19.8 |
| P9 | Nothing else is shared; the planner's email is shared only if they tick it | 19.8 |
| P10 | An enquiry creates or reuses the supplier record and booking, so the thread sits in the plan | 19.8 |
| P11 | Limits of 10 enquiries per occasion and 30 per account per day; either side can close or report; flower quote requests (F5) count against both limits | 19.8 |
| P12 | A business can mark a PDF as a quote, which the planner can accept into the supplier record; a quote originating from an arrangement design also links back to that design version (F6) | 19.8 |
| P29 | A listing that is unclaimed (added by discovery, BD4) shows its published contact route as the public source states it, with the note "This listing isn't claimed yet"; it cannot receive enquiries, quote requests, Featured placement or asset uploads until claimed, and it carries no platform-mediated contact | new |
| P30 | Claiming a listing proves ownership before the claim takes effect: a code is emailed to the business's published contact address; if no email is publicly available, a ListingModerator verifies the claimant against the public source and records the check; an approved claim converts the listing into a normal claimed listing with full account features (P1) | new |
| P31 | Listing quality signal, factual only (competitors use ratings; this plan does not, by non-goal): a claimed listing that has answered at least 10 enquiries shows computed statistics — share of enquiries answered and median reply time — as daily-verified facts with no star rating, no testimonials and no way for payment to influence them; a listing may choose to hide these statistics from public view | new |
| P32 | The business is notified of a new enquiry on arrival by email (in the language of its listing, L4), and again after 48 hours if the enquiry is still unanswered; nudges stop after the second one; a business can turn the 48-hour nudge off, never the arrival notice | new |
| P33 | The planner always sees the enquiry's state in the plan thread: Sent (with date), Awaiting reply, Answered, Closed; an unanswered enquiry shows "sent \<date>" rather than a blank, so a silent business is visible rather than ambiguous (principle: unknown stays visible); the planner can close or re-send the enquiry once after 7 days without creating a duplicate thread (P10) | new |

### Featured placement (exists only after monetization is enabled, MON5)

| ID | Requirement | Blueprint |
| --- | --- | --- |
| P13 | Up to three Featured cards above organic results, picked at random on every request from live items matching the search; Featured is the paid route to appear ahead of non-paying competitors | 19.6 |
| P14 | Cards are labelled "Promovat — plasare plătită", or "Promovat — plasare gratuită de lansare" when claimed under the launch offer; with the English toggle on: "Featured — paid placement" / "Featured — free launch placement" | 19.6, 19.17 |
| P15 | Before buying, the business sees its expected share of rotations, min(1, 3 ÷ (n + 1)), where n is the total number of live Featured items matching the same search (its own included), and the last 30 days of directory searches in its categories and counties, with no guarantee of views | 19.6 |
| P16 | Featured content never appears in plans, guest pages, emails, exports or offline packs; Featured affects directory position only | 19.6 |

**Why Featured is the only paid advantage (v2 note).** A paying business appears above every organic result for matching searches, up to three cards at a time, with honest labels. What payment can never buy: organic rank, badges, planner data, or presence inside a planner's plan. This keeps the label "Featured — paid placement" truthful, keeps organic results worth appearing in, and keeps trust on both sides.

### Business plan

| ID | Requirement | Blueprint |
| --- | --- | --- |
| P17 | Business-owned occasions with the same planning features, created by any active member | 19.9.1 |
| P18 | Team roles: one owner, admins and staff; an admin cannot create or remove other admins | 19.4 |
| P19 | Shared libraries of templates, checklists and supplier contacts; catalogue and drawing assets are shareable to the team | 19.9.1 |
| P20 | Logo, name and one accent colour on guest pages of business occasions | 19.9.1 |
| P21 | Dashboard and reports across the business's occasions, including catalogue-item and drawing usage counts as daily totals with no visitor identifier (D4) | 19.9.1 |
| P22 | Hand an occasion over to a client; branding and business access end, history is kept | 19.9.3 |
| P23 | When the plan lapses, existing occasions stay fully usable; only new business occasions, branding and library edits stop; drawings and catalogues already in use in live plans stay readable (principle 8) | 19.9.4 |

### Billing and monetization switch (v3.2)

The launch offer mechanic from the UK draft is superseded: the entire product is free at launch and monetization is enabled later from the admin console. The launch-offer requirements are retained only as the rules for the transition.

| ID | Requirement | Blueprint |
| --- | --- | --- |
| P24 | Stripe Billing (Stripe operates in Romania for SRL/PFA accounts); features switch on only from a verified webhook, never from the browser redirect; Apple Pay and Google Pay are offered as wallet payment methods through the processor, alongside card entry | 19.10 |
| P25 | 14 days of grace after a failed renewal; cancellation takes effect at period end | 19.10 |
| P26 | Refunds and credits need a request and a second person's approval | 19.10 |
| P27 | (Superseded by MON1: at launch everything is free; there is nothing to claim and no card is taken) | 19.17 |
| P28 | Enabling monetization needs live billing, at least 60 days' public notice and reminders at 30 and 7 days; nothing is charged automatically; businesses that do nothing keep the free tier permanently (account, listing, enquiries, assets, own statistics) | 19.17 |

**Monetization switch (new in v3.2)**

| ID | Requirement | Blueprint |
| --- | --- | --- |
| MON1 | At launch, every feature is free for every user, including all Business plan features (P17–P23) for every claimed business; no pricing, checkout or card-entry screen exists anywhere in the product; release P goes live without Stripe configured | new |
| MON2 | Monetization is a single platform-level switch in the admin console (W6), OFF by default; turning it ON requires a second-person approval (W-group rule) and starts the 60-day public notice (P28); the switch state, its history and its approvers are audit-logged | new |
| MON3 | When the switch is ON: the Business plan and Featured placement become purchasable at the pilot prices (199 RON / 1,990 RON / 149 RON, excluding TVA, PAY4); features already in free use keep working until the notice period ends, then continue on the permanent free tier for non-purchasers (P23); existing occasions are never blocked | new |
| MON4 | Before the switch can be turned ON, billing infrastructure passes acceptance in test mode: P24–P26, PAY1–PAY5, fiscal invoicing (PAY3) and the TVA position (PAY4) are all verified; the switch is the last step, not the first | new |
| MON5 | While the switch is OFF, Featured placement does not exist: the directory shows organic results only, so "paid never means preferred" holds trivially during the free phase | new |

## 9. Requirements: later releases (C, D, E)

These are specified in the blueprint and summarised here. Each needs its own go-ahead after the earlier releases are in use.

| Release | Requirement | Blueprint |
| --- | --- | --- |
| C | Room layouts and seating driven by the occasion's space model (venue drawing plus custom tables); drag to arrange with a tap-based equivalent path, so no arrangement ever requires dragging | 9.1, V1–V7, Q8, Q10 |
| C | Table layouts checked for fit at every stage of a meal, including the moments between courses, against the space model's stated dimensions | 5 |
| C | Entertainment programme, cue list and performer briefings | 6 |
| C | Invitation and stationery designer with proofs and print-ready PDF | 9.4 |
| C | Menus, meal choices and food and drink quantities | 9.5 |
| C | Public event page with registration, waitlist and conditional questions | 11 |
| C | Private dietary and access requests, and a published accessible guest journey | 4.2, 11.3 |
| C | Guest-facing seat assignment: once the planner publishes the seating plan, each guest's own table (and seat, if assigned) appears on their guest link and in their invitation view; unpublished seating is never visible to guests | 9.1, new |
| C | Print pack: QR codes for physical invitations (linking to the guest's own invitation view), table cards with a QR to the guest event page (programme, menu, space layout V9, parking V10), and the to-scale room plan, generated as print-ready PDF from the same records | new, 16.5 |
| C | Guest event page shows the venue address with a navigation link (external map, opens in the guest's maps app), and guests are notified of programme changes to moments that concern them, once per change, never as a stream | new, 10 |
| C | Gift estimator (calculator dar), a Romanian-specific planning aid: a private, per-planner tool that suggests a money-gift range per guest household from a few questions (relationship, distance travelled, venue type), clearly labelled as a cultural guide with no data shared, no guest seeing another's amount, and no commercial input; it is free forever and not part of any paid tier | new |
| C | Promotion: generated copy and assets to export; nothing is posted or spent automatically | 8 |
| C | Visual flower arrangement designer as specified in F3, with the quote flow of F5 and F6 live from release P | new |
| D | Itinerary across time zones, with booking import the user confirms | 10 |
| D | Subgroups, optional activities, packing lists, transport legs and room allocation | 10, 4.5 |
| D | Multiple currencies and participant settlement views | 3.6 |
| E | Rehearsal: step through the day and see conflicts without changing anything | 7 |
| E | QR check-in and guest-flow estimates for larger events | 13.5 |
| E | Limited offline capture: arrivals and own checklist ticks only, reconciled on reconnect | 13.3, 18.12 |
| E | Optional sustainability goals with measured quantities | 13.6 |

## 10. Accounts, privacy and platform requirements

### Sign-in and security

| ID | Requirement | Blueprint |
| --- | --- | --- |
| S1 | Sign-in is a six-digit emailed code; there are no passwords for email accounts; the same email also carries a one-tap sign-in link that is single-use, expires with the code, and is exactly equivalent to entering the code (whichever is easier for the user at that moment); on a device the user marked "remember me", sessions last as defined in S3 and no code is requested again. A user who wants no email at all can instead create an anonymous account (S7) | 18.3 |
| S2 | Two-step sign-in is opt-in for every user and never required, never nudged, never mentioned in the sign-in flow itself; when enabled, the second factor is a standard TOTP authenticator app (any user-chosen app, no proprietary lock-in) or, on the same device, a passkey; ten single-use recovery codes are shown once at enrolment, and enabling or disabling two-step needs a fresh emailed code (S4) | 18.20 |
| S3 | Sessions last 30 days, or 14 days idle | 18.20 |
| S4 | Sensitive actions need a fresh emailed code within ten minutes: ownership transfer, deletion, login-email change, capability grants, business purchases and member changes | 18.20 |
| S5 | Platform staff must use two-step sign-in; the staff console expires after 12 hours or 30 minutes idle | 18.20, 19.12 |
| S6 | Invitation links are scoped, revocable and grant only that invitation's view | 18.3 |
| S7 | Optional fully anonymous accounts: a user can create an account with a random generated username and a user-chosen password, and no email address, no phone number and no real name; the signup screen says plainly what this means: email digests and email sign-in do not exist for this account, notifications arrive only inside the app, and account recovery is impossible without the recovery codes (S8); the platform stores nothing that could identify the person behind the account except what the user later enters into their own occasions. Anonymous accounts are equal in features: planning, roles, guest links, directory use and MCP tokens (MCP1–MCP8) all work; only email-dependent features degrade, and they degrade visibly, never silently | new |
| S8 | Anonymous account security and recovery: passwords are stored hashed with a memory-hard function (Argon2id) with per-account salt, never in plaintext or reversible form; sign-in with a wrong username or wrong password returns one identical generic failure (enumeration-safe, like SEC1), and the SEC16 rate limits apply unchanged (per username, per IP, per device cookie); at signup the user is shown ten single-use recovery codes once (like S2), with an explicit warning that losing both the password and the codes means the account is unrecoverable, because there is no email to send anything to; the sensitive actions in S4 use a recovery code instead of an emailed code for anonymous accounts; an anonymous user who later adds an email becomes an email account (S1), and removing the email again returns to anonymous rules after a fresh recovery-code generation | new |

### User security hardening (new in v4.3)

A security review of every user-facing surface (sign-in, guest links, uploads, emails, external AI, discovery, external links) found ten risks not yet covered by S1–S6 and INF4. Each is mitigated here.

| ID | Requirement | Mitigates |
| --- | --- | --- |
| SEC1 | Account enumeration: requesting a sign-in code behaves identically whether the account exists or not (same email template, same timing band); codes are single-use and invalidated the moment a newer code is issued; sign-in emails state that EventDesk staff will never ask for a code, and that a code the user did not request means someone is probing their address | Email-only sign-in probing and phishing |
| SEC2 | Guest and invitation links carry a random token of at least 128 bits (never sequential or guessable IDs), are individually revocable, can be set to expire (never, at RSVP deadline, or at occasion closeout), and are rate-limited per link against brute force; a link shared beyond its household exposes only that household's own view (A6), never the whole guest list | Guest-link guessing and oversharing on group chats |
| SEC3 | Every account shows its active sessions (device type, last seen) with a one-tap "sign out everywhere" that invalidates all sessions and MCP tokens at once; changing the login email (S4) automatically does the same | Stolen or borrowed-device session persistence |
| SEC4 | Upload safety: images (PNG, JPG) are re-encoded server-side, stripping any embedded content; PDFs (drawings, quotes) are stored as-is but served from a separate media domain with Content-Disposition: attachment and noinline, so untrusted PDFs (a business's quote PDF, P12) can never execute in the app's origin; every file is scanned for malware before it becomes visible | Malicious file uploads from businesses or planners |
| SEC5 | Strict Content-Security-Policy with no inline scripts and no third-party origins (consistent with D1), HSTS, X-Content-Type-Options: nosniff, and referrer policy set to same-origin; the CSP is tested at each release (Q1) | XSS and content injection |
| SEC6 | All state-changing requests require CSRF protection; all background jobs that fetch external URLs (discovery BD1, map links) validate the URL, block private and link-local address ranges, cap fetch size and time, and honour robots.txt | CSRF, and SSRF via the discovery crawler |
| SEC7 | External links on guest pages (navigation links, unclaimed-listing contact routes) open with rel="noopener noreferrer" so a scoped guest URL is never leaked via the Referer header | Scoped-link leakage through referrers |
| SEC8 | Sign-in codes and MCP tokens are stored only as hashes; the console and account pages show at most the token's last four characters; staff can never read a user's token or code | Token theft from the database or console |
| SEC9 | Backup encryption keys (INF10) rotate at least annually; rotation is tested by restoring and decrypting a pre-rotation backup before the old key is retired | Key compromise making every old backup readable |
| SEC10 | The audit log is append-only: entries can never be edited or deleted by any role, including PlatformAdmin; exports (W8) are read-only copies | An insider covering their tracks |
| SEC11 | Public forms (guest RSVP, public registration, enquiry composition, unclaimed-claim requests) are protected from bots without any third-party script (D1): per-IP and per-link rate limits, a hidden honeypot field, and a time-to-submit floor; a throttled client sees a retry time, never a silent failure | Bot abuse of every public, unauthenticated surface |
| SEC12 | Session and authentication cookies are Secure, HttpOnly and SameSite=Lax; the session id is server-side revocable (SEC3); nothing security-relevant is ever stored in localStorage | Cookie theft and XSS escalation |
| SEC13 | Secrets management: Stripe keys, email-provider credentials, GitHub App credentials, backup encryption keys and MCP signing material live in the platform's secret store, never in the repository, never in build output, and rotate at least annually or on staff departure; the console shows each secret's last-rotation date, not its value (SEC8) | Credential leakage through the repo, logs or console |
| SEC14 | The one-tap sign-in link is single-use, but a prefetch by a mail scanner may consume it: if the link is already used, the code in the same email still works, and the page shown to a consumed link offers one new code request, rate-limited (INF4); the link and code expire together | Mail-scanner prefetches silently breaking the easiest sign-in path |
| SEC15 | Propose tools are bounded by the user's write access exactly as read tools are bounded by read access (MCP2): a contributor without finance access cannot use propose_budget, a guest-role holder cannot use propose_task_list; every proposal records which token proposed it | Scope escalation through the MCP surface |
| SEC16 | The sign-in surface is rate-limited on three independent axes, all of which apply: per email address, per IP address, and per device cookie (a plain, clearly disclosed cookie, not a tracker, consistent with D1). Conservative defaults, adjustable in the admin console (W1): a code may be requested at most 3 times per email per hour (INF4) and 10 times per IP per hour; code entry allows at most 5 attempts per code (INF4) and 20 entries per IP per hour. Hitting any limit returns the same generic message whether or not the account exists (SEC1), with a retry time, never a silent failure. Sustained abuse of one email address triggers escalating backoff for that address only, never a full lockout (an attacker must not be able to lock a victim out by flooding their address); rate-limit events are written to the security audit log (SEC10) without recording whether the account exists | Code-request flooding, code brute force, and enumeration of accounts through the sign-in surface |

### Privacy and data

| ID | Requirement | Blueprint |
| --- | --- | --- |
| D1 | The public site sets no cookies and loads no third-party script | 19.3 |
| D2 | Private requests, finance and guest contacts are visible only to people granted that specific access | 2.3, 4.2 |
| D3 | A business learns who a planner is only from an enquiry or quote request the planner sends | 19.1 |
| D4 | Directory statistics are daily totals with no visitor identifier; drawing and catalogue usage statistics follow the same rule | 19.6 |
| D5 | Retention defaults per data type, for example private requests removed 30 days after closeout | 13.2 |
| D6 | Account and occasion deletion with a seven-day undo and a clear statement of what is retained and why | 18.18, 18.19 |

### Platform and quality

| ID | Requirement | Blueprint |
| --- | --- | --- |
| Q1 | Responsive web app on current and previous iOS Safari and Android Chrome, plus desktop browsers | 15.1 |
| Q2 | Usable at 320 pixels wide; target WCAG 2.2 AA | 15.2 |
| Q3 | Guest page targets: main content in 2.5 seconds, interaction within 200 ms | 15.8 |
| Q4 | A repeated or double-tapped action is applied once | 16.2 |
| Q5 | Qualification targets: 1,000 attendees, 50 concurrent operators, 10,000 tasks per occasion | 13.3 |
| Q6 | Fair use for planners: 100 MiB uploads and 500 emails a day per occasion; ten AI text results a month; venue-drawing and arrangement-image uploads count within the 100 MiB occasion limit | 19.2 |
| Q7 | Stack: Next.js, PostgreSQL, one web service and one worker | 18.1 |
| Q8 | Layout and seating interactions support direct manipulation at phone width: drag to place and move tables and seats, with snap-to-grid and collision warnings; every drag action has a tap-based equivalent (select an item, then move it with on-screen controls) of equal quality, so no action requires dragging | new |
| Q10 | Drag and touch interactions: drag targets are at least 44 pixels when touched, items being dragged are magnified and lifted above the layout so the finger does not cover them, drag has a generous snap tolerance, and a drag in progress can be cancelled by dragging the item back to its origin; the tap-based path (Q8) satisfies A12 and WCAG 2.2 AA (Q2) for users who cannot or prefer not to drag | new |
| Q9 | Fair use for businesses, separate from the planner limits in Q6: 200 MiB of stored assets per business (drawings, catalogue images), 10 MiB per file, images accepted as PNG or JPG only at launch, PDF accepted for drawings only; a business over the limit is told which asset to remove, and nothing is deleted without confirmation | new |

### Language (new in v3)

| ID | Requirement | Blueprint |
| --- | --- | --- |
| L1 | The product's primary interface language is Romanian. Every user-facing string is externalized from launch: no string is hard-coded in either language, and the default locale is ro-RO with Romanian diacritics (ș, ț, ă, â, î) rendered and searchable correctly | new |
| L2 | English is a full localization, available as an account-level and per-guest-link toggle; the guest link always opens in the language the invitation was sent in, and guests can switch in one tap; the toggle never changes data, only wording | new |
| L3 | Locale formatting is Romanian by default: amounts in RON with "RON" suffix or lei per common usage (1.990 RON), dates as dd.mm.yyyy, weekday and month names in Romanian, 24-hour times; the English toggle switches to English conventions | new |
| L4 | Moderated content (listings, drawings' captions, catalogue items) is written in Romanian; businesses may add an optional English version, and the language toggle falls back to Romanian with a "numai în română" (Romanian only) note when no English version exists | new |
| L5 | Emails (sign-in codes, invitations, reminders) are bilingual by default: Romanian first, English below; staff console is Romanian-first with the same toggle | new |

### Staffing

Six staff roles: PlatformAdmin, ContentEditor, ListingModerator, CommercialManager, PrivacyOwner and SecurityAdministrator. One person may hold several, but approvals need a second person, so day-to-day running needs at least two people. Compliance access to retained data needs three (19.12). Drawings and catalogues are moderated as listing assets under the ListingModerator role.

## 11. Commercial model

**Free phase (launch).** Everything is free for everyone: planners, guests and businesses, including all Business plan features. There is no pricing page, no checkout and no card entry anywhere; release P goes live without Stripe configured. The platform runs at a loss during this phase, funded by the operator; the console (W6) shows the free-phase cost dashboard.

**Monetization phase (later, enabled from the admin console).** When the operator turns the monetization switch ON (MON2, two-person approval, 60 days' public notice), income starts from businesses only, for two optional things:

| What a business gets | Price (pilot, excluding TVA), charged only after the switch is ON | Free tier, permanently |
| --- | --- | --- |
| Account, directory listing, enquiries, venue drawings, flower catalogues, own statistics | Free permanently | Free |
| Business plan | 199 RON a month or 1,990 RON a year | Client occasions continue; new business occasions, branding and library edits stop after notice (P23) |
| Featured placement, per listing per category | 149 RON a month | Does not exist while the switch is OFF (MON5) |

**Transition rules.** Enabling monetization needs live billing and at least 60 days' notice, with reminders at 30 and 7 days; nothing is charged automatically; businesses that do nothing keep the permanent free tier and their occasions are never blocked. At the end of the notice period, paid-only features lapse for non-subscribers and everything else carries on.

**Suggested trigger to end it** (a guide, unvalidated): the median featured listing in the launch counties has received at least 3 enquiries a month for two months running.

**Break-even illustration, not a forecast.** With fixed costs of 20,000 RON a month (placeholder) and 10,000 active planners at 0.50 RON each, costs are 25,000 RON. At a 3% payment fee that needs about 25,750 RON of income, for example 80 monthly Business plans (15,920 RON) plus 66 Featured items (9,834 RON). That is about 145 paying items. The 20,000 RON is a placeholder: replace it with the real monthly cost before relying on the figure.

**How businesses find out.** A "For businesses" page, "List free" prompts on thin directory pages, a panel for suppliers who open a booking link, a sign-up link planners can share, and one-time dashboard cards. No marketing email goes to contacts that planners entered (19.11).

## 12. Success measures and gates

### Pilot measures

- **Usability:** at least five users per journey, with four of five completing it unaided. Journeys are a solo trip, a birthday with delegated setup, a wedding catering change, and a public event with registration (17).
- **Planner activation:** share of new accounts that activate an occasion and invite at least one person. No target is set yet; record it from the first pilot.
- **Business supply:** at least 20 approved listings in each promoted category and county.
- **Business value:** enquiries per featured listing per month.
- **Asset adoption (new in v2):** share of venue listings with a usable uploaded drawing, and share of florist listings with a catalogue, measured from release P.

These are proposed gates, not evidence of demand.

### Go/no-go gates

| Gate | What is delivered | Exit condition |
| --- | --- | --- |
| M0 | Free access, fair use, separate public and app sites | No third-party script on either site; free activation works |
| M1 | Releases A and B with pilot planners; 20 public guides; 10 business interviews | 5 of the 10 agree to list in a completely free product and 3 say in writing they would pay once monetization is enabled; otherwise revise the future offer before building P |
| M2 | Release P built, billing in test mode, monetization switch OFF | Acceptance tests pass; business terms for the future paid tiers published; fiscal invoicing (PAY3) tested end to end in sandbox |
| M3 | Free phase live in launch counties; nothing charged anywhere | 20 approved listings per promoted pair; enquiries measured monthly; a recorded decision on when to enable monetization |
| M4 | Monetization switch turned ON; 60-day notice given | Terms, tax setup and keys approved; 30 days with no duplicate or missing feature grants |
| M5 | Sustainability | Three consecutive months with income after fees at 1.2 times costs or more |

A release is blocked by any unresolved unauthorised access, duplicate money posting, unexplained overbooking, lost approved records or wrongly reversed facts (16.5).

## 13. Risks, assumptions and open questions

### Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Scope | The blueprint covers several products; v2 adds venue drawings, custom tables and a flower designer on top | Build release A first and test it with five real users before specifying further; the new assets are listed so they can be cut consciously |
| Free-phase burn | Everything is free at launch (MON1) and the platform runs at a loss until the switch is ON; the operator funds the gap | State the funded runway in months before release P; the cost dashboard (W6) tracks actual burn against it; the switch (MON2) can be enabled earlier than planned if burn outruns funding |
| External AI over MCP | Connected assistants send occasion data to third-party AI providers; a leak or over-broad tool breaks privacy promises | Read tools bounded by the user's own grants (MCP2), propose-only writes (MCP3), per-token consent warnings (MCP4), audit logging per call, no admin or payment tools (MCP6) |
| Two-sided start | Businesses pay only if enquiries arrive; enquiries need planners in that county | Free phase removes the price barrier for businesses entirely; start in one or two counties and a few categories |
| Established directories | Romanian wedding directories and social-media recommendation groups already compete for the same suppliers | Lead with the planning tool and the working assets (drawings, catalogues, quote flow) they do not offer |
| Email-only sign-in | An account is only as secure as its owner's mailbox | Fresh code on sensitive actions, email notices, opt-in two-step sign-in |
| Moderation load | Every listing revision, drawing and catalogue item needs a human moderator; discovery adds a queue of drafts to review on top | Limit launch areas; measure review time in the pilot; drawings, catalogues and discovery drafts ride the same approval queue as their listing; bulk review (W5) |
| Asset quality | Businesses may upload unusable drawings or stale catalogues | Minimum standard for drawings in the moderation guide; drawing updates are proposed changes the planner accepts (V4) |
| Discovery legality | Collecting business contact data from public sources into a commercial directory can breach EU GDPR or ePrivacy/Legea nr. 506/2004 if misused; wrong data can misrepresent a real business | Public lawful sources only, source and date recorded per draft, drafts invisible until human approval, one claim invitation and no marketing, 30-day removal handling (BD1–BD7); ANSPDCP is the supervisory authority |
| Staffing | Approvals need two people, compliance access three | Name the second person before release P |
| Review | v14 changes and this v2 draft are not independently reviewed | Review 18.20, 19.17 and the new V/F requirements before handing to a builder |
| Billing detail | The Stripe subscription design is unconfirmed | Check against Stripe's documentation when building P |

### Assumptions not yet validated

Business willingness to pay, the two prices, demand for Featured placement, planner traffic, the cost figures, and now: whether venues will maintain accurate drawings and whether florists will publish indicative prices.

### Open questions

- [ ] What is the real monthly fixed cost to put in the break-even?
- [ ] Which one or two counties and which categories launch first? Bucharest (Ilfov) and Cluj are proposed; confirm with the pilot.
- [ ] Who is the second staff person for approvals?
- [ ] Who operates the business legally (superseded in more detail below by the Romania-specific questions)?
- [ ] Should basic listings stay free permanently, as assumed here, or become paid later?
- [ ] Are the strategy and coding-handoff documents being updated to v14, and to this v2 draft?
- [ ] (new) Drawing format limits: accept PDF and raster only, or also a simple vector or floor-plan format?
- [ ] (new) Does the indicative price in a flower catalogue need a "subject to quote" disclaimer reviewed legally?
- [ ] (new) Should the arrangement designer support artificial and dried flowers, or fresh only at launch?
- [ ] (new) Which licensed datasets, if any, will discovery use, and on what terms?
- [ ] (new) What is the moderation service target (hours) for listing revisions, drawings and discovery drafts?
- [ ] (new) Does the single claim invitation to unclaimed businesses need legal review under ePrivacy/Legea nr. 506/2004 before release P?
- [ ] (RO) Who operates the business legally: a Romanian SRL or SRL-D, registered where, and is it TVA-registered (the 21% standard rate applies to the pilot prices once registered; the micro-enterprise threshold is 395,000 RON)?
- [ ] (RO) Does invoicing businesses for the Business plan and Featured placement require e-Factura (the Romanian e-invoicing system) and an ANAF connection, or do pilot invoices fall below its thresholds?
- [ ] (RO) Should the legal operator register with ANSPDCP as data controller before release P, and who is the named PrivacyOwner under Romanian law?
- [ ] (RO) Business terms and the "For businesses" page need a Romanian-language version with Romanian consumer/commercial law review (OUG 21/1992 on consumer protection applies to B2C; commercial terms apply to B2B)?
- [ ] (RO) Enquiry relay: should planner-to-business enquiry threads support Romanian landline/SMS preference habits (some small businesses prefer phone to email), or stay email-only at launch?
- [ ] (C) Invitation presentation: should the release C invitation include an animated-envelope opening effect (as Plannarium offers), or keep the invitation designer print-first? A design decision, not a build blocker.
- [ ] (MON) Inviter and Invitam show Romanian planners pay for digital invitation tools (paid tiers; 69 RON one-time). Should EventDesk ever offer a paid invitation pack, or is free-forever for planners an immovable principle? Deciding this later requires changing a non-goal deliberately and publicly.

## 14. Assumption review (v2.2)

A reviewer pass asked: where does this document force a reader or builder to make an assumption? Ten were found; each is bridged below either by an explicit requirement or by an explicit recorded decision. A builder following this document no longer has to assume any of them. Items that remain open questions in section 13 are decisions for the operator (prices, areas, staffing), not gaps a builder must fill silently.

| # | Assumption a builder would have had to make | Bridged by |
| --- | --- | --- |
| 1 | Which 21 categories exist | P2 now lists them by name |
| 2 | What geography unit the directory uses | Definitions block after P2: Romanian counties plus locality picklist |
| 3 | Whether unclaimed discovery listings can receive enquiries | P29: no enquiries, quote requests, Featured or uploads until claimed; published contact route shown as-is |
| 4 | How a claimant proves they own the business | P30: emailed code to the published contact address, or moderator verification recorded against the public source |
| 5 | How drawing pixels relate to real dimensions | V7: two-point calibration before any marking is accepted |
| 6 | Upload limits for business assets | Q9: 200 MiB per business, 10 MiB per file, formats fixed |
| 7 | Whether flower quote requests count against enquiry limits | P11: they count against both limits |
| 8 | What "n" is in the Featured rotation formula | P15: total live Featured items matching the same search, own included |
| 9 | How the claim invitation is delivered | BD5: email to the published address; none sent if no address is public |
| 10 | What one operator can do alone | W9: single-operator restricted mode; approval-needing actions queue; live payments blocked until a second staff person exists |

Review verdict on the v2.1 draft: **failed** (ten silent assumptions). Verdict on this v2.2 draft: no known silent assumptions; remaining unknowns are explicitly recorded as operator decisions in section 13.

## 16. Payments and invoicing in Romania (v3.1)

Research findings and the requirements they produce. Sources are cited in the market research report accompanying this blueprint.

**Findings.** Stripe operates in Romania for SRL, SRL-D and PFA entities with Romanian IBANs, publishing fees around 1.5% + 0.25 EUR for European cards ([Stripe Romania guide](https://stripe-efactura.ro/cont-stripe-romania-2026)). Apple Pay and Google Pay both work in Romania: Google Wallet lists Banca Transilvania, BCR, BRD, Raiffeisen, Revolut, CEC and many others ([Google Wallet supported banks](https://support.google.com/wallet/answer/12059326?hl=en-uk&co=GENIE.CountryCode%3DRO)); BCR advertises Apple Pay and Google Pay enrolment ([BCR contactless payments](https://www.bcr.ro/ro/persoane-fizice/plati-contactless)). **BT Pay cannot be offered**: it is Banca Transilvania's mobile banking app, not a merchant checkout integration; a business cannot add "pay with BT Pay" the way it offers Apple Pay. BT-issued cards are ordinary Visa/Mastercard cards and are accepted through any processor, which covers the underlying need. Local alternatives exist if Stripe proves unsuitable: Netopia Payments (the oldest Romanian processor, recurring billing, Apple Pay and Google Pay, PCI DSS Level 1), PayU Romania and euplatesc ([comparison](https://pronetdesign.ro/en/blog/online-payment-processors-romania-2026/)). Stripe's own invoices are not Romanian fiscal invoices; Romanian businesses connect SmartBill or Oblio and submit through ANAF's RO e-Factura ([Stripe and e-Factura guide](https://stripe-efactura.ro/cont-stripe-romania-2026)).

| ID | Requirement | Blueprint |
| --- | --- | --- |
| PAY1 | Checkout offers, in order: Apple Pay (on supported devices), Google Pay (on supported devices), and card entry, all through the single processor; the wallet buttons follow the processor's branded-mark rules; no local bank app integrations | new |
| PAY2 | BT Pay is out of scope: it is a bank app, not a merchant payment method; BT cardholders pay with their cards through the processor like any other Visa/Mastercard | new |
| PAY3 | Fiscal invoicing: the platform does not rely on the processor's invoices; a fiscal invoice is generated in Romania for each charge (via SmartBill, Oblio or an equivalent connected by webhook), with TVA at the standard rate shown, and transmitted through RO e-Factura as required for B2B supplies | new |
| PAY4 | Prices are stated excluding TVA everywhere, with the TVA-inclusive total shown at checkout (for example 199 RON + 21% TVA = 240.79 RON); if the operator is below the micro-enterprise threshold and not TVA-registered, no TVA is charged and prices are stated as such until registration becomes mandatory | new |
| PAY5 | Processor decision is revisited at M2: Stripe first for speed and webhook quality, with Netopia as the fallback if local card-acceptance rates or instalment options (which Romanian businesses may expect) justify a second processor; only one processor is live at launch | new |

## 17. Romanian market and competition (v3.1)

**Findings.** The competitive picture is materially different from the UK assumption that "nothing connects" planning:

- **Plannarium** ([plannarium.ro](https://plannarium.ro/)) — a Romanian event-planning platform in final pre-launch stage covering weddings, botez and anniversaries: digital invitations with animated envelope opening, individual RSVP confirmations (including attendance at specific moments like cununie religioasă), a visual room-layout planner with dance floor, candy bar, photo cabin positioning, and guest seating optimization. Overlaps with releases A, B and parts of C.
- **EventMap** ([eventmap.ro](https://www.eventmap.ro/)) — a new Romanian entrant positioning as "organized like à la carte": auto-generated task roadmaps (27 tasks staged at 12/9/6/3/1 months) for nunță and botez, roles for nași (godparents), collaborator RSVP links with allergies, and a directory of local verified suppliers **with ratings**, plus budget tracking. Free for couples; monetization not yet visible.
- **Planificator Nuntă by miresik.ro** ([miresik.ro](https://www.miresik.ro/planificator-nunta)) — a free Romanian wedding planner: guest lists with menu choices (vegetarian, vegan, child), RSVP links, budget and payment-deadline alerts, supplier CRM for sală/fotograf/formație/florist, and the day timeline. Built specifically for Romanian wedding traditions.

**Implications for this blueprint:**

1. The "nothing connects who is coming" premise is now wrong for Romania: at least three tools connect planning, RSVP and suppliers. EventDesk's differentiation must be stated honestly: the **one-record, many-views** model with **preview before applying** (the "What if?" delta) and **facts stay facts** corrections, none of which the three competitors demonstrate, plus the business-side directory with honest Featured placement, which none of them monetize.
2. The **no-reviews non-goal is now a real strategic choice, not a default**: EventMap ships supplier ratings. The recommendation is to keep the non-goal (ratings invite gaming and moderation load, and conflict with principle 7) but to record that the market expects some quality signal; the factual ONRC/insurance badges (P4) and enquiry statistics must therefore be prominent enough to substitute.
3. **Free is table stakes**: all three competitors are free for planners, so the free-for-planners position creates no differentiation, and the business-payer model must work on its own merits. The M1 gate's business interviews become even more critical.
4. The seating/room-layout planner (Plannarium) and auto-generated task roadmaps (EventMap) are validated demands in this market: release C's layout work and release A's templates are confirmed as wanted, not speculative, for weddings and botez.
5. Nași (godparents) as a planner role is a Romanian specific EventMap already supports: role names in release A's collaborator model (A5) should carry Romanian-localized display names, including naș/nasă as a suggested role label for botez and nunță occasions.

### Gap review against competitors (v3.3)

A feature-by-feature pass of this blueprint against Plannarium, EventMap and Planificator Nuntă by miresik. Where a competitor has something the plan lacks, the gap is bridged with a requirement; where the plan already covers it, that is recorded so the comparison is honest.

| Competitor feature | In plan? | Resolution |
| --- | --- | --- |
| Countdown-staged task roadmap (27 tasks at 12/9/6/3/1 months) — EventMap | Templates existed but were not date-relative | **Bridged in A2**: template tasks auto-schedule relative to the occasion date, and moving the date shifts the schedule as a previewed change |
| Nași roles — EventMap | Recommendation only, not a requirement | **Bridged in A5**: naș/nasă, damă as localized suggested role labels |
| Supplier ratings — EventMap | No (by non-goal) | **Kept, substituted in P31**: factual response statistics (share answered, median reply time) instead of ratings; computed, unhidable-by-payment, optional to display |
| Room layout with dance floor, candy bar, photo cabin, scene — Plannarium | Tables only (V2) | **Bridged in V8**: named fixtures and points of interest with real dimensions, taking part in fit checks |
| Points of interest shown to guests (toilets, cloakroom, bar) — Plannarium | Not present | **Bridged in V9**: a read-only guest-facing space view from the same model |
| RSVP per event moment (civil/religious ceremony, photo session) — Plannarium | Already covered by A6: attendance recorded per session; no change needed | Recorded as a match |
| Menu choices per guest (vegetarian, vegan, child) — miresik, Plannarium | Already covered by release C (menus, meal choices) and C's private dietary requests | Recorded as a match |
| Budget alerts for payment deadlines and advances — miresik, EventMap | Reminders existed (A10) but not tied to supplier payment deadlines | **Bridged in B12**: advances, instalments and final balances raise digest alerts to finance-access holders |
| Supplier CRM with contract statuses — miresik | Already covered by B4 (booking states, versioned briefings) | Recorded as a match |
| Digital invitation with animated envelope — Plannarium | Release C's invitation designer covers content, not the animated presentation | **Deferred by decision**: the invitation designer (C) generates the invitation; animated envelope presentation is a design-language flourish, recorded as an open question, not a requirement |
| Gift estimator (calculator dar) — Plannarium | Not present | **Bridged in release C**: private per-planner gift-range guide, no data sharing, free forever |
| Day timeline — all three | Already covered by A3 calendar views and B7 event-day view | Recorded as a match |

**Verdict:** three real gaps (date-relative templates, fixtures/POIs, payment-deadline alerts) are bridged with requirements; the quality-signal gap is bridged with a factual substitute consistent with the no-ratings non-goal and principle 7; one Romanian-specific aid (gift estimator) is added; two features are deliberately deferred or already matched. No remaining competitor feature forces a silent assumption on a builder.

### Second pass: full competitor feature audit (v3.4)

The three original competitors were re-examined in depth, and two more Romanian players surfaced: **Inviter.ro** (digital invitations plus guest management, checklist, budget, timeline and seating, with a freemium model: 5 responses and 48-hour validity free, unlimited on a paid plan) and **Invitam.ro** (digital wedding and botez invitations sold at 69 RON one-time). Plannarium's full site was opened and audited feature by feature.

| Competitor feature (source) | In plan? | Resolution |
| --- | --- | --- |
| Guest's own seat visible on their invitation (Plannarium) | Seating existed (C) but nothing said the guest sees it | **Bridged**: published seat assignment shown on the guest link; unpublished seating stays private |
| Print-ready documents: QR on physical invitations, table cards with QR to the event page, to-scale room plan (Plannarium) | QR check-in existed only in release E | **Bridged**: release C print pack generated from the same records, QR codes included |
| RSVP options dedicated to cazare (accommodation) and transport (Plannarium), custom RSVP questions (Inviter) | Only dietary/access questions existed | **Bridged in A6**: planner-defined custom RSVP questions including accommodation and transport need, one question per screen |
| Guest list import from Excel (Plannarium) | Exports existed, import did not | **Bridged in A13**: CSV/XLSX import with column mapping, duplicate detection and a confirmed diff |
| Interactive maps and navigation options for event locations (Plannarium) | Address existed, navigation did not | **Bridged**: guest event page carries an external map navigation link |
| Real-time programme updates pushed to guests (Plannarium) | Guest page existed; notification of changes was unstated | **Bridged**: guests notified once per change for moments that concern them |
| Collaborators with zone-scoped read/write access (Plannarium) | Already covered by A5 roles and capability grants | Recorded as a match |
| Digital invitation editor with animated envelope (Plannarium, Inviter, Invitam) | Release C invitation designer covers content; animation deferred | Unchanged: remains the recorded design open question |
| Planners paying: Inviter's paid tiers and Invitam's 69 RON invitations | No, by non-goal (no charge to planners) | **Recorded as a market finding, not a gap**: Romanian planners demonstrably pay for invitation tools. The free-forever planner position stands as the differentiation, and the paid invitation market is noted as a possible future revenue direction requiring a deliberate change to the non-goals, not a silent one |

**Verdict:** five further gaps bridged (guest seat display, print pack with QR, custom RSVP questions, guest import, navigation link and change notifications); one already matched; the paid-invitation market is recorded as a finding with an explicit decision against acting on it now. The blueprint again has no feature-level hole against the known Romanian field, and the audit table keeps the evidence for the next revision.

## 18. Fresh coding-agent review (v4)

The question asked fresh: if a coding agent received only this document, where would it have to make an assumption? Eleven were found. Each is bridged below, so a builder never has to guess.

| # | Assumption a coding agent would have had to make | Bridged by |
| --- | --- | --- |
| 1 | The canonical domain and site split | INF1: eventdesk.ro for the public site, app.eventdesk.ro for the web app; the public site sets no cookies and loads no third-party script (D1); all transactional email is sent from eventdesk.ro or a subdomain with SPF, DKIM and DMARC configured |
| 2 | What sends the emails (sign-in codes, digests, invitations, notices) | INF2: a transactional email provider (operator's choice, e.g. one with EU delivery); bounce and complaint handling feed a suppression list; hard-bounced addresses are never emailed again; the daily limits in Q6 are enforced server-side before the provider is called |
| 3 | Where uploaded files (drawings, catalogue images, receipts) are stored | INF3: an S3-compatible object store with signed upload URLs served by the web service; private objects accessible only through scoped links; assets are counted for fair use (Q6, Q9) at upload time |
| 4 | Sign-in code rules: expiry and abuse limits | INF4: a sign-in code expires after 15 minutes and allows at most 5 attempts; a new code can be requested at most 3 times per account per hour and 10 per day; the same rules apply to the fresh codes for sensitive actions (S4) |
| 5 | How guests are notified of programme changes, given that guests have no account | INF5: guest notifications go by email to the household lead's address, captured when the household responds on the guest link; a household that provided no email sees changes when they next open their link, and the link itself shows a "changed since your last visit" marker |
| 6 | Retention periods: D5 says "for example" only | INF6: the retention table below fixes every data type; a data type not listed defaults to "kept while the account or occasion exists, then deleted with it" |
| 7 | What "ten AI text results a month" (Q6) actually is | INF7: the AI text feature is invitation and message wording suggestions only, offered with explicit generation labelling and an edit box before use; the model and provider are an operator decision recorded in the console; no AI feature runs without the user seeing a result first |
| 8 | Time zone handling | INF8: all timestamps are stored in UTC; all user-facing times are displayed in Europe/Bucharest with Romanian month and weekday names (L3); DST transitions are handled by the display layer, never by storing local times |
| 9 | Where the servers are | INF9: all production data is hosted in the EU (Romania preferred); the stack is unchanged (Q7): Next.js, PostgreSQL, one web service and one worker, plus the object store (INF3) and the email provider (INF2) |
| 10 | Backups and recovery | INF10: PostgreSQL is backed up daily with 30 days of retention, and every backup is encrypted with a customer-managed key before it leaves the database; the key is held separately from the backups (never stored alongside them), and the restore test (monthly, logged in the console) verifies decryption end to end, not just file existence; object storage uses versioning so an asset deleted in error is recoverable for 30 days |
| 11 | How directory statistics are computed without tracking | INF11: all statistics are server-side aggregates of application events (a search performed, an enquiry sent, a listing viewed); there is no client-side tracking, no session recording, no visitor identifier anywhere (D4), and the aggregates are computed by the nightly worker |
| 12 | Whether stored files and data are encrypted | INF12: all data at rest is encrypted: the PostgreSQL volume, the object store (server-side encryption with a customer-managed key), and backups (INF10); encryption at rest is the chosen level for portal files, and application-level per-file encryption is deliberately not used, because moderation (P3, V1, F1) and scoped access (S6, V3) require staff and authorized users to read the files, so app-level keys would add key-management risk without adding real protection; the protection for portal files is access control plus encryption at rest, and private requests and financial records additionally follow D2 access grants |

**Retention table (INF6).**

| Data type | Retention |
| --- | --- |
| Sign-in and sensitive-action codes | Deleted 24 hours after expiry or use |
| Accounts and occasions | Kept until deletion request (D6), then 7 days in undo, then deleted |
| Private requests | 30 days after closeout |
| Enquiry and quote threads | Kept with the occasion; deleted with it |
| Receipts and financial records | Kept 7 years after closeout (accounting period), in line with Romanian bookkeeping practice |
| Guest responses and household emails | Kept with the occasion; deleted with it |
| Unclaimed drafts rejected or discarded in moderation | Deleted after 90 days |
| Claim-removal and objection records | Kept 3 years (evidence of handling) |
| Audit log entries | Kept 2 years |
| Directory statistics | Indefinite as daily aggregates; no raw visitor data exists to retain |

**Verdict:** the v3.4 draft would have forced a coding agent into eleven assumptions, so **failed** the review as it stood. With INF1–INF11 and the retention table, this v4 draft requires no known assumption from a coding agent; the remaining decisions (email provider, AI provider, hosting vendor within the EU) are operator choices with their constraints fixed, not silent builder guesses.

## 19. Final coding-agent review (v4.4)

The document changed materially after the v4 review (MCP tools, directory assistance, magic-link sign-in, security hardening). The review question was asked again fresh. Seven assumptions were found in the new material; all are bridged.

| # | Assumption a coding agent would have had to make | Bridged by |
| --- | --- | --- |
| 1 | What happens when a mail scanner prefetches the one-tap sign-in link (S1) before the user clicks it | SEC14: single-use link, code still valid, consumed-link page offers one rate-limited new code |
| 2 | Whether propose tools check write access, not just read access (MCP3 vs MCP2) | SEC15: propose tools bounded by the user's write grants, same rule as reads |
| 3 | How public forms resist bots with no third-party CAPTCHA allowed (D1) | SEC11: rate limits, honeypot, time-to-submit floor, throttle message |
| 4 | Cookie flags and where session state lives | SEC12: Secure, HttpOnly, SameSite=Lax, server-side revocable session, nothing security-relevant in localStorage |
| 5 | Where secrets live and how they rotate | SEC13: secret store, never in repo or build output, annual rotation, rotation dates visible in console |
| 6 | Whether a deploy requires CI to have passed, and what protects the deployable tags | DEP7: protected main, deployable tags only with green CI on that exact commit, emergency bypass audit-logged |
| 7 | Where the MCP endpoint lives and how a client authenticates | MCP8 (extended): the MCP server is served at app.eventdesk.ro/mcp over HTTPS, clients authenticate with the personal token as a Bearer credential, the server announces its protocol version and tool catalogue on connect, and tokens follow SEC8 hashing |

**Final verdict:** with SEC11–SEC16, DEP7 and the MCP endpoint definition, the v4.9 blueprint requires no known assumption from a coding agent. Remaining degrees of freedom are operator choices inside fixed constraints (email provider, AI provider, EU hosting vendor, secret store product). The blueprint is ready to hand to a builder.

## 20. Launch obligations (v4.6)

Requirements SEC1–SEC16, INF1–INF12 and DEP1–DEP7 make the software buildable without assumptions. A product is production ready only when the obligations around the software are also explicit. These are operator obligations, not builder features; each is a launch gate for its release, owned by a named staff role (section 10, Staffing), and none is left implicit.

| ID | Obligation | Owner |
| --- | --- | --- |
| LAU1 | Legal documents exist and are linked before any account can be created: Termeni și condiții (planner terms, business terms as a separate document), Politica de confidențialitate, and a cookie notice. The cookie notice is shown once inside the app (the public site sets no cookies, D1), lists the three cookies actually used (session, device rate-limit cookie per SEC16, and language preference), states that none is used for tracking or advertising, and links to the privacy policy; it is re-shown only when the cookie set changes | PrivacyOwner |
| LAU2 | ANSPDCP formalities are completed before launch: operator/representative records kept current, the registry of processing activities started on day one, and a DPIA performed and signed for the processing that is highest-risk (business discovery BD1–BD7, guest household data, MCP external transfer MCP4), with the DPIA revisited whenever discovery sources or MCP tools change | PrivacyOwner |
| LAU3 | The email sending domain is warmed up before the first real sign-in email is sent: SPF, DKIM and DMARC verified, the provider's dedicated sending domain confirmed, and a small seed of test sends delivered to major Romanian and free providers (Gmail, Outlook, Yahoo, Posteo) before launch, because a cold domain sending one-tap login links is the single most likely way to break sign-in on day one | SecurityAdministrator |
| LAU4 | An external penetration test of the public surfaces (public site, sign-in, guest links, uploads, directory, MCP endpoint) is completed, findings triaged, and critical and high findings fixed before the first real guest link is sent; the report and triage are retained by SecurityAdministrator and repeated after any change to sign-in, guest links or MCP | SecurityAdministrator |
| LAU5 | Production monitoring and incident response exist from day one: health checks (already feeding deploy rollback, DEP5), error-rate and queue-depth alerts to a monitored operator channel, a documented recovery procedure (restore from backup, INF10) with a stated RTO of 4 hours and RPO of 24 hours (one daily backup), and a simple incident log in the console; guest-facing pages get a plain-language "ceva nu funcționează" status message, never a raw stack trace | SecurityAdministrator |
| LAU6 | Business terms are explicit before the first business registers: the free phase (MON1) is stated in writing (free at launch, what may later be paid, the 60-day notice, MON3), Featured labelling rules (P13–P16, principle 7) are quoted in the business terms so a business knows organic order is never for sale, and the claim and objection process (P29, P30) is published on the "For businesses" page | CommercialManager |
| LAU7 | A launch-day runbook exists: who is on call, how deploys and rollbacks are run (W10, DEP1–DEP7), how a bad discovery batch is pulled back (W5), how a guest-link incident is communicated, and the two-person rule for every irreversible console action; day-to-day running needs at least two people (section 10), so a solo launch is out of scope by design | PlatformAdmin |

| LAU8 | Digital Services Act duties (Regulation (EU) 2022/2065, applied in Romania by Law 50/2024 with ANCOM as Digital Services Coordinator): EventDesk is at minimum a hosting service and becomes an online platform once businesses present content to the public. Before launch: register the service with ANCOM, publish a point of contact, and run a notice-and-action mechanism (anyone can report illegal content or an unlawful listing; every report and moderation decision is logged with the reason given to the affected party, reusing the W3 restriction flow and the SEC10 audit log); terms of service state the moderation rules in plain Romanian; annual transparency reporting to ANCOM as required | PlatformAdmin |
| LAU9 | European Accessibility Act (Directive (EU) 2019/882, applicable since 28 June 2025 to e-commerce and consumer services): publish an accessibility statement for the planner-facing service in Romanian and English, keep WCAG 2.2 AA (Q2) as the compliance target, provide a feedback route for accessibility complaints, and record the statement's date and evaluation method in the console | PrivacyOwner |

**Note.** LAU3 and LAU7 are the two obligations most often skipped and most likely to sink an otherwise correct launch: a cold email domain blocks every login, and a solo operator cannot satisfy the two-person approval rule that the security model (SEC9, SEC10, DEP2) depends on.

## 21. Design language (v2.3)

Five UI/UX directions were designed as full mock-ups (occasion overview, guest page, event-day view, seating designer, directory) and evaluated against the product principles. One primary language is adopted; the other directions contribute situational surfaces and conventions. The mock-ups are the "Five UI/UX Design Directions" file and are part of this specification.

### Adopted primary language: "Garden Soirée", with "Honest Directory" type discipline

| Element | Decision |
| --- | --- |
| Character | Warm, organic, rounded; a garden-party invitation, not software. Works equally for a child's party, a picnic and a wedding |
| Palette | Cream and sage foundation (#fdfefa, #dcead1), ink-green text (#23301f), terracotta reserved for attention states only (#b0674a) |
| Type | Non-standard pairing: Sora (or Avenir Next fallback) for UI text, Cormorant Garamond for human voice (invitations, greetings), DM Mono (or Copperplate Light fallback) for labels, states and anything factual or paid |
| Form | 12–18px radius cards, pill buttons, one question per screen on guest pages, single-column phone layout |
| Touch | All targets ≥44px (A12); steppers and chips primary on phone; drag supported with tap path of equal quality (Q10) |
| Factual labels | Paid, unknown and system facts use the Honest Directory convention: small mono/uppercase labels, never styled as endorsement. "Featured — paid placement" is set in the same weight as the business name, not fine print |
| Unknown treatment | Missing prices, dimensions and confirmations render in italic grey with the word "unknown", never a zero or an estimate (principle 5, taken from the Editorial Banquet direction) |

### Situational surfaces

| Surface | Language | Applies to |
| --- | --- | --- |
| Event-day and dark mode | "Midnight Candlelight": ink-navy, brass accents, one glowing Now row, states legible at arm's length | B7 event-day view, evening venue use, automatic dark mode |
| Layout designer | "Paper & Ink": blueprint paper, engraved rules; venue tables solid, custom tables dashed (provenance visible); fit-check strip on the drawing | Release C space model and seating (V1–V7) |

### Typefaces

Sora, Cormorant Garamond, Space Grotesk, Marcellus, Fraunces and DM Mono, each with named system fallbacks (Avenir Next, Palatino, Trajan Pro, Didot, Copperplate Light, Menlo). All font services load with a fallback stack that preserves the visual character if the CDN is unavailable; the public site's no-third-party-script rule (D1) applies to analytics and trackers, and font loading is permitted but self-hosted fonts are preferred so the rule stays simple.

### Design gates

- The Garden Soirée palette must pass WCAG 2.2 AA at 320px (Q2) before release A ships; contrast pairs are recorded in the design file.
- The "Featured — paid placement" label must be legible at one glance at phone width before release P ships (P14); if the card styling overpowers the label, the card styling is reduced, not the label.
- Every screen mock must exist at phone width before desktop (A12); desktop is the expanded view, not a separate design.