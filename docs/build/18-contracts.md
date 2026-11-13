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

---

# Wave 1 additions

## Auth / sessions
- Web `@/lib/session`: `resolveActor()` → `{ kind:"account", accountId, sessionId }`; `getCurrentSession()`, `ensureDeviceId()` (actions/route handlers only), `getDeviceId()`, `setLanguageCookie`. After sign-in users land on `/occasions`.
- `@ed/auth`: `createSession(ctx, { accountId, userAgent?, fresh? })` → `{ token, sessionId, expiresAt }`, `signOutEverywhere(ctx)`, `onSignOutEverywhere(fn(ctx, accountId))` (MCP must register: revoke tokens).
- `@ed/core/accounts`: `requireFreshAuth(ctx, minutes = 10)` (throws FORBIDDEN `account.errors.freshAuthRequired`, `details.freshAuthRequired = true`) — every S4 sensitive action in any domain (ownership transfer, deletion, grants, member changes) must call it; `isFreshAuth`, `getOwnAccount(ctx)`, `onAccountPurge(fn)`, `purgeDueAccounts(systemCtx)`.
  The account page (`/account`) has the fresh-code UI; on `freshAuthRequired` show a Notice linking to `/account#fresh`.
- Tests: insert an `accounts` row, then `accountCtx(db, id)`. For `requireFreshAuth` to pass insert a `sessions` row with `freshAuthAt` within 10 minutes (see `packages/core/test/deletion.test.ts`).
- Local smoke: `EMAIL_PROVIDER=dev`; code is in `select body_text from email_outbox order by created_at desc limit 1`; or `/sign-in/anonymous/new`. `AUTH_TIMING_FLOOR_MS=0` skips the timing pad.
- Reusable client form: `@/app/(auth)/_components/forms` → `ActionForm`, `FormError`.

## Rate limiting and bot guard — `@ed/core/ratelimit`
`enforceRateLimit(ctx, { scope, rules: [{ axis: "email"|"ip"|"device"|"key", key, limit, windowSeconds, backoff? }] })` (throws RATE_LIMITED + `details.retryAt`),
`checkPublicForm(ctx, { formKey, linkKey?, honeypot, renderedAt, minSeconds?, perIpPerHour?, perLinkPerHour? })`, `issueFormStamp(now?)`,
field names `HONEYPOT_FIELD = "website"`, `FORM_STAMP_FIELD = "ed_rendered"`, `logSecurityEvent(ctx, …)`.
Call these with the request ctx BEFORE opening a transaction (or the counters roll back).

## Deletion — `@ed/core/deletion`
`requestDeletion(ctx, { targetType, targetId, retainedNote? })`, `undoDeletion`, `getOpenDeletion`, `listDue(systemCtx, …)`, `completeDeletion`, `DELETION_UNDO_DAYS`, `RETAINED_AFTER_DELETION`.

## Email — `@ed/email`
`sendEmail(ctx, { to, template, params, locale?, occasionId?, bilingual? })` → `{ status: "sent"|"suppressed", outboxId }` (LIMIT `emails.errors.dailyCap` over 500/day/occasion);
`registerTemplate(name, (params, { locale, t }) => ({ subject, blocks }))` — blocks: `text | code | button | note`; `t` takes full i18n keys (put strings in YOUR namespace); bilingual RO-first by default.

## Jobs — `@ed/jobs`
`defineJob(name, zodSchema, handler(ctx, payload, meta), opts?)` → `.enqueue(ctx, payload, opts)`; `enqueue(ctx, name, payload, { runAt?, uniqueKey? })` (transactional on `ctx.db`);
`defineSchedule({ name, job, every: {kind:"hourly",minute?}|{kind:"daily",at:"HH:MM"}|{kind:"monthly",day,at} })`; `runOnce(ctx, { names? })` for tests.
Registration: your domain exports `registerJobs(): void`; append one import + one array entry in `packages/jobs/src/registry.ts`.
`uniqueKey` dedupes while the row exists — repeating jobs need a time bucket in the key.

## Retention / stats
`@ed/core/retention`: `registerRetentionRule({ name, run(ctx): Promise<number> })`.
`@ed/core/stats`: `recordEvent(ctx, metric, dims?, by = 1)` (daily counter; identifier-like dim names throw; ≤4 dims), `registerStatCollector`, `readDailyStats(ctx, { metric, from, to, dims? })` (no access check — call from checked core code).

## What-if — `@ed/core/whatif`
`registerWhatIf(kind, { input?: zod, authorize(ctx, subject, action), compute?(ctx, input, subject), apply(txCtx, preview) })` (`action`: create|read|confirm|discard; authorize throws),
`createPreview(ctx, { kind, occasionId?, subjectType, subjectId, input, delta?, title?, source? })`, `confirmPreview(ctx, id)` → `{ preview, appliedNow }`, `discardPreview`, `listPending(ctx, occasionId)`, `getPreview`, `toPreviewView(preview)`.
Delta row: `{ key, what, kindLabelKey?, before?, after?, noteKey?, noteParams? }`; `what/before/after` = string or `{ key, params }`; `null` = unknown.
Only account/staff actors confirm; MCP `read_propose` tokens only propose (`proposedByKind: "mcp"`).
Web: `<PreviewPanel preview={toPreviewView(p)} appliedHref? discardedHref? />` from `@/components/whatif/PreviewPanel`; actions `confirmWhatIf`, `discardWhatIf` in `@/app/actions/whatif`.
The occasion "Ce-ar fi dacă?" page is `/occasions/[id]/proposals`.

## Storage — `@ed/storage`
`uploadAsset(ctx, { ownerType: "occasion"|"business"|"account", ownerId, file: { name, bytes, mime? }, allowPdf? })`, `getAssetUrl(ctx, assetId)`, `getAsset`, `listAssets`, `getUsage`, `deleteAsset`;
`registerAssetAccess(ownerType, { canRead(ctx, asset), canWrite(ctx, owner) })` — `occasion` and `business` are system-only until their domain registers a rule;
`registerUploadPurpose(name, { ownerType, allowPdf })` for the web route. Web: `<FileField label purpose ownerId allowPdf? name? onUploaded? />` from `@/components/upload/FileField`; `POST /api/uploads`.

## Security / misc
`@/lib/csrf`: `assertSameOrigin(request)` / `sameOriginOr403(request)` in every state-changing Route Handler (not webhooks/MCP). CSP is strict nonce-based: no inline scripts/styles handlers; `img-src` allows `data:`.
`@ed/core/incidents`: `createIncident`, `resolveIncident`, `listIncidents` (staff), `getActiveIncident(ctx)` (public). `<IncidentBanner />` from `@/components/incident-banner/IncidentBanner` on guest-facing layouts.
`@ed/core/fetching`: `fetchRobotsAllowed(url, ua?, { fetcher? })`. `@ed/core/cookies`: cookie set constants.

## Shell (apps/web)
`(app)/layout.tsx` wraps signed-in pages in the AppShell (top bar + bottom nav). Pages render `<Page>` content.
Occasion pages live at `/occasions/[id]/<slug>` with slugs fixed in `apps/web/lib/occasion-nav.ts`; the frame is
`<OccasionFrame occasionId eyebrow title meta? hiddenKeys? banner?>` from `@/components/shell/OccasionFrame` (used once, in `occasions/[id]/layout.tsx`).
Inside the frame, pages do NOT wrap in `<Page>`; start with `<PageHeader level={2} …>`-style sections (use `Section`/`PageHeader`).
