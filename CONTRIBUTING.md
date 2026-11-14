# Contributing

> Start with [`AGENTS.md`](AGENTS.md) — the short list of rules that keep one change from
> breaking another — and the generated [code map](docs/build/21-code-map.md). `pnpm check` runs
> every gate in one command.

**What this is, in plain English.** The rules for changing EventDesk.ro's code: how a change
travels from an idea to the live service, what must be true before it is accepted, and the
recipes for the most common kinds of change. It applies equally to people and to AI coding
agents. If you only want to run the app, read `README.md` instead.

Two documents rank above this one: the product requirements (`docs/PRD.md`), which win every
disagreement, and the binding code conventions (`docs/build/15-conventions.md`), which this
file points to rather than repeats.

## Before you start

1. Read `docs/build/13-implementation-log.md` (where things stand) and the twelve invariants
   in `docs/build/README.md` (what must never break).
2. Read `docs/build/15-conventions.md` in full, then the section of
   `docs/build/18-contracts.md` for the area you will touch — most things you need already
   exist.
3. Get the app running (`README.md`) and the tests passing on your machine.

## Branches, pull requests and tags

- **`main` is protected.** Nobody pushes to it directly; nobody force-pushes it.
- **One piece of work, one branch**, cut from `main`, named
  `feat/<work-item-id>-<short-slug>` (for a fix, `fix/<short-slug>`).
- **Open a pull request to `main`** with the checklist below in its description. It is merged
  only after a review by someone else (a person or another agent) and green CI.
- **A release is an annotated tag** `vX.Y.Z` on a commit of `main`
  (`git tag -a v1.4.0 -m "Release 1.4.0" && git push origin v1.4.0`). The tag runs the full
  CI on that exact commit and records the status `release-ci`; only a tag with a green
  `release-ci` can be deployed. Tags are never moved or deleted.
- **Production is deployed from the staff console**, by tag, with a second person's approval
  — never from a terminal and never by a push (`docs/build/14-deploy-runbook.md`).
- Never commit a secret, a `.env` file or real personal data.

Branch and tag protection are GitHub settings the operator switches on; until they are, keep
to these rules by discipline.

### Pull-request checklist

Copy this into the description and tick each line honestly.

- [ ] The change does what its work item or issue asks; the PRD requirement ids it touches
      are listed here.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass locally; CI is green.
- [ ] New behaviour has a test that would fail without it. A change near an invariant
      (`docs/build/README.md`) has a test for that invariant.
- [ ] Every user-facing string is in **both** `packages/i18n/messages/ro/` and `…/en/`;
      Romanian reads naturally with correct diacritics.
- [ ] Screens work at 320 px wide and by keyboard; touch targets are at least 44 px; contrast
      meets WCAG 2.2 AA; every drag has an equal tap path (`docs/build/17-ui-rules.md`).
- [ ] Access is checked in `@ed/core`, not in the page; private data needs its grant.
- [ ] Every state change writes an audit entry; every mutation is safe to submit twice.
- [ ] Facts (payments, received quantities, arrivals) change only through a correction.
- [ ] Changes to dates, guests, suppliers, payments — and anything an assistant proposes — go
      through a What-if preview.
- [ ] Security: enumeration-safe answers, hashed tokens, rate limits on new endpoints, bot
      protection on new public forms, upload rules, same-origin check on new state-changing
      route handlers, the SSRF guard on new fetches, `ExternalLink` for outside links.
- [ ] No secret in the repository, logs or build output; no third-party script or origin
      added anywhere; no cookie added without updating the cookie list.
- [ ] A migration that older code cannot live with is listed in
      `scripts/deploy/irreversible.txt`.
- [ ] Documentation updated: `docs/build/09-traceability.md` (status, location, test),
      `docs/build/18-contracts.md` if you added something others will use, `.env.example` and
      `docs/build/10-operator-decisions.md` for a new setting, `CHANGELOG.md`.

## Recipes

### Add a domain (a new area of business rules)

1. Create `packages/core/src/<domain>.ts`. Every function is `fn(ctx, input)`: validate
   `input` with zod, check access (`requireMember`, `requireFinance`, `requireStaffRole`…),
   do the work, call `audit(…)`, throw `AppError` with a translation key to refuse.
2. Add one line to `exports` in `packages/core/package.json`:
   `"./<domain>": "./src/<domain>.ts"`.
3. Add `import "./<domain>";` to `packages/core/src/all.ts` — a test fails if you forget.
4. If the domain holds occasion data, register its clean-up with `onOccasionPurge`; if it
   holds data about an account, with `onAccountPurge`; if the data has a retention period,
   `registerRetentionRule`. Tell the lifecycle what a cancel or close affects
   (`registerLifecycleImpact`) and call `assertOccasionWritable` in writes.
5. Write `packages/core/test/<domain>.test.ts` using `setupTestDb()`.

