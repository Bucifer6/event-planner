import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";
import { accounts } from "./accounts";
import { drawingVersions, spaces, type FixtureKind, type FloorArea, type TableShape } from "./drawings";
import { guests, households } from "./guests";
import { occasions } from "./occasions";

// The occasion's space model, the layout on it and who sits where (P-06 V4–V6, C-01, C-02,
// C-08). Measures are integer millimetres; unknown = NULL, never 0.

export const DOOR_KINDS = ["single", "double", "exit", "opening"] as const;
export type DoorKind = (typeof DOOR_KINDS)[number];
export const DOOR_SWINGS = ["in", "out", "sliding"] as const;
export type DoorSwing = (typeof DOOR_SWINGS)[number];

/**
 * A door in a drawn room, attached to one wall so it follows the wall when the room is
 * reshaped: wall `wall` of outline `areaId` runs from corner `wall` to corner `wall + 1`;
 * `offsetMm` is the distance from that first corner to the middle of the door.
 */
export type RoomDoor = { id: string; areaId: string; wall: number; offsetMm: number; widthMm: number; kind: DoorKind; swing: DoorSwing; hinge: "start" | "end" };
/** A pillar or post standing in the room; x/y = its centre. Tables must stand clear of it. */
export type Pillar = { id: string; shape: "round" | "square"; sizeMm: number; x: number; y: number };
export type RoomFeatures = { doors: RoomDoor[]; pillars: Pillar[] };

export const SPACE_MODEL_SOURCES = ["venue", "own"] as const;
export type SpaceModelSource = (typeof SPACE_MODEL_SOURCES)[number];

/**
 * ONE space model per occasion. source "venue": a frozen approved drawing version of a venue
 * space (version + effective date shown to the planner; it changes only when the planner
 * accepts a proposal, V4). source "own": a rectangle the planner typed in, or a room they drew.
 */
export const spaceModels = pgTable(
  "space_models",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    source: text("source").$type<SpaceModelSource>().notNull(),
    spaceId: ref("space_id").references(() => spaces.id, { onDelete: "set null" }),
    drawingVersionId: ref("drawing_version_id").references(() => drawingVersions.id, { onDelete: "set null" }),
    /** Copied from the version so it stays visible even if the venue later disappears. */
    versionNo: integer("version_no"),
    effectiveAt: timestamptz("effective_at"),
    /** Planner-entered space (source "own") — and the name shown for a venue space. */
    name: text("name").notNull(),
    ownWidthMm: integer("own_width_mm"),
    ownLengthMm: integer("own_length_mm"),
    /**
     * A room the planner drew with the drawing tool (source "own"): one or more floor outlines
     * in mm. NULL = not drawn, the typed rectangle is used.
     */
    ownAreas: jsonb("own_areas").$type<FloorArea[]>(),
    /** Doors and pillars of the drawn room (source "own"). NULL = none. */
    ownFeatures: jsonb("own_features").$type<RoomFeatures>(),
    /** Minimum free passage between tables, chairs included (C-01). */
    aisleMm: integer("aisle_mm").notNull().default(600),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("space_models_occasion_uq").on(t.occasionId),
    index("space_models_space_idx").on(t.spaceId),
    check("space_models_source_ck", sql`${t.source} in ('venue', 'own')`),
    check("space_models_aisle_ck", sql`${t.aisleMm} between 0 and 5000`),
  ],
);

export const PLAN_ITEM_KINDS = ["table", "fixture"] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];
export const PLAN_ITEM_SOURCES = ["venue", "custom"] as const;
/** venue = from the venue's stated inventory/fixtures; custom = added by the planner (V5: never shown as venue-supplied). */
export type PlanItemSource = (typeof PLAN_ITEM_SOURCES)[number];

