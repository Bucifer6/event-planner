import { describe, expect, it } from "vitest";
import { checkFit } from "../src/fitcheck";
import {
  applyStage,
  buildPlanScene,
  calibrationScale,
  insideAreas,
  itemFootprint,
  mmToPx,
  modelFromSnapshot,
  ownSpaceAreas,
  parseMetres,
  planToSvgString,
  pxToMm,
  shapeGap,
  snapPosition,
  type DrawingSnapshot,
  type PlanItem,
  type PlanModel,
} from "../src/spacemodel";

// Pure geometry: calibration maths, collision / aisle detection, fit checks per stage,
// unknown dimensions (V6), the drawing routine.

const table = (id: string, over: Partial<PlanItem> = {}): PlanItem => ({
  id,
  kind: "table",
  source: "venue",
  venueRef: "t-round",
  name: "Masă rotundă",
  label: id,
  shape: "round",
  diameterMm: 1800,
  widthMm: null,
  lengthMm: null,
  seats: 10,
  x: 3000,
  y: 3000,
  rotation: 0,
  ...over,
});
const rect = (id: string, over: Partial<PlanItem> = {}): PlanItem => table(id, { shape: "rect", diameterMm: null, widthMm: 2000, lengthMm: 800, seats: 8, ...over });

const room = (items: PlanItem[], over: Partial<PlanModel> = {}): PlanModel => ({
  name: "Sala Mare",
  source: "own",
  versionNo: null,
  effectiveAt: null,
  widthMm: 20_000,
  lengthMm: 12_000,
  backdrop: null,
  areas: ownSpaceAreas(20_000, 12_000),
  tableTypes: [],
  items,
  pois: [],
  parkingAreas: [],
  aisleMm: 600,
  ...over,
});

