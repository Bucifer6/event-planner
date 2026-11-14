# 18 — Code contracts: what exists, by area

**What this is, in plain English.** A reference for people (and AI agents) writing code in
this repository: for each area, which package and file to import from and what it offers, so
nobody re-invents something that already exists. If you are not writing code you do not need
this file — `01-architecture.md` explains the same system in words.

**How it is kept honest.** Import paths were checked against the `exports` of each
`packages/*/package.json`, and function names against the source files on 14 November 2026.
Function lists name what matters most, not every export; the source file is the authority.
Signatures are given only where the exact shape is the contract.

## Ground rules

- **Web, worker and MCP never hold business rules or access checks; they call `@ed/core`.**
- A core function is `fn(ctx, input)`. It validates `input` with zod, checks access, writes
  an audit entry for a change, and throws `AppError(code, messageKey?, details?)`.
- `@ed/core` has **no root export**: import a domain by subpath, `@ed/core/<domain>`. Every
  file in `packages/core/src/` is exported under its own name.
- Packages are TypeScript source; there is no build step.
- Client Components import client-safe subpaths only (`@ed/shared/errors`, `/money`, `/time`,
  `/zod`; `@ed/core/spacemodel`, `/arrangementkit`, `/cookies`). The `@ed/shared` barrel pulls
  in `node:crypto`.

Versions: next 16.4.6, react 19.3.1, next-intl 4.15.1, drizzle-orm 0.45.4, zod 4.6.7,
vitest 5.1.0, typescript 5.9.3. In Next 16 the middleware file is `proxy.ts`.

Commands: `pnpm --filter @ed/core typecheck` · `pnpm exec vitest run
packages/core/test/x.test.ts` · `pnpm exec vitest run --project @ed/core` ·
`pnpm --filter @ed/web exec next dev --port N` (the `dev` script fixes port 3000).

## 1. Shared helpers — `@ed/shared`

Exports: `.`, `./errors`, `./ids`, `./money`, `./time`, `./env`, `./ssrf`, `./zod`.

| Subpath | Offers |
| --- | --- |
| `errors` | `AppError`, `isAppError`, `APP_ERROR_CODES` (`FORBIDDEN NOT_FOUND VALIDATION CONFLICT RATE_LIMITED TAKEN LIMIT UNAUTHENTICATED`). `details` understood by the web action wrapper: `fieldErrors`, `retryAt` (ISO), `params` |
| `ids` | `newId` (cuid2), `randomToken`, `hashToken` (SHA-256), `hashEquals`, `sixDigitCode` |
| `money` | `toMinor`, `toMajor`, `sumMinor`, `splitEvenly`, `splitByWeights`, `percentOf`, `minorDigits`, `DEFAULT_CURRENCY` |
| `time` | `addSeconds/Minutes/Hours/Days/Months`, `zonedParts`, `zonedToUtc`, `zonedDateKey`, `startOfZonedDay`, `bucharestToUtc`, `bucharestDateKey`, `startOfBucharestDay`, `APP_TIME_ZONE` |
| `zod` | `zId`, `zText`, `zOptionalText`, `zEmail`, `zMinor`, `zMinorNonNegative`, `zCurrency`, `zLocale`, `zIdempotencyKey`, `zDate`, `zFormBoolean`, `zEnum`. Custom messages are translation keys |
| `env` | `assertBootEnv`, `parseEnv`, `bootEnvSchema` — refuses to boot on a bad environment, printing names only |
| `ssrf` | `assertSafeUrl`, `safeFetch`, `isBlockedAddress` — use for **every** server-side fetch of a web- or user-supplied address |

## 2. Database — `@ed/db`

Exports: `.`, `./client`, `./schema`, `./testing`, `./seed`.

- `import { getDb, createDb, type Db, type Tx, eq, and, sql, … } from "@ed/db"` — tables and
  Drizzle operators are re-exported; import from here, not from `drizzle-orm`.
- Column helpers (`packages/db/src/schema/_helpers.ts`): `id()`, `ref(name)`,
  `timestamptz(name)`, `createdAt()`, `updatedAt()`, `moneyMinor(name)`, `moneyMinorBig(name)`,
  `currency()`.
- **New schema file:** `src/schema/<aggregate>.ts` plus one `export * from "./<aggregate>";`
  line in `schema/index.ts`; then `pnpm db:generate` and commit the migration.
- **Seed:** `src/seed/<name>.ts` exporting `Seed = { name, run(db) }`, appended to `seeds` in
  `src/seed/index.ts`. Seeds must be safe to run twice.
- **SQL guard:** `src/sql/NNN_name.sql`, safe to re-apply (`CREATE OR REPLACE`,
  `DROP TRIGGER IF EXISTS`). Applied by `db:migrate`, `db:push` and the test harness.
- **Tests:** `import { setupTestDb } from "@ed/db/testing"` →
  `setupTestDb(): Promise<{ db, url, name, close() }>`. Call it in `beforeAll`, `close()` in
  `afterAll`. Each call clones a private database from a template keyed by a hash of the
  schema and SQL files.

## 3. Core foundations

