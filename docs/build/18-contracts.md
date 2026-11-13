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

---

# Wave 2 additions

## Guests — core
- `@ed/core/invitations`: `resolveGuestLink(ctx, token, { rateLimit? })` → `{ actor: GuestActor, invitationId, householdId, occasionId, language, linkKey } | null` (null for unknown/revoked/expired alike);
  `getGuestView(ctx)` (guest actor) → `{ occasion, household, invitation, rsvp: { deadline, open, questions, response }, changed, sections[] }`;
  `registerGuestSection({ key, order, load(ctx, view) })` — built-ins `polls` (20), `contributions` (40). To add a guest-page section: register in your core module, import that module in `apps/web/lib/guest.ts`, add one renderer entry in `apps/web/app/g/[token]/sections.tsx`.
  `bumpGuestRevision(ctx, occasionId, reasonKey)` (reasonKey = full i18n key), `requireGuest`, `guestLinkPath`, `regenerateInvitation`, `revokeInvitation`.
  `invitations.qrId` column exists as a placeholder for the print-pack QR.
- `@ed/core/capacity`: `claimPlaces(ctx, occasionId, { key, places })`, `adjustPlaces`, `releasePlaces(ctx, occasionId, { key })` — idempotent per key, NO access check (call from checked code), join the caller's tx; loser gets `AppError("TAKEN", "rsvp.errors.lastPlaceTaken", { params: { left } })`. `readCapacity`, `getCapacity`, `setCapacityTotal`. Keys: `rsvp:<householdId>`, suggest `public:<registrationId>`.
- `@ed/core/guests`: `createHousehold`, `updateHousehold`, `addGuest`, `removeGuest`, `listHouseholds(ctx, { occasionId, q?, status? })`, `getHousehold`, `exportGuestsCsv`, `detectChildDetails(text)`, `assertNoChildDetails`.
- `@ed/core/rsvp`: `getRsvpSummary(ctx, occasionId)` → `{ households: { total, yes, maybe, no, pending }, attending: { adults, children, total }, maybe, invited, capacity, rsvpDeadline }` (counts only); `submitRsvp`, `recordRsvp`, `getRsvpSettings`.
- `@ed/core/polls`, `@ed/core/contributions`, `@ed/core/guestimport`. What-if kinds: `guests.import`, `guests.removeHousehold`.
- Web guest helpers `@/lib/guest`: `resolveGuestRequest(token, lang?)`, `runGuestAction(args, { schema, formKey, handler })`, `guestFormFields`, `guestTranslator(locale, ns?)` (guest pages use the LINK language, not the cookie), `guestHref`.
- i18n parity test rejects ICU plurals whose branches differ between ro and en — use count-neutral wording ("Locuri rămase: {left}").
- Occasion dates are day-anchored at noon; show a time only when it is not 12:00/00:00.

## Staff / console
- `@ed/core/staff`: `getConsoleAccess(ctx)`, `resolveStaff(ctx)` (actor `{ kind:"staff", accountId, staffId, roles, sessionId }`), `requireStaffRole(ctx, ...roles)`, `hasStaffRole`, `isSingleOperatorMode(ctx)` (payment code must check, M4), `registerDashboardCounter({ key, count(ctx) → { total, byStatus? } })` (label `console.dashboard.counters.<key>`), `readSetting(ctx, key)`, `writeSetting(ctx, key, value)`.
- Web: `requireConsole()` → `{ ctx, staffId, roles, expiresAt, has(...roles) }` and `staffAction(schema, handler)` in `apps/web/app/console/_lib.ts` — every console page/action uses them.
- Console nav: append `{ key, href, roles?, exact? }` to `apps/web/app/console/_nav.ts` + `console.nav.<key>` in ro/en (the `console` namespace is shared: add your keys under your own sub-object, e.g. `console.moderation.*`, or use your own namespace).
- Staff roles: platform_admin, content_editor, listing_moderator, commercial_manager, privacy_owner, security_administrator.
- `@ed/core/approvals`: `registerApprovalAction(action, { roles, approverRoles?, approvalsNeeded? (approvers other than requester; default 1; three-person rule = 2), input?, describe(payload) → { key, params? }, execute(ctx, payload, { id, requesterStaffId }) })`; `requestApproval(ctx, { action, payload, reason })`, `approveRequest`, `rejectRequest`, `cancelRequest`, `listApprovals`. Approvals UI is `/console/approvals`.
- `@ed/core/auditview`: `listAudit`, `exportAuditCsv` (no mutation path).
- `@ed/core/reports` (content reports, LAU8): `submitContentReport`, `listContentReports`, `getContentReport`, `listContentReportsForTarget(ctx, { targetType, targetId })`, `decideContentReport`, `onContentReportDecided(fn(txCtx, { report, decision, reasonGivenToAffected }))`. In-app report link: `/report?ref=<text>&type=listing&id=<id>`.
- `@ed/core/compliance`: `areLegalDocsPublished(ctx)`, launch checklist + records.
- Bootstrap staff: `node scripts/make-staff.mjs`.

