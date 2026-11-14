# 06 — Release B: budget and deliver (work items)

> **How to read this file (added after the build).** This is the original work-item
> specification, written as a plan before any code existed and kept as the record of scope.
> The work described here has since been built; it is not a description of the final code.
> Where it names a tool that was not used in the end, read it like this: *Prisma* → Drizzle ORM
> (`15-conventions.md`); *Playwright*, *axe* and *k6* → not set up, see what is and is not
> tested in `11-testing-and-qa.md`; *Garden Soirée* → the "Maison" design language
> (`16-design.md`). What was actually built and verified: `13-implementation-log.md`;
> requirement by requirement: `09-traceability.md`.

Outcome (PRD section 6): budget and deliver a simple occasion. Depends on Release A merged.

### B-01 — Budget by category
- **PRD:** B1
- **Depends on:** A-01, A-05
- **Scope:** categories with estimate, committed, invoiced, paid and forecast as separate columns;
  finance grant required (D2).
- **Acceptance:**
  - [ ] Five money states stored and displayed separately, never merged; finance-less member sees
    none of it (403 server-side)

### B-02 — Expenses and receipts
- **PRD:** B2
- **Depends on:** B-01, R0-10
- **Scope:** expenses with receipt upload (SEC4 pipeline); approval and payment are separate states.
- **Acceptance:**
  - [ ] Expense can be approved while unpaid and vice versa; states independent; receipt served per
    upload rules

### B-03 — Shared-cost ledger
- **PRD:** B3
- **Depends on:** B-01
- **Scope:** one balanced ledger: who paid, who benefits, who owes whom, per currency; settlement
  view (RON at launch).
- **Acceptance:**
  - [ ] Ledger balances to zero across participants for any split; multi-currency rows keep their
    own currency

### B-04 — Suppliers, bookings, versioned briefings
- **PRD:** B4, P10
- **Depends on:** A-01, R0-10
- **Scope:** supplier records with quotes (PDF marks as quote, P12), booking states, versioned
  briefings the supplier acknowledges via scoped supplier link (S6).
- **Acceptance:**
  - [ ] Booking state transitions recorded; briefing versions immutable, acknowledgement stored;
    supplier sees only their own booking through the scoped link

### B-05 — Final-order snapshots and deltas
- **PRD:** B5, principle 4
- **Depends on:** B-04, A-08
- **Scope:** final-order snapshot per booking; later guest changes produce a delta row, never a silent
  change to the agreed order.
- **Acceptance:**
  - [ ] Snapshot immutable; post-snapshot RSVP change yields a visible delta linked to the change

### B-06 — Deliveries, hired items, returns + audited corrections
- **PRD:** B6, principle 4
- **Depends on:** B-04
- **Scope:** deliveries/hired items/returns with received quantities; received/paid/arrived values
  change only via `Correction` rows (before/after, actor, reason) feeding the audit log (SEC10).
- **Acceptance:**
  - [ ] Direct overwrite of a received quantity is impossible at API+DB level; correction flow
    creates the audit trail

### B-07 — Event-day view
- **PRD:** B7
- **Depends on:** A-03
- **Scope:** Ready/Running/Waiting/Done states driven from the same task records; "Midnight
  Candlelight" theme (section 21) legible at arm's length.
- **Acceptance:**
  - [ ] State changes reflect instantly from task records; one glowing "Now" row; dark theme passes
    contrast at 320px

### B-08 — Readiness decisions
- **PRD:** B8
- **Depends on:** B-07
- **Scope:** Hold / Proceed / Proceed with conditions, each tied to evidence links; recorded with
  actor and time.
- **Acceptance:**
  - [ ] Decision requires at least one evidence reference; history visible

### B-09 — Cancel or postpone with preview
- **PRD:** B9
- **Depends on:** R0-16
- **Scope:** cancel/postpone shows a What-if preview of everything affected (guests, suppliers,
  payments, deliveries) before applying.
- **Acceptance:**
  - [ ] Preview lists all affected records; apply notifies via the right channels; discard changes
    nothing

### B-10 — Closeout
- **PRD:** B10, D5
- **Depends on:** B-01, B-06
- **Scope:** closeout list of unpaid balances, returns, deposits; lessons carried to the next
  occasion; triggers retention clock (private requests purged 30 days after closeout, INF6).
- **Acceptance:**
  - [ ] Closeout list complete from ledger + deliveries; lessons saved to account; retention job
    purges private requests at closeout+30d

### B-11 — Installable app, offline shell, downloadable briefing
- **PRD:** B11, Q1
- **Depends on:** R0-08
- **Scope:** PWA installable on iOS/Android; offline shell; downloadable briefing (PDF) of the
  occasion.
- **Acceptance:**
  - [ ] `beforeinstallprompt` fires on a phone; installed app opens offline to the shell; briefing
    PDF downloads with current data

### B-12 — Supplier payment deadlines and finance alerts
- **PRD:** B12
- **Depends on:** B-04, A-10
- **Scope:** advances, instalments, final balances carry due dates; daily digest raises upcoming and
  overdue payments to finance-grant holders; What-if shows the money effect of moving a payment.
- **Acceptance:**
  - [ ] Overdue instalment appears in the finance holder's digest only; moving a payment shows the
    cost effect in preview

Release B exit: gate M1 pilot (PRD section 12) run with planners + 10 business interviews; 5 of 10
agree to list free, 3 state in writing they'd pay after monetization — otherwise revise the offer
before building P.
