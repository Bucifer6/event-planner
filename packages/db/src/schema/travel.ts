import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, currency, id, moneyMinor, ref, timestamptz, updatedAt } from "./_helpers";
import { occasions } from "./occasions";
import { tasks } from "./tasks";

// RELEASE D — solo or group holiday: itinerary across time zones, subgroups and optional
// activities, packing lists (a flag on a task — the checklist itself is task_check_items),
// transport legs and room allocation. Every instant is stored in UTC (INF8); the IANA zone a
// time is SHOWN in is stored beside it.

export const ITINERARY_KINDS = ["flight", "train", "bus", "car", "ferry", "stay", "activity", "other"] as const;
export type ItineraryKind = (typeof ITINERARY_KINDS)[number];
export const itineraryKindSchema = z.enum(ITINERARY_KINDS);

export const subgroups = pgTable(
  "subgroups",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** occasion_members.id of the person leading the subgroup (never a synthetic id). */
    leadMemberId: ref("lead_member_id"),
    /** Used when the lead is not (yet) a member. */
    leadEmail: text("lead_email"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subgroups_occasion_idx").on(t.occasionId)],
);

/** "m:<occasionMemberId>" | "h:<householdId>" | "g:<guestId>" — one person or party of the trip. */
export const PERSON_KEY_RE = /^[mhg]:[a-z0-9_]{1,64}$/;

export const subgroupMembers = pgTable(
  "subgroup_members",
  {
    id: id(),
    subgroupId: ref("subgroup_id")
      .notNull()
      .references(() => subgroups.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    personKey: text("person_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("subgroup_members_person_uq").on(t.subgroupId, t.personKey),
    index("subgroup_members_occasion_person_idx").on(t.occasionId, t.personKey),
  ],
);

export const itineraryLegs = pgTable(
  "itinerary_legs",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ItineraryKind>().notNull().default("other"),
    title: text("title").notNull(),
    /** UTC instants. */
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at"),
    /** IANA zones the start / end are shown in (the trip zone of that end of the leg). */
    startTz: text("start_tz").notNull(),
    endTz: text("end_tz").notNull(),
    placeFrom: text("place_from"),
    placeTo: text("place_to"),
    /** Booking / confirmation code as printed on the booking. */
    reference: text("reference"),
    /** Stable key of an imported event (ICS UID or flight number + day): a re-import never duplicates. */
    importKey: text("import_key"),
    notes: text("notes"),
    /** NULL = the whole trip; set = only this subgroup (and managers) see it. */
    subgroupId: ref("subgroup_id").references(() => subgroups.id, { onDelete: "set null" }),
    createdByMemberId: ref("created_by_member_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("itinerary_legs_occasion_idx").on(t.occasionId, t.startsAt),
    index("itinerary_legs_reference_idx").on(t.occasionId, t.reference),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    subgroupId: ref("subgroup_id").references(() => subgroups.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    startsAt: timestamptz("starts_at"),
    endsAt: timestamptz("ends_at"),
    tz: text("tz").notNull().default("Europe/Bucharest"),
    place: text("place"),
    /** Cost per person. NULL = unknown (never 0). */
    costMinor: moneyMinor("cost_minor"),
    currency: currency(),
    /** NULL = no limit. */
    capacity: integer("capacity"),
    /** Places taken; changed only by the conditional UPDATE in @ed/core/subgroups. */
    taken: integer("taken").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("activities_occasion_idx").on(t.occasionId, t.startsAt)],
);

export const activityOptins = pgTable(
  "activity_optins",
  {
    id: id(),
    activityId: ref("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    personKey: text("person_key").notNull(),
    places: integer("places").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("activity_optins_person_uq").on(t.activityId, t.personKey)],
);

export const PACKING_SCOPES = ["occasion", "subgroup", "personal"] as const;
export type PackingScope = (typeof PACKING_SCOPES)[number];

/**
 * D-03: a packing list IS a task with check items. This row is only the flag that says so
 * (and whom the list is for) — there is no second checklist store.
 */
export const packingLists = pgTable(
  "packing_lists",
  {
    taskId: ref("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    scope: text("scope").$type<PackingScope>().notNull().default("occasion"),
    subgroupId: ref("subgroup_id").references(() => subgroups.id, { onDelete: "cascade" }),
    /** Personal lists: the occasion member the list belongs to. */
    memberId: ref("member_id"),
    createdAt: createdAt(),
  },
  (t) => [index("packing_lists_occasion_idx").on(t.occasionId)],
);

export const transportLegs = pgTable(
  "transport_legs",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** Vehicle / label: "Microbuz 1", "Mașina Anei". */
    label: text("label").notNull(),
    departsAt: timestamptz("departs_at"),
    arrivesAt: timestamptz("arrives_at"),
    tz: text("tz").notNull().default("Europe/Bucharest"),
    placeFrom: text("place_from"),
    placeTo: text("place_to"),
    /** NULL = unknown number of seats (claims are then not limited, and shown as unknown). */
    seats: integer("seats"),
    taken: integer("taken").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("transport_legs_occasion_idx").on(t.occasionId, t.departsAt)],
);

export const transportSeats = pgTable(
  "transport_seats",
  {
    id: id(),
    transportLegId: ref("transport_leg_id")
      .notNull()
      .references(() => transportLegs.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    personKey: text("person_key").notNull(),
    seats: integer("seats").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("transport_seats_person_uq").on(t.transportLegId, t.personKey)],
);

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Beds. */
    capacity: integer("capacity").notNull(),
    /** Beds taken; changed only by the conditional UPDATE in @ed/core/rooms. */
    occupants: integer("occupants").notNull().default(0),
    notes: text("notes"),
    /** Per night. NULL = unknown. */
    priceMinor: moneyMinor("price_minor"),
    currency: currency(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rooms_occasion_idx").on(t.occasionId)],
);

export const roomAssignments = pgTable(
  "room_assignments",
  {
    id: id(),
    roomId: ref("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    personKey: text("person_key").notNull(),
    places: integer("places").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    // one bed per person: a person sleeps in one room of the occasion
    uniqueIndex("room_assignments_person_uq").on(t.occasionId, t.personKey),
    index("room_assignments_room_idx").on(t.roomId),
  ],
);

/** D-05: a note the planner types beside a currency ("1 EUR ≈ 4,97 RON la casa de schimb"). Shown only — never used to convert. */
export const exchangeNotes = pgTable(
  "exchange_notes",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    note: text("note").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("exchange_notes_occasion_currency_uq").on(t.occasionId, t.currency)],
);

