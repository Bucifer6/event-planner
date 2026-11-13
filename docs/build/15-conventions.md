# 15 — Build conventions (binding for every agent working in this repo)

The PRD (`docs/PRD.md`) wins over everything. The numbered plan files say WHAT to build. This file
says HOW, so parallel agents produce one coherent codebase. Read it fully before writing code.

## Deviations from the plan (decided, do not revisit)

- **ORM is Drizzle, not Prisma.** Prisma's engine binaries cannot be downloaded in the build
  environment. Everywhere the plan says "Prisma" read "Drizzle ORM + node-postgres"; "prisma migrate
  deploy" = `pnpm db:migrate`. PRD Q7 (Next.js, PostgreSQL, one web service, one worker) is unchanged.
- **Design language is "Maison"** (`docs/build/16-design.md`, `packages/ui`), replacing the PRD §21
  "Garden Soirée" look at the owner's request. PRD §21 *behavioural* gates still hold: AA contrast,
  44px targets, phone-first, honest "Promovat — plasare plătită" label in the same weight as the
  business name, "unknown" rendered italic grey and never as zero.
- **i18n files are split per namespace**: `packages/i18n/messages/ro/<ns>.json` and
  `.../en/<ns>.json` (merged at load). Still the only place user-facing strings live.

## Stack

Node 22, pnpm workspaces, TypeScript strict (`noUncheckedIndexedAccess` on), Next.js 16 App Router
(React 19) for `apps/web` and `apps/public` (static export), `apps/worker` plain Node (tsx),
Drizzle ORM + `pg`, zod, next-intl, Vitest. No other UI/CSS framework: no Tailwind, no component
libraries — only `@ed/ui`. Add a dependency only when really needed; pin exact versions.

Packages are consumed as TypeScript source (no build step): each `packages/*/package.json` has
`"exports": { ".": "./src/index.ts", ... }`; Next apps list them in `transpilePackages`.
Names: `@ed/db @ed/shared @ed/core @ed/auth @ed/i18n @ed/ui @ed/email @ed/storage @ed/jobs @ed/mcp`.

## Database (`packages/db`)

- One schema file per aggregate: `packages/db/src/schema/<aggregate>.ts`, re-exported from
  `schema/index.ts` (append one `export * from` line; never reorder others' lines).
- Tables `snake_case` plural; columns `snake_case`; TS properties camelCase. Primary key
  `id: text` from `newId()` (cuid2). `createdAt`/`updatedAt` `timestamp with time zone` (UTC).
  Money: `bigint`/`integer` minor units + `currency` text (default `RON`). Unknown = `NULL`, never 0.
  Enums: `text` columns with a TS union + zod enum exported from the schema file (no pg enums).
- Tokens/codes are stored only as SHA-256 hashes (`hashToken()` in `@ed/shared`).
- Facts (arrivals, payments, received quantities) change only through a `corrections` row.
- DB-level guards (triggers) live in `packages/db/src/sql/*.sql`; they are applied by the test
  harness and by migrations.
- Do NOT generate migrations while building features; the integrator generates one initial
  migration at the end. Tests use the push-based harness.
- Tests: `import { setupTestDb } from "@ed/db/testing"` gives an isolated, fully-migrated database
  per test file. Local Postgres: `postgresql://ed:ed@127.0.0.1:5432` (role `ed` is superuser).

## Domain logic (`packages/core`)

- All business rules and ALL access checks live here; web, worker and MCP only call core.
- Every function is `fn(ctx: Ctx, input)`; `Ctx = { db, actor, now, ip?, locale }` from
  `@ed/core/context`. Validate `input` with zod at the top. Never trust the caller.
- Throw `AppError(code, messageKey, details?)` from `@ed/shared` — codes: `FORBIDDEN NOT_FOUND
  VALIDATION CONFLICT RATE_LIMITED TAKEN LIMIT UNAUTHENTICATED`. `messageKey` is an i18n key.
- Occasion access: `requireMember(ctx, occasionId, { roles?, grant? })` from `@ed/core/access`
  (grants: `finance`, `privateRequests`). Private-by-default (D2): every read checks it.
- State changes call `audit(ctx, { action, objectType, objectId, before?, after? })`.
- Mutations are idempotent (Q4): unique constraints + conditional updates, and/or
  `withIdempotency(ctx, key, fn)`. Capacity/claims use conditional `UPDATE ... WHERE` + rowCount.
- Changes to dates, guests, suppliers, payments, cancel/postpone and anything proposed by MCP go
  through the What-if engine (`@ed/core/whatif`): create preview → user confirms → apply.
- One file per domain: `packages/core/src/<domain>.ts`, tests in `packages/core/test/<domain>.test.ts`.
  Export from `packages/core/package.json` `exports` as `./<domain>` (add your line only).

## Web app (`apps/web`)

- Route groups: `(auth)` sign-in, `(app)` signed-in planner/business area, `console` staff,
  `g/[token]` guest link, `e/[slug]` public event page, `directory` in-app directory, `api/*`, `mcp`.
- Server Components fetch through core with `await getCtx()` (`apps/web/lib/ctx.ts`).
- Mutations are Server Actions in `apps/web/app/actions/<domain>.ts`, wrapped with `action()` from
  `apps/web/lib/action.ts`; they return `{ ok: true, data } | { ok: false, error: { code,
  message, fieldErrors?, retryAt? } }`. Forms use `useActionState`; the submit button uses
  `<SubmitButton pendingLabel=…>` from `@ed/ui` (disables + says what is happening).
- Never lose typed input on a failed submit; focus the first invalid field; errors beside fields.
- Every interactive screen works at 320px and by keyboard. No drag without an equal tap path.
- No inline `<script>`, no `dangerouslySetInnerHTML`, no third-party origins (strict CSP).
- External links: `<ExternalLink>` from `@ed/ui` (adds `rel="noopener noreferrer"`).

## i18n

- `useTranslations("<ns>")` / `getTranslations("<ns>")` (next-intl). No literal user-facing strings
  in TSX, emails or PDFs. Romanian is primary and must read naturally with correct diacritics
  (ș ț ă â î); English is the full toggle. Each agent owns its namespaces (listed in its brief) and
  must keep ro/en key sets identical (`pnpm --filter @ed/i18n test` checks).
- Formatting only via `@ed/i18n/format`: `formatMoney` (1.990 RON), `formatDate` (dd.mm.yyyy),
  `formatDateTime` (24h, Europe/Bucharest), `formatUnknown`.

## UI

- Read `docs/build/16-design.md` and `docs/build/17-ui-rules.md`. Use `@ed/ui` components and CSS
  tokens only. No new colours, fonts, radii, shadows or one-off spacing values. If a component is
  missing, compose from existing ones in your own route folder with a CSS module that uses tokens.
- One primary button per view. Labels above inputs. SVG icons from `@ed/ui/icons`, never emoji.

## Working rules for parallel agents

- Touch only the files your brief assigns. Shared files (`schema/index.ts`, package `exports`,
  nav registries) get append-only one-line edits.
- Do not run `next build` or the full test suite (the machine has 2 cores, others are working).
  Run `pnpm exec tsc --noEmit -p <your package>` and `pnpm exec vitest run <your test files>`.
- Do not commit, push, or run git commands that change state. Do not edit `docs/PRD.md`.
- Operator decisions (`10-operator-decisions.md`): env/config knob + placeholder, never a guess.
- Finish with a short report: what was built (work-item IDs), files, test results, anything
  stubbed or left open, and any contract another agent needs to know.
