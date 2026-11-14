# EventDesk.ro — build documentation (index)

**What this folder is, in plain English.** These files describe the EventDesk.ro product as it
is built in this repository: how it is put together, what data it keeps, what has and has not
been checked, how to deploy and run it, and how each requirement of the product document
(`../PRD.md`, v4.9) was met. Start with `13-implementation-log.md` for the status and
`09-traceability.md` for the honest requirement-by-requirement verdict.

Nothing here overrides the PRD. If a conflict is found, the PRD wins and the conflict is
reported, not resolved silently. Known places where the code and the PRD differ are listed at
the end of `09-traceability.md`.

## How these documents relate to the code

The documents were first written as a **plan**, before any code existed. The product has since
been built (Releases 0, A, B, P, C, D and E, on 13–14 November 2026), and the documents now
fall into three groups:

| Group | Files | Status |
| --- | --- | --- |
| **The record of scope** | `04`–`08` | The original work-item specifications, kept as written so the scope and acceptance criteria stay on record. They describe intent, not the final shape: where they say *Prisma*, *Playwright*, *k6*, *axe* or *Garden Soirée*, read the note at the top of each file |
| **As built** | `01`, `02`, `03`, `09`, `10`, `11`, `13`, `14`, `19`, `20` | Rewritten against the code. Statements are verified against source files; anything that has not been verified by running it says so |
| **How the code is organised** | `15`, `16`, `17`, `18` | The binding conventions, the design language, the UI checklist and the reference of what each package offers |

`12-security-review.md` is owned by the security review and is maintained separately.

Three deviations from the original plan were decided during the build (details at the top of
`15-conventions.md`): the database layer is **Drizzle ORM** (the plan said Prisma, whose
engine binaries could not be downloaded in the build environment); the look is **"Maison"**
instead of the PRD's "Garden Soirée" (owner's decision; the behavioural design gates still
apply); and translations are **one file per namespace** instead of one file per language.

## Document map

| File | What it contains | Read it when |
| --- | --- | --- |
| [`README.md`](README.md) (this file) | Index, the twelve invariants and where each is enforced, release and gate map | First |
| [`01-architecture.md`](01-architecture.md) | The real architecture: stack and versions, packages, request flow, sign-in model, worker, storage, MCP, console, CI and deployment | Before touching code or infrastructure |
| [`02-data-model.md`](02-data-model.md) | All 167 tables by domain, the database guards, conventions, retention and deletion as implemented | Before any schema change; when answering "what do we keep?" |
| [`03-cross-cutting.md`](03-cross-cutting.md) | Sign-in, links, rate limits, uploads, email, dormant payments, AI text, languages, accessibility — as implemented, with what was not built | Before changing any user-facing feature |
| [`04-foundation-release-0.md`](04-foundation-release-0.md) | Original work items R0-01…R0-18 | To see the intended scope of Release 0 |
| [`05-release-A.md`](05-release-A.md) | Original work items A-01…A-12 | Scope of Release A (plan and invite) |
| [`06-release-B.md`](06-release-B.md) | Original work items B-01…B-12 | Scope of Release B (budget and deliver) |
| [`07-release-P.md`](07-release-P.md) | Original work items P-01…P-15 | Scope of Release P (businesses, directory, console, MCP) |
| [`08-releases-C-D-E.md`](08-releases-C-D-E.md) | Original work items C-01…C-13, D-01…D-05, E-01…E-04 | Scope of Releases C, D, E |
| [`09-traceability.md`](09-traceability.md) | Every PRD requirement id: status, where it lives, which test covers it; the gap list | To judge completeness |
| [`10-operator-decisions.md`](10-operator-decisions.md) | Every decision left to the operator, the setting that carries it, its placeholder and where the code reads it | Before a deployment; when a value needs choosing |
| [`11-testing-and-qa.md`](11-testing-and-qa.md) | The test layers that exist, the test inventory, what is not covered, a manual checklist per release, the evidence people must gather | Before a release |
| [`12-security-review.md`](12-security-review.md) | The security review: scope, checklist, severity scale, findings | Before a release and before the penetration test (LAU4) |
| [`13-implementation-log.md`](13-implementation-log.md) | Status page: what is built, what was verified, what was not | Always, for the current state |
| [`14-deploy-runbook.md`](14-deploy-runbook.md) | Deploy, rollback, first installation, backups and restore, secrets, launch day | Before and during any deployment |
| [`15-conventions.md`](15-conventions.md) | Binding code conventions and the deviations from the plan | Before writing code |
| [`16-design.md`](16-design.md) | The "Maison" design language: rules, tokens, components | Before building a screen |
| [`17-ui-rules.md`](17-ui-rules.md) | The checklist every screen is built to | Before building or reviewing a screen |
| [`18-contracts.md`](18-contracts.md) | Reference by area of what each package exports and the registries that connect them | When using or extending a package |
| [`19-operations.md`](19-operations.md) | Day-to-day guide for the people who run the platform | When operating the live service |
| [`20-glossary.md`](20-glossary.md) | Product and code terms in plain English with the Romanian on-screen term | Whenever a word is unclear |