| Module | Offers |
| --- | --- |
| `@ed/core/context` | `Actor` (kinds `account`, `guest`, `staff`, `mcp`, `system`, `anonymous`), `Ctx = { db, actor, now, ip?, locale }`, `makeCtx`, `systemCtx`, `accountCtx`, `anonymousCtx`, `requireAccount`, `actorAccountId`, `requireSystem`, `requireWriteCapable`, `actorRef` |
| `@ed/core/tx` | `inTx(ctx, fn(txCtx))` — nesting is a savepoint |
| `@ed/core/audit` | `audit(ctx, { action, objectType, objectId?, before?, after?, meta? })` |
| `@ed/core/idempotency` | `withIdempotency(ctx, scope, key, fn(txCtx))` — the result must be JSON-serialisable |
| `@ed/core/corrections` | `recordCorrection(ctx, { occasionId?, targetTable, targetId, field, before, after, reason })` inside the fact-changing transaction (the guards look for the flag `ed.correction`); `listCorrections` |
| `@ed/core/retention` | `registerRetentionRule({ name, run(ctx): Promise<number> })`, `runRetention` |
| `@ed/core/stats` | `recordEvent(ctx, metric, dims?, by = 1)` (identifier-like dimension names throw; at most 4 dimensions), `registerStatCollector`, `readDailyStats` (no access check — call from checked code) |
| `@ed/core/deletion` | `requestDeletion`, `undoDeletion`, `getOpenDeletion`, `listDue`, `completeDeletion`, `DELETION_UNDO_DAYS`, `RETAINED_AFTER_DELETION` |
| `@ed/core/incidents` | `createIncident`, `resolveIncident`, `listIncidents`, `getActiveIncident` |
| `@ed/core/fetching` | `fetchRobotsAllowed(url, ua?)`, `DISCOVERY_USER_AGENT` |
| `@ed/core/cookies` | `APP_COOKIES`, `COOKIE_SET_SIGNATURE` (client-safe) |
| `@ed/core/all` | Imports every core module so every registration exists in the process. Imported by `apps/web/instrumentation-node.ts` and `packages/jobs/src/registry.ts`. **A new module must be added to it** — `packages/core/test/all.test.ts` fails otherwise |
| `@ed/core/wiring` | Connects domains that must not import each other: enquiry counts for the business report and the free-phase dashboard; console counters for enquiries, discovery and claims |
| `@ed/core/wiring-programme` | Registers the programme (Release C) as a rehearsal timeline source (Release E) |

**New domain:** `packages/core/src/<domain>.ts`, one `"./<domain>": "./src/<domain>.ts"` line
in `packages/core/package.json`, one `import "./<domain>";` line in `all.ts`, tests in
`packages/core/test/<domain>.test.ts`.

### The What-if engine — `@ed/core/whatif`

- `registerWhatIf(kind, { input?: zod, authorize(ctx, subject, action), compute?(ctx, input,
  subject), apply(txCtx, preview) })` — `action` is `create | read | confirm | discard`;
  `authorize` throws.
- `createPreview(ctx, { kind, occasionId?, subjectType, subjectId, input, delta?, title?,
  source? })`, `confirmPreview(ctx, id)` → `{ preview, appliedNow }`, `discardPreview`,
  `listPending(ctx, occasionId)`, `getPreview`, `toPreviewView(preview)`.
- A delta row is `{ key, what, kindLabelKey?, before?, after?, noteKey?, noteParams? }`;
  `what/before/after` are a string or `{ key, params }`; `null` means unknown.
- Only account and staff actors confirm; an MCP token with `read_propose` only proposes.
- Web: `<PreviewPanel preview={toPreviewView(p)} appliedHref? discardedHref? />` from
  `@/components/whatif/PreviewPanel`; actions `confirmWhatIf`, `discardWhatIf` in
  `@/app/actions/whatif`. The occasion's page is `/occasions/[id]/proposals`.
- Registered kinds (20): `occasion.moveDate`, `occasion.cancel`, `occasion.postpone`,
  `occasion.close`, `tasks.applyTemplate`, `tasks.proposeList`, `guests.import`,
  `guests.removeHousehold`, `guests.invitationText`, `payment.move`, `budget.proposeEstimates`,
  `budget.proposeNote`, `plan.shortlistNote`, `space.updateDrawing`, `space.addCustomTable`,
  `seating.applyLayout`, `arrangement.applyDesign`, `itinerary.import`, `bizlibrary.apply`,
  `bizoccasion.handover`.

## 4. Accounts, sign-in and limits

**`@ed/auth`** (single export): `requestSignInCode`, `verifySignInCode`, `consumeMagicLink`,
`getMagicLinkStatus`, `requestCodeFromLink`; `createAnonymousAccount`, `signInAnonymous`,
`recoverAnonymousAccount`; `createSession(ctx, { accountId, userAgent?, fresh? })` →
`{ token, sessionId, expiresAt }`, `resolveSession`, `listSessions`, `revokeSession`,
`signOutEverywhere`, `onSignOutEverywhere(fn(ctx, accountId))`; `requestFreshAuthCode`,
`confirmFreshAuth`; `beginTotpEnrolment`, `confirmTotpEnrolment`, `disableTotp`,
`verifySecondFactor`, `regenerateRecoveryCodes`; `requestNewEmailCode`, `confirmNewEmail`,
`removeEmail`; `isSignupOpen`, `assertSignupOpen`; `safeNextPath`, `signInPathFor`;
`purgeExpiredAuthRows`; `PASSKEYS_AVAILABLE` (false — passkeys are a seam).

**`@ed/core/accounts`**: `requireFreshAuth(ctx, minutes = 10)` — throws `FORBIDDEN`
`account.errors.freshAuthRequired` with `details.freshAuthRequired = true`; **every sensitive
action in any domain must call it**; `isFreshAuth`, `getOwnAccount`, `setDisplayName`,
`setAccountLocale`, `requestAccountDeletion`, `undoAccountDeletion`, `onAccountPurge(fn)`,
`purgeDueAccounts`.

