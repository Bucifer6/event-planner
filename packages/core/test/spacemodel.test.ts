import { describe, expect, it } from "vitest";
import { checkFit } from "../src/fitcheck";
import {
  applyStage,
  buildPlanScene,
  calibrationScale,
  insideAreas,
  danceFloorCapacity,
  doorClearance,
  findFreeSpot,
  FIXTURE_KIND_VALUES,
  FIXTURE_PRESETS,
  itemFootprint,
  itemHasDims,
  mmToPx,
  modelFromSnapshot,
  ownSpaceAreas,
  parseMetres,
  planToSvgString,
  polygonSelfIntersects,
  pxToMm,
  resolveDoors,
  roomDrawingProblems,
  roomFeatureProblems,
  setWallLength,
  snapToEdges,
  shapeGap,
  snapPosition,
  TABLE_PRESETS,
  wallLengths,
  type DrawingSnapshot,
  type FloorArea,
  type Pillar,
  type RoomDoor,
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

describe("table shapes and ready-made tables", () => {
  const base = { id: "t", kind: "table" as const, source: "custom" as const, name: "T", label: "1", x: 5000, y: 5000, rotation: 0, seats: 8 };

  it("ovals and half-moons have real footprints, sized by sides or by a diameter", () => {
    const oval = { ...base, shape: "oval" as const, diameterMm: null, widthMm: 2400, lengthMm: 1200 };
    const half = { ...base, shape: "halfmoon" as const, diameterMm: 1500, widthMm: null, lengthMm: null };
    expect(itemHasDims(oval)).toBe(true);
    expect(itemHasDims(half)).toBe(true);
    expect(itemHasDims({ ...half, diameterMm: null, widthMm: 1500, lengthMm: 750 })).toBe(false);
    const fo = itemFootprint(oval)!;
    const fh = itemFootprint(half)!;
    expect(fo.type).toBe("poly");
    const xs = (fo as { points: { x: number; y: number }[] }).points.map((p) => p.x);
    expect(Math.round(Math.max(...xs) - Math.min(...xs))).toBe(2400);
    // a half-moon is as wide as its diameter and half as deep
    const ph = (fh as { points: { x: number; y: number }[] }).points;
    expect(Math.round(Math.max(...ph.map((p) => p.x)) - Math.min(...ph.map((p) => p.x)))).toBe(1500);
    expect(Math.round(Math.max(...ph.map((p) => p.y)) - Math.min(...ph.map((p) => p.y)))).toBe(750);
    // an oval touching a round table: gap ≈ 0
    const round = itemFootprint({ ...base, shape: "round", diameterMm: 1000, widthMm: null, lengthMm: null, x: 5000 + 1200 + 500, y: 5000 })!;
    expect(Math.abs(shapeGap(fo, round))).toBeLessThan(5);
  });

  it("every ready-made table is drawable, its chairs clear of the table, and it fits a 20 × 20 m room on its own", () => {
    expect(new Set(TABLE_PRESETS.map((p) => p.key)).size).toBe(TABLE_PRESETS.length);
    for (const p of TABLE_PRESETS) {
      const item = { ...base, ...p, id: p.key, name: p.key, label: "1", seats: p.seats };
      expect(itemHasDims(item), p.key).toBe(true);
      const model: PlanModel = { name: "R", source: "own", versionNo: null, effectiveAt: null, widthMm: 20_000, lengthMm: 20_000, backdrop: null, areas: ownSpaceAreas(20_000, 20_000), tableTypes: [], items: [{ ...item, x: 10_000, y: 10_000 }], pois: [], parkingAreas: [], aisleMm: 600 };
      expect(checkFit(model, { needed: p.seats }).status, p.key).toBe("fits");
      const scene = buildPlanScene(model, { width: 800 });
      const seats = scene.items[0]!.nodes.filter((n) => n.role === "seat");
      expect(seats, p.key).toHaveLength(p.seats);
      expect(planToSvgString(model, { width: 400 })).toContain("<svg");
    }
  });
});

describe("drawn rooms", () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  it("finds crossing walls and outlines too small to be a room", () => {
    expect(polygonSelfIntersects(sq)).toBe(false);
    expect(polygonSelfIntersects([sq[0]!, sq[2]!, sq[1]!, sq[3]!])).toBe(true);
    expect(polygonSelfIntersects([sq[0]!, sq[1]!, sq[1]!, sq[2]!])).toBe(true); // a wall of no length
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }])).toBe(true); // doubles back
    const L = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }, { x: 12_000, y: 5000 }, { x: 12_000, y: 10_000 }, { x: 0, y: 10_000 }];
    expect(polygonSelfIntersects(L)).toBe(false);
    expect(roomDrawingProblems([{ id: "a", name: null, points: sq }, { id: "b", name: null, points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 0, y: 600 }] }])).toEqual([{ index: 1, problem: "tooSmall" }]);
  });

  it("setting a wall's length keeps the next wall's direction (a rectangle stays a rectangle)", () => {
    const longer = setWallLength(sq, 0, 6500);
    expect(longer).toEqual([{ x: 0, y: 0 }, { x: 6500, y: 0 }, { x: 6500, y: 3000 }, { x: 0, y: 3000 }]);
    expect(wallLengths(longer)).toEqual([6500, 3000, 6500, 3000]);
    const tri = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 0, y: 4000 }];
    expect(wallLengths(setWallLength(tri, 0, 6000))[0]).toBe(6000);
  });
});

