# EventDesk.ro — Build Plan (agent-ready)

This directory turns `docs/PRD.md` (v4.9) into a build plan that coding agents can execute
without making assumptions. The PRD's own reviews (sections 14, 18, 19) established that the PRD
leaves no silent assumptions; this plan preserves that property: every requirement ID from the PRD
maps to exactly one or more work items here (see `09-traceability.md`), and every work item has
testable acceptance criteria.

Nothing in this plan overrides the PRD. If a conflict is found, the PRD wins and the conflict is
reported, not resolved silently.

## Document map

| File | What it contains | Read it when |
| --- | --- | --- |
| `README.md` (this file) | How to use the plan, invariants, agent workflow, definition of done, gates | Always, first |
| `01-architecture.md` | Stack, repo layout, domains, environments, secrets, CI/CD, deployment pipeline | Before touching code or infra |
| `02-data-model.md` | Prisma model dictionary per aggregate, key enums, ID conventions | Before any schema change |
| `03-cross-cutting.md` | Auth/security/privacy/i18n/quality/INF specs that every work item must satisfy | Before implementing any user-facing feature |
| `04-foundation-release-0.md` | Release 0 (platform foundation) work items R0-01…R0-18 | First sprint; everything depends on these |
| `05-release-A.md` | Release A work items (plan and invite) | After Release 0 merges |
| `06-release-B.md` | Release B work items (budget and deliver) | After Release A ships |
| `07-release-P.md` | Release P work items (business module, directory, console, MCP, dormant monetization) | After A+B; depends only on A and B (PRD section 6) |
| `08-releases-C-D-E.md` | Release C, D, E work items (each needs its own go-ahead per PRD section 6/9) | Later; not gated by business income |
| `09-traceability.md` | PRD requirement ID → work item mapping (coverage proof) | When picking up or reviewing a work item |
| `10-operator-decisions.md` | Decisions only the operator may make; agents must not guess these | When a work item says "operator-configurable" |
| `11-testing-and-qa.md` | Test layers, per-release automated test plans, bug-check/release-blocker checklist | Before and during every release |
| `12-security-review.md` | Brief for a cybersecurity agent: scope, checklist mapped to SEC/S/D/MCP/DEP, severity triage, finding template | Before security review and before LAU4 pen test |

## Non-negotiable invariants (enforce in code and tests)

These come from PRD section 5 (principles) and the security review. Every PR that touches the
relevant area must include a test that would fail if the invariant were broken.

1. **Free and frictionless for planners** — no payment, trial, card, or mandatory two-step anywhere
   in planner flows (principle 1, MON1).
2. **One record, many views** — a task, seat or payment exists once; all views read the same row
   (principle 2).
3. **Preview before applying** — changes to dates, guests, suppliers, payments and external-AI
   proposals are shown as a "What if?" delta and applied only on explicit confirmation
   (principle 3, R0-16, MCP3).
4. **Facts stay facts** — arrivals, payments and received stock change only via an audited
   correction record, never an overwrite (principle 4; see `03-cross-cutting.md`).
5. **Unknown stays visible** — missing price/dimension/confirmation renders as *unknown* (italic
   grey, never zero, never an estimate) and is excluded from fit checks (principle 5, V6).
6. **Private by default** — guests, budgets, private requests visible only via the specific grant
   (principle 6, D2).
7. **Paid means position, never preference** — payment never changes organic directory order and
   never leaks into plans, guest pages, emails or exports; Featured cards are honestly labelled
   (principle 7, P13–P16). While monetization is OFF, Featured does not exist at all (MON5).
8. **A lapse never blocks an event** — when a business plan lapses, its clients' occasions and
   already-used drawings/catalogues stay fully readable (principle 8, P23).
9. **Children are never persons** — only an attending count per household, no child data anywhere,
   free-text warning included (A6).
10. **External AI proposes, never applies** — MCP write tools create proposals that enter the
    What if? flow; nothing is applied silently (MCP3, SEC15).