## MCP — `@ed/mcp`
`registerMcpTool({ name, version, scope: "read"|"propose", title, description, inputSchema (zod), handler(ctx, input, call) })`; `ctx.actor = { kind:"mcp", accountId, tokenId, scope }`.
Names: read tools `get_*`/`list_*`/`search_*`, propose tools `propose_*`; denylisted words throw at registration.
READ tools run inside a READ ONLY DB transaction — handlers must not write (no audit, no stats).
Propose tools: call `createPreview` from `@ed/core/whatif`, then `return mcpProposal(preview, summary?)`.
`setOccasionLister(fn(ctx) → [{ id, title }])`; `revokeBusinessMcpTokens(systemCtx, businessId)` (MCP7 handover); `MCP_CONSENT_DATA_CLASSES` (add a class + i18n line before a tool returns a new kind of data).

## Planning core (Release A)
- `@ed/core/access`: `Member`, `getMember`, `requireMember(ctx, occasionId, { roles?, grant?, manage? })`, `isManager`, `hasGrant`.
- `@ed/core/occasions`: `getOccasion`, `getOccasionView`, `listOccasions`, `daysUntil`, `createOccasion`, `updateOccasion`, `proposeMoveDate(ctx, { occasionId, dateMode, startsOn?, endsOn? })`, deletion fns, and **`onOccasionPurge(fn(tx, occasionId))`** — every domain holding occasion data registers its cleanup here.
  `occasions.status`: planning|cancelled|postponed|closed (banners exist; cancel/postpone/close ACTIONS belong to Release B). `occasions.businessId` nullable exists for business-owned occasions.
- `@ed/core/templates`: day helpers `zDay`, `dayToInstant`, `instantToDay`, `shiftDay`, `daysBetween`, `formatDay` (a "day" = 12:00 local in the occasion zone).
- `@ed/core/tasks`: `queryTasks(ctx, occasionId, filter)` (single source), `queryTasksUnchecked`, `countTasks`, `toListView/toBoardView/toCalendarView`, `getTask`, `createTask`, `updateTask`, `setTaskStatus`, `deleteTask`, checklist + dependency fns, `listAssignableMembers`. Task status: todo|doing|waiting|done.
- `@ed/core/delegations`, `@ed/core/members` (`listMembers`, `inviteMember`, `updateMember`, `removeMember`, `transferOwnership`).
- `@ed/core/overview`: `getOverview`, `registerOverviewSection({ key, forMember(ctx, member, occasionId) → { titleKey, lines, slug? } | null })`.
- `@ed/core/digest`: `registerDigestSection({ key, titleKey, forMember(ctx, member, occasionId) → lines[] })` (ctx acts as the member; FORBIDDEN sections are omitted — use `requireMember(..., { grant: "finance" })` to gate).
- `@ed/core/exports`: `registerExport({ key, titleKey, descriptionKey?, grant?, manageOnly?, run })` → appears on `/occasions/[id]/print`, downloads from `/occasions/[id]/print/<key>`; `toCsv`, `csvCell`.
- What-if kinds: `occasion.moveDate`, `tasks.applyTemplate`.
- Web helpers: `orNotFound` in `(app)/occasions/_lib/load.ts`, `plural()` in `_lib/plural.ts`. NO ICU plurals in messages: one key per form (`.zero/.one/.few/.other`) chosen by `plural()`.
- Fresh auth in UI: pre-check `isFreshAuth`, render the existing `FreshGate` (see team/settings pages) linking to `/account#fresh`.
- `.ed-vh` inside a horizontally scrolling container needs a `position: relative` ancestor.
- `next dev` cannot run twice inside `apps/web`: to smoke-test, copy the repo's apps/web to a temp dir or coordinate; always use your own port + private database, and clean up.

---

# Wave 3 additions (Release B)

