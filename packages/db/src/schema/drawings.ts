import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";
import { businesses, listings } from "./business";

// Venue drawings (P-06, PRD V1–V11). Every real-world measure is an INTEGER NUMBER OF
// MILLIMETRES; a measure nobody stated is NULL (unknown), never 0. Positions are millimetres
// from the drawing's origin (its top-left corner), x to the right, y downwards.

export type PlanPoint = { x: number; y: number };

/** A usable floor area (V2): a closed outline; a rectangle is simply four points. */
export type FloorArea = { id: string; name: string | null; points: PlanPoint[] };

export const TABLE_SHAPES = ["round", "rect"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** One line of the venue's standard table inventory (V2). */
export type TableType = {
  id: string;
  name: string;
  shape: TableShape;
  /** round tables; null = unknown */
  diameterMm: number | null;
  /** rectangular tables; null = unknown */
  widthMm: number | null;
  lengthMm: number | null;
  /** places at the table; null = unknown */
  seats: number | null;
  /** how many the venue has; null = unknown */
  count: number | null;
};

export const FIXTURE_KINDS = ["dance", "candybar", "photobooth", "stage", "bar", "other"] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

/** A named fixture with real dimensions (V8): takes part in fit checks. x/y = its centre. */
export type VenueFixture = {
  id: string;
  kind: FixtureKind;
  name: string;
  x: number;
  y: number;
  widthMm: number | null;
  lengthMm: number | null;
  /** degrees, clockwise */
  rotation: number;
};

export const POI_KINDS = ["toilets", "cloakroom", "bar", "entrance", "exit", "photo", "stage", "other"] as const;
export type PoiKind = (typeof POI_KINDS)[number];

/** A point of interest (V8, V9): a place, not a thing with a size. */
export type VenuePoi = { id: string; kind: PoiKind; name: string | null; x: number; y: number };

/** A parking area drawn to scale with the number of places it holds (V11). */
export type ParkingArea = { id: string; name: string | null; points: PlanPoint[]; spaces: number | null };

export type SpaceMarkings = {
  areas: FloorArea[];
  tableTypes: TableType[];
  fixtures: VenueFixture[];
  pois: VenuePoi[];
  parkingAreas: ParkingArea[];
};

export const EMPTY_MARKINGS: SpaceMarkings = { areas: [], tableTypes: [], fixtures: [], pois: [], parkingAreas: [] };

/** V7: two points on the drawing (in image pixels) and the real distance between them. */
export type Calibration = { ax: number; ay: number; bx: number; by: number; distanceMm: number };

/** What one published version of a space says — frozen in drawing_versions.snapshot. */
export type DrawingSnapshot = {
  name: string;
  /** Stated by the business (V1); null = unknown. */
  widthMm: number | null;
  lengthMm: number | null;
  /** The file as uploaded (image or PDF). */
  drawingAssetId: string | null;
  /** The picture shown behind the plan: the image itself, or page 1 of the PDF as PNG. */
  displayAssetId: string | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
  calibration: Calibration | null;
  /** Derived from the calibration; null = not calibrated (no markings, no space model, no fit check). */
  mmPerPx: number | null;
  markings: SpaceMarkings;
};

export const SPACE_STATUSES = ["draft", "pending", "live", "retired"] as const;
export type SpaceStatus = (typeof SPACE_STATUSES)[number];

/**
 * A space of a venue listing with its drawing — the business's WORKING COPY. What planners and
 * the public see is the latest drawing_versions row (live_version_id), written only when a
 * moderator approves (V3).
 */
export const spaces = pgTable(
  "spaces",
  {
    id: id(),
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** draft = never approved; pending = first version waits; live = has an approved version; retired. */
    status: text("status").$type<SpaceStatus>().notNull().default("draft"),
    name: text("name").notNull(),
    widthMm: integer("width_mm"),
    lengthMm: integer("length_mm"),
    drawingAssetId: text("drawing_asset_id"),
    displayAssetId: text("display_asset_id"),
    pixelWidth: integer("pixel_width"),
    pixelHeight: integer("pixel_height"),
    calibration: jsonb("calibration").$type<Calibration>(),
    mmPerPx: doublePrecision("mm_per_px"),
    markings: jsonb("markings").$type<SpaceMarkings>().notNull().default(EMPTY_MARKINGS),
    /** true while the working copy differs from what was last submitted. */
    dirty: boolean("dirty").notNull().default(true),
    liveVersionId: text("live_version_id"),
    /** Optimistic concurrency for the editor (two people of the business editing at once). */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("spaces_listing_idx").on(t.listingId),
    index("spaces_business_idx").on(t.businessId),
    check("spaces_status_ck", sql`${t.status} in ('draft', 'pending', 'live', 'retired')`),
    check("spaces_dims_ck", sql`(${t.widthMm} is null or ${t.widthMm} > 0) and (${t.lengthMm} is null or ${t.lengthMm} > 0)`),
    // V7: no scale without both points and a distance; no markings without a scale (also enforced in core)
    check("spaces_calibration_ck", sql`(${t.mmPerPx} is null) = (${t.calibration} is null)`),
  ],
);

/**
 * One APPROVED version of a space's drawing (V3, V4). Immutable (sql/030): a planner's space
 * model points at exactly one of these and never changes under them.
 */
export const drawingVersions = pgTable(
  "drawing_versions",
  {
    id: id(),
    spaceId: ref("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    snapshot: jsonb("snapshot").$type<DrawingSnapshot>().notNull(),
    /** From when this version is the venue's stated truth (the moment it was approved). */
    effectiveAt: timestamptz("effective_at").notNull(),
    /** The moderation revision that produced it. */
    revisionId: text("revision_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("drawing_versions_space_no_uq").on(t.spaceId, t.versionNo), index("drawing_versions_listing_idx").on(t.listingId)],
);

/** yes / no / null = unknown — every parking fact is individually known or unknown (V10). */
export type ParkingFacts = {
  onSite: boolean | null;
  spaceCount: number | null;
  onStreet: boolean | null;
  paid: boolean | null;
  accessibleSpaces: boolean | null;
  walkingDistanceM: number | null;
  /**
   * V11: when the places drawn on the drawings do not add up to `spaceCount`, the business can
   * confirm the stated number. Holds the pair it confirmed; any change to either voids it.
   */
  countConfirmedFor: { stated: number; drawn: number } | null;
};

export const UNKNOWN_PARKING: ParkingFacts = {
  onSite: null,
  spaceCount: null,
  onStreet: null,
  paid: null,
  accessibleSpaces: null,
  walkingDistanceM: null,
  countConfirmedFor: null,
};

/** Parking facts of a venue listing (V10). `live` is written only by an approved revision. */
export const listingParking = pgTable("listing_parking", {
  listingId: ref("listing_id")
    .primaryKey()
    .references(() => listings.id, { onDelete: "cascade" }),
  businessId: ref("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  live: jsonb("live").$type<ParkingFacts>(),
  liveAt: timestamptz("live_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
