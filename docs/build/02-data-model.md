# 02 — Data model (Prisma dictionary)

All models live in `packages/db/prisma/schema.prisma`. Conventions:

- IDs: `cuid2` (never sequential; SEC2). Invitation/guest-link tokens: ≥128-bit random, stored
  **hashed** (SEC8).
- `createdAt`/`updatedAt` in UTC (INF8). Soft-delete only via `DeletionRequest` + 7-day undo (D6);
  facts are never overwritten — corrections are separate rows (principle 4).
- Money: integer minor units + `currency` (RON at launch). Unknown values are `NULL` + an
  `…Known Boolean` or rendered as "unknown" in UI — never 0 (principle 5, V6).
- Every table that staff or audit touch gets `AuditLog` entries via `packages/core` helper.

## Aggregates and models

### Accounts & auth (S1–S8, SEC1–SEC16, INF4)
| Model | Key fields | PRD |
| --- | --- | --- |
| `Account` | `kind: email\|anonymous`, `email? @unique`, `username? @unique`, `passwordHash?` (Argon2id, per-account salt), `locale`, `emailVerifiedAt?` | S1, S7, S8 |
| `Session` | accountId, deviceType, lastSeenAt, expiresAt, revokedAt | S3, SEC3, SEC12 |
| `SignInCode` | accountId?, email (hashed lookup), `codeHash`, attempts, expiresAt (15 min), usedAt | S1, INF4, SEC1, SEC8 |
| `MagicLink` | tokenHash, single-use, expires with its code; consumed-link path offers one rate-limited new code | S1, SEC14 |
| `RecoveryCode` | accountId, codeHash, usedAt (10 shown once at enrolment) | S2, S8 |
| `TotpSecret` / `PasskeyCredential` | accountId, … | S2 |
| `McpToken` | accountId, name, `tokenHash`, scopes (`read\|read_propose`), lastUsedAt, revokedAt; 30-day inactivity expiry job | MCP1, SEC8, SEC15 |
| `McpCallLog` | tokenId, tool, scope, at (audit-logged per call) | MCP1, SEC10 |
| `RateLimitBucket` | axis (email/ip/device-cookie), key, window, count | SEC16, SEC11 |
| `SecurityLog` | event, axis keys, at — never records whether an account exists | SEC10, SEC16 |

### Occasions & planning (release A/B)
| Model | Key fields | PRD |
| --- | --- | --- |
| `Occasion` | ownerId, title, kind (template kind), date / dateRange / poll ref, status, `spaceModelVersionId?`, brief fields (purpose, priorities) | A1, A11 |
| `OccasionMember` | occasionId, accountId?, role (owner/pm/workstream_lead/contributor/supplier/guest), grants: `finance`, `privateRequests`, custom label | A5, D2 |
| `Template` + `TemplateTask` | kind, tasks with `offsetMonths` (12/9/6/3/1), re-run diff tracking | A2 |
| `Task` | occasionId, title, ownerMemberId, dueAt, status, parentId (child tasks), dependencies (TaskDependency), checklist (TaskCheckItem), views are computed, not stored | A3, B7 |
| `Delegation` | taskId, fromMemberId, toMemberId, state (offered/accepted/declined → returns to delegator) | A4 |
| `Invitation` | occasionId, `tokenHash`, householdId, scope, revocable, expiresAt (never/RSVP deadline/closeout) | A6, S6, SEC2 |
| `Household` / `Guest` | lead contact email (captured at RSVP, INF5); **children stored only as `childrenCount` on the household response — no child person rows, no child fields anywhere** | A6 |
| `RsvpResponse` / `RsvpAnswer` | per session attendance; custom question answers one-per-screen; free-text answer flagged+warned if child-like data entered | A6 |
| `DatePoll` / `PollVote` | yes/maybe/no; host confirms; votes never reserve capacity | A7 |
| `Capacity` | occasionId, total; enforced atomically with invited+public guests (A8) | A8, Q4 |
| `ContributionNeed` / `ContributionClaim` | stated need, units, claims; atomic last-unit (row locks) | A9 |
| `WhatIfPreview` / `Proposal` | subject, delta JSON, proposedBy (user or MCP token), state (pending/applied/discarded); applied only on explicit confirm | principle 3, MCP3 |
| `ReminderDigest` | daily digest per member (A10) | A10 |

### Budget & suppliers (release B)
| Model | Key fields | PRD |
| --- | --- | --- |
| `BudgetCategory` / `BudgetLine` | estimate, committed, invoiced, paid, forecast — separate columns, never merged | B1 |
| `Expense` | categoryId, amount+currency, receiptAssetId, `approvalState`, `paymentState` (separate) | B2 |
| `LedgerEntry` | occasionId, payer, beneficiaries, amount+currency, settlement view | B3 |
| `Supplier` / `Booking` | states (enquired/quoted/booked/…), quoteAssetId (PDF, P12) | B4, P10 |
| `BriefingVersion` | bookingId, version, acknowledgedBy supplier | B4 |
| `OrderSnapshot` | bookingId, version, items; later guest changes produce delta rows, never silent edits | B5 |
| `Delivery` / `DeliveryItem` | expected vs received quantities; received changes only via `Correction` | B6, principle 4 |
| `Correction` | target table+row, field, before, after, actorId, reason — append-only | principle 4 |
| `ReadinessDecision` | Hold/Proceed/Proceed-with-conditions + evidence links | B8 |
| `PaymentDeadline` | bookingId, kind (advance/instalment/final), dueAt, amount — feeds finance digest | B12 |

