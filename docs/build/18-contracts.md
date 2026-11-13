# 18 — Code contracts (what exists; use these, do not re-invent)

## Test DB — `import { setupTestDb } from "@ed/db/testing"`
`setupTestDb(): Promise<{ db, url, name, close() }>` — call in `beforeAll`, `close()` in `afterAll`.
Each call clones a private DB from a template keyed by a hash of schema + sql files (parallel-safe).

## DB — `import { getDb, createDb, type Db, type Tx, eq, and, sql, … } from "@ed/db"`
Tables and drizzle operators are re-exported from `@ed/db` (import from there, not `drizzle-orm`).
Column helpers in `packages/db/src/schema/_helpers.ts`: `id()`, `ref(name)`, `timestamptz(name)`,
`createdAt()`, `updatedAt()`, `moneyMinor(name)`, `moneyMinorBig(name)`, `currency()`.
Platform tables: `auditLog`, `idempotencyKeys`, `platformSettings`.
- New schema file: `src/schema/<aggregate>.ts` + append `export * from "./<aggregate>";` to `schema/index.ts`.
- Seed: `src/seed/<name>.ts` exporting `Seed = { name, run(db) }`, append to `seeds` in `src/seed/index.ts` (idempotent).
- SQL guard: `src/sql/NNN_name.sql`, idempotent (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`).

## Core
- `@ed/core/context`: `Actor` (kinds: account, guest, staff, mcp, system, anonymous), `Ctx = { db, actor, now, ip?, locale }`,
  `makeCtx(db, actor, opts?)`, `systemCtx(db)`, `accountCtx(db, accountId)`, `anonymousCtx(db)`,
  `requireAccount(ctx): string`, `actorAccountId(actor)`, `requireSystem(ctx)`, `requireWriteCapable(ctx)`, `actorRef(actor)`.
- `@ed/core/audit`: `audit(ctx, { action, objectType, objectId?, before?, after?, meta? })`.
- `@ed/core/idempotency`: `withIdempotency(ctx, scope, key, fn(txCtx))` — result must be JSON-serialisable.
- `@ed/core/tx`: `inTx(ctx, fn(txCtx))` (nesting = savepoint).
- New domain: `packages/core/src/<domain>.ts` + one `"./<domain>": "./src/<domain>.ts"` line in `packages/core/package.json` exports. No `"."` export.

## Shared — `@ed/shared`
`AppError(code, messageKey?, details?)` (details understood by the action wrapper: `fieldErrors`, `retryAt` ISO, `params`),
`isAppError`, `newId`, `randomToken`, `hashToken`, `hashEquals`, `sixDigitCode`, money (`toMinor`, `toMajor`, `splitEvenly`,
`splitByWeights`, `percentOf`, `sumMinor`), time (`addMonths`, `zonedParts`, `zonedToUtc`, `bucharestToUtc`,
`startOfBucharestDay`, `bucharestDateKey`), zod helpers (`zId`, `zText`, `zOptionalText`, `zEmail`, `zMinor`, `zCurrency`,
`zIdempotencyKey`, `zDate`, `zFormBoolean`). Subpaths: `@ed/shared/env`, `@ed/shared/ssrf` (`assertSafeUrl`, `safeFetch`).
**Client Components import subpaths** (`@ed/shared/errors`, `/money`, `/time`, `/zod`), never the barrel (it pulls `node:crypto`).

## Web (`apps/web`, alias `@/` = `apps/web/`)
- `@/lib/ctx`: `getCtx()` (anonymous actor when signed out), `requireCtx()` (redirects to `/sign-in`; returns `Ctx & { accountId }`).
- `@/lib/session`: `resolveActor()` — the auth seam.
- `@/lib/action`: `action(schema, async (ctx, input) => data, { auth?: "account" | "public" })` → `{ ok: true, data } |
  { ok: false, error: { code, message, fieldErrors?, retryAt?, values? } }`; works with objects, `FormData` and
  `useActionState(fn, null)`. `error.values` echoes typed input so it is never lost. Zod messages that are i18n keys are translated.
- `app/api/health/route.ts`.

## i18n — `@ed/i18n`
`loadMessages(locale)`, `translate(locale, "ns.key", params?)`, `locales`, `defaultLocale`, `LOCALE_COOKIE = "ed_lang"`.
`@ed/i18n/format`: `formatMoney(minor, currency, locale)`, `formatMoneyOrUnknown`, `formatUnknown`, `formatInteger`, `formatDate`,
`formatTime`, `formatDateTime`, `formatWeekdayDate`, `formatInZone(date, tz, locale)`, `formatMonthYear`.
Add a namespace: create `messages/ro/<ns>.json` and `messages/en/<ns>.json` (alphanumeric name) — nothing else.
Parity gate: `pnpm --filter @ed/i18n test`. A bare `tsc -p` needs `pnpm --filter @ed/i18n gen` first.
`common` namespace already has generic actions, `common.errors.<CODE>`, `common.unknown`.

## Public site
Routes under `apps/public/app/[locale]/`; every page calls `setRequestLocale(locale)`; no next-intl navigation helpers (they set a cookie).

## Worker
`startRunner(ctx)` in `apps/worker/src/index.ts` is the jobs seam.

## Commands
`pnpm --filter @ed/core typecheck` · `pnpm exec vitest run packages/core/test/x.test.ts` · `pnpm exec vitest run --project @ed/core`.
Versions: next 16.4.6, react 19.3.1, next-intl 4.15.1, drizzle-orm 0.45.4, zod 4.6.7, vitest 5.1.0, typescript 5.9.3.
(Next 16: middleware file is `proxy.ts`.)
