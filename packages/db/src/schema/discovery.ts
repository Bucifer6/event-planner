import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { businesses, listings } from "./business";
import { staffMembers } from "./staff";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Business discovery (BD1–BD7, W5) and listing claiming (P29, P30). Written only through
// @ed/core/discovery and @ed/core/claims.
//
// BD2: a discovery draft is never public. It becomes a listing only when a ListingModerator
// approves it (then @ed/core/listings createUnclaimedListing + the moderation record).
// BD6: objection_records are evidence of handling (kept 3 years); discovery_suppressions make
// sure a business that asked to be removed is never discovered again.

export const DISCOVERY_SOURCE_KINDS = ["onrc_public", "business_page", "licensed_dataset"] as const;
export type DiscoverySourceKind = (typeof DISCOVERY_SOURCE_KINDS)[number];
export const discoverySourceKindSchema = z.enum(DISCOVERY_SOURCE_KINDS);

/** Per-kind settings. Every field optional here; @ed/core/discovery validates per kind. */
export type DiscoverySourceConfig = {
  /** licensed_dataset: the file's format. */
  format?: "csv" | "json";
  /** licensed_dataset: https URL of the file under contract … */
  url?: string;
  /** … or the file's content pasted by the operator. */
  inline?: string;
  /** business_page: operator-entered public pages, one business each. */
  urls?: string[];
  /** Category given to rows that do not name one (picklist id). */
  defaultCategoryId?: string;
  /** BD7 targeting: keep only these categories / counties (empty = all). */
  targetCategoryIds?: string[];
  targetCountyCodes?: string[];
};

export const discoverySources = pgTable(
  "discovery_sources",
  {
    id: id(),
    name: text("name").notNull(),
    kind: text("kind").$type<DiscoverySourceKind>().notNull(),
    config: jsonb("config").$type<DiscoverySourceConfig>().notNull().default({}),
    /** SEC6/BD7: most outbound requests this source may make in an hour. */
    rateLimitPerHour: integer("rate_limit_per_hour").notNull().default(60),
    /** BD7 kill switch: false stops the source at once, also in the middle of a run. */
    enabled: boolean("enabled").notNull().default(false),
    /** Where the right to use the source is written down (contract no., licence, terms URL). */
    termsReference: text("terms_reference").notNull(),
    /** Hour bucket of the request counter below. */
    rateWindowStart: timestamptz("rate_window_start"),
    rateWindowCount: integer("rate_window_count").notNull().default(0),
    createdByStaffId: ref("created_by_staff_id").references(() => staffMembers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("discovery_sources_name_uq").on(t.name),
    check("discovery_sources_kind_ck", sql`${t.kind} in ('onrc_public', 'business_page', 'licensed_dataset')`),
    check("discovery_sources_rate_ck", sql`${t.rateLimitPerHour} between 1 and 3600`),
  ],
);

/** BD7: every run, with what it saw and what it made. */
export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: id(),
    sourceId: ref("source_id")
      .notNull()
      .references(() => discoverySources.id, { onDelete: "cascade" }),
    startedAt: timestamptz("started_at").notNull(),
    finishedAt: timestamptz("finished_at"),
    itemsSeen: integer("items_seen").notNull().default(0),
    draftsCreated: integer("drafts_created").notNull().default(0),
    duplicatesQueued: integer("duplicates_queued").notNull().default(0),
    /** Already known (same draft again) or suppressed after an objection — not created. */
    skipped: integer("skipped").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    /** "staff:<id>" or "schedule". */
    triggeredBy: text("triggered_by").notNull(),
    /** Why it ended early: kill_switch | rate_limit | null. */
    stoppedReason: text("stopped_reason"),
  },
  (t) => [index("discovery_runs_source_idx").on(t.sourceId, t.startedAt), index("discovery_runs_started_idx").on(t.startedAt)],
);

export const DISCOVERY_DRAFT_STATES = ["pending", "approved", "rejected", "duplicate_review"] as const;
export type DiscoveryDraftState = (typeof DISCOVERY_DRAFT_STATES)[number];
export const discoveryDraftStateSchema = z.enum(DISCOVERY_DRAFT_STATES);

export const DISCOVERY_BATCH_ACTIONS = ["approve", "reject", "discard"] as const;
export type DiscoveryBatchAction = (typeof DISCOVERY_BATCH_ACTIONS)[number];

/** W5: one decision over many drafts, with its ONE recorded reason. */
export const discoveryBatches = pgTable("discovery_batches", {
  id: id(),
  action: text("action").$type<DiscoveryBatchAction>().notNull(),
  reason: text("reason").notNull(),
  staffId: ref("staff_id")
    .notNull()
    .references(() => staffMembers.id, { onDelete: "restrict" }),
  draftCount: integer("draft_count").notNull().default(0),
  createdAt: createdAt(),
});

