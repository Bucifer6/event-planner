import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { businesses, listings } from "./business";
import { occasions } from "./occasions";
import { bookings } from "./suppliers";
import { createdAt, currency, id, moneyMinor, ref, timestamptz, updatedAt } from "./_helpers";

// Enquiries and quote requests (P8–P12, P29, P32, P33, F5, F6, D3). Written only through
// @ed/core/enquiries.
//
// D3: a business learns who a planner is ONLY from what the planner sends. `shared` is the
// exact snapshot of the fields the planner chose to send — nothing is joined in from the
// occasion or the account when the business reads a thread. `senderAccountId` exists for the
// planner side (limits, access); the business-side read never selects it.
//
// INF6: threads are kept with the occasion and deleted with it (FK cascade + purge hook).

export const ENQUIRY_STATES = ["sent", "awaiting", "answered", "closed"] as const;
export type EnquiryState = (typeof ENQUIRY_STATES)[number];
export const enquiryStateSchema = z.enum(ENQUIRY_STATES);

export const ENQUIRY_KINDS = ["enquiry", "quote_request"] as const;
export type EnquiryKind = (typeof ENQUIRY_KINDS)[number];
export const enquiryKindSchema = z.enum(ENQUIRY_KINDS);

export const ENQUIRY_SIDES = ["planner", "business"] as const;
export type EnquirySide = (typeof ENQUIRY_SIDES)[number];

/** P8: fixed budget bands (RON). Optional — NULL = the planner did not say. */
export const BUDGET_BANDS = ["under_2500", "2500_5000", "5000_10000", "10000_25000", "25000_50000", "over_50000"] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];
export const budgetBandSchema = z.enum(BUDGET_BANDS);

/** P8: what an enquiry shares. Exactly these keys. */
export type EnquiryShared = {
  occasionKind: string;
  /** "YYYY-MM-DD"; null = not decided yet. */
  date: string | null;
  /** Approximate guest count; null = unknown. */
  guests: number | null;
  countyCode: string | null;
  localityId: string | null;
  budgetBand: BudgetBand | null;
};

/** Opaque reference to an arrangement design (release C designer): `{ designId, version }`. */
export type DesignRef = { designId: string; version: number };

/** F5: what a flower quote request shares. Exactly these keys. */
export type QuoteRequestShared = {
  arrangement: { description: string; imageAssetId: string | null; designRef: DesignRef | null };
  date: string | null;
  guests: number | null;
};

