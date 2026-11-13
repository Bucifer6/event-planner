import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";
import { listings } from "./business";
import { createdAt, id, ref, timestamptz } from "./_helpers";

// Featured placement (P13–P16). Exists in the product only while monetization is ON (MON5).
// Written through @ed/core/featured. INVARIANT 7: never an input of the organic order.

export const featuredSlots = pgTable(
  "featured_slots",
  {
    id: id(),
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull(),
    /** NULL = every county the listing serves. */
    countyCode: text("county_code"),
    active: boolean("active").notNull().default(true),
    startsAt: timestamptz("starts_at").notNull(),
    /** NULL = until switched off. */
    endsAt: timestamptz("ends_at"),
    subscriptionId: text("subscription_id"),
    createdAt: createdAt(),
  },
  (t) => [index("featured_slots_search_idx").on(t.categoryId, t.countyCode, t.active), index("featured_slots_listing_idx").on(t.listingId)],
);