/** BD2: a candidate business found by discovery. Never public. */
export const discoveryDrafts = pgTable(
  "discovery_drafts",
  {
    id: id(),
    sourceId: ref("source_id")
      .notNull()
      .references(() => discoverySources.id, { onDelete: "cascade" }),
    runId: ref("run_id").references(() => discoveryRuns.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** Category guess: a picklist id when it could be matched, plus the source's own words. */
    categoryGuessId: text("category_guess_id"),
    categoryGuessText: text("category_guess_text"),
    countyCode: text("county_code"),
    localityId: text("locality_id"),
    /** County / locality as the source wrote them (kept when no picklist row matched). */
    areaText: text("area_text"),
    /** The contact route exactly as the public source states it. */
    publicContactRoute: text("public_contact_route").notNull(),
    /** BD5: only an address the source itself publishes. NULL = none → no invitation. */
    publicEmail: text("public_email"),
    sourceUrl: text("source_url").notNull(),
    collectedAt: timestamptz("collected_at").notNull(),
    state: text("state").$type<DiscoveryDraftState>().notNull().default("pending"),
    /** BD3: SHA-256 of each normalised key (name+place, email, phone, identifier, site). */
    dedupeKeys: jsonb("dedupe_keys").$type<string[]>().notNull().default([]),
    duplicateOfListingId: text("duplicate_of_listing_id"),
    duplicateOfDraftId: text("duplicate_of_draft_id"),
    batchId: ref("batch_id").references(() => discoveryBatches.id, { onDelete: "set null" }),
    decidedAt: timestamptz("decided_at"),
    /** Set on approval: the unclaimed listing made from this draft. */
    listingId: ref("listing_id").references(() => listings.id, { onDelete: "set null" }),
    /** BD5: the one claim invitation. */
    invitationSentAt: timestamptz("invitation_sent_at"),
    /** SHA-256 of the token in the invitation's removal link. */
    invitationTokenHash: text("invitation_token_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("discovery_drafts_state_idx").on(t.state, t.createdAt),
    index("discovery_drafts_source_idx").on(t.sourceId, t.createdAt),
    index("discovery_drafts_listing_idx").on(t.listingId),
    uniqueIndex("discovery_drafts_invite_token_uq").on(t.invitationTokenHash),
    check("discovery_drafts_state_ck", sql`${t.state} in ('pending', 'approved', 'rejected', 'duplicate_review')`),
  ],
);

export const OBJECTION_KINDS = ["removal", "objection", "correction"] as const;
export type ObjectionKind = (typeof OBJECTION_KINDS)[number];
export const objectionKindSchema = z.enum(OBJECTION_KINDS);

export const OBJECTION_STATES = ["received", "honoured", "declined"] as const;
export type ObjectionState = (typeof OBJECTION_STATES)[number];

/** BD6: a removal or objection request and how it was handled. Kept 3 years (INF6). */
export const objectionRecords = pgTable(
  "objection_records",
  {
    id: id(),
    /** Plain text: the record outlives the listing. */
    listingId: text("listing_id").notNull(),
    listingName: text("listing_name").notNull(),
    kind: text("kind").$type<ObjectionKind>().notNull(),
    message: text("message"),
    /** Where to answer, if the requester gave one. */
    contactEmail: text("contact_email"),
    /** True when the request came through the link in the claim invitation (proof of address). */
    viaInvitation: boolean("via_invitation").notNull().default(false),
    state: text("state").$type<ObjectionState>().notNull().default("received"),
    receivedAt: timestamptz("received_at").notNull(),
    /** BD6: to be honoured within 30 days. */
    dueAt: timestamptz("due_at").notNull(),
    handledAt: timestamptz("handled_at"),
    handledByStaffId: ref("handled_by_staff_id").references(() => staffMembers.id, { onDelete: "restrict" }),
    handlingNote: text("handling_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("objection_records_state_idx").on(t.state, t.dueAt),
    index("objection_records_listing_idx").on(t.listingId),
    check("objection_records_state_ck", sql`${t.state} in ('received', 'honoured', 'declined')`),
  ],
);

/** BD6: hashed dedupe keys of businesses that asked to be removed. Discovery skips them for good. */
export const discoverySuppressions = pgTable(
  "discovery_suppressions",
  {
    keyHash: text("key_hash").primaryKey(),
    objectionId: text("objection_id"),
    createdAt: createdAt(),
  },
);

export const CLAIM_STATES = ["code_sent", "verified", "needs_check", "in_approval", "approved", "rejected", "cancelled"] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];
export const claimStateSchema = z.enum(CLAIM_STATES);

/** P30: a claim on an unclaimed listing, from proof to the second-person approval (W9). */
export const listingClaims = pgTable(
  "listing_claims",
  {
    id: id(),
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    claimantAccountId: ref("claimant_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The claimant's existing business, or NULL → one named `businessName` is created on approval. */
    businessId: ref("business_id").references(() => businesses.id, { onDelete: "set null" }),
    businessName: text("business_name"),
    /** code = a code emailed to the published address; moderator = checked against the public source. */
    method: text("method").$type<"code" | "moderator">().notNull(),
    state: text("state").$type<ClaimState>().notNull(),
    /** What the claimant says about their role (shown to the moderator). */
    statement: text("statement"),
    /** SHA-256 of the six-digit code (SEC8). Cleared when used or a day after expiry. */
    codeHash: text("code_hash"),
    codeExpiresAt: timestamptz("code_expires_at"),
    codeAttempts: integer("code_attempts").notNull().default(0),
    codesSent: integer("codes_sent").notNull().default(0),
    verifiedAt: timestamptz("verified_at"),
    /** The moderator's recorded check against the public source (mandatory for method "moderator"). */
    checkNote: text("check_note"),
    checkedByStaffId: ref("checked_by_staff_id").references(() => staffMembers.id, { onDelete: "restrict" }),
    checkedAt: timestamptz("checked_at"),
    approvalRequestId: text("approval_request_id"),
    decisionReason: text("decision_reason"),
    decidedAt: timestamptz("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("listing_claims_listing_idx").on(t.listingId, t.state),
    index("listing_claims_state_idx").on(t.state, t.createdAt),
    // one open claim per person and listing
    uniqueIndex("listing_claims_open_uq")
      .on(t.listingId, t.claimantAccountId)
      .where(sql`${t.state} in ('code_sent', 'verified', 'needs_check', 'in_approval')`),
    check(
      "listing_claims_state_ck",
      sql`${t.state} in ('code_sent', 'verified', 'needs_check', 'in_approval', 'approved', 'rejected', 'cancelled')`,
    ),
  ],
);