/** A table or fixture placed on the occasion's plan. x/y = its centre in the model's millimetres. */
export const planItems = pgTable(
  "plan_items",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    spaceModelId: ref("space_model_id")
      .notNull()
      .references(() => spaceModels.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PlanItemKind>().notNull(),
    source: text("source").$type<PlanItemSource>().notNull(),
    /** Id of the venue table type / venue fixture inside the drawing snapshot (source "venue"). */
    venueRef: text("venue_ref"),
    /** "Masă rotundă 10", "Ring de dans"… */
    name: text("name").notNull(),
    /** What is written on the plan and on the guest's link: "1", "Masa mirilor". */
    label: text("label").notNull(),
    shape: text("shape").$type<TableShape>().notNull(),
    /** Fixtures: what it is (stage, dance floor, speaker…), so checks can tell a dance floor. NULL = not said. */
    fixtureKind: text("fixture_kind").$type<FixtureKind>(),
    diameterMm: integer("diameter_mm"),
    widthMm: integer("width_mm"),
    lengthMm: integer("length_mm"),
    /** Places at a table. NULL = unknown (fixtures: always NULL). */
    seats: integer("seats"),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    /** Degrees clockwise, 0–359. */
    rotation: integer("rotation").notNull().default(0),
    /** Last-write-per-item concurrency: every change bumps it; a stale writer gets CONFLICT. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("plan_items_occasion_idx").on(t.occasionId),
    index("plan_items_model_idx").on(t.spaceModelId),
    check("plan_items_kind_ck", sql`${t.kind} in ('table', 'fixture')`),
    check("plan_items_source_ck", sql`${t.source} in ('venue', 'custom')`),
    check("plan_items_shape_ck", sql`${t.shape} in ('round', 'rect', 'oval', 'halfmoon')`),
    check(
      "plan_items_dims_ck",
      sql`(${t.diameterMm} is null or ${t.diameterMm} > 0) and (${t.widthMm} is null or ${t.widthMm} > 0) and (${t.lengthMm} is null or ${t.lengthMm} > 0) and (${t.seats} is null or ${t.seats} >= 0)`,
    ),
  ],
);

export const SEAT_KINDS = ["guest", "extra", "children"] as const;
/**
 * guest = one named adult; extra = unnamed adults of a household (a count);
 * children = the household's children (a count only — never child persons, invariant 9).
 */
export type SeatKind = (typeof SEAT_KINDS)[number];

export const seatAssignments = pgTable(
  "seat_assignments",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    tableItemId: ref("table_item_id")
      .notNull()
      .references(() => planItems.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SeatKind>().notNull(),
    guestId: ref("guest_id").references(() => guests.id, { onDelete: "cascade" }),
    /** How many places this row takes: 1 for a named adult, the count for extra / children. */
    places: integer("places").notNull().default(1),
    /** Optional numbered seat (named adults only). */
    seatNo: integer("seat_no"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("seat_assignments_occasion_idx").on(t.occasionId),
    index("seat_assignments_table_idx").on(t.tableItemId),
    // a person (or a household's children / unnamed adults) sits at ONE table
    uniqueIndex("seat_assignments_guest_uq")
      .on(t.guestId)
      .where(sql`${t.guestId} is not null`),
    uniqueIndex("seat_assignments_group_uq")
      .on(t.householdId, t.kind)
      .where(sql`${t.kind} <> 'guest'`),
    uniqueIndex("seat_assignments_seat_uq")
      .on(t.tableItemId, t.seatNo)
      .where(sql`${t.seatNo} is not null`),
    check("seat_assignments_kind_ck", sql`${t.kind} in ('guest', 'extra', 'children')`),
    check("seat_assignments_guest_ck", sql`(${t.kind} = 'guest') = (${t.guestId} is not null)`),
    check("seat_assignments_places_ck", sql`${t.places} >= 1 and (${t.kind} <> 'guest' or ${t.places} = 1)`),
    check("seat_assignments_seat_ck", sql`${t.seatNo} is null or (${t.seatNo} >= 1 and ${t.kind} = 'guest')`),
  ],
);

/** A stage of the meal / evening with its own layout variant (C-02): "Primire", "Dans"… */
export const mealStages = pgTable(
  "meal_stages",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("meal_stages_occasion_idx").on(t.occasionId, t.position)],
);

/** How one item differs from the base layout during one stage: put away, or somewhere else. */
export const stageItemStates = pgTable(
  "stage_item_states",
  {
    stageId: ref("stage_id")
      .notNull()
      .references(() => mealStages.id, { onDelete: "cascade" }),
    itemId: ref("item_id")
      .notNull()
      .references(() => planItems.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** false = not deployed during this stage. */
    present: boolean("present").notNull().default(true),
    /** Alternative position for this stage; NULL = where the base layout has it. */
    x: integer("x"),
    y: integer("y"),
    rotation: integer("rotation"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.stageId, t.itemId] }), index("stage_item_states_occasion_idx").on(t.occasionId)],
);

/** C-08: guests see their table only once the plan is published. */
export const seatingPlans = pgTable("seating_plans", {
  occasionId: ref("occasion_id")
    .primaryKey()
    .references(() => occasions.id, { onDelete: "cascade" }),
  publishedAt: timestamptz("published_at"),
  publishedByAccountId: ref("published_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
