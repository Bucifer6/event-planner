"use client";

import {
  DOOR_KIND_VALUES,
  DOOR_SWING_VALUES,
  doorClearance,
  FEATURE_LIMITS,
  itemFootprint,
  mmToMetresText,
  pillarFootprint,
  resolveDoors,
  roomFeatureProblems,
  parseMetres,
  polygonArea,
  roomDrawingProblems,
  setWallLength,
  SPACE_LIMITS,
  wallLengths,
  type FloorArea,
  type Pillar,
  type PlacedDoor,
  type PlanItem,
  type PlanPoint,
  type RoomDoor,
  type RoomFeatures,
} from "@ed/core/spacemodel";
import { Button, Checkbox, IconButton, Notice, SelectField, Tag, TextField } from "@ed/ui";
import { IconMinus, IconPlus, IconTrash, IconUndo } from "@ed/ui/icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { saveRoomDrawingAction } from "@/app/actions/space";
import styles from "./room.module.css";

// THE ROOM DRAWING TOOL — the planner draws their own space to scale, like a simple CAD app.
//
//   tools      Select (move corners, walls or whole outlines), Walls (click corner after corner,
//              close on the first corner or with Enter) and Rectangle (two corners).
//   precise    every tool has a typed path that does the same as the pointer: "next wall
//              6,5 m at 90°", "rectangle 12 × 8 m at 0, 0", exact corner coordinates and an
//              exact length for any wall. This is also the keyboard-only path.
//   snapping   grid (1 cm … 1 m), existing corners, and angles in 15° steps (Shift held
//              switches angle snapping the other way for one move). Each can be turned off.
//   dimensions every wall is labelled with its length; each outline with its floor area.
//   undo/redo  Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y), and buttons.
//
// Coordinates are integer millimetres, y pointing down (as on the seating plan). Saving goes
// through saveRoomDrawingAction → core saveOwnRoomDrawing, which validates again.

type Tool = "select" | "line" | "rect" | "door" | "pillar" | "measure";
type Sel = { area: number; corner?: number; wall?: number } | null;
type FeatSel = { kind: "door" | "pillar"; index: number } | null;
type Room = { areas: FloorArea[]; features: RoomFeatures };
type Drag =
  | { kind: "corner"; area: number; corner: number; start: FloorArea[] }
  | { kind: "area"; area: number; from: PlanPoint; start: FloorArea[] }
  | { kind: "pillar"; index: number; start: Room }
  | { kind: "door"; index: number; start: Room }
  | { kind: "pan"; fromClient: { x: number; y: number }; startView: View };
type View = { cx: number; cy: number; mmPerPx: number };

const STEPS = [10, 50, 100, 500, 1000] as const;
const ANGLE_STEP = 15;
const SNAP_PX = 12;
const HANDLE_PX = 7;

let seq = 0;
const newAreaId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
const newFeatureId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const same = (a: PlanPoint, b: PlanPoint) => a.x === b.x && a.y === b.y;

/** Where an outline's label goes: its centre of area, or (for shapes like an L where that falls outside) the middle of the widest run across it. */
function centroid(points: PlanPoint[]): PlanPoint {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  const c = a === 0 ? { x: points[0]!.x, y: points[0]!.y } : { x: cx / (3 * a), y: cy / (3 * a) };
  if (pointInPoly(c, points)) return c;
  // scan across at the centre's height and take the middle of the longest inside stretch
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    if (p.y > c.y !== q.y > c.y) xs.push(p.x + ((c.y - p.y) * (q.x - p.x)) / (q.y - p.y));
  }
  xs.sort((m, n) => m - n);
  let best = c;
  let bestW = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1]! - xs[i]! > bestW) {
      bestW = xs[i + 1]! - xs[i]!;
      best = { x: (xs[i]! + xs[i + 1]!) / 2, y: c.y };
    }
  }
  return best;
}

