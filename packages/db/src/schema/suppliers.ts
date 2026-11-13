import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, currency, id, moneyMinor, ref, timestamptz, updatedAt } from "./_helpers";
import { occasions } from "./occasions";

// Suppliers, bookings, versioned briefings, final-order snapshots and payment deadlines
// (B4, B5, B12, P10, P12, S6). Access is decided only in @ed/core (suppliers, bookings,
// briefings, orders, payments). Guards for the immutable tables live in
// src/sql/020_suppliers_guards.sql.

export const BOOKING_STATES = ["enquired", "quoted", "booked", "confirmed", "delivered", "cancelled"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];
export const bookingStateSchema = z.enum(BOOKING_STATES);

export const PAYMENT_KINDS = ["advance", "instalment", "final"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const paymentKindSchema = z.enum(PAYMENT_KINDS);

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Free label ("Formație", "Catering"); not the directory picklist. */
    categoryLabel: text("category_label"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    /** Directory listing this supplier came from (P10). Plain text: the directory owns it. */
    listingId: text("listing_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("suppliers_occasion_idx").on(t.occasionId),
    uniqueIndex("suppliers_occasion_listing_uq")
      .on(t.occasionId, t.listingId)
      .where(sql`${t.listingId} is not null`),
  ],
);

/** One booking per supplier record: the state of the agreement with them. */
export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    supplierId: ref("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    state: text("state").$type<BookingState>().notNull().default("enquired"),
    /** Agreed amount. NULL = unknown (never 0). Finance grant only. */
    agreedMinor: moneyMinor("agreed_minor"),
    currency: currency(),
    /** Uploaded quote (a PDF marks the booking as quoted, P12). */
    quoteAssetId: text("quote_asset_id"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("bookings_supplier_uq").on(t.supplierId), index("bookings_occasion_idx").on(t.occasionId)],
);

/** Every state transition of a booking, with who and when. Append-only by convention. */
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: id(),
    bookingId: ref("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    fromState: text("from_state").$type<BookingState>(),
    toState: text("to_state").$type<BookingState>().notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    note: text("note"),
    at: timestamptz("at").notNull().defaultNow(),
  },
  (t) => [index("booking_events_booking_idx").on(t.bookingId, t.at)],
);

/** Scoped supplier link (S6, SEC2): only the token hash is stored. One per booking. */
export const supplierLinks = pgTable(
  "supplier_links",
  {
    id: id(),
    bookingId: ref("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    language: text("language").$type<"ro" | "en">().notNull().default("ro"),
    revokedAt: timestamptz("revoked_at"),
    lastViewedAt: timestamptz("last_viewed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("supplier_links_booking_uq").on(t.bookingId), uniqueIndex("supplier_links_token_uq").on(t.tokenHash)],
);

export type BriefingContent = {
  what: string;
  when: string;
  where: string;
  contacts: string;
  specialNotes: string;
  freeText: string;
};
export const BRIEFING_FIELDS = ["what", "when", "where", "contacts", "specialNotes", "freeText"] as const;
export type BriefingField = (typeof BRIEFING_FIELDS)[number];

/** Immutable: a published briefing is never edited; a change is a new version (DB guard). */
export const briefingVersions = pgTable(
  "briefing_versions",
  {
    id: id(),
    bookingId: ref("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    version: integer("version").notNull(),
    content: jsonb("content").$type<BriefingContent>().notNull(),
    createdByAccountId: text("created_by_account_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("briefing_versions_booking_version_uq").on(t.bookingId, t.version)],
);

/** The supplier's "received and understood", once per version (through the scoped link). */
export const briefingAcks = pgTable(
  "briefing_acks",
  {
    id: id(),
    briefingVersionId: ref("briefing_version_id")
      .notNull()
      .references(() => briefingVersions.id, { onDelete: "cascade" }),
    bookingId: ref("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    /** Who acknowledged, as they wrote it on the supplier link. */
    ackName: text("ack_name").notNull(),
    linkId: text("link_id"),
    ackAt: timestamptz("ack_at").notNull(),
  },
  (t) => [uniqueIndex("briefing_acks_version_uq").on(t.briefingVersionId), index("briefing_acks_booking_idx").on(t.bookingId)],
);

export type OrderItem = { label: string; quantity: number; unit: string | null; note: string | null };
export type OrderCounts = { adults: number; children: number; total: number };

/** Immutable final order of a booking (B5). A change is a new version (DB guard). */
export const orderSnapshots = pgTable(
  "order_snapshots",
  {
    id: id(),
    bookingId: ref("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    version: integer("version").notNull(),
    items: jsonb("items").$type<OrderItem[]>().notNull(),
    /** Guest counts the order was based on, at the moment it was fixed. */
    basedOn: jsonb("based_on").$type<OrderCounts>().notNull(),
    createdByAccountId: text("created_by_account_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("order_snapshots_booking_version_uq").on(t.bookingId, t.version)],
);

/**
 * A guest change that happened AFTER a final order was fixed (B5): written by the database
 * trigger on rsvp_responses, one row per booking that has a snapshot. Never an edit of the
 * order — the planner folds deltas into a NEW snapshot version explicitly.
 */
export const orderDeltas = pgTable(
  "order_deltas",
  {
    id: text("id").primaryKey(),
    bookingId: ref("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    /** The snapshot that was current when the change happened. */
    snapshotId: ref("snapshot_id").notNull(),
    /** The household whose answer changed (no FK: the row outlives a removed household). */
    householdId: text("household_id").notNull(),
    /** Attending counts of that household before and after: { adults, children }. */
    before: jsonb("before").$type<{ adults: number; children: number }>().notNull(),
    after: jsonb("after").$type<{ adults: number; children: number }>().notNull(),
    /** Set when the planner folded this delta into a new snapshot version. */
    foldedIntoSnapshotId: text("folded_into_snapshot_id"),
    createdAt: createdAt(),
  },
  (t) => [index("order_deltas_booking_idx").on(t.bookingId, t.createdAt)],
);

/** Supplier payment deadlines (B12). Finance grant for every read and write (D2). */
export const paymentDeadlines = pgTable(
  "payment_deadlines",
  {
    id: id(),
    bookingId: ref("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PaymentKind>().notNull(),
    /** Calendar day (Europe/Bucharest) the payment is due. */
    dueOn: date("due_on", { mode: "string" }).notNull(),
    /** NULL = amount not known yet. */
    amountMinor: moneyMinor("amount_minor"),
    currency: currency(),
    /** A fact: once set it changes only through a correction (DB guard). */
    paidAt: timestamptz("paid_at"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_deadlines_occasion_due_idx").on(t.occasionId, t.dueOn), index("payment_deadlines_booking_idx").on(t.bookingId)],
);