11. **No third-party scripts on the public site; no visitor identifiers anywhere** (D1, D4, INF11).
12. **Append-only audit log** — no role, including PlatformAdmin, can edit or delete audit entries
    (SEC10).

## Agent workflow

1. Pick the next unblocked work item from the current release file (dependencies listed per item
   must already be merged on `main`).
2. Create a branch `feat/<work-item-id>-<short-slug>` from `main`.
3. Implement with tests. Update `09-traceability.md` if you split or add work items.
4. Open a PR to `main` using this checklist (put it in the PR body):
   - [ ] All acceptance criteria of the work item pass (tests linked)
   - [ ] CI green: lint, typecheck, unit + integration tests, build of all apps, dependency audit, e2e smoke, a11y (axe) on touched flows
   - [ ] Every user-facing string externalized in **both** `ro.json` and `en.json`; default locale `ro-RO` (L1, L2)
   - [ ] Works at 320px width, all touch targets ≥44px, WCAG 2.2 AA contrast (A12, Q2); every drag action has an equal tap path (Q8, Q10)
   - [ ] Security checklist applies (see `03-cross-cutting.md` §Security review): CSRF, headers, token hashing, rate limits, upload handling as relevant
   - [ ] No secrets in repo, logs or build output (SEC13); no third-party script added to the public site (D1)
   - [ ] Mutating endpoints idempotent / double-submit safe (Q4)
   - [ ] PRD requirement IDs listed in the PR description; traceability updated
5. Merge only after review (another agent or the operator) and green CI. Releases are cut as
   annotated tags `vX.Y.Z` from protected `main`; a tag is deployable only when CI passed on that
   exact commit (DEP7). Never force-push `main` or a release tag.
6. Console-driven deploys follow `01-architecture.md` §Deployment (W10, DEP1–DEP7).

## Definition of done per release

A release is done when: every work item of the release is merged with its acceptance tests green;
the release-level quality gates pass (Q1–Q6: 320px/AA, guest page <2.5s content and <200ms
interaction, idempotency, 1,000-attendee / 50-operator / 10,000-task qualification via load test,
fair-use limits enforced); the security review items listed in the release file are implemented and
tested; the launch obligations (LAU1–LAU9) that gate this release have a named owner and are
done or scheduled; pilot measures (PRD section 12) are recorded; and the PRD traceability shows
no unmapped Must requirement for the release.

A release is **blocked** by any unresolved unauthorised access, duplicate money posting, unexplained
overbooking, lost approved records, or wrongly reversed facts (PRD section 12).

## Release and gate map (PRD sections 6 and 12)

| Stage | Contents | Gate exit |
| --- | --- | --- |
| Release 0 (foundation) | `04-foundation-release-0.md` | M0: free activation works; separate public/app sites; no third-party script on either (D1) |
| Release A | `05-release-A.md` | Usable private/shared occasion on a phone (A1–A13) |
| Release B | `06-release-B.md` | Budgeted, delivered occasion incl. event-day view and installable app (B1–B12) |
| Release P | `07-release-P.md` | M2: business module live, billing in test mode, monetization switch OFF (MON1–MON5) |
| Free phase live | Launch areas (Bucharest/Ilfov, Cluj proposed) | M3: 20 approved listings per promoted pair; enquiries measured |
| Monetization ON | Console switch, 60-day notice | M4: M2/M3 plus terms, tax setup, keys approved; 30 days no grant errors |
| Releases C, D, E | `08-releases-C-D-E.md`, each with its own go-ahead | M5: three consecutive months income ≥ 1.2× costs |

Pilot note (PRD section 12, M1): before building P, run A+B with pilot planners — 5 users per
journey, 4 of 5 completing unaided; 20 public guides; 10 business interviews, of which 5 must agree
to list in a completely free product and 3 must state in writing they would pay once monetization is
enabled. Otherwise revise the offer before P.
