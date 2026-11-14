import type {
  Calibration,
  DrawingSnapshot,
  FloorArea,
  ParkingArea,
  PlanItemKind,
  PlanItemSource,
  PlanPoint,
  SpaceMarkings,
  TableShape,
  TableType,
  VenueFixture,
  VenuePoi,
} from "@ed/db";
import { z } from "zod";

// The SPACE MODEL — pure geometry, no database, no Node APIs: this file is imported by the
// browser (plan editor), the server and, later, the PDF print pack. (Only `import type` from
// @ed/db here, so nothing server-side is pulled into a client bundle.)
//
// Units: every real-world measure is an integer number of MILLIMETRES. Unknown = null, never 0.
// Origin: top-left of the drawing; x to the right, y downwards.
//
//   calibrationScale(cal)                 two points + real distance → mm per pixel (V7)
//   itemFootprint(item, pad?)             circle / convex polygon of a table or fixture
//   shapeGap(a, b)                        distance between two footprints (≤ 0 = they overlap)
//   insideAreas(shape, areas)             is the footprint inside the usable floor
//   snapPosition(model, item, at, opts)   10 cm grid + neighbour / wall alignment (Q8, Q10)
//   applyStage(model, states)             the layout variant of one meal stage (C-02)
//   buildPlanScene(model, opts)           the ONE drawing routine (React renderer + SVG string)
//   planToSvgString(model, opts)          server-safe SVG markup for PDFs

export type {
  Calibration,
  DrawingSnapshot,
  FloorArea,
  ParkingArea,
  PlanPoint,
  SpaceMarkings,
  TableShape,
  TableType,
  VenueFixture,
  VenuePoi,
} from "@ed/db";

export const FIXTURE_KIND_VALUES = ["dance", "candybar", "photobooth", "stage", "bar", "other"] as const;
export const POI_KIND_VALUES = ["toilets", "cloakroom", "bar", "entrance", "exit", "photo", "stage", "other"] as const;
export const TABLE_SHAPE_VALUES = ["round", "rect", "oval", "halfmoon"] as const;

/** Round and half-moon tables are sized by a diameter; rectangular and oval ones by two sides. */
export function shapeUsesDiameter(shape: TableShape): boolean {
  return shape === "round" || shape === "halfmoon";
}

/** A size is stated whole or not at all: keeps only the dimensions the shape uses. */
export function shapeDims(shape: TableShape, d: { diameterMm: number | null; widthMm: number | null; lengthMm: number | null }) {
  return shapeUsesDiameter(shape) ? { diameterMm: d.diameterMm, widthMm: null, lengthMm: null } : { diameterMm: null, widthMm: d.widthMm, lengthMm: d.lengthMm };
}

/* ── Ready-made tables ───────────────────────────────────────────────────────────────── */

export const TABLE_PRESET_GROUPS = ["round", "square", "rect", "oval", "halfmoon", "cocktail"] as const;
export type TablePresetGroup = (typeof TABLE_PRESET_GROUPS)[number];
export type TablePreset = {
  key: string;
  group: TablePresetGroup;
  shape: TableShape;
  diameterMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  /** Usual number of chairs; the planner can change it. Cocktail tables are for standing. */
  seats: number;
};

const round = (key: string, d: number, seats: number, group: TablePresetGroup = "round"): TablePreset => ({ key, group, shape: "round", diameterMm: d, widthMm: null, lengthMm: null, seats });
const sides = (key: string, group: TablePresetGroup, shape: TableShape, w: number, l: number, seats: number): TablePreset => ({ key, group, shape, diameterMm: null, widthMm: w, lengthMm: l, seats });
const half = (key: string, d: number, seats: number): TablePreset => ({ key, group: "halfmoon", shape: "halfmoon", diameterMm: d, widthMm: null, lengthMm: null, seats });

/** Common hire sizes (Romanian event-hire catalogues and UK/EU banqueting standards). */
export const TABLE_PRESETS: readonly TablePreset[] = [
  round("round-90", 900, 4),
  round("round-120", 1200, 6),
  round("round-150", 1500, 8),
  round("round-160", 1600, 10),
  round("round-180", 1800, 10),
  round("round-200", 2000, 12),
  sides("square-80", "square", "rect", 800, 800, 4),
  sides("square-90", "square", "rect", 900, 900, 4),
  sides("square-120", "square", "rect", 1200, 1200, 8),
  sides("rect-120", "rect", "rect", 1200, 800, 4),
  sides("rect-160", "rect", "rect", 1600, 800, 6),
  sides("rect-180", "rect", "rect", 1800, 800, 6),
  sides("rect-200", "rect", "rect", 2000, 900, 8),
  sides("rect-240", "rect", "rect", 2400, 1000, 10),
  sides("rect-300", "rect", "rect", 3000, 1000, 12),
  sides("oval-200", "oval", "oval", 2000, 1100, 8),
  sides("oval-240", "oval", "oval", 2400, 1200, 10),
  half("halfmoon-150", 1500, 4),
  half("halfmoon-180", 1800, 5),
  round("cocktail-60", 600, 0, "cocktail"),
  round("cocktail-80", 800, 0, "cocktail"),
];

/** Limits of one drawing / one plan (kept generous; they bound JSON size and render cost). */
export const SPACE_LIMITS = {
  areas: 20,
  areaPoints: 40,
  tableTypes: 30,
  fixtures: 40,
  pois: 60,
  parkingAreas: 20,
  /** 500 m — nothing on a venue drawing is further away than this. */
  maxCoordMm: 500_000,
  maxDimMm: 100_000,
  maxSeats: 60,
  maxCount: 2000,
  planItems: 400,
  stages: 20,
} as const;

/** Depth of the zone a seated guest and their chair occupy around a table. */
export const CHAIR_ZONE_MM = 450;
export const DEFAULT_AISLE_MM = 600;
export const GRID_MM = 100;

/* ── zod shapes shared by drawings / seating / what-if inputs ─────────────────────────── */

const coord = z.number("common.validation.invalid").int("common.validation.invalid").min(-SPACE_LIMITS.maxCoordMm).max(SPACE_LIMITS.maxCoordMm);
const dim = z.number("common.validation.invalid").int("common.validation.invalid").min(1, "common.validation.tooSmall").max(SPACE_LIMITS.maxDimMm, "common.validation.tooBig");
const shortId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
const label = (max: number) => z.string().trim().min(1, "common.validation.required").max(max, "common.validation.tooLong");
export const zPoint = z.object({ x: coord, y: coord });
export const zMm = dim;
export const zCoordMm = coord;
export const zRotation = z.number().int().min(-3600).max(3600).transform((d) => ((d % 360) + 360) % 360);

