# 05 — Release A: plan and invite (work items)

> **How to read this file (added after the build).** This is the original work-item
> specification, written as a plan before any code existed and kept as the record of scope.
> The work described here has since been built; it is not a description of the final code.
> Where it names a tool that was not used in the end, read it like this: *Prisma* → Drizzle ORM
> (`15-conventions.md`); *Playwright*, *axe* and *k6* → not set up, see what is and is not
> tested in `11-testing-and-qa.md`; *Garden Soirée* → the "Maison" design language
> (`16-design.md`). What was actually built and verified: `13-implementation-log.md`;
> requirement by requirement: `09-traceability.md`.

Outcome (PRD section 6): create, delegate and track a private or shared occasion — complete and
usable on a phone before release B starts. All items depend on Release 0 being merged.

### A-01 — Occasion creation and event brief
- **PRD:** A1, A11
- **Depends on:** R0-04, R0-06, R0-16
- **Scope:** create occasion with title + date, date range or poll; free activation, no payment
  step anywhere (A1, MON1); event brief with purpose and 2–3 priorities the plan links to (A11).
- **Acceptance:**
  - [ ] New account can create and activate an occasion with no payment/promo/card UI encountered
  - [ ] Brief saves purpose + priorities; plan overview links to them
  - [ ] All strings ro+en; works at 320px

### A-02 — Templates with date-relative scheduling
- **PRD:** A2
- **Depends on:** A-01, R0-16
- **Scope:** templates picnic, aniversare, nuntă, botez, Revelion, voiaj solo, voiaj de grup, or
  blank; template tasks auto-scheduled at 12/9/6/3/1-month stages relative to the occasion date;
  re-running a template shows a diff and creates no duplicates; moving the occasion date shifts the
  schedule as a What-if preview, never silently.
- **Acceptance:**
  - [ ] All seven templates seeded (ro + en names)
  - [ ] Tasks land at the right offsets; moving the date shows the shift preview; confirm applies,
    discard changes nothing (principle 3)
  - [ ] Re-running a template produces a diff (create/change/skip), no duplicate tasks

### A-03 — Tasks with List/Board/Calendar views
- **PRD:** A3, principle 2
- **Depends on:** A-01, A-05
- **Scope:** tasks with one accountable owner, due date, checklist, dependencies, child tasks;
  List, Board and Calendar render the same rows (no separate stores).
- **Acceptance:**
  - [ ] Owner/due/checklist/dependencies/children persist; changing a task in one view reflects in
    the other two immediately
  - [ ] Dependency violations (e.g., child done before parent) surfaced, not silently blocked

### A-04 — Delegation by offer and acceptance
- **PRD:** A4
- **Depends on:** A-03, A-05
- **Scope:** owner/lead offers a task; accept or decline; declining returns the task to the
  delegator, never to a random person; state visible in overview (A10).
- **Acceptance:**
  - [ ] Offer → accept assigns owner; decline returns to delegator with reason; no random reassignment

### A-05 — Roles and capability grants
- **PRD:** A5, D2
- **Depends on:** A-01, R0-04
- **Scope:** roles owner, project manager, workstream lead, contributor, supplier, guest; finance
  and private-request access as separate grants; localized role labels incl. suggested naș/nasă and
  damă/naș de cununie for botez/nuntă (ro); grant checks enforced server-side in `packages/core`.
- **Acceptance:**
  - [ ] A contributor without the finance grant gets 403 on budget reads/writes server-side (D2)
  - [ ] Role labels localize; naș/nasă suggested labels appear on botez/nuntă occasions

### A-06 — Household invitations and RSVP
- **PRD:** A6, S6, SEC2, L2, INF5
- **Depends on:** A-01, A-05, R0-04
- **Scope:** invitation link per household (≥128-bit hashed token, revocable, optional expiry,
  per-link rate limit — SEC2); a lead responds for their party; attendance recorded per session;
  planner-defined custom RSVP questions (menu choice, allergies, accommodation, transport, free
  text) shown one at a time on the guest link; **children only as an attending count per household
  ("+2 copii") — no name/age/details, guest page states this, and free-text answers containing
  child-like details trigger a warning**; guest link opens in the invitation language, one-tap
  switch (L2); household lead email captured at RSVP for change notifications (INF5); a link shows
  only its own household.
- **Acceptance:**
  - [ ] Token ≥128-bit, hashed at rest; revoked link 403s; expired-at-RSVP-deadline link 403s
  - [ ] Household response records adults + children count only; no child person records exist in
    schema/UI; warning fires on child details in free text
  - [ ] Custom questions render one per screen on the guest link; link language toggle works
  - [ ] Shared link exposes only that household's view (SEC2)

### A-07 — Date polls
- **PRD:** A7
- **Depends on:** A-06
- **Scope:** Yes/Maybe/No votes; host confirms; votes never reserve capacity (A8 capacity separate).
- **Acceptance:**
  - [ ] Votes recorded per household; host confirm sets the date; capacity unchanged by votes

### A-08 — Shared capacity, atomic
- **PRD:** A8, Q4
- **Depends on:** A-06
- **Scope:** one capacity count shared by invited + public guests; two people cannot take the last
  place — conditional update / row lock, loser gets a clear "taken" response.
- **Acceptance:**
  - [ ] Concurrent RSVPs for the last place: exactly one succeeds (integration test with parallel
    requests); double-tap on one RSVP applies once (Q4)

### A-09 — Contribution claims, atomic
- **PRD:** A9
- **Depends on:** A-03
- **Scope:** claim/change/release against a stated need with units; two claims cannot take the same
  last units.
- **Acceptance:**
  - [ ] Parallel claims on last units: exactly one wins; release returns units

### A-10 — Overview and daily reminder digest
- **PRD:** A10
- **Depends on:** A-03, A-04, R0-12
- **Scope:** overview shows next milestone, overdue work, unaccepted delegation, blockers; daily
  digest email (bilingual, L5) to members; digest job in worker.
- **Acceptance:**
  - [ ] Digest contains the four sections; sent once per day per member; respects suppression list
    and Q6 cap

### A-11 — Guest list import (CSV/XLSX)
- **PRD:** A13
- **Depends on:** A-06
- **Scope:** upload CSV/XLSX; column-mapping preview; duplicate detection against existing guests by
  name + household; diff of create/change/skip; applied only after planner confirms.
- **Acceptance:**
  - [ ] Mapping preview shown; duplicates detected; confirm applies exactly the diff; cancel
    changes nothing

### A-12 — Basic exports
- **PRD:** release A "basic exports", P16 (invariant 7)
- **Depends on:** A-03, A-06
- **Scope:** export plan (tasks, guests counts, budget later) to CSV/PDF; exports never contain
  Featured/paid content (P16) and never leak other households' private data (D2).
- **Acceptance:**
  - [ ] Export contains own occasion data only; test asserts no directory/Featured fields present

Release A exit: all above merged, gate M0 checks pass, usability pilot (5 users per journey, 4/5
unaided — PRD section 12) scheduled with the operator before B starts.
