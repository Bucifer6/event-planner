import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { households } from "./guests";
import type { DietTag } from "./menus";
import { occasions } from "./occasions";
import { publicRegistrations } from "./publicpage";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Private dietary / access requests and the published accessible guest journey (C-07, D2, D5).
//
// `private_requests` is readable ONLY by members holding the `privateRequests` grant
// (@ed/core/requests). It is purged 30 days after the occasion's closeout (INF6).

export const PRIVATE_REQUEST_KINDS = ["dietary", "access", "other"] as const;
export type PrivateRequestKind = (typeof PRIVATE_REQUEST_KINDS)[number];
export const privateRequestKindSchema = z.enum(PRIVATE_REQUEST_KINDS);

export const PRIVATE_REQUEST_STATUSES = ["open", "handled"] as const;
export type PrivateRequestStatus = (typeof PRIVATE_REQUEST_STATUSES)[number];

export const privateRequests = pgTable(
  "private_requests",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** Exactly one of the two: who asked. */
    householdId: ref("household_id").references(() => households.id, { onDelete: "cascade" }),
    registrationId: ref("registration_id").references(() => publicRegistrations.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PrivateRequestKind>().notNull(),
    /** Optional tag from the fixed diet list — what makes anonymous counts possible. */
    dietTag: text("diet_tag").$type<DietTag>(),
    body: text("body"),
    status: text("status").$type<PrivateRequestStatus>().notNull().default("open"),
    /** The grant holder's own note. */
    note: text("note"),
    handledByAccountId: text("handled_by_account_id"),
    handledAt: timestamptz("handled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("private_requests_occasion_idx").on(t.occasionId, t.status), index("private_requests_household_idx").on(t.householdId)],
);

export const JOURNEY_FACTS = ["stepFree", "accessibleToilets", "parking", "quietRoom", "seatingHelp"] as const;
export type JourneyFactKey = (typeof JOURNEY_FACTS)[number];
export const JOURNEY_FACT_STATES = ["yes", "no", "unknown"] as const;
export type JourneyFactState = (typeof JOURNEY_FACT_STATES)[number];
/** A fact is known (yes / no) or unknown — unknown stays visible, it is never hidden or guessed. */
export type JourneyFact = { state: JourneyFactState; noteRo: string | null; noteEn: string | null };

export const guestJourneys = pgTable("guest_journeys", {
  occasionId: ref("occasion_id")
    .primaryKey()
    .references(() => occasions.id, { onDelete: "cascade" }),
  publishedAt: timestamptz("published_at"),
  facts: jsonb("facts").$type<Partial<Record<JourneyFactKey, JourneyFact>>>().notNull().default({}),
  contactName: text("contact_name"),
  /** Phone or email the planner chose to show to guests. */
  contactRoute: text("contact_route"),
  updatedAt: updatedAt(),
});