export const zFloorArea = z.object({ id: shortId, name: z.string().trim().max(80).nullable().default(null), points: z.array(zPoint).min(3).max(SPACE_LIMITS.areaPoints) });
export const zTableType = z.object({
  id: shortId,
  name: label(80),
  shape: z.enum(TABLE_SHAPE_VALUES),
  diameterMm: dim.nullable().default(null),
  widthMm: dim.nullable().default(null),
  lengthMm: dim.nullable().default(null),
  seats: z.number().int().min(0).max(SPACE_LIMITS.maxSeats).nullable().default(null),
  count: z.number().int().min(0).max(SPACE_LIMITS.maxCount).nullable().default(null),
});
export const zVenueFixture = z.object({
  id: shortId,
  kind: z.enum(FIXTURE_KIND_VALUES),
  name: label(80),
  x: coord,
  y: coord,
  widthMm: dim.nullable().default(null),
  lengthMm: dim.nullable().default(null),
  rotation: zRotation.default(0),
});
export const zVenuePoi = z.object({ id: shortId, kind: z.enum(POI_KIND_VALUES), name: z.string().trim().max(80).nullable().default(null), x: coord, y: coord });
export const zParkingArea = z.object({
  id: shortId,
  name: z.string().trim().max(80).nullable().default(null),
  points: z.array(zPoint).min(3).max(SPACE_LIMITS.areaPoints),
  spaces: z.number().int().min(0).max(100_000).nullable().default(null),
});
export const zSpaceMarkings = z.object({
  areas: z.array(zFloorArea).max(SPACE_LIMITS.areas).default([]),
  tableTypes: z.array(zTableType).max(SPACE_LIMITS.tableTypes).default([]),
  fixtures: z.array(zVenueFixture).max(SPACE_LIMITS.fixtures).default([]),
  pois: z.array(zVenuePoi).max(SPACE_LIMITS.pois).default([]),
  parkingAreas: z.array(zParkingArea).max(SPACE_LIMITS.parkingAreas).default([]),
});

export function markingsEmpty(m: SpaceMarkings): boolean {
  return m.areas.length + m.tableTypes.length + m.fixtures.length + m.pois.length + m.parkingAreas.length === 0;
}

/* ── Calibration (V7) ─────────────────────────────────────────────────────────────────── */

/** The two calibration points must be at least this many pixels apart to give a usable scale. */
export const MIN_CALIBRATION_PX = 20;

/** mm per pixel from two points and the real distance between them; null when unusable. */
export function calibrationScale(cal: Calibration): number | null {
  const px = Math.hypot(cal.bx - cal.ax, cal.by - cal.ay);
  if (!Number.isFinite(px) || px < MIN_CALIBRATION_PX) return null;
  if (!Number.isFinite(cal.distanceMm) || cal.distanceMm <= 0) return null;
  return cal.distanceMm / px;
}

export function pxToMm(p: PlanPoint, mmPerPx: number): PlanPoint {
  return { x: Math.round(p.x * mmPerPx), y: Math.round(p.y * mmPerPx) };
}
export function mmToPx(p: PlanPoint, mmPerPx: number): PlanPoint {
  return { x: p.x / mmPerPx, y: p.y / mmPerPx };
}

/* ── The model ────────────────────────────────────────────────────────────────────────── */

export type PlanItem = {
  id: string;
  kind: PlanItemKind;
  /** venue = stated by the venue; custom = added by the planner (drawn dashed, V5). */
  source: PlanItemSource;
  venueRef?: string | null;
  name: string;
  label: string;
  shape: TableShape;
  diameterMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  seats: number | null;
  x: number;
  y: number;
  rotation: number;
  version?: number;
  /** Places taken at this table (planner views only). */
  seated?: number;
};

export type PlanModel = {
  name: string;
  /** venue = an approved venue drawing; own = typed in by the planner; drawing = the business's own view. */
  source: "venue" | "own" | "drawing";
  versionNo: number | null;
  /** ISO instant */
  effectiveAt: string | null;
  /** Stated real dimensions of the space; null = unknown. */
  widthMm: number | null;
  lengthMm: number | null;
  /** Extent of the drawing picture in mm (calibrated drawings only). */
  backdrop: { widthMm: number; heightMm: number } | null;
  areas: FloorArea[];
  tableTypes: TableType[];
  items: PlanItem[];
  pois: VenuePoi[];
  parkingAreas: ParkingArea[];
  aisleMm: number;
};

/** The plan a drawing snapshot describes (no placed tables — venue fixtures sit where the venue drew them). */
export function modelFromSnapshot(
  snap: DrawingSnapshot,
  meta: { source?: PlanModel["source"]; versionNo?: number | null; effectiveAt?: Date | string | null; aisleMm?: number } = {},
): PlanModel {
  const calibrated = snap.mmPerPx !== null;
  // V7: an uncalibrated drawing carries no markings at all
  const m: SpaceMarkings = calibrated ? snap.markings : { areas: [], tableTypes: snap.markings.tableTypes, fixtures: [], pois: [], parkingAreas: [] };
  return {
    name: snap.name,
    source: meta.source ?? "venue",
    versionNo: meta.versionNo ?? null,
    effectiveAt: meta.effectiveAt ? new Date(meta.effectiveAt).toISOString() : null,
    widthMm: snap.widthMm,
    lengthMm: snap.lengthMm,
    backdrop:
      calibrated && snap.pixelWidth && snap.pixelHeight
        ? { widthMm: Math.round(snap.pixelWidth * snap.mmPerPx!), heightMm: Math.round(snap.pixelHeight * snap.mmPerPx!) }
        : null,
    areas: m.areas,
    tableTypes: m.tableTypes,
    items: m.fixtures.map(fixtureToItem),
    pois: m.pois,
    parkingAreas: m.parkingAreas,
    aisleMm: meta.aisleMm ?? DEFAULT_AISLE_MM,
  };
}

export function fixtureToItem(f: VenueFixture): PlanItem {
  return {
    id: f.id,
    kind: "fixture",
    source: "venue",
    venueRef: f.id,
    name: f.name,
    label: f.name,
    shape: "rect",
    diameterMm: null,
    widthMm: f.widthMm,
    lengthMm: f.lengthMm,
    seats: null,
    x: f.x,
    y: f.y,
    rotation: f.rotation,
  };
}

