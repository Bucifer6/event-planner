import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { categories, counties, localities } from "./directory";
import { staffMembers } from "./staff";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Business accounts, listings, moderation and listing statistics (P1–P4, P18, P23, P29, P31,
// W2, W3). Written only through @ed/core/{business,listings,moderation,listingstats}.
//
// INVARIANT 7 (paid means position, never preference): nothing in this file may ever feed the
// organic directory order. `businesses.planLapsedAt` is the only billing-like column here and
// @ed/core/directory `organicOrder()` cannot see it (its inputs are listing ids, the day and
// the search key only).

export const BUSINESS_STATUSES = ["active", "restricted", "suspended"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];
export const businessStatusSchema = z.enum(BUSINESS_STATUSES);

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    name: text("name").notNull(),
    /** The owner. Must be an email account (P29: claim verification needs an address). */
    ownerAccountId: ref("owner_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    /** ONRC registration number as the business states it (e.g. J12/345/2020). NULL = not given. */
    onrcRegistration: text("onrc_registration"),
    /** P4 badge 1: set by a listing moderator after checking the Trade Register. */
    onrcVerifiedAt: timestamptz("onrc_verified_at"),
    /** P4 badge 2: the date until which the insurance a moderator SAW is valid ("YYYY-MM-DD"). */
    insuranceValidUntil: text("insurance_valid_until"),
    insuranceSeenAt: timestamptz("insurance_seen_at"),
    /**
     * W3. active = normal; restricted = listings stay public, the business cannot submit new
     * or changed content; suspended = its listings are not public. Data, not session state.
     */
    status: text("status").$type<BusinessStatus>().notNull().default("active"),
    /** The reason given to the business (shown in its business area). */
    restrictionReason: text("restriction_reason"),
    restrictedAt: timestamptz("restricted_at"),
    /** P23 groundwork: set by the (later) billing domain when the plan lapses. NEVER an ordering input. */
    planLapsedAt: timestamptz("plan_lapsed_at"),
    /** P32: the 48-hour reminder for unanswered enquiries (the arrival notice cannot be turned off). */
    nudge48h: boolean("nudge_48h").notNull().default(true),
    /** P31: hide response statistics on every listing of this business. */
    hideStats: boolean("hide_stats").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("businesses_owner_idx").on(t.ownerAccountId),
    index("businesses_status_idx").on(t.status),
  ],
);

export const BUSINESS_ROLES = ["owner", "admin", "staff"] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];
export const businessRoleSchema = z.enum(BUSINESS_ROLES);

/** P18: one owner, admins and staff. A row with account_id NULL is an invitation not yet accepted. */
export const businessMembers = pgTable(
  "business_members",
  {
    id: id(),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    accountId: ref("account_id").references(() => accounts.id, { onDelete: "restrict" }),
    role: text("role").$type<BusinessRole>().notNull(),
    inviteEmail: text("invite_email"),
    /** SHA-256 of the emailed token (SEC8); cleared on acceptance. */
    inviteTokenHash: text("invite_token_hash"),
    invitedAt: timestamptz("invited_at"),
    createdAt: createdAt(),
    removedAt: timestamptz("removed_at"),
  },
  (t) => [
    uniqueIndex("business_members_business_account_uq")
      .on(t.businessId, t.accountId)
      .where(sql`${t.accountId} is not null and ${t.removedAt} is null`),
    uniqueIndex("business_members_invite_token_uq").on(t.inviteTokenHash),
    index("business_members_account_idx").on(t.accountId),
    // exactly one live owner per business
    uniqueIndex("business_members_one_owner_uq")
      .on(t.businessId)
      .where(sql`${t.role} = 'owner' and ${t.removedAt} is null`),
  ],
);

export const FACT_CHECK_KINDS = ["onrc", "insurance"] as const;
export type FactCheckKind = (typeof FACT_CHECK_KINDS)[number];
export const factCheckKindSchema = z.enum(FACT_CHECK_KINDS);

/**
 * P4: the record behind each factual badge — who checked, when, and what was seen. Only two
 * kinds of badge can ever exist; the CHECK constraint makes a third one impossible to store.
 */
