# 08 — Releases C, D, E (work items)

> **How to read this file (added after the build).** This is the original work-item
> specification, written as a plan before any code existed and kept as the record of scope.
> The work described here has since been built; it is not a description of the final code.
> Where it names a tool that was not used in the end, read it like this: *Prisma* → Drizzle ORM
> (`15-conventions.md`); *Playwright*, *axe* and *k6* → not set up, see what is and is not
> tested in `11-testing-and-qa.md`; *Garden Soirée* → the "Maison" design language
> (`16-design.md`). What was actually built and verified: `13-implementation-log.md`;
> requirement by requirement: `09-traceability.md`.

Per PRD sections 6 and 9, each of these releases needs its own go-ahead once the earlier releases are
in use; they are not gated by business income, but spending on them is reviewed at each gate. The
flower arrangement designer sits at the C/P boundary: the quote flow ships with P (P-07), the visual
designer below.

## Release C — design and run a celebration

| ID | Work item | PRD | Depends on | Acceptance (summary) |
| --- | --- | --- | --- | --- |
| C-01 | Seating and table layout on the occasion's space model (venue drawing + custom tables); drag with snap/collision warnings **and** equal tap path | C, V1–V7, Q8, Q10 | P-06 | Every arrangement action has a tap path; dragged item ≥44px, magnified, cancellable; custom tables dashed |
| C-02 | Fit checks at every meal stage incl. between courses, against stated dims; unknown dims excluded and shown unknown | C, V6, principle 5 | C-01, P-06 | Fit-check strip on drawing; unknown never counted as fitting |
| C-03 | Entertainment programme, cue list, performer briefings | C | B-04 | Cue list versioned; briefings acknowledged like B4 |
| C-04 | Invitation and stationery designer with proofs and print-ready PDF | C | A-06 | Print-ready PDF generated; proof step before send; animated envelope is an open design question, not built |
| C-05 | Menus, meal choices, food/drink quantities | C | A-06 | Per-guest meal choices flow into order snapshots (B5 deltas) |
| C-06 | Public event page with registration, waitlist, conditional questions | C, SEC11 | A-06, A-08 | Public registration bot-protected (SEC11); waitlist promotes atomically (A8) |
| C-07 | Private dietary/access requests + published accessible guest journey | C | A-06, D2 | Private requests visible only with the private-request grant; journey page published in ro+en |
| C-08 | Guest-facing seat assignment: published seating shows each guest their table/seat on their link + invitation view; unpublished seating never visible | C | C-01, A-06 | Seat visible only after publish; unpublished invisible to guests (test) |
| C-09 | Print pack: QR on physical invitations (→ guest's own invitation view), table cards with QR → guest event page (programme, menu, space layout V9, parking V10), to-scale room plan — print-ready PDF from the same records | C, V9, V10 | C-01, C-04 | PDF regenerates from records; QRs resolve to scoped views |
| C-10 | Guest event page: venue address + external navigation link (opens guest's maps app, rel="noopener noreferrer" SEC7); guests notified once per programme change for moments concerning them (INF5 email/marker) | C, SEC7, INF5 | A-06 | Change notification sent once per change; link carries no referrer leak |
| C-11 | Gift estimator (calculator dar): private per-planner range suggestion from a few questions (relationship, distance, venue type); labelled cultural guide; no data shared; no guest sees another's amount; free forever | C | A-01 | Private to planner; no storage shared across planners; not in any paid tier |
| C-12 | Promotion exports: generated copy/assets to export; nothing posted or spent automatically | C | A-01 | Export-only; no posting integration exists |
| C-13 | Visual flower arrangement designer (base form, catalogue items from one or more businesses, stem counts, running indicative cost labelled indicative, never a quote) + quote flow F5/F6 live | F3–F6, C | P-07 | Indicative cost labelled; quote request carries only F5 fields |

## Release D — solo or group holiday

| ID | Work item | PRD | Depends on | Acceptance (summary) |
| --- | --- | --- | --- | --- |
| D-01 | Itinerary across time zones (UTC storage, Europe/Bucharest + trip-zone display, INF8); booking import the user confirms (What-if) | D | A-01, R0-16 | Import previewed, applied on confirm; times correct across DST |
| D-02 | Subgroups, optional activities | D | A-05 | Subgroup-scoped views respect grants (D2) |
| D-03 | Packing lists | D | A-03 | Checklist tasks reused |
| D-04 | Transport legs and room allocation | D | A-06, C-01 | Rooms assigned atomically like capacity (A8) |
| D-05 | Multiple currencies and participant settlement views | D, B3 | B-03 | Settlement per currency from the one ledger |

## Release E — rehearse and operate complex occasions

| ID | Work item | PRD | Depends on | Acceptance (summary) |
| --- | --- | --- | --- | --- |
| E-01 | Rehearsal simulation: step through the day, see conflicts without changing anything | E, principle 3 | B-07 | Read-only simulation; conflicts flagged; nothing persisted |
| E-02 | QR check-in and guest-flow estimates for larger events | E, Q5 | C-09 | QR scan marks arrival via audited correction (principle 4); flow estimates from aggregates |
| E-03 | Limited offline capture: arrivals and own checklist ticks only, reconciled on reconnect | E | B-11, B-06 | Offline queue syncs once on reconnect (Q4); conflicts surfaced, never silently merged |
| E-04 | Optional sustainability goals with measured quantities | E | B-01 | Goals tracked against measured quantities; unknown stays unknown |