/** A space the planner typed in: a rectangle when both sides are known, nothing to draw otherwise. */
export function ownSpaceAreas(widthMm: number | null, lengthMm: number | null): FloorArea[] {
  if (!widthMm || !lengthMm) return [];
  return [
    {
      id: "own",
      name: null,
      points: [
        { x: 0, y: 0 },
        { x: widthMm, y: 0 },
        { x: widthMm, y: lengthMm },
        { x: 0, y: lengthMm },
      ],
    },
  ];
}

/** V6: an item whose size nobody stated has no footprint — it is shown as unknown and excluded. */
export function itemHasDims(item: Pick<PlanItem, "shape" | "diameterMm" | "widthMm" | "lengthMm">): boolean {
  return shapeUsesDiameter(item.shape) ? item.diameterMm !== null && item.diameterMm > 0 : item.widthMm !== null && item.lengthMm !== null && item.widthMm > 0 && item.lengthMm > 0;
}

/* ── Geometry ─────────────────────────────────────────────────────────────────────────── */

export type Footprint = { type: "circle"; cx: number; cy: number; r: number } | { type: "poly"; points: PlanPoint[] };

function rectCorners(cx: number, cy: number, w: number, l: number, deg: number): PlanPoint[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = w / 2;
  const hl = l / 2;
  return [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ].map(([dx, dy]) => ({ x: cx + dx! * cos - dy! * sin, y: cy + dx! * sin + dy! * cos }));
}

const CURVE_STEPS = 32;

/**
 * The outline of an oval or half-moon table around its centre, before rotation (convex, so
 * the gap maths below stays exact). A half-moon is `diameter` wide and half as deep: its flat
 * side faces up (−y) and the curve faces down, where its chairs are.
 */
function curvedOutline(shape: "oval" | "halfmoon", d: { diameterMm: number | null; widthMm: number | null; lengthMm: number | null }, pad: number): PlanPoint[] {
  const out: PlanPoint[] = [];
  if (shape === "oval") {
    const rx = d.widthMm! / 2 + pad;
    const ry = d.lengthMm! / 2 + pad;
    for (let i = 0; i < CURVE_STEPS; i++) {
      const a = (i / CURVE_STEPS) * 2 * Math.PI;
      out.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
    }
    return out;
  }
  const r = d.diameterMm! / 2;
  const flat = -r / 2; // the straight side, a quarter of the diameter above the centre
  for (let i = 0; i <= CURVE_STEPS / 2; i++) {
    const a = (i / (CURVE_STEPS / 2)) * Math.PI;
    out.push({ x: (r + pad) * Math.cos(a), y: flat + (r + pad) * Math.sin(a) });
  }
  out.push({ x: -(r + pad), y: flat - pad }, { x: r + pad, y: flat - pad });
  return out;
}