export const enquiries = pgTable(
  "enquiries",
  {
    id: id(),
    kind: text("kind").$type<EnquiryKind>().notNull().default("enquiry"),
    state: text("state").$type<EnquiryState>().notNull().default("sent"),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** P10: the booking of the supplier record this thread sits in. */
    bookingId: ref("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    /** Planner side only (limits, "sent by"). NEVER read on the business side (D3). */
    senderAccountId: ref("sender_account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** Snapshot of the shared fields: EnquiryShared or QuoteRequestShared by `kind`. */
    shared: jsonb("shared").$type<EnquiryShared | QuoteRequestShared>().notNull(),
    /** P9: true only when the planner ticked the box. */
    emailShared: boolean("email_shared").notNull().default(false),
    /** The address as it was when shared; NULL unless `emailShared`. */
    sharedEmail: text("shared_email"),
    /** Double-submit guard: one enquiry per (occasion, key). */
    idempotencyKey: text("idempotency_key").notNull(),
    sentAt: timestamptz("sent_at").notNull(),
    /** P33: set by the single re-send. */
    resentAt: timestamptz("resent_at"),
    /** First reply from the business. */
    firstAnsweredAt: timestamptz("first_answered_at"),
    lastMessageAt: timestamptz("last_message_at").notNull(),
    /** P32: when the one 48-hour reminder went out. */
    nudgedAt: timestamptz("nudged_at"),
    closedAt: timestamptz("closed_at"),
    closedBy: text("closed_by").$type<EnquirySide>(),
    reportedAt: timestamptz("reported_at"),
    reportedBy: text("reported_by").$type<EnquirySide>(),
    /** Row in enquiry_stat_events (kept after the thread is deleted; carries no identity). */
    statEventId: text("stat_event_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("enquiries_occasion_idx").on(t.occasionId, t.sentAt),
    index("enquiries_business_idx").on(t.businessId, t.state, t.lastMessageAt),
    index("enquiries_booking_idx").on(t.bookingId),
    index("enquiries_sender_idx").on(t.senderAccountId, t.sentAt),
    uniqueIndex("enquiries_idempotency_uq").on(t.occasionId, t.idempotencyKey),
    // P10/P33: one open plain enquiry per occasion and listing — never a duplicate thread
    uniqueIndex("enquiries_open_uq")
      .on(t.occasionId, t.listingId)
      .where(sql`${t.kind} = 'enquiry' and ${t.state} <> 'closed'`),
    check("enquiries_state_ck", sql`${t.state} in ('sent', 'awaiting', 'answered', 'closed')`),
    check("enquiries_kind_ck", sql`${t.kind} in ('enquiry', 'quote_request')`),
    check("enquiries_email_ck", sql`${t.emailShared} or ${t.sharedEmail} is null`),
  ],
);

export const enquiryMessages = pgTable(
  "enquiry_messages",
  {
    id: id(),
    enquiryId: ref("enquiry_id")
      .notNull()
      .references(() => enquiries.id, { onDelete: "cascade" }),
    side: text("side").$type<EnquirySide>().notNull(),
    /** Who typed it, for the audit trail of the author's own side. Never shown to the other side. */
    authorAccountId: ref("author_account_id").references(() => accounts.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** P12: a PDF the business marked as its quote (asset owned by the occasion). */
    quoteAssetId: text("quote_asset_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("enquiry_messages_enquiry_idx").on(t.enquiryId, t.createdAt),
    check("enquiry_messages_side_ck", sql`${t.side} in ('planner', 'business')`),
    check("enquiry_messages_quote_ck", sql`${t.quoteAssetId} is null or ${t.side} = 'business'`),
  ],
);

/**
 * P31 / INF11: one row per enquiry that reached a listing — when it arrived and how long the
 * first reply took. No occasion, no account, no text: it outlives the thread so a listing's
 * published response numbers do not change when a planner deletes an occasion.
 */
export const enquiryStatEvents = pgTable(
  "enquiry_stat_events",
  {
    id: id(),
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    receivedAt: timestamptz("received_at").notNull(),
    answeredAt: timestamptz("answered_at"),
    /** Minutes from arrival to the first reply. NULL = not answered. */
    replyMinutes: integer("reply_minutes"),
  },
  (t) => [index("enquiry_stat_events_listing_idx").on(t.listingId, t.receivedAt)],
);

/**
 * F6 / P12: an accepted quote, linked to what was asked for. One row per acceptance — a later
 * acceptance (changed design, new quote) is a new `version`, so the change shows as a delta.
 */
export const quoteLinks = pgTable(
  "quote_links",
  {
    id: id(),
    enquiryId: ref("enquiry_id")
      .notNull()
      .references(() => enquiries.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    bookingId: text("booking_id"),
    version: integer("version").notNull(),
    /** The design version the quote answers (null for a photo/sketch or a plain enquiry). */
    designRef: jsonb("design_ref").$type<DesignRef>(),
    /** Snapshot of the arrangement text at acceptance (null for a plain enquiry). */
    arrangementDescription: text("arrangement_description"),
    quoteAssetId: text("quote_asset_id").notNull(),
    quoteMessageId: text("quote_message_id").notNull(),
    /** Agreed amount entered by the planner at acceptance. NULL = unknown. */
    agreedMinor: moneyMinor("agreed_minor"),
    currency: currency(),
    acceptedAt: timestamptz("accepted_at").notNull(),
    acceptedByAccountId: ref("accepted_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("quote_links_version_uq").on(t.enquiryId, t.version), index("quote_links_booking_idx").on(t.bookingId)],
);