**`@ed/core/ratelimit`**: `enforceRateLimit(ctx, { scope, rules: [{ axis: "email" | "ip" |
"device" | "key", key, limit, windowSeconds, backoff? }] })` (throws `RATE_LIMITED` with
`details.retryAt`); `checkPublicForm(ctx, { formKey, linkKey?, honeypot, renderedAt,
minSeconds?, perIpPerHour?, perLinkPerHour? })`; `issueFormStamp`; `getSignInLimits`;
`logSecurityEvent`. **Call these with the request ctx before opening a transaction**, or the
counters roll back with it.

Tests: insert an `accounts` row, then `accountCtx(db, id)`. For `requireFreshAuth` to pass,
insert a `sessions` row with `freshAuthAt` within ten minutes (see
`packages/core/test/deletion.test.ts`). `AUTH_TIMING_FLOOR_MS=0` skips the timing pad.

## 5. Occasions and planning

| Module | Offers |
| --- | --- |
| `@ed/core/access` | `Member`, `getMember`, `requireMember(ctx, occasionId, { roles?, grant?, manage? })` (grants `finance`, `privateRequests`), `isManager`, `hasGrant`. Live members of a business get a synthetic `Member` (id `bm_<businessMemberId>`, `viaBusiness`) on that business's occasions until handover — **never store a synthetic id in a foreign key**; use `ensureBusinessSeat` |
| `@ed/core/occasions` | `getOccasion`, `getOccasionView`, `listOccasions`, `createOccasion`, `updateOccasion`, `proposeMoveDate`, `requestOccasionDeletion`, `undoOccasionDeletion`, **`onOccasionPurge(fn(tx, occasionId))`** — every domain holding occasion data registers its clean-up. Status: `planning | cancelled | postponed | closed` |
| `@ed/core/lifecycle` | `registerLifecycleImpact`, `registerCloseoutSection`, **`assertOccasionWritable(ctx, occasionId)`** — call it in writes; it refuses a closed occasion |
| `@ed/core/closeout` | `proposeCancel`, `proposePostpone`, `proposeClose`, `getCloseout`, `saveLesson`, `listLessons` |
| `@ed/core/templates` | `listTemplates`, `proposeTemplate`, `getTemplateDiff`; day helpers `zDay`, `dayToInstant`, `instantToDay`, `shiftDay`, `daysBetween`, `formatDay` (a day is noon local in the occasion's zone) |
| `@ed/core/tasks` | `queryTasks(ctx, occasionId, filter)` (the single source), `toListView`, `toBoardView`, `toCalendarView`, `getTask`, `createTask`, `updateTask`, `setTaskStatus`, `deleteTask`, checklist and dependency functions, `listAssignableMembers`. Status: `todo | doing | waiting | done` |
| `@ed/core/delegations` | `offerTask`, `acceptOffer`, `declineOffer`, `withdrawOffer`, `listOpenOffers` |
| `@ed/core/members` | `listMembers`, `inviteMember`, `acceptInvite`, `updateMember`, `removeMember`, `transferOwnership`, `suggestedLabelKeys` |
| `@ed/core/overview` | `getOverview`, `registerOverviewSection({ key, forMember(ctx, member, occasionId) → { titleKey, lines, slug? } \| null })` |
| `@ed/core/digest` | `registerDigestSection({ key, titleKey, forMember })` — runs as the member; a `FORBIDDEN` section is left out, so gate with `requireMember(…, { grant })` |
| `@ed/core/exports` | `registerExport({ key, titleKey, descriptionKey?, grant?, manageOnly?, run })` — appears on `/occasions/[id]/print`, downloads from `/occasions/[id]/print/<key>`; `toCsv`, `csvCell` |
| `@ed/core/plannotes`, `tasks-proposals`, `invitationtext` | The What-if kinds behind the MCP propose tools |

Occasion dates are anchored at noon; show a time only when it is not 12:00 or 00:00.

## 6. Guests

| Module | Offers |
| --- | --- |
| `@ed/core/guests` | `createHousehold`, `updateHousehold`, `addGuest`, `removeGuest`, `listHouseholds(ctx, { occasionId, q?, status? })`, `getHousehold`, `exportGuestsCsv`, `detectChildDetails`, `assertNoChildDetails` |
| `@ed/core/invitations` | `resolveGuestLink(ctx, token, { rateLimit? })` → guest actor or `null` (unknown, revoked and expired alike); `getGuestView(ctx)`; **`registerGuestSection({ key, order, load(ctx, view) })`**; `bumpGuestRevision(ctx, occasionId, reasonKey)`; `requireGuest`; `guestLinkPath`; `regenerateInvitation`; `revokeInvitation`; `setInvitationExpiry`; `sendInvitationEmails` |
| `@ed/core/rsvp` | `submitRsvp`, `recordRsvp`, `getRsvpSummary` (counts only), `getRsvpSettings`, question functions |
| `@ed/core/capacity` | `claimPlaces(ctx, occasionId, { key, places })`, `adjustPlaces`, `releasePlaces` — once per key, **no access check** (call from checked code), join the caller's transaction; the loser gets `AppError("TAKEN", "rsvp.errors.lastPlaceTaken")`. Keys: `rsvp:<householdId>`, `public:<registrationId>` |
| `@ed/core/polls`, `contributions`, `guestimport` | Date polls; "who brings what"; CSV and XLSX import as a preview |
| `@ed/core/qr` | `ensureQrIds`, `rotateQrId`, `resolveQrLink`, `qrMatrix`, `drawQrOnPdf` |

Guest-page sections registered (key, order): `polls` 20, `seat` 30, `programme` 32, `menu` 34,
`contributions` 40, `venue` 58, `spaceView` 60, `privateRequest` 70. To add one: register it
in your core module and add one renderer entry in `apps/web/app/g/[token]/sections.tsx`.

Web helpers `@/lib/guest`: `resolveGuestRequest(token, lang?)`, `runGuestAction(args, { schema,
formKey, handler })`, `guestFormFields`, `guestTranslator(locale, ns?)` (guest pages use the
link's language, not the cookie), `guestHref`. Supplier links: `@/lib/supplier-link`
(`resolveSupplierRequest`, `runSupplierAction`).

## 7. Money

| Module | Offers |
| --- | --- |
| `@ed/core/budget` | `requireFinance(ctx, occasionId, { manage? })`, `getBudget`, `registerBudgetSource`, category functions, `exportBudgetCsv` |
| `@ed/core/expenses` | `createExpense(ctx, { occasionId, categoryId?, description, amountMinor, currency?, spentOn, supplierLabel?, bookingId?, receiptAssetId?, idempotencyKey })`, `listExpenses`, `setExpenseApproval`, `markExpensePaid`, `correctExpense`, `expenseTotalsByBooking` |
| `@ed/core/ledger` | `getLedger`, `addLedgerEntry`, `recordSettlement`, `voidLedgerEntry`, `getOwnBalance`, `settleUp` |
| `@ed/core/payments` | `listPaymentDeadlines`, `addPaymentDeadline`, `markPaymentPaid`, `correctPaymentPaid`, `proposeMovePayment` |
| `@ed/core/gifts` | `estimateGift`, `getGiftGuide`, `saveGiftGuide`, `DEFAULT_GIFT_GUIDE` |

## 8. Suppliers and delivery

| Module | Offers |
| --- | --- |
| `@ed/core/suppliers` | `listSuppliers`, `getSupplier`, `createSupplier`, **`findOrCreateSupplierForListing(ctx, { occasionId, listingId, name, categoryLabel })`**, **`ensureBooking(ctx, supplierId)`**, supplier-link functions, `supplierAccess` |
| `@ed/core/bookings` | `setBookingState`, `attachQuote` (upload purpose `occasion.quote`), `updateBookingTerms`, `listBookingEvents` |
| `@ed/core/briefings` | `publishBriefing`, `listBriefingVersions`, `acknowledgeBriefing`, `getSupplierLinkView` |
| `@ed/core/orders` | `createOrderSnapshot(ctx, { bookingId, items })`, `getOrderState` — changes to replies after a snapshot become `order_deltas` through a database trigger |
| `@ed/core/deliveries` | `createDelivery`, `recordReceipt`, `recordReturn`, `correctReceivedQty`, `correctReturnedQty`, `markDepositRecovered` |
| `@ed/core/eventday` | `getDayView(ctx, occasionId, { day? })`, `setDayState`, `addDayItem` |
| `@ed/core/readiness` | `recordReadinessDecision`, `getReadiness` |
| `@ed/core/briefingpdf` | The PDF toolkit for every other PDF: `newPdfDocument({ title, lang, createdAt })` → `{ doc, done() }` with fonts `serif`, `serif-bold`, `serif-italic`, `sans`, `sans-bold` (DejaVu; Romanian diacritics work), `PDF_COLORS`, `PDF_MARGIN`, `pdfFontDir()` |

Purging immutable rows: set the flag `ed.purge` in your purge hook (see
`packages/db/src/sql/020_suppliers_guards.sql`). Never resolve font or binary files with a
literal path in code the bundler processes — find them on the file system at run time.

## 9. Businesses, listings, moderation and the directory

| Module | Offers |
| --- | --- |
| `@ed/core/business` | `requireBusinessMember(ctx, businessId, { roles? })` → `{ business, member, role }` (roles `owner | admin | staff`), `listMyBusinesses`, `getBusinessView`, `canManageRole`, `isBusinessLapsed`, `assertBusinessCanCreate`, `setBusinessStatus` (staff), `addBusinessNotice`, `queueBusinessEmail`, `getBusinessBadges`, `recordFactCheck` |
| `@ed/core/listings` | `createListing`, `saveListingDraft`, `submitListing`, `requireListingMember`, `getLivePayload`, `createUnclaimedListing` (discovery), `convertListingToClaimed` (claims), `suspendListing`, `restoreListing` |
| `@ed/core/moderation` | **One queue for everything a business publishes.** `registerModerationKind(kind, { labelKey, describe, apply(txCtx, rev), onRejected?, onWithdrawn? })`, `submitForModeration`, `decideRevision`, `listModerationQueue`, `getModerationTargetHours`. Kinds: `listing`, `drawing`, `parking`, `catalogue`. The approver must not be a member of the business |
| `@ed/core/directory` | `getDirectoryResults(ctx, { categoryId, countyCode, localityId?, day?, limit?, offset? })` → `{ featured, organic, total, day }`, `organicOrder`, `getPublicListing`, `getDirectoryPrefill`, `suggestDirectoryLink`, `getDirectoryStats`, `setFeaturedProvider` |
| `@ed/core/listingstats` | `setEnquiryStatsProvider`, `getPublishedListingStats` |
| `@ed/core/geography` | `getPicklists`, `listCategories`, `listCounties`, `listLocalities`, `localName(row, locale)`, and the console's create, update, merge functions |
| `@ed/core/enquiries` | `sendEnquiry`, `sendQuoteRequest` (listing must be a florist or styling category), `replyAsPlanner`, `replyAsBusiness`, `closeEnquiry`, `reportEnquiry`, `resendEnquiry`, `acceptQuote`, `getQuoteLink`, `listOccasionEnquiries`, `listBusinessEnquiries`, `enquiryNumbers`. Limits: 10 per occasion, 30 per account per day. **No tool or API lets an assistant send an enquiry** |
| `@ed/core/catalogues` | `listPublicCatalogues`, `getCatalogueItem`, the editor functions, `submitCatalogue` |
| `@ed/core/drawings` | `createSpace`, `attachDrawing`, `calibrateSpace`, `assertCalibrated`, `saveMarkings`, `submitSpace`, `submitParking`, `getListingSpaces`, `onDrawingVersionPublished`, `setPdfRasteriser` |
| `@ed/core/discovery` | `createDiscoverySource`, `requestDiscoveryRun`, `runDiscoverySource`, `decideDiscoveryDrafts`, `sendClaimInvitation`, `submitObjection`, `decideObjection`, **`registerOnrcAdapter`** (seam) |
| `@ed/core/claims` | `startClaim`, `verifyClaimCode`, `submitClaimForApproval`, `rejectClaim` |
| `@ed/core/bizoccasions` | `createBusinessOccasion`, `ensureBusinessSeat`, `getOccasionBranding` (use on guest and public pages), `saveBranding`, `recordAssetUse`, `getBusinessReport`, `setBusinessEnquiryProvider` |
| `@ed/core/library`, `handover` | Business library and `proposeLibraryApply`; `proposeHandover`, `onOccasionHandover(fn)` |
| `@ed/core/reports` | Content reports: `submitContentReport`, `decideContentReport`, `onContentReportDecided(fn)`. In-app link: `/report?ref=<text>&type=listing&id=<id>` |

Slots in `apps/web/app/directory/_slots/`: `EnquiryCta`, `ListingExtras`, `ListingDrawings`,
`ListingCatalogues`, `ListingStatsBlock`, `ParkingFacts`. A source-scan test fails on any
source line containing rating, testimonial or star wording without a negation
(`packages/core/test/directory.test.ts`). Uploads larger than 1 MB go through a Route
Handler, not a Server Action.

## 10. Monetisation, billing and Featured (dormant)

| Module | Offers |
| --- | --- |
| `@ed/core/monetization` | `isMonetizationOn(ctx)`, `getMonetizationState`, `assertMonetizationOn`, `recordBillingAcceptance`, `requestMonetizationEnable`, `requestMonetizationDisable` |
| `@ed/core/billing` | `getPrices`, `priceWithTva`, `requestPriceChange`, `createCheckoutSession`, `handleStripeWebhook`, `verifyStripeSignature`, `runBillingSweep`, `requestRefund`, `getPlanView`, `getFreePhaseDashboard`, `getMonthlyCost`, `setMonthlyCost` |
| `@ed/core/invoicing` | `registerInvoicingProvider` (seam), `issueInvoice`, `handleInvoicingWebhook` |
| `@ed/core/featured` | The only source of Featured cards; returns none while off. `expectedShare(n)`. `FeaturedCard = DirectoryCard & { featured: true; labelKey: "featured.label" }` |
| `@ed/core/comms` | `previewAudience`, `sendPlatformNotice`, `listPlatformNotices` — to businesses only |

Payment code must check `isSingleOperatorMode(ctx)` where a second person is required.

## 11. Staff, approvals and compliance

| Module | Offers |
| --- | --- |
| `@ed/core/staff` | `getConsoleAccess(ctx)`, `resolveStaff(ctx)`, `requireStaffRole(ctx, ...roles)`, `hasStaffRole`, `isSingleOperatorMode(ctx)`, `registerDashboardCounter({ key, count(ctx) → { total, byStatus? } })`, `readSetting(ctx, key)`, `writeSetting(ctx, key, value)`, `grantStaffBootstrap`. Roles: `platform_admin`, `content_editor`, `listing_moderator`, `commercial_manager`, `privacy_owner`, `security_administrator` |
| `@ed/core/approvals` | `registerApprovalAction(action, { roles, approverRoles?, approvalsNeeded?, input?, describe(payload), execute(ctx, payload, { id, requesterStaffId }) })`, `requestApproval(ctx, { action, payload, reason })`, `approveRequest`, `rejectRequest`, `cancelRequest`, `listApprovals`. `approvalsNeeded` counts approvers other than the requester (default 1; the three-person rule is 2) |
| `@ed/core/auditview` | `listAudit`, `exportAuditCsv` — no write path |
| `@ed/core/compliance` | `areLegalDocsPublished`, launch checklist and records, `setLegalPublished` |
| `@ed/core/complianceaccess` | `requestComplianceAccess`, `assertComplianceAccess(staffCtx, { subjectType: "account", subjectId }, "what")`, `revokeComplianceAccess`, `exportDataSubject` |
| `@ed/core/deploys` | `getDeployOverview`, `requestDeploy`, `requestEmergencyDeploy`, `requestRollback`, `abandonDeploy`, `recordDeployStage`, `verifyDeployRecordToken`, `configureDeploys` |

Approval actions registered: `staff.set_roles`, `security.sign_in_limits.set`,
`compliance.access`, `deploy.production`, `monetization.enable`, `monetization.disable`,
`billing.prices.set`, `billing.refund`, `listing.claim`.

Web: `requireConsole()` → `{ ctx, staffId, roles, expiresAt, has(...roles) }` and
`staffAction(schema, handler)` in `apps/web/app/console/_lib.ts` — every console page and
action uses them. Console navigation: append `{ key, href, roles?, exact? }` to
`apps/web/app/console/_nav.ts` and add `console.nav.<key>` in both languages. First staff
member: `node scripts/make-staff.mjs`. A migration that older code cannot live with needs a
line in `scripts/deploy/irreversible.txt`; a new workspace package needs a `COPY` line in the
Dockerfile's `deps` stage.

## 12. Releases C, D and E

| Module | Offers |
| --- | --- |
| `@ed/core/spacemodel` | Pure and client-safe: `PlanModel`, `PlanItem`, `applyStage`, `buildPlanScene`, `planToSvgString(model, { width?, title?, highlightIds?, showTables?, showPois?, onlyItemIds? })`, `snapPosition`, `findFreeSpot` (avoids pillars and doorways), geometry helpers, `mmToMetresText`; table shapes `TABLE_SHAPE_VALUES`, `shapeUsesDiameter`, `shapeDims`, ready-made tables `TABLE_PRESETS`; drawn rooms `roomDrawingProblems`, `polygonSelfIntersects`, `wallLengths`, `setWallLength`; doors and pillars `resolveDoors`, `doorClearance`, `pillarFootprint`, `roomFeatureProblems`; `FIXTURE_PRESETS`, `danceFloorCapacity`, `REFERENCE_PERSON_MM`, `snapToEdges` (measuring) |
| `@ed/core/fitcheck` | `checkFit(model, { needed: number \| null })` → `{ status: "fits" \| "no" \| "unknown", seats, area, issues, excluded, … }` |
| `@ed/core/seating` | `getSpaceModel`, `attachVenueSpace`, `createOwnSpace`, `saveOwnRoomDrawing` (own spaces: the drawn room's outlines plus doors and pillars; empty = back to the rectangle), `addFixture` (optional `kind`), `addTable` (shapes round, rect, oval, halfmoon), `addFixture`, `moveItem`, `assignSeats`, `publishSeating`, `getSeatingSummary` (counts only), `getFitChecks`, `getGuestSeat`, `getGuestSpaceView`, `listMealStages`, `addMealStage`, `proposeDrawingUpdate` |
| `@ed/core/programme` | `listProgramme`, `saveProgrammeItem`, `saveCueList`, `getGuestProgramme`, `notifyProgrammeChange` |
| `@ed/core/stationery`, `stationerykit`, `stationerycollections` | Versions and proofs (`getStarterWordings(kind, locale)`, `stationeryThumbnail(ctx, occasionId, designKey)` for the designer gallery); the kit: `layoutPiece` (takes `occasionKind` for the collections' motif), `sceneToSvg`, `drawSceneOnPdf` (artwork is clipped to the bleed), `stationeryFontFamily()`, `colourwaysFor(design, kind)` (a design's colourways for an occasion kind), `getColourway`, `transformPath`, `mixColour`, `contrastRatio`, `DESIGN_RANGES`, `HOUSE_DESIGN_KEYS`; `stationerycollections` holds the collection data (palettes, `KIND_PALETTES`, edition artwork, embroidery charts, `KIND_MOTIFS`, `STARTER_KEYS`); `stationerytemplates` makes the occasion templates (`occasionTemplates(kind)`, `drawTemplate`, `TEMPLATE_PALETTES`, `TEMPLATE_STYLES`) — a template belongs to one kind (`designAvailableFor(design, kind)`, enforced on save), and `stationeryDesignName(key, locale)` names any design |
| `@ed/core/menus` | `getMenus`, `saveMenu`, `saveMenuItem`, `setMealChoices`, `getMenuQuantities`, `pushMenuToOrder` |
| `@ed/core/publicpage`, `registrations` | `savePublicPage`, `getPublicEvent`; `registerForEvent`, `cancelOwnRegistration`, `promoteWaitlist` |
| `@ed/core/requests`, `guestevent` | Private requests (own grant); venue link and the accessible guest journey |
| `@ed/core/printpack` | `buildQrLabelsPdf`, `buildQrInvitationsPdf`, `buildTableCardsPdf`, `buildRoomPlanPdf`, `setEventPageUrlProvider` |
| `@ed/core/promotion` | `getPromotionPage`, `buildPromotionCard`, `buildPromotionIcs`, `buildPromotionPoster` |
| `@ed/core/arrangements`, `arrangementkit` | `saveArrangementDesign`, `requestArrangementQuote`, `proposeArrangementDesign`; the kit is pure and client-safe (`indicativeCost`, `arrangementToSvg`) |
| `@ed/core/aitext` | `getAiTextStatus`, `suggestText`, `markAiTextAccepted`, `getAiTextConfig`, `AI_TEXT_LABEL` |
| `@ed/core/itinerary` | `getItinerary`, `createLeg`, `parseIcs`, `parseBooking`, `proposeItineraryImport`, `localToInstant` |
| `@ed/core/subgroups`, `packing`, `transport`, `rooms` | Subgroups and activities, `getTripSettlement`; packing lists (a task with check items); seats and beds claimed atomically |
| `@ed/core/rehearsal` | `simulateDay` (reads only), `findConflicts`, **`registerTimelineSource({ key, list(ctx, occasionId, day) })`** |
| `@ed/core/checkin` | `checkInHousehold`, `checkInByQr`, `correctCheckIn`, `getGuestFlow` |
| `@ed/core/offline` | `submitOfflineItems`, `listOfflineConflicts`, `resolveOfflineConflict`, `getOfflineBundle` |
| `@ed/core/sustainability` | `createSustainabilityGoal`, `recordMeasurement`, `getSustainability` |

Web: `@/components/plan/PlanView` (read-only, client), `PlanSvg` (server-safe),
`SeatingEditor`.

## 13. Email — `@ed/email`

- `sendEmail(ctx, { to, template, params, locale?, occasionId?, bilingual? })` →
  `{ status: "sent" | "suppressed", outboxId }`; throws `LIMIT` `emails.errors.dailyCap` over
  500 a day per occasion.
- `registerTemplate(name, (params, { locale, t }) => ({ subject, blocks }))` — blocks are
  `text | code | button | note`; `t` takes full translation keys (keep strings in your own
  namespace); Romanian first by default.
- `registerEmailProvider(name, factory)`; built in: `dev`, `http`. `suppressEmail`,
  `isSuppressed`, `applyEmailEvents` (the bounce webhook).

## 14. Storage — `@ed/storage`

- `uploadAsset(ctx, { ownerType: "occasion" | "business" | "account", ownerId, file: { name,
  bytes, mime? }, allowPdf? })`, `createSignedUpload`, `completeSignedUpload`,
  `getAssetUrl(ctx, assetId)`, `getAsset`, `listAssets`, `getUsage`, `deleteAsset`,
  `deleteOwnerAssets`.
- `registerAssetAccess(ownerType, { canRead(ctx, asset), canWrite(ctx, owner) })`.
- `registerUploadPurpose(name, { ownerType, allowPdf })` — what the web route accepts.
  Registered: `account.image`, `business.photo`, `business.drawing`, the business logo and
  library file purposes, `occasion.receipt`, `occasion.quote`, the enquiry attachment purpose.
- `setScanner`, `getScanner`, `setStorageTransport`, `signAssetLink`, `verifyAssetLink`.
- Web: `<FileField label purpose ownerId allowPdf? name? onUploaded? />` from
  `@/components/upload/FileField`; `POST /api/uploads`.

## 15. Jobs — `@ed/jobs`

- `defineJob(name, zodSchema, handler(ctx, payload, meta), opts?)` → `.enqueue(ctx, payload,
  opts)`; `enqueue(ctx, name, payload, { runAt?, uniqueKey? })` joins the caller's
  transaction. `uniqueKey` de-duplicates while the row exists — a repeating job needs a time
  bucket in the key.
- `defineSchedule({ name, job, every: { kind: "hourly", minute? } | { kind: "daily", at:
  "HH:MM" } | { kind: "monthly", day, at } })`. `runOnce(ctx, { names? })` for tests.
- `recordJobRun`, `listJobRuns`; `readQueueMetrics`.
- Registration: your domain exports `registerJobs(): void`; append one import and one array
  entry in `packages/jobs/src/registry.ts` (`@ed/jobs/registry`, imported by the worker only).
  Handlers get a system actor and must be safe to run twice.

## 16. MCP — `@ed/mcp`

- `registerMcpTool({ name, version, scope: "read" | "propose", title, description, inputSchema
  (zod), handler(ctx, input, call) })`; `ctx.actor = { kind: "mcp", accountId, tokenId, scope }`.
- Names: read tools `get_*`, `list_*`, `search_*`; propose tools `propose_*`; forbidden words
  throw at registration.
- **Read tools run inside a read-only database transaction** — handlers must not write (no
  audit, no statistics). Propose tools call `createPreview` and `return mcpProposal(preview,
  summary?)`.
- A new tool is a new platform release: add it in a `tools-*.ts` file, add its line to
  `MCP_TOOL_CATALOGUE` in `packages/mcp/src/tools.ts`, add `mcp.tools.<name>` in both
  languages, and — before it returns a new kind of data — add the class to
  `MCP_CONSENT_DATA_CLASSES`.
- A read tool may return a picture with `mcpWithImage(json, pngBase64)`: the server sends it as
  MCP image content beside the JSON (used by `get_invitation_preview`).
- The invitation builder (`tools-stationery.ts`): `list_invitation_designs` (read),
  `get_invitation_preview` (read; PNG + fit report), `propose_invitation_design` (propose; What-if
  kind `stationery.version`, confirmed → `saveStationeryVersion`, unproofed, assistant text
  AI-labelled). Core: `getInvitationBuilder`, `previewInvitationDraft`, `proposeInvitationDesign`
  in `@ed/core/stationery`. Data class `invitations`.
- `createMcpToken`, `listMcpTokens`, `revokeMcpToken`, `revokeAllMcpTokens`,
  `revokeBusinessMcpTokens`, `authenticateMcpToken`, `handleMcpRequest(request, { db, ip })`,
  `setOccasionLister`.

## 17. Languages — `@ed/i18n`

Exports: `.`, `./config`, `./load`, `./format`.

- `loadMessages(locale)`, `translate(locale, "ns.key", params?)`, `locales`, `defaultLocale`,
  `LOCALE_COOKIE = "ed_lang"`.
- `@ed/i18n/format`: `formatMoney(minor, currency, locale)`, `formatMoneyOrUnknown`,
  `formatUnknown`, `formatInteger`, `formatDate`, `formatTime`, `formatDateTime`,
  `formatWeekdayDate`, `formatInZone(date, tz, locale)`, `formatMonthYear`.
- **Add a namespace:** create `messages/ro/<ns>.json` and `messages/en/<ns>.json` (alphanumeric
  name) — nothing else. Parity gate: `pnpm --filter @ed/i18n test`. A bare `tsc -p` needs
  `pnpm --filter @ed/i18n gen` first.
- **No ICU plurals**: one key per form (`.zero/.one/.few/.other`) chosen by `plural()` in
  `apps/web/app/(app)/occasions/_lib/plural.ts`.
- `common` has generic actions, `common.errors.<CODE>` and `common.unknown`.

## 18. The web app — `apps/web` (alias `@/` = `apps/web/`)

| Helper | Offers |
| --- | --- |
| `@/lib/ctx` | `getCtx()` (anonymous actor when signed out), `requireCtx()` (redirects to `/sign-in`, keeping an allow-listed return path; returns `Ctx & { accountId }`) |
| `@/lib/session` | `resolveActor()`, `getCurrentSession()`, `ensureDeviceId()` (actions and route handlers only), `getDeviceId()`, `setLanguageCookie`, `applySignIn`. After sign-in people land on `/occasions` |
| `@/lib/action` | `action(schema, async (ctx, input) => data, { auth?: "account" \| "public" })` → `{ ok: true, data } \| { ok: false, error: { code, message, fieldErrors?, retryAt?, values? } }`. Works with objects, `FormData` and `useActionState(fn, null)`; `error.values` echoes typed input |
| `@/lib/csrf` | `assertSameOrigin(request)`, `sameOriginOr403(request)` — in every state-changing Route Handler (not webhooks, not `/mcp`) |
| `@/lib/security` | `buildCsp`, `securityHeaders`, `generateNonce` — used by `proxy.ts`. No inline scripts or style handlers; `img-src` allows `data:` |
| `@/lib/occasion-nav` | The fixed list of occasion sections and their slugs |
| `@/components/shell/OccasionFrame` | The occasion frame, used once in `occasions/[id]/layout.tsx`. Pages inside it do not wrap in `<Page>` |
| `@/components/incident-banner/IncidentBanner` | On guest-facing layouts |
| `@/app/(auth)/_components/forms` | `ActionForm`, `FormError` |
| `@/app/(app)/occasions/_lib/load` | `orNotFound` |

Mutations are Server Actions in `apps/web/app/actions/<domain>.ts`. Forms use
`useActionState` and `<SubmitButton pendingLabel=…>`. Fresh confirmation in the UI: pre-check
`isFreshAuth` and render the existing `FreshGate` linking to `/account#fresh`.

`next dev` cannot run twice inside `apps/web`: to try something in parallel, use your own
port and a private database, and clean up.

### Help centre — `apps/web/app/help`, `apps/web/components/help`

Added on 14 November 2026, in parallel with this reference; check the files for the current
state.

- Routes: `/help` (index with search, by section) and `/help/[slug]` (one article).
- Structure: `components/help/registry.ts` — `helpSections` (thirteen sections; `staff` is
  listed only to staff) and the article definitions `{ slug, section, routes, related }`,
  where `routes` are the app screens an article describes.
- Wording: the `help` namespace (the chrome of `/help`) and one namespace per section
  (`helpStart`, `helpPlan`, `helpGuests`, `helpMoney`, `helpSuppliers`, `helpSpace`,
  `helpTravel`, `helpInvited`, `helpBusiness`, `helpAccount`, `helpPrivacy`, `helpTrouble`,
  `helpStaff`), each article keyed by its slug: `{ title, summary, keywords, where, need?,
  body }`. Read by `components/help/content.ts` (`listHelpEntries`, article blocks).
- Components: `HelpLink` (contextual "Ajutor: …" link for a screen), `HelpSearch`
  (diacritics-insensitive), `HelpArticleBody`, `HelpIcon`; `staff.ts` (`isStaffReader` — a
  read-only check that does not open a console session).
- To add an article: add its definition to `registry.ts` and its text under the same slug in
  both languages.
- The contact line on `/help` shows `SUPPORT_EMAIL` when the operator has set it.

## 19. The public site and the worker

- **Public site** — routes under `apps/public/app/[locale]/`; every page calls
  `setRequestLocale(locale)`; do not use next-intl navigation helpers (they set a cookie).
  `pnpm build` runs `scripts/check-public-d1.mjs` afterwards.
- **Worker** — `startRunner(ctx)` in `apps/worker/src/index.ts` registers all jobs and starts
  the runner.

## 20. UI — `@ed/ui`

Exports: `.`, `./icons`, `./styles.css`. Components and tokens are listed in `16-design.md`;
the rules every screen follows are in `17-ui-rules.md`. `.ed-vh` inside a horizontally
scrolling container needs a `position: relative` ancestor.

## Appearance (the looks)

- `@ed/core/appearance`: `UI_THEMES`, `UiTheme`, `getUiTheme(ctx, { fresh? })` (public read,
  cached ~15 s per process, never throws), `setUiTheme(staffCtx, { theme })` (platform_admin
  only, audited), `UI_THEME_PAPER`, `UI_THEME_SETTING_KEY = "ui.theme"`.
- Web: `apps/web/app/layout.tsx` sets `<html data-ui>`; console screen
  `apps/web/app/console/appearance` (`saveUiTheme` action). Design details: `16-design.md`.