Repository-level documents: [`../../README.md`](../../README.md) (run it locally),
[`../../CHANGELOG.md`](../../CHANGELOG.md), [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md),
[`../../SECURITY.md`](../../SECURITY.md).

## The twelve invariants, and where each is enforced

These come from PRD section 5 (principles) and the security requirements. Each row names the
code that enforces the rule and the automated check that would fail if it were broken. Every
file named here exists in the repository; none of these checks has been run in CI on GitHub
(see `13-implementation-log.md`).

| # | Invariant | Enforced by | Check |
| --- | --- | --- | --- |
| 1 | **Free and frictionless for planners** — no payment, trial or card anywhere in planner flows; two-step sign-in never required of planners (principle 1, MON1) | No pricing or checkout route exists outside the dormant business plan screen; `isMonetizationOn` in `packages/core/src/monetization.ts` gates everything paid | `apps/web/test/monetization-off.test.ts` (scans routes and sources); `packages/core/test/billing.test.ts` |
| 2 | **One record, many views** — a task, seat or payment exists once | `queryTasks` is the single source for list, board, calendar and the event-day view (`packages/core/src/tasks.ts`, `eventday.ts`); a packing list is a task (`packing.ts`) | `packages/core/test/planning.test.ts` ("one record, three views"); `eventday.test.ts`; `travel.test.ts` |
| 3 | **Preview before applying** — date, guest, supplier, payment and assistant-proposed changes are shown as a "What if?" preview and applied only on confirmation | `packages/core/src/whatif.ts` (20 registered kinds); only account or staff actors can confirm | `packages/core/test/whatif.test.ts`; `planning.test.ts` (date move); `lifecycle.test.ts`; `packages/mcp/test/tools.test.ts` |
| 4 | **Facts stay facts** — arrivals, payments and received quantities change only through a recorded correction | Database triggers in `packages/db/src/sql/` (`010`, `020_finance_fact_guards`, `020_suppliers_guards`, `021`, `040_operate_guards`) plus `packages/core/src/corrections.ts` | `packages/core/test/money.test.ts`, `deliveries.test.ts`, `suppliers.test.ts`, `operate.test.ts` |
| 5 | **Unknown stays visible** — a missing price, dimension or confirmation is shown as unknown, never zero, and is left out of fit checks | `NULL` in the database; `Unknown`/`ValueOrUnknown` in `@ed/ui`; `formatUnknown` in `@ed/i18n/format`; `packages/core/src/fitcheck.ts` | `packages/core/test/spacemodel.test.ts`, `drawings-seating.test.ts` (V6, V11); `packages/i18n/test/format.test.ts` |
| 6 | **Private by default** — guests, budgets and private requests only through the specific grant | `requireMember` in `packages/core/src/access.ts`, `requireFinance` in `budget.ts`; every read in core checks it | `packages/core/test/planning.test.ts` (A5, D2), `money.test.ts`, `requests.test.ts`, `guests-rsvp.test.ts` |
| 7 | **Paid means position, never preference** — payment never changes organic order and never leaks into plans, guest pages, emails or exports; while monetisation is OFF Featured does not exist | `organicOrder` in `packages/core/src/directory.ts`; `packages/core/src/featured.ts` returns nothing while OFF | `packages/core/test/directory.test.ts` (rotation; source scan for ratings), `featured.test.ts`, `planning.test.ts` (exports, P16), `printpack.test.ts` |
| 8 | **A lapse never blocks an event** — when a business plan lapses its clients' occasions and already-used drawings and catalogues stay readable | `isBusinessLapsed` / `assertBusinessCanCreate` in `packages/core/src/business.ts`; library links in `bizoccasions.ts` | `packages/core/test/business-listings.test.ts` ("lapse groundwork"), `bizoccasions.test.ts`, `billing.test.ts`, `catalogues.test.ts` |
| 9 | **Children are never persons** — only a count per household | No child columns exist in `packages/db/src/schema/guests.ts`; `detectChildDetails` in `packages/core/src/guests.ts` warns on free text | `packages/core/test/guests-rsvp.test.ts` ("schema — children are never persons") |
| 10 | **External AI proposes, never applies** | Read tools run in a read-only database transaction; propose tools only create previews (`packages/mcp/src/server.ts`, `registry.ts`) | `packages/mcp/test/mcp.test.ts`, `tools.test.ts` |
| 11 | **No third-party scripts on the public site; no visitor identifiers anywhere** | `apps/public` is a static export; `stats_daily` has no column that could hold a visitor; `recordEvent` rejects identifier-like dimensions (`packages/core/src/stats.ts`) | `scripts/check-public-d1.mjs` (run by `pnpm build`); `packages/core/test/stats.test.ts` |
| 12 | **Append-only audit log** — no role can edit or delete entries | Trigger `packages/db/src/sql/001_audit_append_only.sql`; `packages/core/src/auditview.ts` exports no write path | `packages/db/test/audit-append-only.test.ts`; `packages/core/test/staff.test.ts` |

