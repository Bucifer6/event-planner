# Guide for coding agents (and new developers)

Read this before changing anything. It is short on purpose; it tells you where the full
picture is and which rules keep one change from breaking something else.

**EventDesk.ro** is a free Romanian planning app for celebrations, trips and events, with a
business directory. One Next.js web app, one static public site, one background worker, one
PostgreSQL database. The owner is not a developer: explain changes in plain English.

## 1. Find things first

| You need | Look here |
| --- | --- |
| Where a feature's code, tables, screens and tests are | [`docs/build/21-code-map.md`](docs/build/21-code-map.md) — generated from the code, always current |
| What functions exist and how to call them | [`docs/build/18-contracts.md`](docs/build/18-contracts.md) |
| How the system fits together | [`docs/build/01-architecture.md`](docs/build/01-architecture.md) |
| Every table, guard and retention rule | [`docs/build/02-data-model.md`](docs/build/02-data-model.md) |
| The rules for writing code here | [`docs/build/15-conventions.md`](docs/build/15-conventions.md) |
| The look, components and UI rules | [`docs/build/16-design.md`](docs/build/16-design.md), [`docs/build/17-ui-rules.md`](docs/build/17-ui-rules.md) |
| What a requirement id (A6, SEC2, P13…) means | [`docs/PRD.md`](docs/PRD.md) — it wins over everything else |
| Whether a requirement is built and which test covers it | [`docs/build/09-traceability.md`](docs/build/09-traceability.md) |
| Security findings and decisions | [`docs/build/12-security-review.md`](docs/build/12-security-review.md) |
| Product words and their Romanian UI terms | [`docs/build/20-glossary.md`](docs/build/20-glossary.md) |

Layout in one breath: `packages/core/src/<domain>.ts` holds every business rule and access
check; `packages/db/src/schema/<domain>.ts` holds the tables; `apps/web/app` holds screens
(`page.tsx`), endpoints (`route.ts`) and server actions (`app/actions/<domain>.ts`) that only
call core; `packages/ui` is the design system; `packages/i18n/messages/{ro,en}` holds every
user-facing string.

This is Next.js 16, which differs from older versions (for example the middleware file is
`proxy.ts`): read [`apps/web/AGENTS.md`](apps/web/AGENTS.md) before writing Next.js code.

## 2. Rules that keep changes from breaking other things

1. **Access checks live in core, never only in the screen.** Every occasion read or write
   starts with `requireMember` (or `requireFinance`, `requireBusinessMember`,
   `requireStaffRole`, `requireGuest`). A function documented as "unchecked" must only be
   called after a check. An id from a form is untrusted: confirm it belongs to the occasion
   or business you checked.
2. **Extend through registries; do not edit another domain.** Exports, overview and digest
   sections, cancel/postpone impact, closeout, moderation kinds, guest-page sections, timeline
   sources, MCP tools, retention rules and purge hooks are all registered (code map §3).
3. **A new core module must be added to `packages/core/src/all.ts`**, to the `exports` in
   `packages/core/package.json`, and to `docs/build/module-purposes.json`. Tests fail otherwise.
4. **Facts change only by correction.** Payments, received quantities and arrivals are guarded
   by database triggers; use the domain's `correct…` function with a reason. Never update
   those columns directly and never set the `ed.correction` / `ed.purge` settings yourself.
5. **Anything that changes dates, guests, suppliers or payments in bulk, or that an assistant
   proposes, goes through the What-if engine** (`createPreview` → the user confirms).
6. **Unknown is `NULL`, never `0`,** and is shown as "necunoscut". Money is whole minor units
   plus a currency. Times are stored in UTC.
7. **Children are only ever a count.** No column, field or text input may hold a child's name
   or age. A schema test enforces this.
8. **Every user-facing string goes in both `ro` and `en`** message files with identical keys;
   no ICU plurals (use `.zero/.one/.few/.other` keys and `plural()`). Romanian is primary.
9. **UI uses only `@ed/ui` components and tokens.** No new colours, fonts, radii or spacing
   values; one primary button per view; works at 320px and by keyboard.
10. **Schema changes need a migration:** edit the schema file, run `pnpm db:generate`, commit
    the new file under `packages/db/drizzle`. If older code cannot run against the new schema,
    add the release to `scripts/deploy/irreversible.txt`.
11. **Monetisation is off and must stay unreachable** (no pricing, checkout or card UI) unless
    the switch is on. Paid placement never changes organic order. Tests enforce both.
12. **No third-party scripts, fonts or origins,** no inline scripts, no `dangerouslySetInnerHTML`
    (strict CSP). The public site sets no cookies. The app sets exactly three.
13. **Tokens and codes are stored only as hashes** (the invitation QR id is the documented
    exception). Never log personal data; use `describeError()` when logging errors.
14. **Uploads over 1 MB go through a Route Handler,** not a Server Action; state-changing Route
    Handlers call `assertSameOrigin`.
15. **Do not weaken or delete a test to make it pass.** If a rule seems wrong, say so and ask.

## 3. Before you say you are done

```bash
pnpm check        # code map current, type check, lint, all tests (needs PostgreSQL running)
pnpm build        # both production builds + the public-site privacy gate
```

- Local PostgreSQL for tests: `docker compose -f docker-compose.dev.yml up -d`.
- Changed anything a browser sees? Also run `node scripts/check-headers.mjs` and
  `node scripts/smoke.mjs` after the build (they need `DATABASE_URL`).
- Added, moved or removed a module, route, table, job or tool? Run `pnpm codemap` and commit
  the regenerated `docs/build/21-code-map.md`.
- Update the docs your change makes untrue: `18-contracts.md` for new or changed functions,
  `02-data-model.md` for tables, `09-traceability.md` for requirement status,
  `10-operator-decisions.md` and `.env.example` for new settings, `CHANGELOG.md` always.
- Add a help article or update one (`apps/web/components/help/registry.ts`, `help*` message
  files) when a screen's steps or button labels change — a test checks help against routes.

## 4. How to do common things

- **Add a feature to an existing domain:** core function (with access check, zod input,
  `audit()`), test in `packages/core/test`, server action in `apps/web/app/actions`, screen
  under `apps/web/app`, strings in both languages.
- **Add a domain:** schema file + line in `schema/index.ts`; core module + the three
  registrations in rule 3; purge hook (`onOccasionPurge` / `onAccountPurge`) so deletion stays
  complete; migration; tests.
- **Add a section to an occasion:** slug in `apps/web/lib/occasion-nav.ts`, label in
  `nav.json`, page at `apps/web/app/(app)/occasions/[id]/<slug>/page.tsx`.
- **Add a console screen:** `apps/web/app/console/<name>`, entry in `console/_nav.ts`, use
  `requireConsole()` and `staffAction()`; irreversible actions go through approvals.
- **Add an export, background job, MCP tool, guest-page section:** see the matching registry
  in code map §3 and copy the nearest existing example.

## 5. Working alongside other agents

Touch only the files your task needs. Shared registries (`schema/index.ts`, package
`exports`, `all.ts`, `occasion-nav.ts`, `console/_nav.ts`, `packages/jobs/src/registry.ts`)
get append-only one-line edits. Do not run two `next dev` servers inside `apps/web`; use your
own port and a private database for smoke tests, and clean up afterwards. Branch from `main`,
open a pull request, and never push to `main` directly.