### Directory & business module (release P)
| Model | Key fields | PRD |
| --- | --- | --- |
| `Business` | accountId (email required, P29 claim verification), onrcRegistration, insuranceValidUntil?, claimed listings | P1, P4 |
| `BusinessMember` | businessId, accountId, role (owner/admin/staff); admin cannot create/remove admins | P18 |
| `Listing` | businessId?, categories[21 fixed], counties[41+Bucharest], localities (picklists, no free text), status (draft/pending/live/suspended), claimed flag, badges (ONRC, insurance+date), unclaimed label + public contact route | P1–P4, P29 |
| `ListingRevision` | listingId, payload, state, moderatorId (≠ business member), decidedAt; live version stays up while pending | P3, W2 |
| `County` / `Locality` | fixed seed data (41 counties + Bucharest; sectors S1–S6 etc.), console-managed (W4) | P2 defs |
| `Category` | the 21 fixed launch categories, ro name + en toggle | P2 |
| `Drawing` | listingId, assetId (PNG/JPG/PDF ≤ limits), calibration points + derived scale, spaces, tables, fixtures, POIs, parking; versioned | V1–V11 |
| `SpaceModelVersion` | occasionId, drawingId, effectiveAt; updates arrive as proposed change to planner, never silent | V4 |
| `TableInventory` / `CustomTable` | dims; custom flagged "custom", never venue-supplied | V2, V5 |
| `Fixture` / `PointOfInterest` | dims, kind; flow to guest space view (V9) | V8, V9 |
| `ParkingFacts` | onSite?, spaceCountKnown?, count?, onStreet/paid, accessibleSpaces?, walkingDistanceM? — each known/unknown | V10, V11 |
| `FlowerCatalogue` / `CatalogueItem` | variety, image asset, seasonality, indicative price per stem/bunch, colours; moderated with listing | F1, F2 |
| `ArrangementDesign` | occasionId, form, items+stem counts, indicativeCost, version links to accepted quote | F3, F6 |
| `Enquiry` / `EnquiryMessage` | planner↔business thread, state (sent/awaiting/answered/closed), counts vs limits (10/occasion, 30/account/day), quote-request type carries arrangement + date + guests + message only; email shared only if ticked | P8–P11, P33, F5 |
| `FeaturedSlot` (dormant) | listingId, category, active; rotation pool; label state | P13–P16, MON5 |
| `Subscription` / `Invoice` (dormant until MON ON) | Stripe refs via webhook only, grace 14d, refunds need second person; fiscal invoice via SmartBill/Oblio webhook + RO e-Factura, TVA shown | P24–P26, PAY1–PAY5 |
| `MonetizationSwitch` | state OFF/ON, history, approvers, notice dates (60/30/7) | MON2, MON3, P28 |
| `DiscoverySource` / `DiscoveryRun` / `DiscoveryDraft` | source config + rate limits + kill switch; runs logged; drafts never public until approved; dedup queue | BD1–BD7, W5 |
| `ClaimInvitation` / `ObjectionRecord` | single claim email to published address; removal/objection honoured ≤30 days, recorded 3 years | BD5, BD6 |
| `ListingStats` | daily aggregates: enquiries sent/answered share, median reply time — computed by worker, no visitor identifiers | P31, D4, INF11 |
| `BusinessOccasion` branding fields, handover record (P22), lapse behavior flags (P23) | P17–P23 |

### Platform / staff (console, deployments)
| Model | Key fields | PRD |
| --- | --- | --- |
| `StaffMember` | accountId, roles[6] (PlatformAdmin, ContentEditor, ListingModerator, CommercialManager, PrivacyOwner, SecurityAdministrator) | staffing, W8 |
| `ApprovalRequest` | action, payload, requesterId, approverId?, state; queued in single-operator mode; no effect until approved | W9, P3, P26, P30, MON2 |
| `AuditLog` | actor, action, object, before/after, at — append-only (DB-enforced) | SEC10, W8 |
| `Deploy` | tag, commitHash, requesterId, approverId?, result, duration, rollback info, ciStatus | DEP2–DEP7, W10 |
| `StatsAggregate` | daily totals only (searches, enquiries, listing views, asset usage) — no visitor identifiers | D4, INF11 |
| `DeletionRequest` | target, requestedAt, undoUntil (+7 days), completedAt, retained-note | D6 |
| `RetentionPolicy` | seed of the INF6 retention table; worker purges per it | INF6, D5 |
| `NoticeAndActionReport` | DSA report intake: reporter, content, decision, reason given to affected party | LAU8 |

## Retention (INF6) — enforced by the worker's retention job

Sign-in/sensitive codes: deleted 24h after expiry or use · accounts/occasions: until deletion
request, then 7-day undo, then delete · private requests: 30 days after closeout · enquiry/quote
threads, guest responses/household emails: with the occasion · receipts/financial records: 7 years
after closeout (Romanian bookkeeping) · rejected discovery drafts: 90 days · claim/objection
records: 3 years · audit log: 2 years · directory statistics: indefinite daily aggregates (no raw
visitor data exists). Unlisted types default to "kept while the account/occasion exists, then
deleted with it".