describe("placing new tables", () => {
  it("finds the nearest free floor: never on another table, never outside the room", () => {
    const L = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }, { x: 12_000, y: 5000 }, { x: 12_000, y: 10_000 }, { x: 0, y: 10_000 }];
    const model: PlanModel = { name: "L", source: "own", versionNo: null, effectiveAt: null, widthMm: 12_000, lengthMm: 10_000, backdrop: null, areas: [{ id: "a", name: null, points: L }], tableTypes: [], items: [], pois: [], parkingAreas: [], aisleMm: 600 };
    const t = { kind: "table" as const, shape: "round" as const, diameterMm: 1800, widthMm: null, lengthMm: null, seats: 10, rotation: 0 };
    const placed: PlanItem[] = [];
    for (let i = 0; i < 5; i++) {
      // ask for the empty corner of the L every time
      const at = findFreeSpot(model, t, { x: 9000, y: 2500 }, placed)!;
      expect(at, `table ${i}`).not.toBeNull();
      placed.push({ ...t, id: `t${i}`, source: "custom", name: "", label: String(i), ...at });
    }
    const withPlaced = { ...model, items: placed };
    expect(checkFit(withPlaced, { needed: 50 }).status).toBe("fits");
    // a sixth 1.8 m table with chairs and aisles no longer fits in 90 m²
    expect(findFreeSpot(model, t, { x: 9000, y: 2500 }, placed)).toBeNull();
    expect(findFreeSpot(model, { ...t, diameterMm: null }, { x: 0, y: 0 })).toBeNull();
  });
});

