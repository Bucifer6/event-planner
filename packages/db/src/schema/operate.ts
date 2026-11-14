import { doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";
import { households } from "./guests";
import { occasions } from "./occasions";
import { taskCheckItems } from "./tasks";

// RELEASE E — rehearse and operate: arrivals (facts), the offline capture inbox, checklist
// item revisions (to tell an offline tick from a stale one) and sustainability goals.
// The rehearsal simulation has NO tables: it never persists anything (principle 3).

export const CHECK_IN_SOURCES = ["qr", "search", "offline"] as const;
export type CheckInSource = (typeof CHECK_IN_SOURCES)[number];

/**
 * An arrival is a FACT (principle 4): one row per household, recorded once. Counts, the time
 * and "un-check" (voided_at) change only together with a corrections row — the DB guard in
 * sql/040_operate_guards.sql refuses anything else.
 */
export const checkIns = pgTable(
  "check_ins",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    adultsArrived: integer("adults_arrived").notNull(),
    /** A count only — never names or ages of children. */
    childrenArrived: integer("children_arrived").notNull().default(0),
    arrivedAt: timestamptz("arrived_at").notNull(),
    source: text("source").$type<CheckInSource>().notNull().default("search"),
    byMemberId: text("by_member_id"),
    byAccountId: text("by_account_id"),
    /** Set by an "un-check" correction; the row stays. */
    voidedAt: timestamptz("voided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("check_ins_household_uq").on(t.householdId),
    // the guest-flow aggregates read (occasion, arrived_at) only
    index("check_ins_occasion_arrived_idx").on(t.occasionId, t.arrivedAt),
  ],
);

export const OFFLINE_KINDS = ["arrival", "tick"] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];
export const offlineKindSchema = z.enum(OFFLINE_KINDS);

/** pending → applied | merged (already there, nothing duplicated) | conflict (the person decides) | rejected | dropped */
export const OFFLINE_STATES = ["pending", "applied", "merged", "conflict", "rejected", "dropped"] as const;
export type OfflineState = (typeof OFFLINE_STATES)[number];

export type OfflineArrivalPayload = { householdId: string; adults?: number; children?: number };
export type OfflineTickPayload = { itemId: string; done: boolean; baseRevision: number };

/** E-03: what a device captured without network, received once per (occasion, clientKey) (Q4). */
export const offlineItems = pgTable(
  "offline_items",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    /** uuid made on the device. */
    clientKey: text("client_key").notNull(),
    kind: text("kind").$type<OfflineKind>().notNull(),
    payload: jsonb("payload").$type<OfflineArrivalPayload | OfflineTickPayload>().notNull(),
    capturedAt: timestamptz("captured_at").notNull(),
    state: text("state").$type<OfflineState>().notNull().default("pending"),
    /** already_arrived | changed_since_capture | item_removed | not_yours | … */
    resultCode: text("result_code"),
    resultDetail: jsonb("result_detail").$type<Record<string, unknown>>(),
    receivedAt: timestamptz("received_at").notNull(),
    resolvedAt: timestamptz("resolved_at"),
  },
  (t) => [
    uniqueIndex("offline_items_client_key_uq").on(t.occasionId, t.clientKey),
    index("offline_items_state_idx").on(t.occasionId, t.accountId, t.state),
  ],
);

/**
 * Bumped by a DB trigger on every insert / label or done change of a checklist item. A device
 * sends the revision it saw; a different revision at sync time = "changed since capture".
 */
export const checkItemRevisions = pgTable("check_item_revisions", {
  itemId: ref("item_id")
    .primaryKey()
    .references(() => taskCheckItems.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  changedAt: timestamptz("changed_at").notNull().defaultNow(),
});

export const SUSTAINABILITY_METRICS = ["food_waste_kg", "single_use_items", "local_suppliers_share", "shared_transport_share", "custom"] as const;
export type SustainabilityMetric = (typeof SUSTAINABILITY_METRICS)[number];
export const sustainabilityMetricSchema = z.enum(SUSTAINABILITY_METRICS);
export const SUSTAINABILITY_DIRECTIONS = ["at_most", "at_least"] as const;
export type SustainabilityDirection = (typeof SUSTAINABILITY_DIRECTIONS)[number];
/** sum = quantities add up over the event (kg, pieces); latest = the newest reading stands (shares). */
export const SUSTAINABILITY_AGGREGATES = ["sum", "latest"] as const;
export type SustainabilityAggregate = (typeof SUSTAINABILITY_AGGREGATES)[number];

export const sustainabilityGoals = pgTable(
  "sustainability_goals",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    metric: text("metric").$type<SustainabilityMetric>().notNull(),
    /** Name of a custom metric. */
    label: text("label"),
    /** NULL = no target yet: the goal can be measured but never "on track". */
    targetValue: doublePrecision("target_value"),
    unit: text("unit").notNull(),
    direction: text("direction").$type<SustainabilityDirection>().notNull().default("at_most"),
    aggregate: text("aggregate").$type<SustainabilityAggregate>().notNull().default("sum"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sustainability_goals_occasion_idx").on(t.occasionId)],
);

export const sustainabilityMeasurements = pgTable(
  "sustainability_measurements",
  {
    id: id(),
    goalId: ref("goal_id")
      .notNull()
      .references(() => sustainabilityGoals.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    /** NULL = looked, could not measure: unknown (never 0, never counted as meeting the goal). */
    value: doublePrecision("value"),
    note: text("note"),
    measuredAt: timestamptz("measured_at").notNull(),
    byMemberId: text("by_member_id"),
    createdAt: createdAt(),
  },
  (t) => [index("sustainability_measurements_goal_idx").on(t.goalId, t.measuredAt)],
);