export const businessFactChecks = pgTable(
  "business_fact_checks",
  {
    id: id(),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: text("kind").$type<FactCheckKind>().notNull(),
    /** verified = the badge was set; withdrawn = the badge was removed. */
    outcome: text("outcome").$type<"verified" | "withdrawn">().notNull().default("verified"),
    staffId: ref("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    /** What the moderator saw (register extract number, policy number and insurer…). */
    seen: text("seen").notNull(),
    /** Insurance only: valid until ("YYYY-MM-DD"). */
    validUntil: text("valid_until"),
    checkedAt: timestamptz("checked_at").notNull(),
  },
  (t) => [
    index("business_fact_checks_business_idx").on(t.businessId, t.checkedAt),
    check("business_fact_checks_kind_ck", sql`${t.kind} in ('onrc', 'insurance')`),
    check("business_fact_checks_outcome_ck", sql`${t.outcome} in ('verified', 'withdrawn')`),
  ],
);

/** In-app messages to a business (W3 restriction notices, moderation decisions). */
export const businessNotices = pgTable(
  "business_notices",
  {
    id: id(),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** e.g. business.restricted, business.suspended, business.restored, listing.suspended, revision.approved, revision.rejected */
    kind: text("kind").notNull(),
    listingId: text("listing_id"),
    /** Free text written by staff for the business (the recorded reason). */
    reason: text("reason"),
    createdAt: createdAt(),
    readAt: timestamptz("read_at"),
  },
  (t) => [index("business_notices_business_idx").on(t.businessId, t.createdAt)],
);

export const LISTING_STATUSES = ["draft", "pending", "live", "suspended", "retired"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const listingStatusSchema = z.enum(LISTING_STATUSES);

/**
 * What a business (or discovery) proposes for a listing. This exact shape is what a
 * moderator approves; ids refer to the seeded picklists — there is no free-text category or
 * place (P1, P2).
 */
export type ListingPayload = {
  name: string;
  /** L4: Romanian is required. */
  descriptionRo: string;
  /** L4: optional English version; NULL → "numai în română". */
  descriptionEn: string | null;
  /** 1–5 category ids. */
  categoryIds: string[];
  /** ≤5 county codes. */
  countyCodes: string[];
  /** 1–20 locality ids, each inside one of `countyCodes`. */
  localityIds: string[];
  contactPhone: string | null;
  contactEmail: string | null;
  /** https only. */
  website: string | null;
  /** Asset ids (images owned by the business). */
  photoAssetIds: string[];
};

export const listings = pgTable(
  "listings",
  {
    id: id(),
    /** NULL = unclaimed listing added by discovery (P29, BD4). */
    businessId: ref("business_id").references(() => businesses.id, { onDelete: "restrict" }),
    /**
     * draft = never submitted; pending = first revision waits for a moderator (not public);
     * live = public; suspended = taken down by staff (W3); retired = withdrawn.
     * A live listing with an edit waiting stays "live" — see listing_revisions.
     */
    status: text("status").$type<ListingStatus>().notNull().default("draft"),
    claimed: boolean("claimed").notNull().default(true),

    /* ── LIVE content: written only when a revision is approved ── */
    name: text("name").notNull(),
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    website: text("website"),
    photoAssetIds: jsonb("photo_asset_ids").$type<string[]>().notNull().default([]),
    liveRevisionId: text("live_revision_id"),
    publishedAt: timestamptz("published_at"),

    /** The business's working copy (not public, not yet submitted). */
    draft: jsonb("draft").$type<ListingPayload>(),

    /* ── Unclaimed listings (P29): where the facts came from ── */
    sourceUrl: text("source_url"),
    collectedAt: timestamptz("collected_at"),
    /** The contact route exactly as the public source states it. */
    publicContactRoute: text("public_contact_route"),

    /** P31: hide this listing's response statistics. */
    hideStats: boolean("hide_stats").notNull().default(false),

    /* ── W3 ── */
    suspensionReason: text("suspension_reason"),
    suspendedAt: timestamptz("suspended_at"),
    /** Status to return to when the suspension is lifted. */
    statusBeforeSuspension: text("status_before_suspension").$type<ListingStatus>(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("listings_business_idx").on(t.businessId),
    index("listings_status_idx").on(t.status),
    check("listings_status_ck", sql`${t.status} in ('draft', 'pending', 'live', 'suspended', 'retired')`),
    // an unclaimed listing has no business; a claimed one always has
    check("listings_claimed_ck", sql`(${t.claimed} and ${t.businessId} is not null) or (not ${t.claimed} and ${t.businessId} is null)`),
  ],
);

/** LIVE categories of a listing (search index). Rewritten when a revision is approved. */
export const listingCategories = pgTable(
  "listing_categories",
  {
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    categoryId: ref("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.categoryId] }), index("listing_categories_category_idx").on(t.categoryId, t.listingId)],
);

/** LIVE localities of a listing, with the county denormalised for category × county search. */
export const listingLocalities = pgTable(
  "listing_localities",
  {
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    localityId: ref("locality_id")
      .notNull()
      .references(() => localities.id, { onDelete: "restrict" }),
    countyCode: ref("county_code")
      .notNull()
      .references(() => counties.code, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.localityId] }),
    index("listing_localities_county_idx").on(t.countyCode, t.listingId),
    index("listing_localities_locality_idx").on(t.localityId, t.listingId),
  ],
);

export const REVISION_STATES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type RevisionState = (typeof REVISION_STATES)[number];
export const revisionStateSchema = z.enum(REVISION_STATES);

/**
 * THE moderation queue (P3, W2). Every create and every edit of moderated content is a row
 * here; `kind` says what it is ("listing" now; "drawing", "catalogue"… register themselves
 * with registerModerationKind in @ed/core/moderation). The live content is untouched until a
 * row is approved. A decided row (approved / rejected) can never change again: enforced by
 * the trigger in sql/020_listing_revisions_immutable.sql.
 */
export const listingRevisions = pgTable(
  "listing_revisions",
  {
    id: id(),
    kind: text("kind").notNull().default("listing"),
    /** Id of the moderated object (for kind "listing": the listing id). */
    subjectId: text("subject_id").notNull(),
    /** The listing this belongs to, when there is one (drawings and catalogues are moderated with the listing). */
    listingId: ref("listing_id").references(() => listings.id, { onDelete: "cascade" }),
    /** The business whose members may NOT decide this row (P3). NULL for unclaimed listings. */
    businessId: ref("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    /** The live content at submission time, in the same shape — for the before → after view. NULL = new. */
    basePayload: jsonb("base_payload"),
    state: text("state").$type<RevisionState>().notNull().default("pending"),
    submittedByAccountId: ref("submitted_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** Set when staff or discovery created the row (BD4); that person cannot approve it. */
    submittedByStaffId: ref("submitted_by_staff_id").references(() => staffMembers.id, { onDelete: "restrict" }),
    /** Where the content came from, cited in the moderation record (BD4). */
    sourceNote: text("source_note"),
    moderatorStaffId: ref("moderator_staff_id").references(() => staffMembers.id, { onDelete: "restrict" }),
    decidedAt: timestamptz("decided_at"),
    /** The reason given to the business (mandatory on rejection). */
    decisionReason: text("decision_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("listing_revisions_queue_idx").on(t.state, t.createdAt),
    index("listing_revisions_subject_idx").on(t.kind, t.subjectId, t.createdAt),
    index("listing_revisions_business_idx").on(t.businessId, t.createdAt),
    // at most one revision of an object waits at a time
    uniqueIndex("listing_revisions_one_pending_uq")
      .on(t.kind, t.subjectId)
      .where(sql`${t.state} = 'pending'`),
    check("listing_revisions_state_ck", sql`${t.state} in ('pending', 'approved', 'rejected', 'withdrawn')`),
  ],
);

/**
 * P31: one row per listing per day — the cumulative response numbers as verified that night,
 * computed by the worker from application events only (INF11). No visitor identifier.
 */
export const listingStats = pgTable(
  "listing_stats",
  {
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    /** Europe/Bucharest day, "YYYY-MM-DD". */
    day: text("day").notNull(),
    enquiriesReceived: integer("enquiries_received").notNull().default(0),
    enquiriesAnswered: integer("enquiries_answered").notNull().default(0),
    /** NULL = unknown (no answered enquiry yet). */
    medianReplyMinutes: integer("median_reply_minutes"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.day] }),
    check("listing_stats_counts_ck", sql`${t.enquiriesReceived} >= 0 and ${t.enquiriesAnswered} >= 0 and ${t.enquiriesAnswered} <= ${t.enquiriesReceived}`),
  ],
);