describe("doors, pillars, dance floors and measuring", () => {
  const room: FloorArea = { id: "hall", name: null, points: [{ x: 0, y: 0 }, { x: 10_000, y: 0 }, { x: 10_000, y: 8000 }, { x: 0, y: 8000 }] };
  const door: RoomDoor = { id: "d1", areaId: "hall", wall: 0, offsetMm: 5000, widthMm: 900, kind: "single", swing: "in", hinge: "start" };
  const base: PlanModel = { name: "R", source: "own", versionNo: null, effectiveAt: null, widthMm: 10_000, lengthMm: 8000, backdrop: null, areas: [room], tableTypes: [], items: [], pois: [], parkingAreas: [], aisleMm: 600 };
  const table = (x: number, y: number): PlanItem => ({ id: `t${x}-${y}`, kind: "table", source: "custom", name: "T", label: "1", shape: "round", diameterMm: 1500, widthMm: null, lengthMm: null, seats: 8, x, y, rotation: 0 });

  it("a door sits on its wall, opens into the room, and keeps the floor in front of it clear", () => {
    const [d] = resolveDoors([room], [door]);
    expect(d!.a).toEqual({ x: 4550, y: 0 });
    expect(d!.b).toEqual({ x: 5450, y: 0 });
    expect(d!.inward).toEqual({ x: -0, y: 1 });
    const zone = doorClearance(d!);
    expect(Math.max(...zone.map((p) => p.y))).toBe(900);
    // a door on a wall that no longer exists is left out
    expect(resolveDoors([room], [{ ...door, wall: 9 }])).toEqual([]);
    const blocked = checkFit({ ...base, doors: [d!], items: [table(5000, 1200)] }, { needed: 8 });
    expect(blocked.issues.map((i) => i.type)).toContain("door");
    const clear = checkFit({ ...base, doors: [d!], items: [table(5000, 4000)] }, { needed: 8 });
    expect(clear.status).toBe("fits");
  });

  it("pillars block tables and their chairs, and take floor out of the usable area", () => {
    const pillar: Pillar = { id: "p1", shape: "square", sizeMm: 400, x: 5000, y: 4000 };
    const r = checkFit({ ...base, pillars: [pillar], items: [table(5000, 5000)] }, { needed: 8 });
    expect(r.issues).toEqual([expect.objectContaining({ type: "pillar", value: 1 })]);
    expect(r.area.usableMm2).toBe(80_000_000 - 160_000);
    expect(checkFit({ ...base, pillars: [pillar], items: [table(2000, 2000)] }, { needed: 8 }).status).toBe("fits");
  });

  it("finds doors that no longer fit their wall and pillars outside the room", () => {
    expect(roomFeatureProblems([room], { doors: [door], pillars: [] })).toEqual([]);
    expect(roomFeatureProblems([room], { doors: [{ ...door, offsetMm: 9900 }], pillars: [] })).toEqual([{ kind: "door", index: 0, problem: "offWall" }]);
    expect(roomFeatureProblems([room], { doors: [{ ...door, wall: 1, widthMm: 9000, offsetMm: 4000 }], pillars: [] })).toEqual([{ kind: "door", index: 0, problem: "tooWide" }]);
    expect(roomFeatureProblems([room], { doors: [], pillars: [{ id: "p", shape: "round", sizeMm: 300, x: 20_000, y: 0 }] })).toEqual([{ kind: "pillar", index: 0, problem: "outside" }]);
  });

  it("doors and pillars are drawn on every plan (screen, SVG, PDF scene)", () => {
    const model = { ...base, doors: resolveDoors([room], [door, { ...door, id: "d2", wall: 2, kind: "double" as const, widthMm: 1600 }]), pillars: [{ id: "p", shape: "round" as const, sizeMm: 400, x: 3000, y: 3000 }] };
    const scene = buildPlanScene(model, { width: 600 });
    const roles = scene.under.map((n) => n.role);
    expect(roles.filter((r) => r === "door-gap")).toHaveLength(2);
    expect(roles.filter((r) => r === "door")).toHaveLength(3); // one leaf + two leaves
    expect(roles).toContain("pillar");
    expect(planToSvgString(model, { width: 400 })).toContain('stroke-dasharray="2 2"');
  });

  it("knows how many can dance on the dance floor, and every ready-made item is well formed", () => {
    const floor: PlanItem = { id: "f", kind: "fixture", source: "custom", name: "Ring", label: "Ring", shape: "rect", diameterMm: null, widthMm: 6000, lengthMm: 6000, seats: null, x: 5000, y: 4000, rotation: 0, fixtureKind: "dance" };
    expect(danceFloorCapacity(base)).toBeNull();
    expect(danceFloorCapacity({ ...base, items: [floor] })).toEqual({ areaMm2: 36_000_000, packed: 85, comfortable: 48, count: 1 });
    expect(new Set(FIXTURE_PRESETS.map((p) => p.key)).size).toBe(FIXTURE_PRESETS.length);
    for (const p of FIXTURE_PRESETS) expect(FIXTURE_KIND_VALUES).toContain(p.kind);
  });

  it("measurements stick to table edges, chair edges and walls", () => {
    const model = { ...base, items: [table(5000, 4000)] };
    expect(snapToEdges(model, { x: 5000 + 760, y: 4000 }, 50)).toEqual({ point: { x: 5750, y: 4000 }, on: "item" });
    expect(snapToEdges(model, { x: 5000 + 1190, y: 4000 }, 50)).toEqual({ point: { x: 6200, y: 4000 }, on: "chairs" });
    expect(snapToEdges(model, { x: 9980, y: 1000 }, 50)).toEqual({ point: { x: 10_000, y: 1000 }, on: "wall" });
    expect(snapToEdges(model, { x: 2500, y: 2500 }, 50)).toBeNull();
  });

  it("new tables are placed off pillars and out of the way of doors", () => {
    const [d] = resolveDoors([room], [door]);
    const model = { ...base, doors: [d!], pillars: [{ id: "p", shape: "round" as const, sizeMm: 600, x: 5000, y: 4000 }] };
    const t = { kind: "table" as const, shape: "round" as const, diameterMm: 1500, widthMm: null, lengthMm: null, seats: 8, rotation: 0 };
    for (const near of [{ x: 5000, y: 600 }, { x: 5000, y: 4000 }]) {
      const at = findFreeSpot(model, t, near)!;
      expect(checkFit({ ...model, items: [{ ...t, id: "n", source: "custom", name: "", label: "1", ...at }] }, { needed: 8 }).status).toBe("fits");
    }
  });
});