function placeLocal(points: PlanPoint[], cx: number, cy: number, deg: number): PlanPoint[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return points.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

/** The floor an item covers, optionally grown by `pad` mm on every side (chairs). null = unknown size. */
export function itemFootprint(item: Pick<PlanItem, "shape" | "diameterMm" | "widthMm" | "lengthMm" | "x" | "y" | "rotation">, pad = 0): Footprint | null {
  if (!itemHasDims(item)) return null;
  if (item.shape === "round") return { type: "circle", cx: item.x, cy: item.y, r: item.diameterMm! / 2 + pad };
  if (item.shape === "oval" || item.shape === "halfmoon") return { type: "poly", points: placeLocal(curvedOutline(item.shape, item, pad), item.x, item.y, item.rotation) };
  return { type: "poly", points: rectCorners(item.x, item.y, item.widthMm! + 2 * pad, item.lengthMm! + 2 * pad, item.rotation) };
}

export function polygonArea(points: PlanPoint[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function footprintArea(f: Footprint): number {
  return f.type === "circle" ? Math.PI * f.r * f.r : polygonArea(f.points);
}

/** Ray casting; a point exactly on the outline counts as inside (tables may touch a wall). */
export function pointInPolygon(p: PlanPoint, poly: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (pointSegmentDistance(p, a, b) < 0.5) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pointSegmentDistance(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Convex polygons (table and fixture footprints): separating axes; touching counts as a gap of 0. */
function polyPolyGap(a: PlanPoint[], b: PlanPoint[]): number {
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len === 0) continue;
      const nx = -(q.y - p.y) / len;
      const ny = (q.x - p.x) / len;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const d = v.x * nx + v.y * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = v.x * nx + v.y * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      depth = Math.min(depth, Math.min(maxA, maxB) - Math.max(minA, minB));
    }
  }
  if (depth > 1e-6) return -depth; // they share floor: how deep
  let min = Infinity;
  for (const p of a) for (let j = 0; j < b.length; j++) min = Math.min(min, pointSegmentDistance(p, b[j]!, b[(j + 1) % b.length]!));
  for (const p of b) for (let j = 0; j < a.length; j++) min = Math.min(min, pointSegmentDistance(p, a[j]!, a[(j + 1) % a.length]!));
  return min;
}

function circlePolyGap(c: { cx: number; cy: number; r: number }, poly: PlanPoint[]): number {
  const centre = { x: c.cx, y: c.cy };
  let min = Infinity;
  for (let j = 0; j < poly.length; j++) min = Math.min(min, pointSegmentDistance(centre, poly[j]!, poly[(j + 1) % poly.length]!));
  if (pointInPolygonStrict(centre, poly)) return -(min + c.r);
  return min - c.r;
}

function pointInPolygonStrict(p: PlanPoint, poly: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The free distance between two footprints in mm. Zero or negative means they touch or
 * overlap. Exact for circle–circle, circle–polygon and polygon–polygon (any rotation).
 */
export function shapeGap(a: Footprint, b: Footprint): number {
  if (a.type === "circle" && b.type === "circle") return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r;
  if (a.type === "circle" && b.type === "poly") return circlePolyGap(a, b.points);
  if (a.type === "poly" && b.type === "circle") return circlePolyGap(b, a.points);
  return polyPolyGap((a as { points: PlanPoint[] }).points, (b as { points: PlanPoint[] }).points);
}

function footprintSamples(f: Footprint): PlanPoint[] {
  if (f.type === "circle") {
    const out: PlanPoint[] = [{ x: f.cx, y: f.cy }];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      out.push({ x: f.cx + f.r * Math.cos(a), y: f.cy + f.r * Math.sin(a) });
    }
    return out;
  }
  const out: PlanPoint[] = [];
  for (let i = 0; i < f.points.length; i++) {
    const p = f.points[i]!;
    const q = f.points[(i + 1) % f.points.length]!;
    out.push(p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  }
  out.push({ x: f.points.reduce((s, p) => s + p.x, 0) / f.points.length, y: f.points.reduce((s, p) => s + p.y, 0) / f.points.length });
  return out;
}

/**
 * Whether a footprint lies on usable floor: every sampled point of its outline (corners, edge
 * midpoints, centre; 16 points of a circle) is inside at least one floor area, so an item may
 * straddle two areas that touch. 1 mm tolerance.
 */
export function insideAreas(f: Footprint, areas: FloorArea[]): boolean {
  if (areas.length === 0) return false;
  return footprintSamples(f).every((p) => areas.some((a) => pointInPolygon(p, a.points)));
}

/* ── Drawn rooms ──────────────────────────────────────────────────────────────────────── */

/** The smallest floor outline worth keeping: half a square metre. */
export const MIN_ROOM_AREA_MM2 = 500_000;

function cross(o: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Whether two segments cross or overlap anywhere other than at a shared end. */
export function segmentsCross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // collinear overlap (walls drawn back over themselves)
  const on = (p: PlanPoint, q: PlanPoint, r: PlanPoint) => cross(p, q, r) === 0 && Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  const same = (p: PlanPoint, q: PlanPoint) => p.x === q.x && p.y === q.y;
  const touches = (p: PlanPoint) => same(p, a) || same(p, b);
  return (on(a, b, c) && !touches(c)) || (on(a, b, d) && !touches(d)) || (on(c, d, a) && !same(a, c) && !same(a, d)) || (on(c, d, b) && !same(b, c) && !same(b, d));
}

/** Whether any two walls of the outline cross (a figure-of-eight is not a room). */
export function polygonSelfIntersects(points: PlanPoint[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    if (a.x === b.x && a.y === b.y) return true; // a wall of no length
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue; // neighbours share a corner
      if (segmentsCross(a, b, points[j]!, points[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

export type RoomProblem = { index: number; problem: "crossing" | "tooSmall" };

/** What is wrong with a drawn room, outline by outline; empty = fine to save. */
export function roomDrawingProblems(areas: FloorArea[]): RoomProblem[] {
  const out: RoomProblem[] = [];
  areas.forEach((a, index) => {
    if (polygonSelfIntersects(a.points)) out.push({ index, problem: "crossing" });
    else if (polygonArea(a.points) < MIN_ROOM_AREA_MM2) out.push({ index, problem: "tooSmall" });
  });
  return out;
}

/** The length of each wall of an outline (wall i runs from corner i to corner i + 1). */
export function wallLengths(points: PlanPoint[]): number[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
}

/** Changing one wall's length moves its far corner and the next one with it, so the following wall keeps its direction and length. */
export function setWallLength(points: PlanPoint[], wall: number, lengthMm: number): PlanPoint[] {
  const n = points.length;
  const a = points[wall]!;
  const b = points[(wall + 1) % n]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return points;
  const k = (lengthMm - len) / len;
  const dx = Math.round((b.x - a.x) * k);
  const dy = Math.round((b.y - a.y) * k);
  const move = new Set([(wall + 1) % n]);
  if (n > 3) move.add((wall + 2) % n);
  return points.map((p, i) => (move.has(i) ? { x: p.x + dx, y: p.y + dy } : p));
}

/**
 * The nearest place to `near` where a new item stands on the floor with its chairs and an aisle
 * clear of everything already placed (searched outwards on a 50 cm grid, up to 40 m away).
 * null = no such place, or the item's size is unknown.
 */
export function findFreeSpot(model: PlanModel, item: Pick<PlanItem, "shape" | "diameterMm" | "widthMm" | "lengthMm" | "rotation" | "seats" | "kind">, near: PlanPoint, others: PlanItem[] = model.items): PlanPoint | null {
  if (!itemHasDims(item)) return null;
  // the same zones as the fit check: every table keeps room for people around it
  const pad = item.kind === "table" ? CHAIR_ZONE_MM : 0;
  const placed = others
    .map((o) => itemFootprint(o, o.kind === "table" ? CHAIR_ZONE_MM : 0))
    .filter((f): f is Footprint => f !== null);
  const step = 500;
  const cx = Math.round(near.x / 100) * 100;
  const cy = Math.round(near.y / 100) * 100;
  for (let ring = 0; ring <= 80; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of ring === 0 ? [[0, 0]] : [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        if (ring > 0 && Math.abs(dx!) !== ring && Math.abs(dy!) !== ring) continue;
        const at = { x: cx + dx! * step, y: cy + dy! * step };
        const f = itemFootprint({ ...item, ...at }, pad);
        if (!f) return null;
        if (model.areas.length > 0 && !insideAreas(f, model.areas)) continue;
        if (placed.every((o) => shapeGap(f, o) >= model.aisleMm)) return at;
      }
    }
  }
  return null;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Everything drawable, in mm. Falls back to a 10 × 10 m sheet for an empty model. */
export function modelBounds(model: PlanModel, opts: { withParking?: boolean; withBackdrop?: boolean } = {}): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  if (opts.withBackdrop !== false && model.backdrop) {
    add(0, 0);
    add(model.backdrop.widthMm, model.backdrop.heightMm);
  }
  for (const a of model.areas) for (const p of a.points) add(p.x, p.y);
  if (opts.withParking !== false) for (const a of model.parkingAreas) for (const p of a.points) add(p.x, p.y);
  for (const p of model.pois) add(p.x, p.y);
  for (const it of model.items) {
    const f = itemFootprint(it, it.kind === "table" ? CHAIR_ZONE_MM : 0);
    if (!f) {
      add(it.x - 600, it.y - 600);
      add(it.x + 600, it.y + 600);
    } else if (f.type === "circle") {
      add(f.cx - f.r, f.cy - f.r);
      add(f.cx + f.r, f.cy + f.r);
    } else for (const p of f.points) add(p.x, p.y);
  }
  if (!Number.isFinite(b.minX)) {
    return { minX: 0, minY: 0, maxX: model.widthMm ?? 10_000, maxY: model.lengthMm ?? 10_000 };
  }
  return b;
}

/* ── Snapping (Q8, Q10) ───────────────────────────────────────────────────────────────── */

export type SnapOptions = { gridMm?: number; toleranceMm?: number };
export type SnapResult = { x: number; y: number; snappedX: "grid" | "neighbour" | "wall"; snappedY: "grid" | "neighbour" | "wall" };

function halfExtents(item: PlanItem): { hx: number; hy: number } {
  const f = itemFootprint(item);
  if (!f) return { hx: 0, hy: 0 };
  if (f.type === "circle") return { hx: f.r, hy: f.r };
  const xs = f.points.map((p) => p.x);
  const ys = f.points.map((p) => p.y);
  return { hx: (Math.max(...xs) - Math.min(...xs)) / 2, hy: (Math.max(...ys) - Math.min(...ys)) / 2 };
}

/**
 * Where an item lands when dropped at `at`: first the 10 cm grid; then, within a generous
 * tolerance (default 20 cm), alignment with a neighbour's centre line or flush against a wall
 * of the floor area (chairs included for tables) takes precedence.
 */
export function snapPosition(model: PlanModel, item: PlanItem, at: PlanPoint, opts: SnapOptions = {}): SnapResult {
  const grid = opts.gridMm ?? GRID_MM;
  const tol = opts.toleranceMm ?? 200;
  const out: SnapResult = { x: Math.round(at.x / grid) * grid, y: Math.round(at.y / grid) * grid, snappedX: "grid", snappedY: "grid" };
  let bestX = tol;
  let bestY = tol;
  for (const other of model.items) {
    if (other.id === item.id) continue;
    const dx = Math.abs(other.x - at.x);
    const dy = Math.abs(other.y - at.y);
    if (dx < bestX) {
      bestX = dx;
      out.x = other.x;
      out.snappedX = "neighbour";
    }
    if (dy < bestY) {
      bestY = dy;
      out.y = other.y;
      out.snappedY = "neighbour";
    }
  }
  const { hx, hy } = halfExtents({ ...item, x: at.x, y: at.y });
  const pad = item.kind === "table" ? CHAIR_ZONE_MM : 0;
  if (hx > 0) {
    for (const a of model.areas) {
      const xs = a.points.map((p) => p.x);
      const ys = a.points.map((p) => p.y);
      for (const wall of [Math.min(...xs) + hx + pad, Math.max(...xs) - hx - pad]) {
        const d = Math.abs(wall - at.x);
        if (d < bestX) {
          bestX = d;
          out.x = Math.round(wall);
          out.snappedX = "wall";
        }
      }
      for (const wall of [Math.min(...ys) + hy + pad, Math.max(...ys) - hy - pad]) {
        const d = Math.abs(wall - at.y);
        if (d < bestY) {
          bestY = d;
          out.y = Math.round(wall);
          out.snappedY = "wall";
        }
      }
    }
  }
  return out;
}

/* ── Meal stages (C-02) ───────────────────────────────────────────────────────────────── */

export type StageItemState = { itemId: string; present: boolean; x: number | null; y: number | null; rotation: number | null };

/** The layout during one stage: items put away are gone, moved items sit at their stage position. */
export function applyStage(model: PlanModel, states: StageItemState[]): PlanModel {
  if (states.length === 0) return model;
  const by = new Map(states.map((s) => [s.itemId, s]));
  const items: PlanItem[] = [];
  for (const it of model.items) {
    const s = by.get(it.id);
    if (!s) items.push(it);
    else if (s.present) items.push({ ...it, x: s.x ?? it.x, y: s.y ?? it.y, rotation: s.rotation ?? it.rotation });
  }
  return { ...model, items };
}

/* ── The drawing routine ──────────────────────────────────────────────────────────────── */

/**
 * Role of a drawn element. The React renderer turns it into `data-kind` (venue, custom,
 * fixture, poi — styled by `.ed-plan` in @ed/ui) or `data-role`; planToSvgString paints it
 * with fixed print inks.
 */
export type SceneRole =
  | "grid"
  | "grid-major"
  | "area"
  | "area-label"
  | "parking"
  | "parking-label"
  | "venue"
  | "custom"
  | "fixture"
  | "fixture-custom"
  | "unknown"
  | "seat"
  | "seat-taken"
  | "label"
  | "sublabel"
  | "fixture-label"
  | "poi"
  | "poi-label"
  | "hit"
  | "scale"
  | "scale-label"
  | "title-box"
  | "title-name"
  | "title-meta"
  | "calibration"
  | "highlight";

export type SceneNode =
  | { t: "line"; role: SceneRole; x1: number; y1: number; x2: number; y2: number }
  | { t: "rect"; role: SceneRole; x: number; y: number; w: number; h: number; rotate?: number; cx?: number; cy?: number }
  | { t: "circle"; role: SceneRole; cx: number; cy: number; r: number }
  | { t: "polygon"; role: SceneRole; points: Array<[number, number]> }
  | { t: "text"; role: SceneRole; x: number; y: number; text: string; anchor: "start" | "middle" | "end" };

export type SceneItem = {
  id: string;
  kind: PlanItemKind;
  source: PlanItemSource;
  /** false = dimensions unknown (V6) */
  known: boolean;
  /** centre in scene px */
  cx: number;
  cy: number;
  nodes: SceneNode[];
};

export type PlanScene = {
  width: number;
  height: number;
  /** scene px per mm */
  scale: number;
  /** scene px of the model origin (0, 0) */
  originX: number;
  originY: number;
  /** where the drawing picture goes, when there is one */
  backdrop: { x: number; y: number; w: number; h: number } | null;
  under: SceneNode[];
  items: SceneItem[];
  /** numbered points of interest, in legend order */
  pois: Array<{ id: string; index: number; nodes: SceneNode[] }>;
  over: SceneNode[];
};

export type PlanSceneOptions = {
  /** Width the plan will be shown at, in CSS px (the scene's own unit). Default 360 — a phone. */
  width?: number;
  /** Title block lines, already translated and formatted: "SALA MARE", "v3 · 12.11.2026". */
  title?: { name: string; meta?: string | null } | null;
  /** Scale bar caption for n metres, e.g. (n) => `${n} m`. Default "n m". */
  scaleLabel?: (metres: number) => string;
  showTables?: boolean;
  showFixtures?: boolean;
  showPois?: boolean;
  showParking?: boolean;
  showSeats?: boolean;
  /** Draw "8/10" under the table label. */
  showCounts?: boolean;
  /** Only these item ids are drawn (guest view: the guest's own table). */
  onlyItemIds?: string[] | null;
  /** Fit the sheet to the floor areas and items rather than the whole drawing picture. */
  withBackdrop?: boolean;
  /** Outer margin in px. */
  margin?: number;
  /** false = no scale bar (an uncalibrated picture has no scale to show). */
  showScale?: boolean;
};

const SEAT_R_MM = 190;
const SEAT_OFFSET_MM = 260;

function niceScaleMetres(pxPerMm: number): number {
  for (const m of [1, 2, 5, 10, 20, 50, 100]) if (m * 1000 * pxPerMm >= 44) return m;
  return 200;
}

function seatPositions(item: PlanItem): PlanPoint[] {
  const n = item.seats ?? 0;
  if (n <= 0 || !itemHasDims(item)) return [];
  const out: PlanPoint[] = [];
  if (item.shape === "round") {
    const r = item.diameterMm! / 2 + SEAT_OFFSET_MM;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2 + (item.rotation * Math.PI) / 180;
      out.push({ x: item.x + r * Math.cos(a), y: item.y + r * Math.sin(a) });
    }
    return out;
  }
  if (item.shape === "oval") {
    // evenly round the ellipse (by angle — close enough for a plan)
    const local: PlanPoint[] = [];
    const rx = item.widthMm! / 2 + SEAT_OFFSET_MM;
    const ry = item.lengthMm! / 2 + SEAT_OFFSET_MM;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      local.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
    }
    return placeLocal(local, item.x, item.y, item.rotation);
  }
  if (item.shape === "halfmoon") {
    // along the curve only; the flat side stays free (against a wall or the top table)
    const r = item.diameterMm! / 2 + SEAT_OFFSET_MM;
    const flat = -item.diameterMm! / 4;
    const local: PlanPoint[] = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI;
      local.push({ x: r * Math.cos(a), y: flat + r * Math.sin(a) });
    }
    return placeLocal(local, item.x, item.y, item.rotation);
  }
  // rectangular: along the two long sides; an odd one out sits at an end
  const w = item.widthMm!;
  const l = item.lengthMm!;
  const longIsW = w >= l;
  const long = longIsW ? w : l;
  const short = longIsW ? l : w;
  const perSide = Math.floor(n / 2);
  const ends = n - perSide * 2;
  const local: Array<[number, number]> = [];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < perSide; i++) {
      const along = -long / 2 + ((i + 0.5) * long) / perSide;
      const across = (s === 0 ? -1 : 1) * (short / 2 + SEAT_OFFSET_MM);
      local.push(longIsW ? [along, across] : [across, along]);
    }
  }
  if (ends > 0) local.push(longIsW ? [long / 2 + SEAT_OFFSET_MM, 0] : [0, long / 2 + SEAT_OFFSET_MM]);
  const a = (item.rotation * Math.PI) / 180;
  for (const [dx, dy] of local) out.push({ x: item.x + dx * Math.cos(a) - dy * Math.sin(a), y: item.y + dx * Math.sin(a) + dy * Math.cos(a) });
  return out;
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/**
 * Lays the model out on a sheet `width` px wide. A pure function of its arguments: the
 * business page, the planner's editor, the guest view and the PDF all draw THIS scene.
 */
export function buildPlanScene(model: PlanModel, opts: PlanSceneOptions = {}): PlanScene {
  const width = Math.max(200, Math.round(opts.width ?? 360));
  const margin = opts.margin ?? 20;
  const footer = 46; // scale bar + title block band
  const b = modelBounds(model, { withParking: opts.showParking !== false, withBackdrop: opts.withBackdrop !== false });
  const spanX = b.maxX - b.minX >= 1 ? b.maxX - b.minX : 1000;
  const spanY = b.maxY - b.minY >= 1 ? b.maxY - b.minY : 1000;
  const scale = (width - 2 * margin) / spanX;
  const height = Math.round(spanY * scale + 2 * margin + footer);
  const originX = margin - b.minX * scale;
  const originY = margin - b.minY * scale;
  const X = (mm: number) => originX + mm * scale;
  const Y = (mm: number) => originY + mm * scale;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pts = (points: PlanPoint[]): Array<[number, number]> => points.map((p) => [r2(X(p.x)), r2(Y(p.y))]);

  const under: SceneNode[] = [];
  const over: SceneNode[] = [];

  // metric grid: a line every metre (every 5 m when a metre is under 8 px), heavier every 5th
  const stepM = scale * 1000 >= 8 ? 1 : 5;
  const stepMm = stepM * 1000;
  const gx0 = Math.floor(b.minX / stepMm) * stepMm;
  const gy0 = Math.floor(b.minY / stepMm) * stepMm;
  for (let gx = gx0, i = Math.round(gx0 / stepMm); gx <= b.maxX + 1; gx += stepMm, i++) {
    if (gx < b.minX - 1) continue;
    under.push({ t: "line", role: i % 5 === 0 ? "grid-major" : "grid", x1: r2(X(gx)), y1: r2(Y(b.minY)), x2: r2(X(gx)), y2: r2(Y(b.maxY)) });
  }
  for (let gy = gy0, i = Math.round(gy0 / stepMm); gy <= b.maxY + 1; gy += stepMm, i++) {
    if (gy < b.minY - 1) continue;
    under.push({ t: "line", role: i % 5 === 0 ? "grid-major" : "grid", x1: r2(X(b.minX)), y1: r2(Y(gy)), x2: r2(X(b.maxX)), y2: r2(Y(gy)) });
  }

  if (opts.showParking !== false) {
    for (const a of model.parkingAreas) {
      under.push({ t: "polygon", role: "parking", points: pts(a.points) });
      const cx = a.points.reduce((s, p) => s + p.x, 0) / a.points.length;
      const cy = a.points.reduce((s, p) => s + p.y, 0) / a.points.length;
      under.push({ t: "text", role: "parking-label", x: r2(X(cx)), y: r2(Y(cy) + 4), text: a.spaces === null ? "P" : `P · ${a.spaces}`, anchor: "middle" });
    }
  }
  for (const a of model.areas) {
    under.push({ t: "polygon", role: "area", points: pts(a.points) });
    if (a.name) {
      const minX = Math.min(...a.points.map((p) => p.x));
      const minY = Math.min(...a.points.map((p) => p.y));
      under.push({ t: "text", role: "area-label", x: r2(X(minX) + 6), y: r2(Y(minY) + 14), text: clip(a.name.toUpperCase(), 28), anchor: "start" });
    }
  }

  const only = opts.onlyItemIds ? new Set(opts.onlyItemIds) : null;
  const items: SceneItem[] = [];
  for (const it of model.items) {
    if (it.kind === "table" && opts.showTables === false && !only?.has(it.id)) continue;
    if (it.kind === "fixture" && opts.showFixtures === false) continue;
    if (only && it.kind === "table" && !only.has(it.id)) continue;
    const nodes: SceneNode[] = [];
    const cx = r2(X(it.x));
    const cy = r2(Y(it.y));
    const known = itemHasDims(it);
    const bodyRole: SceneRole = !known ? "unknown" : it.kind === "fixture" ? (it.source === "custom" ? "fixture-custom" : "fixture") : it.source === "custom" ? "custom" : "venue";
    let halfW = 14;
    let halfH = 14;
    if (!known) {
      nodes.push({ t: "circle", role: "unknown", cx, cy, r: 14 });
    } else if (it.shape === "round") {
      const r = (it.diameterMm! / 2) * scale;
      halfW = halfH = r;
      nodes.push({ t: "circle", role: bodyRole, cx, cy, r: r2(r) });
    } else if (it.shape === "oval" || it.shape === "halfmoon") {
      const outline = placeLocal(curvedOutline(it.shape, it, 0), it.x, it.y, it.rotation);
      halfW = ((Math.max(...outline.map((p) => p.x)) - Math.min(...outline.map((p) => p.x))) * scale) / 2;
      halfH = ((Math.max(...outline.map((p) => p.y)) - Math.min(...outline.map((p) => p.y))) * scale) / 2;
      nodes.push({ t: "polygon", role: bodyRole, points: pts(outline) });
    } else {
      const w = it.widthMm! * scale;
      const h = it.lengthMm! * scale;
      const a = (it.rotation * Math.PI) / 180;
      halfW = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
      halfH = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
      nodes.push({ t: "rect", role: bodyRole, x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h), rotate: it.rotation || undefined, cx, cy });
    }
    if (it.kind === "table" && known && opts.showSeats !== false && SEAT_R_MM * scale >= 1.6) {
      const seats = seatPositions(it);
      const taken = Math.min(it.seated ?? 0, seats.length);
      seats.forEach((p, i) => nodes.push({ t: "circle", role: i < taken ? "seat-taken" : "seat", cx: r2(X(p.x)), cy: r2(Y(p.y)), r: r2(SEAT_R_MM * scale) }));
    }
    if (it.kind === "table") {
      const counts = opts.showCounts && known && it.seats !== null && halfH >= 17;
      nodes.push({ t: "text", role: "label", x: cx, y: r2(cy + (counts ? -1 : 4)), text: known ? clip(it.label, Math.max(2, Math.floor((halfW * 2) / 6.5))) : "?", anchor: "middle" });
      if (counts) nodes.push({ t: "text", role: "sublabel", x: cx, y: r2(cy + 10), text: `${it.seated ?? 0}/${it.seats}`, anchor: "middle" });
    } else {
      const maxChars = Math.max(3, Math.floor((halfW * 2 - 6) / 6.2));
      nodes.push({ t: "text", role: "fixture-label", x: cx, y: r2(known ? cy + 3.5 : cy + 4), text: known ? clip(it.label.toUpperCase(), maxChars) : "?", anchor: "middle" });
    }
    // Q10: the touch target is at least 44 px even when the table is drawn smaller
    const hw = Math.max(22, halfW + 3);
    const hh = Math.max(22, halfH + 3);
    nodes.push({ t: "rect", role: "hit", x: r2(cx - hw), y: r2(cy - hh), w: r2(hw * 2), h: r2(hh * 2) });
    items.push({ id: it.id, kind: it.kind, source: it.source, known, cx, cy, nodes });
  }

  const pois: PlanScene["pois"] = [];
  if (opts.showPois !== false) {
    model.pois.forEach((p, i) => {
      const cx = r2(X(p.x));
      const cy = r2(Y(p.y));
      const d = 6.5;
      pois.push({
        id: p.id,
        index: i + 1,
        nodes: [
          { t: "polygon", role: "poi", points: [[cx, r2(cy - d)], [r2(cx + d), cy], [cx, r2(cy + d)], [r2(cx - d), cy]] },
          { t: "text", role: "poi-label", x: r2(cx + d + 3), y: r2(cy + 4), text: String(i + 1), anchor: "start" },
        ],
      });
    });
  }

  // scale bar, bottom left
  const metres = niceScaleMetres(scale);
  const barY = height - 18;
  const barX = margin;
  const barW = opts.showScale === false ? 0 : r2(metres * 1000 * scale);
  if (opts.showScale !== false) over.push({ t: "line", role: "scale", x1: barX, y1: barY, x2: r2(barX + barW), y2: barY });
  if (opts.showScale !== false) {
    over.push({ t: "line", role: "scale", x1: barX, y1: barY - 4, x2: barX, y2: barY + 4 });
    over.push({ t: "line", role: "scale", x1: r2(barX + barW), y1: barY - 4, x2: r2(barX + barW), y2: barY + 4 });
    if (barW >= 60) over.push({ t: "line", role: "scale", x1: r2(barX + barW / 2), y1: barY - 2.5, x2: r2(barX + barW / 2), y2: barY + 2.5 });
    over.push({ t: "text", role: "scale-label", x: r2(barX + barW + 6), y: barY + 3.5, text: (opts.scaleLabel ?? ((n) => `${n} m`))(metres), anchor: "start" });
  }

  // title block, bottom right: space name · version · effective date
  if (opts.title) {
    const room = width - margin - (barX + barW + 6 + 40) - 8;
    const maxChars = Math.max(6, Math.floor((room - 16) / 6.6));
    const name = clip(opts.title.name.toUpperCase(), maxChars);
    const meta = opts.title.meta ? clip(opts.title.meta, Math.floor(maxChars * 1.15)) : null;
    const boxW = Math.min(room, Math.max(name.length * 6.6, (meta?.length ?? 0) * 5.6) + 16);
    const boxH = meta ? 32 : 20;
    const bx = width - margin - boxW;
    const by = height - 8 - boxH;
    over.push({ t: "rect", role: "title-box", x: r2(bx), y: by, w: r2(boxW), h: boxH });
    over.push({ t: "text", role: "title-name", x: r2(bx + 8), y: by + 14, text: name, anchor: "start" });
    if (meta) over.push({ t: "text", role: "title-meta", x: r2(bx + 8), y: by + 26, text: meta, anchor: "start" });
  }

  const backdrop = model.backdrop && opts.withBackdrop !== false ? { x: r2(X(0)), y: r2(Y(0)), w: r2(model.backdrop.widthMm * scale), h: r2(model.backdrop.heightMm * scale) } : null;
  return { width, height, scale, originX, originY, backdrop, under, items, pois, over };
}

/* ── SVG markup (PDF, e-mail, anywhere without the app's stylesheet) ──────────────────── */

const INK = "#1c2233";
const INK2 = "#4a5165";
const LINE = "#dcd6c8";
const PAPER = "#fbf9f4";
const SUNKEN = "#efeadf";
const GILT = "#a8853b";

const PRINT_STYLE: Record<SceneRole, string> = {
  grid: `stroke="${LINE}" stroke-width="0.4" fill="none"`,
  "grid-major": `stroke="${LINE}" stroke-width="0.8" fill="none"`,
  area: `fill="${PAPER}" fill-opacity="0.82" stroke="${INK}" stroke-width="1.6"`,
  "area-label": `fill="${INK2}" font-size="8.5" letter-spacing="1.2" font-weight="600"`,
  parking: `fill="none" stroke="${INK2}" stroke-width="0.9" stroke-dasharray="2 3"`,
  "parking-label": `fill="${INK2}" font-size="10" font-weight="600" letter-spacing="0.6"`,
  venue: `fill="#ffffff" stroke="${INK}" stroke-width="1.3"`,
  custom: `fill="#ffffff" stroke="${INK}" stroke-width="1.3" stroke-dasharray="5 4"`,
  fixture: `fill="${SUNKEN}" stroke="${INK2}" stroke-width="1"`,
  "fixture-custom": `fill="${SUNKEN}" stroke="${INK2}" stroke-width="1" stroke-dasharray="5 4"`,
  unknown: `fill="none" stroke="${INK2}" stroke-width="1" stroke-dasharray="1.5 3"`,
  seat: `fill="${PAPER}" stroke="${INK2}" stroke-width="0.6"`,
  "seat-taken": `fill="${INK2}" stroke="${INK2}" stroke-width="0.6"`,
  label: `fill="${INK}" font-size="11" font-weight="600" letter-spacing="0.6"`,
  sublabel: `fill="${INK2}" font-size="8.5" font-weight="500"`,
  "fixture-label": `fill="${INK2}" font-size="8.5" font-weight="600" letter-spacing="1.1"`,
  poi: `fill="${GILT}" stroke="none"`,
  "poi-label": `fill="${INK}" font-size="10" font-weight="700"`,
  hit: "",
  scale: `stroke="${INK}" stroke-width="1" fill="none"`,
  "scale-label": `fill="${INK}" font-size="9.5" font-weight="600" letter-spacing="0.6"`,
  "title-box": `fill="${PAPER}" stroke="${INK}" stroke-width="0.8"`,
  "title-name": `fill="${INK}" font-size="9.5" font-weight="700" letter-spacing="1.3"`,
  "title-meta": `fill="${INK2}" font-size="8.5" font-weight="500" letter-spacing="0.3"`,
  calibration: `stroke="${GILT}" stroke-width="1.5" fill="none"`,
  highlight: `fill="none" stroke="${INK}" stroke-width="2.4"`,
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nodeToSvg(n: SceneNode): string {
  if (n.role === "hit") return "";
  const st = PRINT_STYLE[n.role];
  switch (n.t) {
    case "line":
      return `<line x1="${n.x1}" y1="${n.y1}" x2="${n.x2}" y2="${n.y2}" ${st}/>`;
    case "rect":
      return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"${n.rotate ? ` transform="rotate(${n.rotate} ${n.cx} ${n.cy})"` : ""} ${st}/>`;
    case "circle":
      return `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" ${st}/>`;
    case "polygon":
      return `<polygon points="${n.points.map((p) => p.join(",")).join(" ")}" ${st}/>`;
    case "text":
      return `<text x="${n.x}" y="${n.y}" text-anchor="${n.anchor}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" ${st}>${esc(n.text)}</text>`;
  }
}

export type PlanSvgOptions = PlanSceneOptions & {
  /** Item ids to ring (e.g. the guest's own table on a table card). */
  highlightIds?: string[];
  /** Accessible title of the image. */
  ariaLabel?: string;
};

/**
 * Self-contained SVG markup of the plan (inline inks, no stylesheet, no scripts, no external
 * references) — for the print pack. Same scene as the on-screen renderer.
 */
export function planToSvgString(model: PlanModel, opts: PlanSvgOptions = {}): string {
  const scene = buildPlanScene(model, { width: 720, ...opts });
  const hi = new Set(opts.highlightIds ?? []);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img"${opts.ariaLabel ? ` aria-label="${esc(opts.ariaLabel)}"` : ""}>`,
  );
  parts.push(`<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${PAPER}"/>`);
  for (const n of scene.under) parts.push(nodeToSvg(n));
  for (const it of scene.items) {
    parts.push("<g>");
    for (const n of it.nodes) parts.push(nodeToSvg(n));
    if (hi.has(it.id)) {
      const hit = it.nodes.find((n) => n.role === "hit");
      if (hit && hit.t === "rect") parts.push(`<circle cx="${it.cx}" cy="${it.cy}" r="${Math.round(Math.max(hit.w, hit.h) / 2 + 4)}" ${PRINT_STYLE.highlight}/>`);
    }
    parts.push("</g>");
  }
  for (const p of scene.pois) for (const n of p.nodes) parts.push(nodeToSvg(n));
  for (const n of scene.over) parts.push(nodeToSvg(n));
  parts.push("</svg>");
  return parts.filter(Boolean).join("");
}

/* ── Small helpers for words ──────────────────────────────────────────────────────────── */

/** 12000 → "12", 1850 → "1,85" (ro) / "1.85" (en): metres with up to two decimals. */
export function mmToMetresText(mm: number, locale: "ro" | "en" = "ro"): string {
  const s = (Math.round(mm / 10) / 100).toFixed(2).replace(/\.?0+$/, "");
  return locale === "ro" ? s.replace(".", ",") : s;
}

/** "1,8" / "1.8" / "180 cm" / "1800mm" → integer mm; null when empty; NaN when not a measure. */
export function parseMetres(text: string | null | undefined): number | null {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw) return null;
  const m = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?$/.exec(raw);
  if (!m) return NaN;
  const v = Number(m[1]!.replace(",", "."));
  const mm = m[2] === "mm" ? v : m[2] === "cm" ? v * 10 : v * 1000;
  return Math.round(mm);
}

/** Size of an item in words-free form: "⌀ 1,8 m" or "0,9 × 2 m"; null = unknown. */
export function itemSizeText(item: Pick<PlanItem, "shape" | "diameterMm" | "widthMm" | "lengthMm">, locale: "ro" | "en" = "ro"): string | null {
  if (!itemHasDims(item)) return null;
  return shapeUsesDiameter(item.shape) ? `⌀ ${mmToMetresText(item.diameterMm!, locale)} m` : `${mmToMetresText(item.widthMm!, locale)} × ${mmToMetresText(item.lengthMm!, locale)} m`;
}
