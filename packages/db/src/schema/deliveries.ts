import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, currency, id, moneyMinor, ref, timestamptz, updatedAt } from "./_helpers";
import { occasions } from "./occasions";
import { suppliers } from "./suppliers";

// Deliveries, hired items and returns (B6, principle 4). Received and returned quantities are
// FACTS: set once, afterwards changed only through a correction (API check in
// @ed/core/deliveries and the trigger in src/sql/021_delivery_facts.sql).

export const DELIVERY_KINDS = ["delivery", "hire", "return"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];
export const deliveryKindSchema = z.enum(DELIVERY_KINDS);

export const DELIVERY_STATES = ["expected", "received", "partial", "returned"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];
export const deliveryStateSchema = z.enum(DELIVERY_STATES);

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** NULL = not tied to a supplier record (something a relative brings, for example). */
    supplierId: ref("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    kind: text("kind").$type<DeliveryKind>().notNull().default("delivery"),
    /** Expected slot. NULL = not agreed yet. */
    expectedFrom: timestamptz("expected_from"),
    expectedTo: timestamptz("expected_to"),
    place: text("place"),
    state: text("state").$type<DeliveryState>().notNull().default("expected"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deliveries_occasion_idx").on(t.occasionId, t.expectedFrom), index("deliveries_supplier_idx").on(t.supplierId)],
);

export const deliveryItems = pgTable(
  "delivery_items",
  {
    id: id(),
    deliveryId: ref("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    label: text("label").notNull(),
    /** Order of the lines within the delivery. */
    position: integer("position").notNull().default(0),
    expectedQty: integer("expected_qty").notNull(),
    unit: text("unit"),
    /** FACT. NULL = nothing recorded yet. */
    receivedQty: integer("received_qty"),
    receivedAt: timestamptz("received_at"),
    /** FACT (hired items): how many went back. NULL = nothing recorded yet. */
    returnedQty: integer("returned_qty"),
    returnedAt: timestamptz("returned_at"),
    /** Deposit paid for a hired item. NULL = none / unknown. Finance grant only. */
    depositMinor: moneyMinor("deposit_minor"),
    currency: currency(),
    /** FACT: when the deposit came back. */
    depositRecoveredAt: timestamptz("deposit_recovered_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("delivery_items_delivery_idx").on(t.deliveryId)],
);