## Working on the code

The workflow, the pull-request checklist and the definition of done are in
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md). The rules for how code is written are in
`15-conventions.md`; what already exists to build on is in `18-contracts.md`.

## Release and gate map (PRD sections 6 and 12)

The software for every release exists. The **gates** are about people and evidence, and none
of them is met by code alone.

| Stage | Software | Gate (PRD §12) — still to be met by people |
| --- | --- | --- |
| Release 0 (foundation) | Built | **M0**: free activation works; separate public and app sites; no third-party script on either. The automated side exists (`check-public-d1.mjs`, `monetization-off.test.ts`); confirm it on the deployed sites |
| Releases A and B | Built | **M1**: pilot with planners — five users per journey, four of five completing unaided; 20 public guides; 10 business interviews, of which 5 agree to list in a free product and 3 state in writing they would pay later |
| Release P | Built; monetisation OFF | **M2**: acceptance tests pass; business terms published; fiscal invoicing tested end to end in a sandbox — the invoicing and payment adapters here are seams, so this needs a real sandbox account |
| Free phase live | — | **M3**: 20 approved listings per promoted category and county; enquiries measured monthly; a recorded decision on when to enable monetisation |
| Monetisation ON | Switch built, dormant | **M4**: terms, tax set-up and keys approved; 30 days with no duplicate or missing feature grants; 60-day notice given |
| Releases C, D, E | Built | Each needs its own go-ahead under the PRD; **M5**: three consecutive months with income after fees at 1.2× costs or more |

The PRD defines gates M0 to M5. (Earlier notes in this folder mentioned "M1–M7"; there is no
M6 or M7 in PRD v4.9.)

A release is **blocked** by any unresolved unauthorised access, duplicate money posting,
unexplained overbooking, lost approved records or wrongly reversed facts (PRD section 12).