### Add a table or change the schema

1. Edit or create `packages/db/src/schema/<aggregate>.ts` (follow the conventions for ids,
   time, money and unknown values); for a new file add one `export * from` line to
   `schema/index.ts`.
2. If the database itself must refuse something, add an idempotent file to
   `packages/db/src/sql/`.
3. Run `pnpm db:generate` and commit the new migration in `packages/db/drizzle/` with the
   schema change. Check it applies to an empty database and on top of the previous state:
   `pnpm db:migrate`.
4. Prefer additive changes. To remove or rename something, expand in one release, switch the
   code, and contract in a later one. If older code truly cannot run against the new schema,
   add a line to `scripts/deploy/irreversible.txt` in the same pull request.
5. Update `docs/build/02-data-model.md`.

`pnpm db:push` is only for trying a schema change on your own machine.

### Add a screen or an action to the app

1. Pages are Server Components under `apps/web/app/…`; fetch through core with
   `await getCtx()` or `await requireCtx()`. Occasion sections live at
   `/occasions/[id]/<slug>` and are listed in `apps/web/lib/occasion-nav.ts`; console sections
   in `apps/web/app/console/_nav.ts`.
2. Changes are Server Actions in `apps/web/app/actions/<domain>.ts`, wrapped with `action()`;
   forms use `useActionState` and `<SubmitButton pendingLabel=…>`.
3. Build with `@ed/ui` components and tokens only — no new colours, fonts, radii or spacing
   values (`docs/build/16-design.md`, `17-ui-rules.md`).
4. A state-changing Route Handler calls `sameOriginOr403(request)`.
5. Add a help article if the screen is one users will need explained (below).

### Add a translation namespace or strings

1. Create `packages/i18n/messages/ro/<ns>.json` and `packages/i18n/messages/en/<ns>.json`
   with identical keys — nothing else is needed.
2. Use `getTranslations("<ns>")` / `useTranslations("<ns>")`. No literal user-facing text in
   components, emails or PDFs.
3. No ICU plural syntax: one key per form (`.zero`, `.one`, `.few`, `.other`), chosen in code.
4. Format money, dates and times only through `@ed/i18n/format`.
5. `pnpm --filter @ed/i18n test` checks the two languages match.

### Add a background job

Define it with `defineJob` (and `defineSchedule` if it repeats) inside your domain's
`registerJobs()`, and add one import and one array entry to `packages/jobs/src/registry.ts`.
Handlers must be safe to run twice.

### Add an email

`registerTemplate` in your domain, with the wording in your own namespace; send with
`sendEmail`. Emails are bilingual, Romanian first.

### Add a previewed change (What-if)

`registerWhatIf(kind, { authorize, compute, apply })` in your domain; create it with
`createPreview`; show it with `PreviewPanel`. `apply` runs only on confirmation, inside a
transaction, and must re-check that the basis has not changed.

### Add an MCP tool

A new tool is a product decision and a new platform release: see `docs/build/18-contracts.md`,
section 16. Read tools must not write; propose tools only create previews.

### Add a help article

Add its definition to `apps/web/components/help/registry.ts` and its text under the same slug
in the section's namespace, in both languages.

### Add an operator setting

A decision that is the operator's must never be guessed in code. Add an environment variable
(documented in `.env.example`) or a console setting (`readSetting` / `writeSetting`) with a
safe placeholder, and add a row to `docs/build/10-operator-decisions.md`.

### Add a dependency

Only when really needed. Pin the exact version. A new workspace package also needs a `COPY`
line in the `deps` stage of the `Dockerfile`.

## Definition of done

A change is done when all of this is true:

1. It meets its acceptance criteria and the pull-request checklist above.
2. Its tests are in the repository and pass; nothing was skipped or quarantined to get there.
3. Both languages are complete.
4. It breaks none of the twelve invariants.
5. The documentation says what is now true — including, plainly, anything that was left as a
   seam, stubbed, or not verified. **Never write that something is tested, deployed or
   verified unless you can point to the evidence in the repository.**
6. It has been reviewed by someone other than its author and merged through a pull request.

A **release** is done when, in addition: the manual checklist in
`docs/build/11-testing-and-qa.md` has been run for what changed (on a phone as well); there is
no open high or critical finding in `docs/build/12-security-review.md`; the launch
obligations that gate it have an owner and a date; and none of the PRD's release blockers is
open — unauthorised access, duplicate money posting, unexplained overbooking, lost approved
records, wrongly reversed facts.

## Working alongside other agents

Touch only the files your task assigns. Shared files (`schema/index.ts`, package `exports`,
`all.ts`, the navigation and job registries) get append-only, one-line edits. Do not commit,
push or change git state unless asked. Do not edit `docs/PRD.md`. Finish with a short report:
what was built, which files, test results, and anything stubbed or left open.