function pointInPoly(p: PlanPoint, poly: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segDist(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Screen angle in degrees, 0 = right, 90 = down (y points down on the plan). */
function angleOf(a: PlanPoint, b: PlanPoint): number {
  return (((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 360 + 360) % 360;
}

export function RoomDrawer(props: { occasionId: string; locale: "ro" | "en"; initial: FloorArea[]; initialFeatures: RoomFeatures; items: PlanItem[]; backHref: string }) {
  const t = useTranslations("space.draw");
  const tc = useTranslations("common");
  const router = useRouter();
  const formId = useId();
  const m = (mm: number) => mmToMetresText(Math.round(mm), props.locale);

  /* ── the drawing (outlines + doors + pillars) and its history ── */
  const [room, setRoom] = useState<Room>({ areas: props.initial, features: props.initialFeatures });
  const [past, setPast] = useState<Room[]>([]);
  const [future, setFuture] = useState<Room[]>([]);
  const [dirty, setDirty] = useState(false);
  const areas = room.areas;
  const features = room.features;
  /** A live preview while dragging; the history gets one entry when the drag ends. */
  const setAreas = (next: FloorArea[]) => setRoom((r) => ({ ...r, areas: next }));
  const commitRoom = useCallback(
    (next: Room, before: Room = room) => {
      setPast((p) => [...p.slice(-99), before]);
      setFuture([]);
      setRoom(next);
      setDirty(true);
    },
    [room],
  );
  const commit = useCallback((next: FloorArea[], before?: FloorArea[]) => commitRoom({ ...room, areas: next }, before ? { ...room, areas: before } : room), [room, commitRoom]);
  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      setFuture((f) => [room, ...f]);
      setRoom(p[p.length - 1]!);
      setDirty(true);
      return p.slice(0, -1);
    });
    setSel(null);
    setFeatSel(null);
  }, [room]);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      setPast((p) => [...p, room]);
      setRoom(f[0]!);
      setDirty(true);
      return f.slice(1);
    });
    setSel(null);
    setFeatSel(null);
  }, [room]);

  /* ── tools and snapping ── */
  const [tool, setTool] = useState<Tool>(props.initial.length === 0 ? "rect" : "select");
  const [draft, setDraft] = useState<PlanPoint[]>([]);
  const [rectStart, setRectStart] = useState<PlanPoint | null>(null);
  const [cursor, setCursor] = useState<{ p: PlanPoint; how: "grid" | "corner" | "angle" | "free" } | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [featSel, setFeatSel] = useState<FeatSel>(null);
  const [doorKind, setDoorKind] = useState<RoomDoor["kind"]>("single");
  const [doorWidth, setDoorWidth] = useState(900);
  const [pillarShape, setPillarShape] = useState<Pillar["shape"]>("round");
  const [pillarSize, setPillarSize] = useState(400);
  const [measures, setMeasures] = useState<Array<{ a: PlanPoint; b: PlanPoint }>>([]);
  const [measureFrom, setMeasureFrom] = useState<PlanPoint | null>(null);
  const [snapGrid, setSnapGrid] = useState(true);
  const [snapCorners, setSnapCorners] = useState(true);
  const [snapAngle, setSnapAngle] = useState(true);
  const [step, setStep] = useState<number>(100);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const shift = useRef(false);

  const changeTool = (next: Tool) => {
    setTool(next);
    setDraft([]);
    setRectStart(null);
    setMeasureFrom(null);
    setSel(null);
    setFeatSel(null);
    setMessage(null);
  };

  /* ── the view: centre + scale; the SVG viewBox follows the element's size ── */
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 320, h: 360 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(240, el.clientHeight) });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitView = useCallback(
    (list: FloorArea[] = areas): View => {
      const pts = [...list.flatMap((a) => a.points), ...props.items.map((i) => ({ x: i.x, y: i.y })), ...features.pillars.map((p) => ({ x: p.x, y: p.y }))];
      if (pts.length === 0) return { cx: 6000, cy: 4500, mmPerPx: 14000 / size.w };
      const minX = Math.min(...pts.map((p) => p.x));
      const maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxY = Math.max(...pts.map((p) => p.y));
      const spanX = Math.max(2000, maxX - minX);
      const spanY = Math.max(2000, maxY - minY);
      return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, mmPerPx: Math.max(spanX / (size.w - 80), spanY / (size.h - 80)) };
    },
    [areas, features.pillars, props.items, size],
  );
  const [view, setView] = useState<View | null>(null);
  const v = view ?? fitView();
  const vb = { x: v.cx - (size.w * v.mmPerPx) / 2, y: v.cy - (size.h * v.mmPerPx) / 2, w: size.w * v.mmPerPx, h: size.h * v.mmPerPx };
  const px = v.mmPerPx; // mm per screen pixel: strokes, handles and text are sized with it
  const zoom = (factor: number, at?: PlanPoint) =>
    setView((cur) => {
      const c = cur ?? v;
      const mmPerPx = Math.min(400, Math.max(1, c.mmPerPx * factor));
      if (!at) return { ...c, mmPerPx };
      return { cx: at.x + (c.cx - at.x) * (mmPerPx / c.mmPerPx), cy: at.y + (c.cy - at.y) * (mmPerPx / c.mmPerPx), mmPerPx };
    });

  const toMm = useCallback((clientX: number, clientY: number): PlanPoint | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }, []);

  /** Where a pointer at `raw` lands: an existing corner, else angle + length steps from `from`, else the grid. */
  const snap = useCallback(
    (raw: PlanPoint, from: PlanPoint | null, skip?: { area: number; corner: number }): { p: PlanPoint; how: "grid" | "corner" | "angle" | "free" } => {
      if (snapCorners) {
        let best: PlanPoint | null = null;
        let bestD = SNAP_PX * px;
        areas.forEach((a, ai) =>
          a.points.forEach((p, ci) => {
            if (skip && skip.area === ai && skip.corner === ci) return;
            const d = Math.hypot(p.x - raw.x, p.y - raw.y);
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }),
        );
        for (const p of draft) {
          const d = Math.hypot(p.x - raw.x, p.y - raw.y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) return { p: best, how: "corner" };
      }
      const angleOn = snapAngle !== shift.current;
      if (from && angleOn) {
        const ang = Math.round(angleOf(from, raw) / ANGLE_STEP) * ANGLE_STEP;
        let len = Math.hypot(raw.x - from.x, raw.y - from.y);
        if (snapGrid) len = Math.max(step, roundTo(len, step));
        const r = (ang * Math.PI) / 180;
        return { p: { x: Math.round(from.x + len * Math.cos(r)), y: Math.round(from.y + len * Math.sin(r)) }, how: "angle" };
      }
      if (snapGrid) return { p: { x: roundTo(raw.x, step), y: roundTo(raw.y, step) }, how: "grid" };
      return { p: { x: Math.round(raw.x), y: Math.round(raw.y) }, how: "free" };
    },
    [areas, draft, px, snapAngle, snapCorners, snapGrid, step],
  );

  /* ── building outlines ── */
  const addArea = (points: PlanPoint[]) => {
    if (areas.length >= SPACE_LIMITS.areas) {
      setMessage(t("limits.areas", { max: SPACE_LIMITS.areas }));
      return false;
    }
    const next = [...areas, { id: newAreaId(), name: null, points }];
    commit(next);
    setSel({ area: next.length - 1 });
    setMessage(null);
    return true;
  };
  const closeDraft = () => {
    if (draft.length < 3) {
      setMessage(t("line.needThree"));
      return;
    }
    if (addArea(draft)) {
      setDraft([]);
      setTool("select");
    }
  };
  const addDraftPoint = (p: PlanPoint) => {
    if (draft.length >= 3 && same(p, draft[0]!)) return closeDraft();
    if (draft.length > 0 && same(p, draft[draft.length - 1]!)) return;
    if (draft.length >= SPACE_LIMITS.areaPoints) {
      setMessage(t("limits.corners", { max: SPACE_LIMITS.areaPoints }));
      return;
    }
    setDraft((d) => [...d, p]);
    setMessage(null);
  };
  const rectFrom = (a: PlanPoint, b: PlanPoint): PlanPoint[] | null => {
    if (a.x === b.x || a.y === b.y) return null;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  };

  /* ── doors and pillars ── */
  const placedDoors = useMemo(() => resolveDoors(areas, features.doors), [areas, features.doors]);
  const setFeatures = (next: RoomFeatures, before: Room = room) => commitRoom({ ...room, features: next }, before);
  /** The wall nearest to a point (within `tol` mm), with where along it the point falls. */
  const nearestWall = (p: PlanPoint, tol: number) => {
    let best: { areaId: string; wall: number; along: number; len: number } | null = null;
    let bestD = tol;
    for (const a of areas)
      for (let i = 0; i < a.points.length; i++) {
        const u = a.points[i]!;
        const w = a.points[(i + 1) % a.points.length]!;
        const d = segDist(p, u, w);
        if (d < bestD) {
          const len = Math.hypot(w.x - u.x, w.y - u.y);
          bestD = d;
          best = { areaId: a.id, wall: i, len, along: len === 0 ? 0 : ((p.x - u.x) * (w.x - u.x) + (p.y - u.y) * (w.y - u.y)) / len };
        }
      }
    return best;
  };
  const clampOffset = (along: number, width: number, len: number) => Math.round(Math.max(width / 2, Math.min(len - width / 2, snapGrid ? roundTo(along, Math.min(step, 100)) : along)));
  const addDoorAt = (areaId: string, wall: number, along: number, len: number) => {
    if (features.doors.length >= FEATURE_LIMITS.doors) return setMessage(t("limits.doors", { max: FEATURE_LIMITS.doors }));
    const width = doorKind === "double" ? Math.max(doorWidth, 1400) : doorWidth;
    if (len < width) return setMessage(t("door.tooShort"));
    const door: RoomDoor = { id: newFeatureId("d"), areaId, wall, offsetMm: clampOffset(along, width, len), widthMm: width, kind: doorKind, swing: doorKind === "opening" ? "in" : "in", hinge: "start" };
    setFeatures({ ...features, doors: [...features.doors, door] });
    setFeatSel({ kind: "door", index: features.doors.length });
    setSel(null);
    setMessage(null);
  };
  const addPillarAt = (p: PlanPoint) => {
    if (features.pillars.length >= FEATURE_LIMITS.pillars) return setMessage(t("limits.pillars", { max: FEATURE_LIMITS.pillars }));
    setFeatures({ ...features, pillars: [...features.pillars, { id: newFeatureId("p"), shape: pillarShape, sizeMm: pillarSize, x: p.x, y: p.y }] });
    setFeatSel({ kind: "pillar", index: features.pillars.length });
    setSel(null);
  };
  const hitFeature = (p: PlanPoint): FeatSel => {
    const tol = HANDLE_PX * 1.6 * px;
    for (let i = features.pillars.length - 1; i >= 0; i--) {
      const f = pillarFootprint(features.pillars[i]!);
      const c = f.type === "circle" ? { x: f.cx, y: f.cy } : { x: features.pillars[i]!.x, y: features.pillars[i]!.y };
      const r = f.type === "circle" ? f.r : features.pillars[i]!.sizeMm / 2;
      if (Math.hypot(p.x - c.x, p.y - c.y) <= r + tol) return { kind: "pillar", index: i };
    }
    for (const d of placedDoors) if (segDist(p, d.a, d.b) <= tol) return { kind: "door", index: d.index - 1 };
    return null;
  };
  /** Splitting wall `w` at `at` mm from its start: doors further along move to the new wall. */
  const doorsAfterSplit = (areaId: string, w: number, at: number): RoomDoor[] =>
    features.doors.map((d) => (d.areaId !== areaId ? d : d.wall > w ? { ...d, wall: d.wall + 1 } : d.wall === w && d.offsetMm > at ? { ...d, wall: d.wall + 1, offsetMm: d.offsetMm - at } : d));
  /** Removing corner `c` of an outline with `n` corners merges two walls: their doors go, later walls shift down. */
  const doorsAfterRemoveCorner = (areaId: string, c: number, n: number): RoomDoor[] =>
    features.doors
      .filter((d) => d.areaId !== areaId || (d.wall !== c && d.wall !== (c - 1 + n) % n))
      .map((d) => (d.areaId === areaId && d.wall > c ? { ...d, wall: d.wall - 1 } : d));

  /* ── pointer ── */
  const drag = useRef<Drag | null>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  const hitTest = (p: PlanPoint): Sel => {
    const tol = HANDLE_PX * 1.6 * px;
    for (let ai = areas.length - 1; ai >= 0; ai--) {
      const pts = areas[ai]!.points;
      const ci = pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol);
      if (ci >= 0) return { area: ai, corner: ci };
    }
    for (let ai = areas.length - 1; ai >= 0; ai--) {
      const pts = areas[ai]!.points;
      for (let wi = 0; wi < pts.length; wi++) if (segDist(p, pts[wi]!, pts[(wi + 1) % pts.length]!) <= tol) return { area: ai, wall: wi };
    }
    for (let ai = areas.length - 1; ai >= 0; ai--) if (pointInPoly(p, areas[ai]!.points)) return { area: ai };
    return null;
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const raw = toMm(e.clientX, e.clientY);
    if (!raw) return;
    svgRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    downAt.current = { x: e.clientX, y: e.clientY };
    if (e.button === 0 && tool === "select") {
      const fh = hitFeature(raw);
      if (fh) {
        setFeatSel(fh);
        setSel(null);
        drag.current = { kind: fh.kind, index: fh.index, start: room };
        return;
      }
    }
    if (e.button === 1 || tool === "select") {
      const hit = e.button === 1 ? null : hitTest(raw);
      if (hit) setFeatSel(null);
      if (hit && hit.corner !== undefined) {
        setSel(hit);
        drag.current = { kind: "corner", area: hit.area, corner: hit.corner, start: areas };
      } else if (hit) {
        setSel(hit);
        drag.current = { kind: "area", area: hit.area, from: snap(raw, null).p, start: areas };
      } else {
        if (e.button === 0) setSel(null);
        drag.current = { kind: "pan", fromClient: { x: e.clientX, y: e.clientY }, startView: v };
      }
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    shift.current = e.shiftKey;
    const raw = toMm(e.clientX, e.clientY);
    if (!raw) return;
    const d = drag.current;
    if (d?.kind === "pan") {
      setView({ ...d.startView, cx: d.startView.cx - (e.clientX - d.fromClient.x) * d.startView.mmPerPx, cy: d.startView.cy - (e.clientY - d.fromClient.y) * d.startView.mmPerPx });
      return;
    }
    if (d?.kind === "pillar") {
      const s = snap(raw, null);
      setRoom({ ...d.start, features: { ...d.start.features, pillars: d.start.features.pillars.map((q, i) => (i === d.index ? { ...q, x: s.p.x, y: s.p.y } : q)) } });
      return;
    }
    if (d?.kind === "door") {
      const door = d.start.features.doors[d.index]!;
      const area = d.start.areas.find((a) => a.id === door.areaId);
      if (!area) return;
      const u = area.points[door.wall]!;
      const w = area.points[(door.wall + 1) % area.points.length]!;
      const len = Math.hypot(w.x - u.x, w.y - u.y);
      const along = len === 0 ? 0 : ((raw.x - u.x) * (w.x - u.x) + (raw.y - u.y) * (w.y - u.y)) / len;
      setRoom({ ...d.start, features: { ...d.start.features, doors: d.start.features.doors.map((q, i) => (i === d.index ? { ...q, offsetMm: clampOffset(along, q.widthMm, len) } : q)) } });
      return;
    }
    if (d?.kind === "corner") {
      const pts = d.start[d.area]!.points;
      const prev = pts[(d.corner - 1 + pts.length) % pts.length]!;
      const s = snap(raw, prev, { area: d.area, corner: d.corner });
      setCursor(s);
      setAreas(d.start.map((a, ai) => (ai === d.area ? { ...a, points: a.points.map((q, ci) => (ci === d.corner ? s.p : q)) } : a)));
      return;
    }
    if (d?.kind === "area") {
      const s = snap(raw, null);
      const dx = s.p.x - d.from.x;
      const dy = s.p.y - d.from.y;
      setAreas(d.start.map((a, ai) => (ai === d.area ? { ...a, points: a.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : a)));
      return;
    }
    if (tool === "line") setCursor(snap(raw, draft.length > 0 ? draft[draft.length - 1]! : null));
    else if (tool === "rect" || tool === "pillar") setCursor(snap(raw, null));
    else if (tool === "measure") setCursor(snap(raw, measureFrom));
    else if (tool === "door") {
      const nw = nearestWall(raw, 24 * px);
      setCursor(nw ? { p: { x: Math.round(raw.x), y: Math.round(raw.y) }, how: "corner" } : null);
    } else setCursor(null);
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    const moved = downAt.current ? Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 4 : false;
    downAt.current = null;
    if (d?.kind === "corner" || d?.kind === "area") {
      if (moved && areas !== d.start) commit(areas, d.start);
      else setAreas(d.start);
      return;
    }
    if (d?.kind === "pillar" || d?.kind === "door") {
      if (moved && room !== d.start) commitRoom(room, d.start);
      else setRoom(d.start);
      return;
    }
    if (d?.kind === "pan") return;
    const raw = toMm(e.clientX, e.clientY);
    if (!raw) return;
    if (tool === "door") {
      const nw = nearestWall(raw, 24 * px);
      if (!nw) return setMessage(t("door.onWall"));
      addDoorAt(nw.areaId, nw.wall, nw.along, nw.len);
      return;
    }
    if (tool === "pillar") {
      addPillarAt(snap(raw, null).p);
      return;
    }
    if (tool === "measure") {
      const p = snap(raw, measureFrom).p;
      if (!measureFrom) setMeasureFrom(p);
      else {
        if (!same(p, measureFrom)) setMeasures((m) => [...m.slice(-9), { a: measureFrom, b: p }]);
        setMeasureFrom(null);
      }
      return;
    }
    if (tool === "line") {
      addDraftPoint(snap(raw, draft.length > 0 ? draft[draft.length - 1]! : null).p);
    } else if (tool === "rect") {
      const p = snap(raw, null).p;
      if (!rectStart) setRectStart(p);
      else {
        const pts = rectFrom(rectStart, p);
        if (!pts) return setMessage(t("rect.flat"));
        if (addArea(pts)) {
          setRectStart(null);
          setTool("select");
        }
      }
    }
  };

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const at = toMm(e.clientX, e.clientY) ?? undefined;
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, at);
  };
  // the page must not scroll while the wheel zooms the drawing
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const stop = (e: globalThis.WheelEvent) => e.preventDefault();
    svg.addEventListener("wheel", stop, { passive: false });
    return () => svg.removeEventListener("wheel", stop);
  }, []);

  /* ── keyboard ── */
  const nudge = (dx: number, dy: number) => {
    if (featSel?.kind === "pillar") {
      setFeatures({ ...features, pillars: features.pillars.map((q, i) => (i === featSel.index ? { ...q, x: q.x + dx, y: q.y + dy } : q)) });
      return;
    }
    if (featSel?.kind === "door") {
      const door = features.doors[featSel.index]!;
      const pd = placedDoors.find((x) => x.index === featSel.index + 1);
      const area = areas.find((x) => x.id === door.areaId);
      if (!pd || !area) return;
      const len = wallLengths(area.points)[door.wall]!;
      // along the wall: right/down = further from its first corner
      const delta = dx + dy;
      setFeatures({ ...features, doors: features.doors.map((q, i) => (i === featSel.index ? { ...q, offsetMm: clampOffset(q.offsetMm + delta, q.widthMm, len) } : q)) });
      return;
    }
    if (!sel) return;
    const next = areas.map((a, ai) => {
      if (ai !== sel.area) return a;
      if (sel.corner !== undefined) return { ...a, points: a.points.map((q, ci) => (ci === sel.corner ? { x: q.x + dx, y: q.y + dy } : q)) };
      return { ...a, points: a.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
    });
    commit(next);
  };
  const removeSelected = () => {
    if (featSel) {
      setFeatures(
        featSel.kind === "door" ? { ...features, doors: features.doors.filter((_, i) => i !== featSel.index) } : { ...features, pillars: features.pillars.filter((_, i) => i !== featSel.index) },
      );
      setFeatSel(null);
      return;
    }
    if (!sel) return;
    const a = areas[sel.area]!;
    if (sel.corner !== undefined) {
      if (a.points.length <= 3) return setMessage(t("select.minCorners"));
      commitRoom({
        areas: areas.map((x, ai) => (ai === sel.area ? { ...x, points: x.points.filter((_, ci) => ci !== sel.corner) } : x)),
        features: { ...features, doors: doorsAfterRemoveCorner(a.id, sel.corner, a.points.length) },
      });
      setSel({ area: sel.area });
      return;
    }
    commitRoom({ areas: areas.filter((_, ai) => ai !== sel.area), features: { ...features, doors: features.doors.filter((d) => d.areaId !== a.id) } });
    setSel(null);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    shift.current = e.shiftKey;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === "Escape") {
      setDraft([]);
      setRectStart(null);
      setMeasureFrom(null);
      setSel(null);
      setFeatSel(null);
      return;
    }
    if (e.key === "Enter" && tool === "line") {
      e.preventDefault();
      closeDraft();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (tool === "line" && draft.length > 0) setDraft((d) => d.slice(0, -1));
      else removeSelected();
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[e.key];
    if (a && (sel || featSel)) {
      e.preventDefault();
      const k = (snapGrid ? step : 10) * (e.shiftKey ? 10 : 1);
      nudge(a[0] * k, a[1] * k);
      return;
    }
    if (!mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "v") changeTool("select");
      else if (key === "w") changeTool("line");
      else if (key === "r") changeTool("rect");
      else if (key === "d") changeTool("door");
      else if (key === "p") changeTool("pillar");
      else if (key === "m") changeTool("measure");
      else if (key === "+" || key === "=") zoom(1 / 1.25);
      else if (key === "-") zoom(1.25);
      else if (key === "f") setView(null);
    }
  };

  /* ── saving ── */
  const problems = useMemo(() => roomDrawingProblems(areas), [areas]);
  const featureProblems = useMemo(() => roomFeatureProblems(areas, features), [areas, features]);
  async function save() {
    if (problems.length > 0 || featureProblems.length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveRoomDrawingAction({ occasionId: props.occasionId, areas, features });
      if (!res.ok) {
        setSaveError(res.error.message);
        return;
      }
      setDirty(false);
      router.push(props.backHref);
      router.refresh();
    } catch {
      setSaveError(t("errors.network"));
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ── what is drawn ── */
  const minor = snapGrid ? step : 100;
  const minorShown = minor / px >= 6 ? minor : minor * 10 / px >= 6 ? minor * 10 : null;
  const gridLines = (every: number) => {
    const out: Array<{ k: string; x1: number; y1: number; x2: number; y2: number }> = [];
    if (vb.w / every > 400 || vb.h / every > 400) return out;
    for (let x = Math.floor(vb.x / every) * every; x <= vb.x + vb.w; x += every) out.push({ k: `x${x}`, x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h });
    for (let y = Math.floor(vb.y / every) * every; y <= vb.y + vb.h; y += every) out.push({ k: `y${y}`, x1: vb.x, y1: y, x2: vb.x + vb.w, y2: y });
    return out;
  };
  const font = 11 * px;
  const dimLabel = (a: PlanPoint, b: PlanPoint, key: string, poly: PlanPoint[] | null) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len / px < 28) return null;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    // labels sit outside the outline
    if (poly && pointInPoly({ x: mid.x + nx * 4 * px, y: mid.y + ny * 4 * px }, poly)) {
      nx = -nx;
      ny = -ny;
    }
    let ang = angleOf(a, b);
    if (ang > 90 && ang <= 270) ang -= 180;
    const off = 10 * px;
    return (
      <text key={key} className={styles.dim} x={mid.x + nx * off} y={mid.y + ny * off} fontSize={font} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${mid.x + nx * off} ${mid.y + ny * off})`}>
        {m(len)} m
      </text>
    );
  };

  const last = draft.length > 0 ? draft[draft.length - 1]! : null;
  const live = tool === "line" && last && cursor ? { a: last, b: cursor.p } : null;
  const rectLive = tool === "rect" && rectStart && cursor ? rectFrom(rectStart, cursor.p) : null;
  const selArea = sel ? areas[sel.area] : undefined;

  const status = (() => {
    if (tool === "line") {
      if (live) return t("line.live", { length: m(Math.hypot(live.b.x - live.a.x, live.b.y - live.a.y)), angle: Math.round(angleOf(live.a, live.b)) });
      return draft.length === 0 ? t("line.start") : t("line.next");
    }
    if (tool === "rect") {
      if (rectLive) return t("rect.live", { w: m(rectLive[1]!.x - rectLive[0]!.x), l: m(rectLive[2]!.y - rectLive[1]!.y) });
      return rectStart ? t("rect.second") : t("rect.first");
    }
    if (tool === "door") return t("door.hint");
    if (tool === "pillar") return cursor ? t("pillar.live", { x: m(cursor.p.x), y: m(cursor.p.y) }) : t("pillar.hint");
    if (tool === "measure") {
      if (measureFrom && cursor) return t("measure.live", { length: m(Math.hypot(cursor.p.x - measureFrom.x, cursor.p.y - measureFrom.y)) });
      return measureFrom ? t("measure.second") : t("measure.first");
    }
    if (cursor && drag.current?.kind === "corner") return t("select.corner", { x: m(cursor.p.x), y: m(cursor.p.y) });
    return areas.length === 0 ? t("select.empty") : t("select.hint");
  })();

  return (
    <div className="ed-stack" data-gap="3">
      <div className={styles.toolbar} role="toolbar" aria-label={t("toolbar")}>
        <div className={styles.group} role="group" aria-label={t("tools.label")}>
          {(["select", "line", "rect", "door", "pillar", "measure"] as const).map((k) => (
            <Button key={k} size="sm" variant={tool === k ? "secondary" : "quiet"} aria-pressed={tool === k} onClick={() => changeTool(k)}>
              {t(`tools.${k}`)}
            </Button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label={t("history")}>
          <IconButton label={t("undo")} onClick={undo} disabled={past.length === 0}>
            <IconUndo size={18} />
          </IconButton>
          <IconButton label={t("redo")} onClick={redo} disabled={future.length === 0}>
            <span className={styles.flip}>
              <IconUndo size={18} />
            </span>
          </IconButton>
        </div>
        <div className={styles.group} role="group" aria-label={t("zoom.label")}>
          <IconButton label={t("zoom.in")} onClick={() => zoom(1 / 1.25)}>
            <IconPlus size={18} />
          </IconButton>
          <IconButton label={t("zoom.out")} onClick={() => zoom(1.25)}>
            <IconMinus size={18} />
          </IconButton>
          <Button size="sm" variant="quiet" onClick={() => setView(null)}>
            {t("zoom.fit")}
          </Button>
        </div>
      </div>

      <details className={styles.snap}>
        <summary>{t("snap.title", { state: snapGrid || snapCorners || snapAngle ? t("snap.on") : t("snap.off") })}</summary>
        <div className={styles.snapBody}>
          <Checkbox label={t("snap.grid")} checked={snapGrid} onChange={(e) => setSnapGrid(e.target.checked)} />
          <SelectField id={`${formId}-step`} label={t("snap.step")} value={String(step)} onChange={(e) => setStep(Number(e.target.value))} disabled={!snapGrid}>
            {STEPS.map((s) => (
              <option key={s} value={s}>
                {s < 1000 ? t("snap.cm", { n: s / 10 }) : t("snap.m", { n: s / 1000 })}
              </option>
            ))}
          </SelectField>
          <Checkbox label={t("snap.corners")} checked={snapCorners} onChange={(e) => setSnapCorners(e.target.checked)} />
          <Checkbox label={t("snap.angle")} hint={t("snap.angleHint")} checked={snapAngle} onChange={(e) => setSnapAngle(e.target.checked)} />
        </div>
      </details>

      <p className={styles.status} aria-live="polite">
        {status}
      </p>

      <div ref={wrapRef} className={styles.canvas}>
        <svg
          ref={svgRef}
          role="application"
          aria-label={t("canvas", { count: areas.length })}
          aria-describedby={`${formId}-keys`}
          tabIndex={0}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          width={size.w}
          height={size.h}
          data-tool={tool}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => !drag.current && setCursor(null)}
          onPointerCancel={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.kind === "corner" || d?.kind === "area") setAreas(d.start);
            else if (d?.kind === "pillar" || d?.kind === "door") setRoom(d.start);
          }}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => (shift.current = e.shiftKey)}
        >
          {minorShown ? gridLines(minorShown).map((l) => <line key={l.k} className={styles.grid} {...l} />) : null}
          {gridLines(1000).map((l) => (
            <line key={`M${l.k}`} className={styles.gridMajor} {...l} />
          ))}
          <g className={styles.origin}>
            <line x1={-20 * px} y1={0} x2={20 * px} y2={0} />
            <line x1={0} y1={-20 * px} x2={0} y2={20 * px} />
          </g>

          {areas.map((a, ai) => (
            <g key={a.id}>
              <polygon className={styles.area} data-selected={sel?.area === ai || undefined} points={a.points.map((p) => `${p.x},${p.y}`).join(" ")} />
              {sel?.area === ai && sel.wall !== undefined ? (
                <line className={styles.wallSel} x1={a.points[sel.wall]!.x} y1={a.points[sel.wall]!.y} x2={a.points[(sel.wall + 1) % a.points.length]!.x} y2={a.points[(sel.wall + 1) % a.points.length]!.y} />
              ) : null}
              {a.points.map((p, i) => dimLabel(p, a.points[(i + 1) % a.points.length]!, `${a.id}-${i}`, a.points))}
              {(() => {
                const c = centroid(a.points);
                return (
                  <text className={styles.areaLabel} x={c.x} y={c.y} fontSize={font} textAnchor="middle" dominantBaseline="middle">
                    {a.name ? `${a.name} · ` : ""}
                    {t("areaM2", { n: (polygonArea(a.points) / 1e6).toLocaleString(props.locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 }) })}
                  </text>
                );
              })()}
              {(tool === "select" || sel?.area === ai) &&
                a.points.map((p, ci) => (
                  <rect
                    key={ci}
                    className={styles.handle}
                    data-selected={(sel?.area === ai && sel.corner === ci) || undefined}
                    x={p.x - HANDLE_PX * px}
                    y={p.y - HANDLE_PX * px}
                    width={HANDLE_PX * 2 * px}
                    height={HANDLE_PX * 2 * px}
                  />
                ))}
            </g>
          ))}

          {props.items.map((it) => {
            const f = itemFootprint(it);
            if (!f) return null;
            return f.type === "circle" ? <circle key={it.id} className={styles.item} cx={f.cx} cy={f.cy} r={f.r} /> : <polygon key={it.id} className={styles.item} points={f.points.map((p) => `${p.x},${p.y}`).join(" ")} />;
          })}

          {features.pillars.map((pl, i) => {
            const f = pillarFootprint(pl);
            const selected = featSel?.kind === "pillar" && featSel.index === i;
            return f.type === "circle" ? (
              <circle key={pl.id} className={styles.pillar} data-selected={selected || undefined} cx={f.cx} cy={f.cy} r={f.r} />
            ) : (
              <polygon key={pl.id} className={styles.pillar} data-selected={selected || undefined} points={f.points.map((q) => `${q.x},${q.y}`).join(" ")} />
            );
          })}
          {placedDoors.map((d) => (
            <DoorShape key={d.id} d={d} px={px} selected={featSel?.kind === "door" && featSel.index === d.index - 1} />
          ))}
          {[...measures, ...(measureFrom && cursor && tool === "measure" ? [{ a: measureFrom, b: cursor.p }] : [])].map((ms, i) => (
            <g key={`m${i}`} className={styles.measure}>
              <line x1={ms.a.x} y1={ms.a.y} x2={ms.b.x} y2={ms.b.y} />
              <circle cx={ms.a.x} cy={ms.a.y} r={3 * px} />
              <circle cx={ms.b.x} cy={ms.b.y} r={3 * px} />
              {dimLabel(ms.a, ms.b, `ml${i}`, null)}
            </g>
          ))}
          {measureFrom && tool === "measure" && !cursor ? <circle className={styles.draftPoint} cx={measureFrom.x} cy={measureFrom.y} r={4 * px} /> : null}
          {draft.length > 0 ? <polyline className={styles.draft} points={draft.map((p) => `${p.x},${p.y}`).join(" ")} /> : null}
          {draft.slice(0, -1).map((p, i) => dimLabel(p, draft[i + 1]!, `d${i}`, null))}
          {draft.map((p, i) => (
            <circle key={i} className={i === 0 && draft.length >= 3 ? styles.closeTarget : styles.draftPoint} cx={p.x} cy={p.y} r={(i === 0 && draft.length >= 3 ? 8 : 4) * px} />
          ))}
          {live ? (
            <>
              <line className={styles.rubber} x1={live.a.x} y1={live.a.y} x2={live.b.x} y2={live.b.y} />
              {dimLabel(live.a, live.b, "live", null)}
            </>
          ) : null}
          {rectStart && !rectLive ? <circle className={styles.draftPoint} cx={rectStart.x} cy={rectStart.y} r={4 * px} /> : null}
          {rectLive ? (
            <>
              <polygon className={styles.draftArea} points={rectLive.map((p) => `${p.x},${p.y}`).join(" ")} />
              {dimLabel(rectLive[0]!, rectLive[1]!, "rw", rectLive)}
              {dimLabel(rectLive[1]!, rectLive[2]!, "rl", rectLive)}
            </>
          ) : null}
          {cursor && tool !== "select" ? (
            <g className={styles.cursor} data-how={cursor.how}>
              <line x1={cursor.p.x - 9 * px} y1={cursor.p.y} x2={cursor.p.x + 9 * px} y2={cursor.p.y} />
              <line x1={cursor.p.x} y1={cursor.p.y - 9 * px} x2={cursor.p.x} y2={cursor.p.y + 9 * px} />
              {cursor.how === "corner" ? <circle cx={cursor.p.x} cy={cursor.p.y} r={7 * px} /> : null}
            </g>
          ) : null}
        </svg>
      </div>
      <p id={`${formId}-keys`} className="ed-small ed-muted">
        {t("keys")}
      </p>

      {message ? <Notice tone="attention">{message}</Notice> : null}

      {tool === "line" ? <WallEntry t={t} last={last} count={draft.length} onStart={(p) => addDraftPoint(p)} onAdd={(p) => addDraftPoint(p)} onClose={closeDraft} onUndoPoint={() => setDraft((d) => d.slice(0, -1))} onCancel={() => setDraft([])} locale={props.locale} /> : null}
      {tool === "rect" ? (
        <RectEntry
          t={t}
          onAdd={(pts) => {
            if (!addArea(pts)) return;
            setRectStart(null);
            setTool("select");
          }}
        />
      ) : null}
      {tool === "door" ? (
        <div className={styles.entry}>
          <h3 className={styles.listTitle}>{t("door.newTitle")}</h3>
          <div className={styles.fields}>
            <SelectField id={`${formId}-dkind`} label={t("door.kind")} value={doorKind} onChange={(e) => setDoorKind(e.target.value as RoomDoor["kind"])}>
              {DOOR_KIND_VALUES.map((k) => (
                <option key={k} value={k}>
                  {t(`door.kinds.${k}`)}
                </option>
              ))}
            </SelectField>
            <SelectField id={`${formId}-dwidth`} label={t("door.width")} value={String(doorWidth)} onChange={(e) => setDoorWidth(Number(e.target.value))}>
              {[800, 900, 1000, 1200, 1600, 1800, 2400, 3000].map((w) => (
                <option key={w} value={w}>
                  {m(w)} m
                </option>
              ))}
            </SelectField>
          </div>
          <p className="ed-small ed-muted">{t("door.typedHint")}</p>
        </div>
      ) : null}
      {tool === "pillar" ? <PillarEntry t={t} shape={pillarShape} size={pillarSize} locale={props.locale} onShape={setPillarShape} onSize={setPillarSize} onAdd={addPillarAt} /> : null}
      {tool === "measure" ? (
        <div className={styles.entry} aria-live="polite">
          <h3 className={styles.listTitle}>{t("measure.title")}</h3>
          {measures.length === 0 ? (
            <p className="ed-small ed-muted">{t("measure.none")}</p>
          ) : (
            <ol className={styles.walls}>
              {measures.map((ms, i) => (
                <li key={i}>{t("measure.item", { n: i + 1, length: m(Math.hypot(ms.b.x - ms.a.x, ms.b.y - ms.a.y)), dx: m(Math.abs(ms.b.x - ms.a.x)), dy: m(Math.abs(ms.b.y - ms.a.y)) })}</li>
              ))}
            </ol>
          )}
          {measures.length > 0 ? (
            <div className="ed-cluster">
              <Button size="sm" variant="quiet" onClick={() => setMeasures([])}>
                {t("measure.clear")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {tool === "select" && featSel?.kind === "door" && features.doors[featSel.index] ? (
        <DoorPanel
          key={features.doors[featSel.index]!.id}
          t={t}
          locale={props.locale}
          door={features.doors[featSel.index]!}
          index={featSel.index}
          wallLength={(() => {
            const d = features.doors[featSel.index]!;
            const a = areas.find((x) => x.id === d.areaId);
            return a && d.wall < a.points.length ? wallLengths(a.points)[d.wall]! : null;
          })()}
          onChange={(next) => setFeatures({ ...features, doors: features.doors.map((q, i) => (i === featSel.index ? next : q)) })}
          onRemove={removeSelected}
        />
      ) : null}
      {tool === "select" && featSel?.kind === "pillar" && features.pillars[featSel.index] ? (
        <PillarPanel
          key={features.pillars[featSel.index]!.id}
          t={t}
          locale={props.locale}
          pillar={features.pillars[featSel.index]!}
          index={featSel.index}
          onChange={(next) => setFeatures({ ...features, pillars: features.pillars.map((q, i) => (i === featSel.index ? next : q)) })}
          onRemove={removeSelected}
        />
      ) : null}
      {tool === "select" && selArea && sel ? (
        <SelectionPanel
          key={`${selArea.id}-${sel.corner ?? "w"}-${sel.wall ?? "a"}`}
          t={t}
          locale={props.locale}
          area={selArea}
          index={sel.area}
          sel={sel}
          onChange={(next) => commit(areas.map((a, ai) => (ai === sel.area ? next : a)))}
          onSplit={(wall) => {
            const a = selArea;
            if (a.points.length >= SPACE_LIMITS.areaPoints) return;
            const u = a.points[wall]!;
            const w = a.points[(wall + 1) % a.points.length]!;
            const pts = [...a.points];
            pts.splice(wall + 1, 0, { x: Math.round((u.x + w.x) / 2), y: Math.round((u.y + w.y) / 2) });
            commitRoom({ areas: areas.map((x, ai) => (ai === sel.area ? { ...x, points: pts } : x)), features: { ...features, doors: doorsAfterSplit(a.id, wall, Math.hypot(w.x - u.x, w.y - u.y) / 2) } });
            setSel({ area: sel.area, corner: wall + 1 });
          }}
          onAddDoor={(wall) => {
            const len = wallLengths(selArea.points)[wall]!;
            addDoorAt(selArea.id, wall, len / 2, len);
          }}
          onSelect={(s) => setSel(s)}
          onRemove={removeSelected}
        />
      ) : null}

      <section className="ed-stack" data-gap="2" aria-labelledby={`${formId}-list`}>
        <h3 id={`${formId}-list`} className={styles.listTitle}>
          {t("list.title")}
        </h3>
        {areas.length === 0 ? (
          <p className="ed-muted">{t("list.empty")}</p>
        ) : (
          <ul className={styles.list}>
            {areas.map((a, ai) => {
              const bad = problems.find((p) => p.index === ai);
              return (
                <li key={a.id}>
                  <span>
                    <strong>{a.name || t("list.unnamed", { n: ai + 1 })}</strong>{" "}
                    <span className="ed-small ed-muted">
                      {t("list.facts", { corners: a.points.length, area: (polygonArea(a.points) / 1e6).toLocaleString(props.locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 }) })}
                    </span>{" "}
                    {bad ? <Tag tone="danger">{t(`problems.${bad.problem}`)}</Tag> : null}
                  </span>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      changeTool("select");
                      setSel({ area: ai });
                    }}
                  >
                    {t("list.select")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {problems.length > 0 ? (
        <Notice tone="danger" title={t("problems.title")}>
          {t("problems.body")}
        </Notice>
      ) : null}
      {featureProblems.length > 0 ? (
        <Notice tone="danger" title={t("problems.title")}>
          <ul>
            {featureProblems.map((fp) => (
              <li key={`${fp.kind}${fp.index}`}>{t(`errors.${fp.kind}.${fp.problem}`, { n: fp.index + 1 })}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
      {features.doors.length + features.pillars.length > 0 ? (
        <section className="ed-stack" data-gap="2" aria-labelledby={`${formId}-feat`}>
          <h3 id={`${formId}-feat`} className={styles.listTitle}>
            {t("features.title")}
          </h3>
          <ul className={styles.list}>
            {features.doors.map((d, i) => (
              <li key={d.id}>
                <span>
                  <strong>{t("door.name", { n: i + 1 })}</strong> <span className="ed-small ed-muted">{t("door.facts", { kind: t(`door.kinds.${d.kind}`), width: m(d.widthMm) })}</span>
                </span>
                <Button size="sm" variant="quiet" onClick={() => (changeTool("select"), setFeatSel({ kind: "door", index: i }))}>
                  {t("list.select")}
                </Button>
              </li>
            ))}
            {features.pillars.map((pl, i) => (
              <li key={pl.id}>
                <span>
                  <strong>{t("pillar.name", { n: i + 1 })}</strong> <span className="ed-small ed-muted">{t(`pillar.facts.${pl.shape}`, { size: m(pl.sizeMm) })}</span>
                </span>
                <Button size="sm" variant="quiet" onClick={() => (changeTool("select"), setFeatSel({ kind: "pillar", index: i }))}>
                  {t("list.select")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {props.items.length > 0 ? <p className="ed-small ed-muted">{t("itemsNote")}</p> : null}

      <div className="ed-cluster">
        <Button variant="primary" onClick={save} disabled={saving || problems.length > 0 || featureProblems.length > 0 || (!dirty && props.initial.length > 0)}>
          {saving ? tc("status.saving") : areas.length === 0 && props.initial.length > 0 ? t("saveClear") : t("save")}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            if (dirty && !window.confirm(t("leaveConfirm"))) return;
            router.push(props.backHref);
          }}
        >
          {tc("actions.cancel")}
        </Button>
        {dirty ? <Tag>{t("unsaved")}</Tag> : null}
      </div>
    </div>
  );
}

type T = ReturnType<typeof useTranslations<"space.draw">>;

function metresField(v: string): number | null | "bad" {
  const mm = parseMetres(v);
  if (mm === null) return null;
  if (Number.isNaN(mm)) return "bad";
  return mm;
}

/** Typed walls: start point, then "length at angle" again and again — the keyboard's way to draw. */
function WallEntry({ t, last, count, onStart, onAdd, onClose, onUndoPoint, onCancel, locale }: { t: T; last: PlanPoint | null; count: number; onStart: (p: PlanPoint) => void; onAdd: (p: PlanPoint) => void; onClose: () => void; onUndoPoint: () => void; onCancel: () => void; locale: "ro" | "en" }) {
  const id = useId();
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [len, setLen] = useState("");
  const [angle, setAngle] = useState("0");
  const [err, setErr] = useState<Record<string, string>>({});
  const start = (e: FormEvent) => {
    e.preventDefault();
    const px = metresField(x);
    const py = metresField(y);
    const errors: Record<string, string> = {};
    if (px === null || px === "bad") errors.x = t("errors.measure");
    if (py === null || py === "bad") errors.y = t("errors.measure");
    setErr(errors);
    if (Object.keys(errors).length) return;
    onStart({ x: px as number, y: py as number });
  };
  const add = (e: FormEvent | null, deg?: number) => {
    e?.preventDefault();
    if (!last) return;
    const l = metresField(len);
    const a = deg ?? (/^-?\d+(\.\d+)?$/.test(angle.trim().replace(",", ".")) ? Number(angle.trim().replace(",", ".")) : NaN);
    const errors: Record<string, string> = {};
    if (l === null || l === "bad" || l <= 0) errors.len = t("errors.measure");
    if (Number.isNaN(a)) errors.angle = t("errors.angle");
    setErr(errors);
    if (Object.keys(errors).length) {
      document.getElementById(`${id}-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    const r = (a * Math.PI) / 180;
    onAdd({ x: Math.round(last.x + (l as number) * Math.cos(r)), y: Math.round(last.y + (l as number) * Math.sin(r)) });
    if (deg !== undefined) setAngle(String(deg));
  };
  if (!last) {
    return (
      <form className={styles.entry} onSubmit={start} noValidate aria-labelledby={`${id}-h`}>
        <h3 id={`${id}-h`} className={styles.listTitle}>
          {t("line.typedStart")}
        </h3>
        <div className={styles.fields}>
          <TextField id={`${id}-x`} label={t("fields.x")} inputMode="decimal" value={x} onChange={(e) => setX(e.target.value)} error={err.x} autoComplete="off" />
          <TextField id={`${id}-y`} label={t("fields.y")} inputMode="decimal" value={y} onChange={(e) => setY(e.target.value)} error={err.y} autoComplete="off" />
        </div>
        <Button type="submit">{t("line.startHere")}</Button>
      </form>
    );
  }
  return (
    <form className={styles.entry} onSubmit={(e) => add(e)} noValidate aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={styles.listTitle}>
        {t("line.typedNext", { n: count })}
      </h3>
      <p className="ed-small ed-muted">{t("line.from", { x: mmToMetresText(last.x, locale), y: mmToMetresText(last.y, locale) })}</p>
      <div className={styles.fields}>
        <TextField id={`${id}-len`} label={t("fields.length")} inputMode="decimal" value={len} onChange={(e) => setLen(e.target.value)} error={err.len} autoComplete="off" />
        <TextField id={`${id}-angle`} label={t("fields.angle")} hint={t("fields.angleHint")} inputMode="decimal" value={angle} onChange={(e) => setAngle(e.target.value)} error={err.angle} autoComplete="off" />
      </div>
      <div className="ed-cluster" role="group" aria-label={t("line.directions")}>
        <Button type="submit" size="sm">
          {t("line.addWall")}
        </Button>
        {([0, 90, 180, 270] as const).map((deg) => (
          <Button key={deg} size="sm" variant="quiet" onClick={() => add(null, deg)}>
            {t(`line.dir${deg}`)}
          </Button>
        ))}
      </div>
      <div className="ed-cluster">
        <Button size="sm" onClick={onClose} disabled={count < 3}>
          {t("line.close")}
        </Button>
        <Button size="sm" variant="quiet" onClick={onUndoPoint}>
          {t("line.undoPoint")}
        </Button>
        <Button size="sm" variant="quiet" onClick={onCancel}>
          {t("line.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Typed rectangle: width × length with its top-left corner. */
function RectEntry({ t, onAdd }: { t: T; onAdd: (pts: PlanPoint[]) => void }) {
  const id = useId();
  const [v, setV] = useState({ w: "", l: "", x: "0", y: "0" });
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const w = metresField(v.w);
    const l = metresField(v.l);
    const x = metresField(v.x);
    const y = metresField(v.y);
    const errors: Record<string, string> = {};
    if (w === null || w === "bad" || w <= 0) errors.w = t("errors.measure");
    if (l === null || l === "bad" || l <= 0) errors.l = t("errors.measure");
    if (x === null || x === "bad") errors.x = t("errors.measure");
    if (y === null || y === "bad") errors.y = t("errors.measure");
    setErr(errors);
    if (Object.keys(errors).length) {
      document.getElementById(`${id}-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    const [W, L, X, Y] = [w, l, x, y] as number[];
    onAdd([
      { x: X!, y: Y! },
      { x: X! + W!, y: Y! },
      { x: X! + W!, y: Y! + L! },
      { x: X!, y: Y! + L! },
    ]);
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form className={styles.entry} onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={styles.listTitle}>
        {t("rect.typed")}
      </h3>
      <div className={styles.fields}>
        <TextField id={`${id}-w`} label={t("fields.width")} inputMode="decimal" value={v.w} onChange={set("w")} error={err.w} autoComplete="off" />
        <TextField id={`${id}-l`} label={t("fields.depth")} inputMode="decimal" value={v.l} onChange={set("l")} error={err.l} autoComplete="off" />
        <TextField id={`${id}-x`} label={t("fields.x")} inputMode="decimal" value={v.x} onChange={set("x")} error={err.x} autoComplete="off" />
        <TextField id={`${id}-y`} label={t("fields.y")} inputMode="decimal" value={v.y} onChange={set("y")} error={err.y} autoComplete="off" />
      </div>
      <Button type="submit">{t("rect.add")}</Button>
    </form>
  );
}

/** The selected outline: its name, exact wall lengths, exact corners, delete. */
function SelectionPanel({
  t,
  locale,
  area,
  index,
  sel,
  onChange,
  onSplit,
  onAddDoor,
  onSelect,
  onRemove,
}: {
  t: T;
  locale: "ro" | "en";
  area: FloorArea;
  index: number;
  sel: NonNullable<Sel>;
  onChange: (a: FloorArea) => void;
  onSplit: (wall: number) => void;
  onAddDoor: (wall: number) => void;
  onSelect: (s: Sel) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const fm = (mm: number) => mmToMetresText(Math.round(mm), locale);
  const lengths = wallLengths(area.points);
  const [name, setName] = useState(area.name ?? "");
  const [wallLen, setWallLen] = useState(sel.wall !== undefined ? fm(lengths[sel.wall]!) : "");
  const corner = sel.corner !== undefined ? area.points[sel.corner]! : null;
  const [cx, setCx] = useState(corner ? fm(corner.x) : "");
  const [cy, setCy] = useState(corner ? fm(corner.y) : "");
  const [err, setErr] = useState<Record<string, string>>({});

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    onChange({ ...area, name: name.trim() ? name.trim().slice(0, 80) : null });
  };
  const saveWall = (e: FormEvent) => {
    e.preventDefault();
    const l = metresField(wallLen);
    if (sel.wall === undefined) return;
    if (l === null || l === "bad" || l <= 0) return setErr({ wall: t("errors.measure") });
    setErr({});
    onChange({ ...area, points: setWallLength(area.points, sel.wall, l) });
  };
  const saveCorner = (e: FormEvent) => {
    e.preventDefault();
    if (sel.corner === undefined) return;
    const x = metresField(cx);
    const y = metresField(cy);
    const errors: Record<string, string> = {};
    if (x === null || x === "bad") errors.cx = t("errors.measure");
    if (y === null || y === "bad") errors.cy = t("errors.measure");
    setErr(errors);
    if (Object.keys(errors).length) return;
    onChange({ ...area, points: area.points.map((p, i) => (i === sel.corner ? { x: x as number, y: y as number } : p)) });
  };
  return (
    <div className={styles.entry}>
      <h3 className={styles.listTitle}>{area.name || t("list.unnamed", { n: index + 1 })}</h3>
      <form onSubmit={saveName} className={styles.inline} noValidate>
        <TextField id={`${id}-name`} label={t("fields.name")} hint={t("fields.nameHint")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
        <Button type="submit" size="sm">
          {t("select.rename")}
        </Button>
      </form>

      {sel.wall !== undefined ? (
        <form onSubmit={saveWall} className={styles.inline} noValidate>
          <TextField id={`${id}-wall`} label={t("select.wallLength", { n: sel.wall + 1 })} hint={t("select.wallHint")} inputMode="decimal" value={wallLen} onChange={(e) => setWallLen(e.target.value)} error={err.wall} autoComplete="off" />
          <Button type="submit" size="sm">
            {t("select.apply")}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => onSplit(sel.wall!)}>
            {t("select.split")}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => onAddDoor(sel.wall!)}>
            {t("door.addHere")}
          </Button>
        </form>
      ) : null}

      {sel.corner !== undefined ? (
        <form onSubmit={saveCorner} noValidate className="ed-stack" data-gap="2">
          <div className={styles.fields}>
            <TextField id={`${id}-cx`} label={t("fields.x")} inputMode="decimal" value={cx} onChange={(e) => setCx(e.target.value)} error={err.cx} autoComplete="off" />
            <TextField id={`${id}-cy`} label={t("fields.y")} inputMode="decimal" value={cy} onChange={(e) => setCy(e.target.value)} error={err.cy} autoComplete="off" />
          </div>
          <div className="ed-cluster">
            <Button type="submit" size="sm">
              {t("select.moveCorner", { n: sel.corner + 1 })}
            </Button>
          </div>
        </form>
      ) : null}

      <details>
        <summary>{t("select.walls", { count: lengths.length })}</summary>
        <ol className={styles.walls}>
          {lengths.map((l, i) => (
            <li key={i}>
              <Button size="sm" variant="quiet" onClick={() => onSelect({ area: index, wall: i })} aria-pressed={sel.wall === i}>
                {t("select.wallItem", { n: i + 1, length: fm(l) })}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => onSelect({ area: index, corner: i })} aria-pressed={sel.corner === i}>
                {t("select.cornerItem", { n: i + 1 })}
              </Button>
            </li>
          ))}
        </ol>
      </details>

      <div className="ed-cluster">
        <Button size="sm" variant="danger-quiet" onClick={onRemove}>
          <IconTrash size={16} /> {sel.corner !== undefined ? t("select.removeCorner") : t("select.removeArea")}
        </Button>
      </div>
    </div>
  );
}

/** A door as the drawing tool draws it: the gap, the leaf (or leaves), the swing, and its clear floor when selected. */
function DoorShape({ d, px, selected }: { d: PlacedDoor; px: number; selected: boolean }) {
  const dir = d.swing === "out" ? { x: -d.inward.x, y: -d.inward.y } : d.inward;
  const leaf = (hinge: PlanPoint, free: PlanPoint, key: string) => {
    const w = Math.hypot(free.x - hinge.x, free.y - hinge.y);
    const open = { x: hinge.x + dir.x * w, y: hinge.y + dir.y * w };
    // sweep flag: which way round the arc goes from the closed to the open position
    const cross = (free.x - hinge.x) * (open.y - hinge.y) - (free.y - hinge.y) * (open.x - hinge.x);
    return (
      <g key={key}>
        <line className={styles.doorLeaf} x1={hinge.x} y1={hinge.y} x2={open.x} y2={open.y} />
        <path className={styles.doorSwing} d={`M ${free.x} ${free.y} A ${w} ${w} 0 0 ${cross > 0 ? 1 : 0} ${open.x} ${open.y}`} />
      </g>
    );
  };
  const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
  return (
    <g data-selected={selected || undefined} className={styles.door}>
      {selected ? <polygon className={styles.doorClear} points={doorClearance(d).map((q) => `${q.x},${q.y}`).join(" ")} /> : null}
      <line className={styles.doorGap} x1={d.a.x} y1={d.a.y} x2={d.b.x} y2={d.b.y} />
      <circle className={styles.doorJamb} cx={d.a.x} cy={d.a.y} r={2.5 * px} />
      <circle className={styles.doorJamb} cx={d.b.x} cy={d.b.y} r={2.5 * px} />
      {d.kind === "opening" ? null : d.swing === "sliding" ? (
        <line className={styles.doorLeaf} x1={d.a.x + d.inward.x * 80} y1={d.a.y + d.inward.y * 80} x2={d.b.x + d.inward.x * 80} y2={d.b.y + d.inward.y * 80} />
      ) : d.kind === "double" ? (
        <>
          {leaf(d.a, mid, "l")}
          {leaf(d.b, mid, "r")}
        </>
      ) : (
        leaf(d.a, d.b, "s")
      )}
    </g>
  );
}

/** The selected door: kind, width, where along its wall, which way it opens, which side the hinges are. */
function DoorPanel({ t, locale, door, index, wallLength, onChange, onRemove }: { t: T; locale: "ro" | "en"; door: RoomDoor; index: number; wallLength: number | null; onChange: (d: RoomDoor) => void; onRemove: () => void }) {
  const id = useId();
  const fm = (mm: number) => mmToMetresText(Math.round(mm), locale);
  const [width, setWidth] = useState(fm(door.widthMm));
  const [offset, setOffset] = useState(fm(door.offsetMm - door.widthMm / 2));
  const [err, setErr] = useState<Record<string, string>>({});
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const w = metresField(width);
    const o = metresField(offset);
    const errors: Record<string, string> = {};
    if (w === null || w === "bad" || w < FEATURE_LIMITS.minDoorMm || w > FEATURE_LIMITS.maxDoorMm) errors.width = t("errors.doorWidth");
    if (o === null || o === "bad" || o < 0) errors.offset = t("errors.measure");
    if (!errors.width && wallLength !== null && (w as number) > wallLength) errors.width = t("door.tooShort");
    if (!errors.width && !errors.offset && wallLength !== null && (o as number) + (w as number) > wallLength + 1) errors.offset = t("errors.door.offWall", { n: index + 1 });
    setErr(errors);
    if (Object.keys(errors).length) return;
    onChange({ ...door, widthMm: w as number, offsetMm: Math.round((o as number) + (w as number) / 2) });
  };
  return (
    <div className={styles.entry}>
      <h3 className={styles.listTitle}>{t("door.name", { n: index + 1 })}</h3>
      <div className={styles.fields}>
        <SelectField id={`${id}-kind`} label={t("door.kind")} value={door.kind} onChange={(e) => onChange({ ...door, kind: e.target.value as RoomDoor["kind"] })}>
          {DOOR_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {t(`door.kinds.${k}`)}
            </option>
          ))}
        </SelectField>
        {door.kind !== "opening" ? (
          <SelectField id={`${id}-swing`} label={t("door.swing")} value={door.swing} onChange={(e) => onChange({ ...door, swing: e.target.value as RoomDoor["swing"] })}>
            {DOOR_SWING_VALUES.map((k) => (
              <option key={k} value={k}>
                {t(`door.swings.${k}`)}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      <form onSubmit={apply} noValidate className="ed-stack" data-gap="2">
        <div className={styles.fields}>
          <TextField id={`${id}-width`} label={t("door.width")} inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} error={err.width} autoComplete="off" />
          <TextField id={`${id}-offset`} label={t("door.offset")} hint={t("door.offsetHint")} inputMode="decimal" value={offset} onChange={(e) => setOffset(e.target.value)} error={err.offset} autoComplete="off" />
        </div>
        <div className="ed-cluster">
          <Button type="submit" size="sm">
            {t("select.apply")}
          </Button>
          {door.kind !== "opening" && door.swing !== "sliding" ? (
            <Button size="sm" variant="quiet" onClick={() => onChange({ ...door, hinge: door.hinge === "start" ? "end" : "start" })}>
              {t("door.flipHinge")}
            </Button>
          ) : null}
        </div>
      </form>
      <p className="ed-small ed-muted">{t("door.clearNote")}</p>
      <div className="ed-cluster">
        <Button size="sm" variant="danger-quiet" onClick={onRemove}>
          <IconTrash size={16} /> {t("door.remove")}
        </Button>
      </div>
    </div>
  );
}

/** New pillars: their shape and size, and a typed position for the keyboard. */
function PillarEntry({ t, shape, size, locale, onShape, onSize, onAdd }: { t: T; shape: Pillar["shape"]; size: number; locale: "ro" | "en"; onShape: (s: Pillar["shape"]) => void; onSize: (n: number) => void; onAdd: (p: PlanPoint) => void }) {
  const id = useId();
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const px = metresField(x);
    const py = metresField(y);
    const errors: Record<string, string> = {};
    if (px === null || px === "bad") errors.x = t("errors.measure");
    if (py === null || py === "bad") errors.y = t("errors.measure");
    setErr(errors);
    if (Object.keys(errors).length) return;
    onAdd({ x: px as number, y: py as number });
  };
  return (
    <form className={styles.entry} onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={styles.listTitle}>
        {t("pillar.newTitle")}
      </h3>
      <div className={styles.fields}>
        <SelectField id={`${id}-shape`} label={t("pillar.shape")} value={shape} onChange={(e) => onShape(e.target.value as Pillar["shape"])}>
          <option value="round">{t("pillar.shapes.round")}</option>
          <option value="square">{t("pillar.shapes.square")}</option>
        </SelectField>
        <SelectField id={`${id}-size`} label={shape === "round" ? t("pillar.diameter") : t("pillar.side")} value={String(size)} onChange={(e) => onSize(Number(e.target.value))}>
          {[100, 200, 300, 400, 500, 600, 800, 1000].map((n) => (
            <option key={n} value={n}>
              {mmToMetresText(n, locale)} m
            </option>
          ))}
        </SelectField>
        <TextField id={`${id}-x`} label={t("fields.x")} inputMode="decimal" value={x} onChange={(e) => setX(e.target.value)} error={err.x} autoComplete="off" />
        <TextField id={`${id}-y`} label={t("fields.y")} inputMode="decimal" value={y} onChange={(e) => setY(e.target.value)} error={err.y} autoComplete="off" />
      </div>
      <Button type="submit">{t("pillar.add")}</Button>
    </form>
  );
}

/** The selected pillar: shape, exact size and position. */
function PillarPanel({ t, locale, pillar, index, onChange, onRemove }: { t: T; locale: "ro" | "en"; pillar: Pillar; index: number; onChange: (p: Pillar) => void; onRemove: () => void }) {
  const id = useId();
  const fm = (mm: number) => mmToMetresText(Math.round(mm), locale);
  const [v, setV] = useState({ size: fm(pillar.sizeMm), x: fm(pillar.x), y: fm(pillar.y) });
  const [err, setErr] = useState<Record<string, string>>({});
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const size = metresField(v.size);
    const x = metresField(v.x);
    const y = metresField(v.y);
    const errors: Record<string, string> = {};
    if (size === null || size === "bad" || size < FEATURE_LIMITS.minPillarMm || size > FEATURE_LIMITS.maxPillarMm) errors.size = t("errors.pillarSize");
    if (x === null || x === "bad") errors.x = t("errors.measure");
    if (y === null || y === "bad") errors.y = t("errors.measure");
    setErr(errors);
    if (Object.keys(errors).length) return;
    onChange({ ...pillar, sizeMm: size as number, x: x as number, y: y as number });
  };
  return (
    <form className={styles.entry} onSubmit={apply} noValidate>
      <h3 className={styles.listTitle}>{t("pillar.name", { n: index + 1 })}</h3>
      <div className={styles.fields}>
        <SelectField id={`${id}-shape`} label={t("pillar.shape")} value={pillar.shape} onChange={(e) => onChange({ ...pillar, shape: e.target.value as Pillar["shape"] })}>
          <option value="round">{t("pillar.shapes.round")}</option>
          <option value="square">{t("pillar.shapes.square")}</option>
        </SelectField>
        <TextField id={`${id}-size`} label={pillar.shape === "round" ? t("pillar.diameter") : t("pillar.side")} inputMode="decimal" value={v.size} onChange={(e) => setV((s) => ({ ...s, size: e.target.value }))} error={err.size} autoComplete="off" />
        <TextField id={`${id}-x`} label={t("fields.x")} inputMode="decimal" value={v.x} onChange={(e) => setV((s) => ({ ...s, x: e.target.value }))} error={err.x} autoComplete="off" />
        <TextField id={`${id}-y`} label={t("fields.y")} inputMode="decimal" value={v.y} onChange={(e) => setV((s) => ({ ...s, y: e.target.value }))} error={err.y} autoComplete="off" />
      </div>
      <div className="ed-cluster">
        <Button type="submit" size="sm">
          {t("select.apply")}
        </Button>
        <Button size="sm" variant="danger-quiet" onClick={onRemove}>
          <IconTrash size={16} /> {t("pillar.remove")}
        </Button>
      </div>
    </form>
  );
}
