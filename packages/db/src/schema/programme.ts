import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { occasions } from "./occasions";
import { suppliers } from "./suppliers";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Entertainment programme, versioned cue lists and programme change notices (C-03, C-10).
//
// - A programme item is a moment of the occasion day. Its time is stored as WALL TIME relative
//   to the occasion day (`day_offset` days after the occasion's first day + `start_minute`
//   minutes after 00:00 in the occasion's zone), so moving the occasion's date moves the whole
//   programme with it and a party that runs past midnight is simply day_offset = 1.
// - The cue list of an item is versioned: every save inserts the next `programme_cue_versions`
//   row; older versions are never updated or deleted while the item exists.
// - `programme_state.revision` counts changes GUESTS can see. Each such change leaves one
//   `programme_changes` row that says who it concerns; households are told once per change.

export const PROGRAMME_KINDS = ["ceremony", "meal", "music", "dance", "speech", "moment", "other"] as const;
export type ProgrammeKind = (typeof PROGRAMME_KINDS)[number];
export const programmeKindSchema = z.enum(PROGRAMME_KINDS);

export const PROGRAMME_CHANGE_KINDS = ["added", "changed", "removed"] as const;
export type ProgrammeChangeKind = (typeof PROGRAMME_CHANGE_KINDS)[number];

/** One line of a cue list: when (minutes after the item starts), what, who. */
export type ProgrammeCue = { offsetMin: number; instruction: string; who: string | null };

export const programmeItems = pgTable(
  "programme_items",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").$type<ProgrammeKind>().notNull().default("moment"),
    /** Days after the occasion's first day (0 = the day itself, 1 = after midnight). */
    dayOffset: integer("day_offset").notNull().default(0),
    /** Minutes after 00:00, wall time in the occasion's zone (0–1439). */
    startMinute: integer("start_minute").notNull(),
    /** NULL = unknown / open-ended (never 0). */
    durationMin: integer("duration_min"),
    place: text("place"),
    visibleToGuests: boolean("visible_to_guests").notNull().default(false),
    /** true = every guest; false = only the households in `concerns_household_ids`. */
    concernsAll: boolean("concerns_all").notNull().default(true),
    concernsHouseholdIds: jsonb("concerns_household_ids").$type<string[]>().notNull().default([]),
    /** The performer: a supplier of this occasion. */
    supplierId: ref("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** Planner notes — never shown to guests. */
    notes: text("notes"),
    /** Latest cue-list version (0 = no cue list yet). */
    cueVersion: integer("cue_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("programme_items_occasion_idx").on(t.occasionId, t.dayOffset, t.startMinute)],
);

export const programmeCueVersions = pgTable(
  "programme_cue_versions",
  {
    id: id(),
    itemId: ref("item_id")
      .notNull()
      .references(() => programmeItems.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id").notNull(),
    version: integer("version").notNull(),
    cues: jsonb("cues").$type<ProgrammeCue[]>().notNull(),
    createdByAccountId: text("created_by_account_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("programme_cue_versions_item_version_uq").on(t.itemId, t.version), index("programme_cue_versions_occasion_idx").on(t.occasionId)],
);

export const programmeState = pgTable("programme_state", {
  occasionId: ref("occasion_id")
    .primaryKey()
    .references(() => occasions.id, { onDelete: "cascade" }),
  /** programmeRevision: bumped by every change guests can see. */
  revision: integer("revision").notNull().default(0),
  revisionAt: timestamptz("revision_at"),
  updatedAt: updatedAt(),
});

/** What a guest-visible change was, and whom it concerns (INF5: told once per change). */
export const programmeChanges = pgTable(
  "programme_changes",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    kind: text("kind").$type<ProgrammeChangeKind>().notNull(),
    /** Kept as text: the item may be gone by the time the notice is read. */
    itemId: text("item_id").notNull(),
    itemTitle: text("item_title").notNull(),
    concernsAll: boolean("concerns_all").notNull(),
    householdIds: jsonb("household_ids").$type<string[]>().notNull().default([]),
    /** Set when the email round for this change has run. */
    notifiedAt: timestamptz("notified_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("programme_changes_occasion_revision_uq").on(t.occasionId, t.revision)],
);
