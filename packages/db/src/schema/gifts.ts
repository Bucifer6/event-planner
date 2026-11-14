import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { occasions } from "./occasions";
import { createdAt, currency, id, moneyMinor, ref, updatedAt } from "./_helpers";

// Gift estimator — "calculator dar" (C-11). PRIVATE TO ONE ACCOUNT: every row carries the
// account it belongs to and is read only by that account, even inside a shared occasion.
// Nothing here is joined into exports, guest pages, MCP tools or another member's view.

export const GIFT_RELATIONSHIPS = ["close_family", "family", "close_friend", "friend", "colleague"] as const;
export type GiftRelationship = (typeof GIFT_RELATIONSHIPS)[number];
export const giftRelationshipSchema = z.enum(GIFT_RELATIONSHIPS);

export const GIFT_DISTANCES = ["local", "county", "country", "abroad"] as const;
export type GiftDistance = (typeof GIFT_DISTANCES)[number];
export const giftDistanceSchema = z.enum(GIFT_DISTANCES);

export const GIFT_VENUES = ["restaurant", "ballroom", "premium", "home"] as const;
export type GiftVenue = (typeof GIFT_VENUES)[number];
export const giftVenueSchema = z.enum(GIFT_VENUES);

/** The transparent table the guide computes from. Minor units per adult; percentages are whole numbers. */
export type GiftGuideTable = {
  currency: string;
  base: Record<GiftVenue, { lowMinor: number; highMinor: number }>;
  relationshipPct: Record<GiftRelationship, number>;
  distancePct: Record<GiftDistance, number>;
};

/** The account's own copy of the table, once it has changed the placeholders. */
export const giftGuideSettings = pgTable("gift_guide_settings", {
  accountId: ref("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  guide: jsonb("guide").$type<GiftGuideTable>().notNull(),
  updatedAt: updatedAt(),
});

export const giftEstimates = pgTable(
  "gift_estimates",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** The household the note is about; plain text id (no join is ever made to guests). NULL = a free label. */
    householdId: text("household_id"),
    label: text("label").notNull(),
    relationship: text("relationship").$type<GiftRelationship>().notNull(),
    distance: text("distance").$type<GiftDistance>().notNull(),
    venue: text("venue").$type<GiftVenue>().notNull(),
    adults: integer("adults").notNull().default(2),
    lowMinor: moneyMinor("low_minor").notNull(),
    highMinor: moneyMinor("high_minor").notNull(),
    currency: currency(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("gift_estimates_account_occasion_idx").on(t.accountId, t.occasionId),
    uniqueIndex("gift_estimates_household_uq").on(t.accountId, t.occasionId, t.householdId),
  ],
);