describe("calibration (V7)", () => {
  it("two points and the real distance between them give the scale", () => {
    // 400 px apart horizontally = 8 m → 20 mm per pixel
    expect(calibrationScale({ ax: 100, ay: 50, bx: 500, by: 50, distanceMm: 8000 })).toBe(20);
    // a 3-4-5 diagonal: 500 px = 10 m
    expect(calibrationScale({ ax: 0, ay: 0, bx: 300, by: 400, distanceMm: 10_000 })).toBe(20);
  });

  it("refuses points too close together or a distance that is not positive", () => {
    expect(calibrationScale({ ax: 10, ay: 10, bx: 12, by: 10, distanceMm: 5000 })).toBeNull();
    expect(calibrationScale({ ax: 0, ay: 0, bx: 400, by: 0, distanceMm: 0 })).toBeNull();
  });

  it("markings convert between picture pixels and real millimetres", () => {
    const scale = calibrationScale({ ax: 0, ay: 0, bx: 250, by: 0, distanceMm: 5000 })!; // 20 mm/px
    expect(pxToMm({ x: 150, y: 75 }, scale)).toEqual({ x: 3000, y: 1500 });
    expect(mmToPx({ x: 3000, y: 1500 }, scale)).toEqual({ x: 150, y: 75 });
  });

  it("an uncalibrated snapshot yields a model without any positioned marking", () => {
    const snap: DrawingSnapshot = {
      name: "Terasă",
      widthMm: null,
      lengthMm: null,
      drawingAssetId: "a",
      displayAssetId: "a",
      pixelWidth: 800,
      pixelHeight: 600,
      calibration: null,
      mmPerPx: null,
      markings: {
        areas: [{ id: "a1", name: null, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
        tableTypes: [],
        fixtures: [{ id: "f1", kind: "stage", name: "Scenă", x: 0, y: 0, widthMm: 1, lengthMm: 1, rotation: 0 }],
        pois: [{ id: "p1", kind: "bar", name: null, x: 0, y: 0 }],
        parkingAreas: [],
      },
    };
    const model = modelFromSnapshot(snap);
    expect(model.areas).toEqual([]);
    expect(model.items).toEqual([]);
    expect(model.pois).toEqual([]);
    expect(model.backdrop).toBeNull();
  });
});

describe("collision and aisle geometry", () => {
  it("round – round: gap is centre distance minus both radii", () => {
    const a = itemFootprint(table("a", { x: 0, y: 0 }))!;
    const b = itemFootprint(table("b", { x: 3000, y: 0 }))!;
    expect(shapeGap(a, b)).toBeCloseTo(1200, 5);
    const c = itemFootprint(table("c", { x: 1500, y: 0 }))!;
    expect(shapeGap(a, c)).toBeLessThan(0); // overlapping
  });

  it("rect – rect, rotated: exact distance and overlap", () => {
    const a = itemFootprint(rect("a", { x: 0, y: 0 }))!; // spans x −1000…1000, y −400…400
    const b = itemFootprint(rect("b", { x: 3000, y: 0 }))!; // 1000 mm gap
    expect(shapeGap(a, b)).toBeCloseTo(1000, 5);
    // rotate b by 90°: now 800 wide, 2000 tall → its left edge at 2600
    const b90 = itemFootprint(rect("b", { x: 3000, y: 0, rotation: 90 }))!;
    expect(shapeGap(a, b90)).toBeCloseTo(1600, 3);
    // a 45° table whose corner pokes into a
    const poke = itemFootprint(rect("p", { x: 1500, y: 0, rotation: 45 }))!;
    expect(shapeGap(a, poke)).toBeLessThan(0);
    // one fully inside another
    const big = itemFootprint(rect("big", { x: 0, y: 0, widthMm: 6000, lengthMm: 6000 }))!;
    expect(shapeGap(big, a)).toBeLessThan(0);
  });

  it("round – rect: distance from the circle to the nearest edge or corner", () => {
    const r = itemFootprint(rect("r", { x: 0, y: 0 }))!;
    const c = itemFootprint(table("c", { x: 0, y: 2000 }))!; // centre 1600 above the edge, radius 900
    expect(shapeGap(c, r)).toBeCloseTo(700, 5);
    expect(shapeGap(r, c)).toBeCloseTo(700, 5);
    const corner = itemFootprint(table("k", { x: 1000 + 3000, y: 400 + 4000 }))!; // 5000 from the corner
    expect(shapeGap(corner, r)).toBeCloseTo(4100, 5);
    const inside = itemFootprint(table("i", { x: 0, y: 0, diameterMm: 200 }))!;
    expect(shapeGap(inside, r)).toBeLessThan(0);
  });

  it("insideAreas: touching the wall is inside, crossing it is not", () => {
    const areas = ownSpaceAreas(10_000, 8000);
    expect(insideAreas(itemFootprint(table("a", { x: 900, y: 900 }))!, areas)).toBe(true);
    expect(insideAreas(itemFootprint(table("a", { x: 800, y: 900 }))!, areas)).toBe(false);
    expect(insideAreas(itemFootprint(rect("r", { x: 9500, y: 4000 }))!, areas)).toBe(false);
    expect(insideAreas(itemFootprint(rect("r", { x: 5000, y: 4000, rotation: 30 }))!, areas)).toBe(true);
    expect(insideAreas(itemFootprint(table("a"))!, [])).toBe(false);
  });

  it("snaps to the 10 cm grid, to a neighbour's centre line and flush to a wall", () => {
    const model = room([table("n", { x: 5000, y: 5000 })]);
    const moving = table("m");
    expect(snapPosition(model, moving, { x: 8043, y: 9012 }, { toleranceMm: 50 })).toMatchObject({ x: 8000, y: 9000, snappedX: "grid", snappedY: "grid" });
    // within tolerance of the neighbour's y → aligned with it
    expect(snapPosition(model, moving, { x: 8043, y: 5130 })).toMatchObject({ y: 5000, snappedY: "neighbour" });
    // near the left wall: table radius 900 + chairs 450 from the wall
    expect(snapPosition(model, moving, { x: 1420, y: 9000 })).toMatchObject({ x: 1350, snappedX: "wall" });
  });
});

describe("fit checks (C-02, V6, principle 5)", () => {
  it("fits: enough places, nothing overlapping, aisles kept", () => {
    const res = checkFit(room([table("1", { x: 3000, y: 3000 }), table("2", { x: 7000, y: 3000 })]), { needed: 18 });
    expect(res.status).toBe("fits");
    expect(res.seats).toEqual({ available: 20, needed: 18, missing: 0 });
    expect(res.issues).toEqual([]);
    expect(res.area.usableMm2).toBe(240_000_000);
    expect(res.area.usedMm2).toBeGreaterThan(0);
  });

  it("does not fit: says how many places are missing", () => {
    const res = checkFit(room([table("1"), table("2", { x: 7000 })]), { needed: 32 });
    expect(res.status).toBe("no");
    expect(res.seats.missing).toBe(12);
  });

  it("overlap, too close (aisle incl. chairs), outside the floor — each named", () => {
    const overlap = checkFit(room([table("1", { x: 3000 }), table("2", { x: 4000 })]), { needed: 0 });
    expect(overlap.status).toBe("no");
    expect(overlap.issues).toEqual([{ type: "overlap", itemIds: ["1", "2"], labels: ["1", "2"] }]);
    expect(overlap.conflictIds.sort()).toEqual(["1", "2"]);

    // edges 1.2 m apart; chairs take 2 × 45 cm → 30 cm passage < 60 cm aisle
    const close = checkFit(room([table("1", { x: 3000 }), table("2", { x: 6000 })]), { needed: 0 });
    expect(close.issues).toEqual([{ type: "tooClose", itemIds: ["1", "2"], labels: ["1", "2"], value: 300 }]);
    // with a 30 cm aisle the same layout passes
    expect(checkFit(room([table("1", { x: 3000 }), table("2", { x: 6000 })], { aisleMm: 300 }), { needed: 0 }).status).toBe("fits");

    const outside = checkFit(room([table("1", { x: 500, y: 3000 })]), { needed: 0 });
    expect(outside.issues).toEqual([{ type: "outside", itemIds: ["1"], labels: ["1"] }]);
  });

  it("a table's chairs must not run into a fixture; fixtures may touch each other", () => {
    const stage: PlanItem = { ...rect("scena", { kind: "fixture", seats: null, widthMm: 4000, lengthMm: 2000, x: 10_000, y: 1000 }), name: "Scenă" };
    const bar: PlanItem = { ...stage, id: "bar", label: "bar", x: 14_000 };
    expect(checkFit(room([stage, bar]), { needed: 0 }).issues).toEqual([]);
    // table edge 30 cm from the stage: closer than the chair zone
    const res = checkFit(room([stage, table("1", { x: 10_000, y: 2000 + 300 + 900 })]), { needed: 0 });
    expect(res.issues.map((i) => i.type)).toEqual(["tooClose"]);
  });

  it("V6: an item without dimensions is excluded, listed by name, and the answer is never 'fits'", () => {
    const unknown = table("7", { source: "custom", venueRef: null, name: "Masă de la bunici", diameterMm: null, seats: 12 });
    const res = checkFit(room([table("1"), table("2", { x: 7000 }), unknown]), { needed: 15 });
    expect(res.excluded).toEqual([{ id: "7", label: "7", name: "Masă de la bunici", kind: "table" }]);
    // its 12 places are NOT counted
    expect(res.seats.available).toBe(20);
    expect(res.status).toBe("unknown");
    expect(res.unknown).toContain("excludedItems");

    // short of places among known tables, but an unknown table might cover it → unknown, not "fits", not a definite "no"
    const short = checkFit(room([table("1"), unknown]), { needed: 18 });
    expect(short.seats.missing).toBe(8);
    expect(short.status).toBe("unknown");

    // a definite problem among known items stays a definite "no"
    const clash = checkFit(room([table("1", { x: 3000 }), table("2", { x: 3500 }), unknown]), { needed: 5 });
    expect(clash.status).toBe("no");
    // the unknown item never takes part in a collision, wherever it is
    expect(clash.conflictIds).not.toContain("7");
  });

  it("a space without usable floor is unknown, never fitting", () => {
    const res = checkFit(room([table("1")], { areas: [], widthMm: null, lengthMm: null }), { needed: 4 });
    expect(res.area.usableMm2).toBeNull();
    expect(res.status).toBe("unknown");
    expect(res.unknown).toContain("noFloorArea");
  });

  it("more venue tables of a type than the venue states it has is flagged", () => {
    const type = { id: "t-round", name: "Rotundă 10", shape: "round" as const, diameterMm: 1800, widthMm: null, lengthMm: null, seats: 10, count: 1 };
    const res = checkFit(room([table("1", { x: 3000 }), table("2", { x: 9000 })], { tableTypes: [type] }), { needed: 0 });
    expect(res.issues).toEqual([{ type: "overInventory", itemIds: ["2"], labels: ["Rotundă 10"], value: 1 }]);
  });

  it("per meal stage: tables put away between courses change the answer (fits → missing places)", () => {
    const model = room([table("1", { x: 3000 }), table("2", { x: 7000 }), table("3", { x: 11_000 }), rect("ring", { kind: "fixture", seats: null, name: "Ring de dans", widthMm: 5000, lengthMm: 4000, x: 16_000, y: 8000 })]);
    expect(checkFit(model, { needed: 28 }).status).toBe("fits");
    // "Dans": table 3 is cleared away, the dance floor moves to the middle
    const dance = applyStage(model, [
      { itemId: "3", present: false, x: null, y: null, rotation: null },
      { itemId: "ring", present: true, x: 11_000, y: 8000, rotation: null },
    ]);
    expect(dance.items.map((i) => i.id)).toEqual(["1", "2", "ring"]);
    expect(dance.items.find((i) => i.id === "ring")).toMatchObject({ x: 11_000, y: 8000 });
    const res = checkFit(dance, { needed: 28 });
    expect(res.status).toBe("no");
    expect(res.seats.missing).toBe(8);
    // a stage where the dance floor is dropped onto a table → overlap, in that stage only
    const clash = applyStage(model, [{ itemId: "ring", present: true, x: 3000, y: 3000, rotation: null }]);
    expect(checkFit(clash, { needed: 28 }).issues.some((i) => i.type === "overlap")).toBe(true);
    expect(checkFit(model, { needed: 28 }).issues).toEqual([]);
  });
});

describe("the drawing routine", () => {
  const model = room([table("1"), table("2", { x: 7000, source: "custom", venueRef: null }), table("9", { x: 12_000, diameterMm: null })], {
    pois: [{ id: "p1", kind: "toilets", name: "Toalete", x: 19_000, y: 500 }],
  });

  it("is a pure function of the model: custom dashed, unknown marked, 44 px hit targets, scale bar, title block", () => {
    const scene = buildPlanScene(model, { width: 360, title: { name: "Sala Mare", meta: "v3 · 12.11.2026" } });
    expect(buildPlanScene(model, { width: 360, title: { name: "Sala Mare", meta: "v3 · 12.11.2026" } })).toEqual(scene);
    const roles = (id: string) => scene.items.find((i) => i.id === id)!.nodes.map((n) => n.role);
    expect(roles("1")).toContain("venue");
    expect(roles("2")).toContain("custom");
    expect(roles("9")).toContain("unknown");
    expect(scene.items.find((i) => i.id === "9")!.known).toBe(false);
    for (const it of scene.items) {
      const hit = it.nodes.find((n) => n.role === "hit");
      expect(hit && hit.t === "rect" && hit.w >= 44 && hit.h >= 44).toBe(true);
    }
    expect(scene.over.some((n) => n.role === "scale-label" && n.t === "text" && /m$/.test(n.text))).toBe(true);
    expect(scene.over.some((n) => n.role === "title-name" && n.t === "text" && n.text === "SALA MARE")).toBe(true);
    expect(scene.pois).toHaveLength(1);
  });

  it("planToSvgString: self-contained markup, escaped text, guest view without tables", () => {
    const svg = planToSvgString({ ...model, name: 'Sala "<Mare>"' }, { title: { name: 'Sala "<Mare>"' }, highlightIds: ["1"] });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("SALA &quot;&lt;MARE&gt;&quot;");
    expect(svg).not.toMatch(/<script|href=|url\(/);
    expect(svg).toContain('stroke-dasharray="5 4"'); // the custom table
    const guest = buildPlanScene(model, { showTables: false });
    expect(guest.items).toEqual([]);
    expect(guest.pois).toHaveLength(1);
  });

  it("parseMetres reads what people type and keeps nonsense out", () => {
    expect(parseMetres("1,8")).toBe(1800);
    expect(parseMetres("12")).toBe(12_000);
    expect(parseMetres("180 cm")).toBe(1800);
    expect(parseMetres("")).toBeNull();
    expect(Number.isNaN(parseMetres("mare"))).toBe(true);
  });
});