- `@ed/core/corrections`: `recordCorrection(ctx, { occasionId?, targetTable, targetId, field, before, after, reason })` (inside the fact-changing tx; DB guards use GUC `ed.correction`), `listCorrections`.
- `@ed/core/lifecycle`: `registerLifecycleImpact`, `registerCloseoutSection`, **`assertOccasionWritable(ctx, occasionId)`** (CONFLICT when closed — call it in your writes).
- `@ed/core/budget`: `registerBudgetSource`, `getBudget`, `requireFinance(ctx, occasionId, { manage? })`. `@ed/core/expenses`: `createExpense(ctx, { occasionId, categoryId?, description, amountMinor, currency?, spentOn, supplierLabel?, bookingId?, receiptAssetId?, idempotencyKey })`, `listExpenses`, `expenseTotalsByBooking`. `@ed/core/ledger`: `getLedger`, `addLedgerEntry`, `getOwnBalance` (per-currency settlement already exists).
- `@ed/core/closeout`: what-if kinds `occasion.cancel|postpone|close`, `getCloseout`, `getClosedOccasionsOlderThan(systemCtx, days)`, `listLessons(ctx, kind?)`.
- `@ed/core/suppliers`: `listSuppliers`, `getSupplier`, `createSupplier`, **`findOrCreateSupplierForListing(ctx, { occasionId, listingId, name, categoryLabel })`**, **`ensureBooking(ctx, supplierId)`** (store the returned `booking.id` on your enquiry row), supplier link helpers, `PLANNING_ROLES`, `supplierAccess`.
- `@ed/core/bookings`: `setBookingState`, `attachQuote` (PDF quote, purpose `occasion.quote`), `updateBookingTerms`. `@ed/core/briefings`: `publishBriefing`, `listBriefingVersions`, `acknowledgeBriefing`. `@ed/core/orders`: `createOrderSnapshot(ctx, { bookingId, items })`, `getOrderState` (post-snapshot RSVP changes become `order_deltas` via a DB trigger).
- `@ed/core/deliveries`, `@ed/core/payments` (finance; what-if `payment.move`).
- `@ed/core/eventday`: `getDayView(ctx, occasionId, { day? })`, `setDayState`, `addDayItem`; `task_day_state` holds time of day for a task. `@ed/core/readiness`.
- `@ed/core/briefingpdf` (PDF toolkit for other PDFs): `newPdfDocument({ title, lang, createdAt })` → `{ doc, done() }` with fonts `serif`, `serif-bold`, `serif-italic`, `sans`, `sans-bold` (DejaVu, Romanian diacritics OK), `PDF_COLORS`, `PDF_MARGIN`, `pdfFontDir()`. Binary exports cast bytes to `ExportFile.content` (see briefingpdf export).
- Purge of immutable rows: set GUC `ed.purge` in the purge hook (see `020_suppliers_guards.sql`).
- Modules that register things at import time (exports, overview sections, what-if kinds) must be imported in `apps/web/instrumentation-node.ts` (one line) and, if they have jobs/digest sections, `packages/jobs/src/registry.ts`.
- Never `require.resolve` font/binary files with a literal path in code Turbopack bundles — walk the filesystem at run time.
- Web dev server: `pnpm --filter @ed/web exec next dev --port N` (the `dev` script hardcodes 3000).

---

# Wave 3 additions (Release P: business, listings, moderation, directory)

- `@ed/core/business`: `requireBusinessMember(ctx, businessId, { roles? })` → `{ business, member, role }` (roles owner|admin|staff), `isAccountBusinessMember`, `listMyBusinesses`, `getBusinessView`, `canManageRole`, `isBusinessLapsed(business)`, `assertBusinessCanCreate(ctx, businessId)`, `setBusinessStatus(staffCtx, …)`, `addBusinessNotice(txCtx, …)`, `queueBusinessEmail(txCtx, { businessId, headlineKey, reason })`, `getBusinessBadges`. Upload purpose `business.photo`. `businesses` has `planLapsedAt`, `nudge48h`, `hideStats`, `status`.
- `@ed/core/listings`: `createListing`, `saveListingDraft`, `submitListing`, `requireListingMember`, `getLivePayload`, **`createUnclaimedListing(ctx, { name, descriptionRo?, categoryIds, localityIds, publicContactRoute, sourceUrl, collectedAt?, sourceNote? })`** → `{ listingId, revisionId }` (discovery), **`convertListingToClaimed(ctx, { listingId, businessId })`** (claiming), `suspendListing`, `restoreListing`.
- `@ed/core/moderation` (ONE generic queue): `registerModerationKind(kind, { labelKey, describe(ctx, rev) → { title, fields[{ key, labelKey, before, after }], imageAssetIds? }, apply(txCtx, rev), onRejected?, onWithdrawn? })`, `submitForModeration(ctx, { kind, subjectId, payload, basePayload?, listingId?, businessId?, sourceNote? })`, `decideRevision`, `listModerationQueue`. Pages/actions using a kind must import its domain module. Approver must not be a member of the business.
- `@ed/core/directory`: `getDirectoryResults(ctx, { categoryId, countyCode, localityId?, day?, limit?, offset? })` → `{ featured: [] (P13 goes here), organic, total, day }` (pure read), `organicOrder`, `getPublicListing(ctx, id)` (`acceptsEnquiries`, `unclaimed`, …), `getDirectoryPrefill(ctx, occasionId)`, `suggestDirectoryLink`, `getDirectoryStats(staffCtx, { days })`, `recordDirectorySearch`.
- `@ed/core/listingstats`: `setEnquiryStatsProvider(async (ctx, { listingIds, until }) => Map<listingId, { received, answered, medianReplyMinutes }>)`, `getPublishedListingStats`.
- `@ed/core/geography`: `getPicklists(ctx)`, `listCategories`, `listCounties`, `listLocalities({ countyCode? })`, `getCategoryBySlug`, `localName(row, locale)`.
- Slots to fill in `apps/web/app/directory/_slots/`: `EnquiryCta.tsx` (`{ listing, occasionId? }`; keep the `acceptsEnquiries` guard), `ListingExtras.tsx` (drawings, catalogues).
- Business area routes: `/business`, `/business/[businessId]` (+ `/listings/[listingId]`, `/team`, `/settings`). Console: `/console/moderation`, `/console/businesses`, `/console/directory`.
- Source-scan test: any source line containing "rating", "testimonial", "stele", "★" etc. without a negation fails `directory.test.ts`.
