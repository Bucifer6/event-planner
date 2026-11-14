"use client";

import { checkFit, mm2ToM2, type FitIssue, type FitResult } from "@ed/core/fitcheck";
import type { MealStageView, RosterHousehold } from "@ed/core/seating";
import { applyStage, buildPlanScene, findFreeSpot, GRID_MM, itemHasDims, itemSizeText, mmToMetresText, parseMetres, shapeUsesDiameter, snapPosition, TABLE_PRESET_GROUPS, TABLE_PRESETS, TABLE_SHAPE_VALUES, type PlanItem, type PlanModel, type StageItemState, type TableShape } from "@ed/core/spacemodel";
import { Button, Checkbox, IconButton, Notice, Section, SelectField, Sheet, Tag, TextField, Unknown } from "@ed/ui";
import { IconAlert, IconArrowLeft, IconArrowRight, IconCheck, IconClose, IconInfo, IconMinus, IconPlus } from "@ed/ui/icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  addDefaultStagesAction,
  addFixtureAction,
  addMealStageAction,
  addTableAction,
  assignSeatsAction,
  moveItemAction,
  moveMealStageAction,
  removeItemAction,
  removeMealStageAction,
  renameMealStageAction,
  setSeatNumberAction,
  setStageItemAction,
  unassignSeatsAction,
  updateItemAction,
} from "@/app/actions/seating";
import { PlanSvg } from "./PlanSvg";
import { useMeasuredWidth } from "./PlanView";
import styles from "./plan.module.css";

// THE SEATING DESK (C-01, C-02) — the planner arranges tables on the space model and seats
// guests. Two paths of equal standing for every arrangement action (Q8, Q10, A12):
//
//   tap / keyboard   select an item (tap, or Tab + Enter) → the bar at the bottom moves it in
//                    10 cm / 50 cm steps, rotates it, places it where you tap ("Așază aici")
//                    or at typed coordinates; arrow keys nudge a focused item.
//   drag             pointer events: the item is magnified and lifted above the finger, has a
//                    ≥44 px grip even when drawn smaller, snaps to the 10 cm grid and to
//                    walls / neighbours, and is cancelled by Escape or by dropping it back
//                    where it was.
//
// Every change is applied on screen at once and saved in the background (idempotent actions);
// a stale write is answered with words, never with a silent loss.

type Locale = "ro" | "en";

export type SeatingEditorProps = {
  occasionId: string;
  locale: Locale;
  canManage: boolean;
  /** Base layout: geometry, stated facts and the placed items (each with its version). */
  model: PlanModel;
  stages: MealStageView[];
  roster: RosterHousehold[];
  /** People who confirmed (adults + children). */
  attending: number;
  /** Everyone invited, when known. */
  invited: number | null;
  title: { name: string; meta: string | null };
  pictureUrl: string | null;
  /** Names of the points of interest, in the order they are numbered on the plan. */
  poiLabels: string[];
  /** Changes whenever the server data changed: the desk then takes the server's state. */
  syncKey: string;
};

type Drag = { id: string; x: number; y: number; originX: number; originY: number; back: boolean; guideX: boolean; guideY: boolean };
type SheetName = "add" | "position" | "assign" | "edit" | "remove" | "stages" | "more" | null;

const newClientId = () => {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "c";
  const bytes = crypto.getRandomValues(new Uint8Array(23));
  for (const b of bytes) s += a[b % a.length];
  return s;
};
const pluralKey = (n: number, locale: Locale) => {
  const r = new Intl.PluralRules(locale).select(n);
  return r === "one" ? "one" : r === "few" ? "few" : "other";
};

export function SeatingEditor(props: SeatingEditorProps) {
  const t = useTranslations("seating");
  const tc = useTranslations("common");
  const router = useRouter();
  const { occasionId, locale, canManage, roster } = props;

  const [items, setItems] = useState<PlanItem[]>(props.model.items);
  const [stages, setStages] = useState<MealStageView[]>(props.stages);
  const [stageId, setStageId] = useState<string>("base");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<100 | 500>(100);
  const [zoom, setZoom] = useState(1);
  const [placeMode, setPlaceMode] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [saving, setSaving] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const pending = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  // the server's state wins whenever it changes and nothing of ours is still on its way
  useEffect(() => {
    if (pending.current > 0 || timers.current.size > 0) return;
    setItems(props.model.items);
    setStages(props.stages);
  }, [props.syncKey]);

  const stage = stageId === "base" ? null : (stages.find((s) => s.id === stageId) ?? null);
  useEffect(() => {
    if (stageId !== "base" && !stages.some((s) => s.id === stageId)) setStageId("base");
  }, [stages, stageId]);

  /* ── derived: seats taken, the layout of the active stage, fit ── */
  const seated = useMemo(() => {
    const m = new Map<string, number>();
    const add = (id: string | null, n: number) => id && m.set(id, (m.get(id) ?? 0) + n);
    for (const h of roster) {
      for (const a of h.adults) add(a.tableItemId, 1);
      if (h.extra) add(h.extra.tableItemId, h.extra.count);
      if (h.children) add(h.children.tableItemId, h.children.count);
    }
    return m;
  }, [roster]);

  const baseModel: PlanModel = useMemo(() => ({ ...props.model, items: items.map((i) => (i.kind === "table" ? { ...i, seated: seated.get(i.id) ?? 0 } : i)) }), [props.model, items, seated]);
  const stageStates: StageItemState[] = stage?.states ?? [];
  const awayIds = useMemo(() => stageStates.filter((s) => !s.present).map((s) => s.itemId), [stageStates]);
  /** What the fit check sees (items put away are gone). */
  const liveModel = useMemo(() => applyStage(baseModel, stageStates), [baseModel, stageStates]);
  /** What is drawn: items put away stay visible, faded, so they can be brought back. */
  const shownModel: PlanModel = useMemo(() => {
    const by = new Map(stageStates.map((s) => [s.itemId, s]));
    return {
      ...baseModel,
      items: baseModel.items.map((it) => {
        const s = by.get(it.id);
        const moved = s ? { ...it, x: s.x ?? it.x, y: s.y ?? it.y, rotation: s.rotation ?? it.rotation } : it;
        return drag && drag.id === it.id ? { ...moved, x: drag.x, y: drag.y } : moved;
      }),
    };
  }, [baseModel, stageStates, drag]);

  const fit = useMemo(() => checkFit(liveModel, { needed: props.attending }), [liveModel, props.attending]);
  const stageFits = useMemo(() => new Map(stages.map((s) => [s.id, checkFit(applyStage(baseModel, s.states), { needed: props.attending }).status])), [stages, baseModel, props.attending]);
  const baseFit = useMemo(() => (stageId === "base" ? fit.status : checkFit(baseModel, { needed: props.attending }).status), [stageId, fit, baseModel, props.attending]);

  const selected = selectedId ? (shownModel.items.find((i) => i.id === selectedId) ?? null) : null;
  const selectedAway = !!selected && awayIds.includes(selected.id);

  /* ── the sheet ── */
  const [wrapRef, measured] = useMeasuredWidth<HTMLDivElement>();
  const baseWidth = Math.min(measured || 358, 1080);
  const width = Math.round(baseWidth * zoom);
  const scene = useMemo(
    () => buildPlanScene(shownModel, { width, title: props.title, showCounts: true, showParking: false, scaleLabel: (n) => `${n} m`, withBackdrop: props.model.areas.length === 0 }),
    [shownModel, width, props.title, props.model.areas.length],
  );
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const clientToMm = useCallback((clientX: number, clientY: number) => {
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const sc = sceneRef.current;
    const px = ((clientX - r.left) * sc.width) / r.width;
    const py = ((clientY - r.top) * sc.height) / r.height;
    return { x: (px - sc.originX) / sc.scale, y: (py - sc.originY) / sc.scale };
  }, [wrapRef]);

  /* ── saving: optimistic, queued, idempotent ── */
  const run = useCallback(
    <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>, opts: { refresh?: boolean } = {}) => {
      pending.current += 1;
      setSaving((n) => n + 1);
      const p = chain.current.then(async () => {
        try {
          const res = await fn();
          if (!res.ok) {
            setProblem(res.error.message);
            // someone else changed it, or it is gone: take the server's state
            pending.current -= 1;
            setSaving((n) => n - 1);
            if (pending.current === 0) router.refresh();
            return null;
          }
          setProblem(null);
          setSavedOnce(true);
          pending.current -= 1;
          setSaving((n) => n - 1);
          if (opts.refresh && pending.current === 0) router.refresh();
          return res.data;
        } catch {
          pending.current -= 1;
          setSaving((n) => n - 1);
          setProblem(t("errors.network"));
          return null;
        }
      });
      chain.current = p;
      return p;
    },
    [router, t],
  );

  /** Saves where an item is NOW (base layout or the active stage), a moment after the last change. */
  const scheduleSave = useCallback(
    (id: string, forStage: string) => {
      const key = `${forStage}:${id}`;
      const old = timers.current.get(key);
      if (old) clearTimeout(old);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          if (forStage === "base") {
            const it = itemsRef.current.find((i) => i.id === id);
            if (!it) return;
            void run(() => moveItemAction({ itemId: id, x: it.x, y: it.y, rotation: it.rotation, version: it.version })).then((saved) => {
              if (!saved) return;
              // keep whatever moved on screen since; only the version moves forward
              setItems((list) => list.map((i) => (i.id === id ? { ...i, version: saved.version } : i)));
            });
          } else {
            const st = stagesRef.current.find((s) => s.id === forStage)?.states.find((s) => s.itemId === id);
            if (!st) return;
            void run(() => setStageItemAction({ stageId: forStage, itemId: id, present: st.present, x: st.x, y: st.y, rotation: st.rotation }));
          }
        }, 450),
      );
    },
    [run],
  );

  /** Moves / rotates an item in the active layout. */
  const place = useCallback(
    (id: string, to: { x?: number; y?: number; rotation?: number }) => {
      if (!canManage) return;
      const clamp = (v: number) => Math.max(-400_000, Math.min(400_000, Math.round(v)));
      if (stageId === "base") {
        setItems((list) => list.map((i) => (i.id === id ? { ...i, x: to.x !== undefined ? clamp(to.x) : i.x, y: to.y !== undefined ? clamp(to.y) : i.y, rotation: to.rotation !== undefined ? ((to.rotation % 360) + 360) % 360 : i.rotation } : i)));
      } else {
        const base = itemsRef.current.find((i) => i.id === id);
        if (!base) return;
        setStages((list) =>
          list.map((s) => {
            if (s.id !== stageId) return s;
            const cur = s.states.find((x) => x.itemId === id) ?? { itemId: id, present: true, x: null, y: null, rotation: null };
            const next: StageItemState = {
              ...cur,
              x: clamp(to.x ?? cur.x ?? base.x),
              y: clamp(to.y ?? cur.y ?? base.y),
              rotation: to.rotation !== undefined ? ((to.rotation % 360) + 360) % 360 : cur.rotation,
            };
            return { ...s, states: [...s.states.filter((x) => x.itemId !== id), next] };
          }),
        );
      }
      scheduleSave(id, stageId);
    },
    [canManage, stageId, scheduleSave],
  );

  const nudge = useCallback(
    (id: string, dx: number, dy: number, by: number = step) => {
      const it = shownModelRef.current.items.find((i) => i.id === id);
      if (!it) return;
      place(id, { x: it.x + dx * by, y: it.y + dy * by });
    },
    [place, step],
  );
  const shownModelRef = useRef(shownModel);
  shownModelRef.current = shownModel;

  const rotate = (id: string, by: number) => {
    const it = shownModel.items.find((i) => i.id === id);
    if (it) place(id, { rotation: it.rotation + by });
  };

  function setPresent(id: string, present: boolean) {
    if (!stage) return;
    const cur = stage.states.find((x) => x.itemId === id) ?? { itemId: id, present: true, x: null, y: null, rotation: null };
    const next = { ...cur, present };
    setStages((list) => list.map((s) => (s.id === stage.id ? { ...s, states: [...s.states.filter((x) => x.itemId !== id), next] } : s)));
    void run(() => setStageItemAction({ stageId: stage.id, itemId: id, present, x: next.x, y: next.y, rotation: next.rotation }));
  }
  function resetStageItem(id: string) {
    if (!stage) return;
    setStages((list) => list.map((s) => (s.id === stage.id ? { ...s, states: s.states.filter((x) => x.itemId !== id) } : s)));
    void run(() => setStageItemAction({ stageId: stage.id, itemId: id, present: true }));
  }

  /* ── drag (enhancement) ── */
  const dragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number; started: boolean; lift: number } | null>(null);

  const endDrag = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag((cur) => {
        if (commit && cur && d && !cur.back) place(d.id, { x: cur.x, y: cur.y });
        return null;
      });
    },
    [place],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (!d.started) {
        if (dist < 6) return;
        d.started = true;
      }
      e.preventDefault();
      const sc = sceneRef.current;
      const svg = wrapRef.current?.querySelector("svg");
      const ratio = svg ? sc.width / svg.getBoundingClientRect().width : 1;
      const raw = { x: d.originX + ((e.clientX - d.startX) * ratio) / sc.scale, y: d.originY + ((e.clientY - d.startY - d.lift) * ratio) / sc.scale };
      const item = shownModelRef.current.items.find((i) => i.id === d.id);
      if (!item) return;
      // generous snap: grid first, then walls and neighbours within 25 cm
      const snap = snapPosition({ ...shownModelRef.current, items: shownModelRef.current.items.filter((i) => !awayRef.current.includes(i.id)) }, item, raw, { gridMm: GRID_MM, toleranceMm: 250 });
      // dropped (nearly) where it started = cancelled
      const back = dist < 22;
      setDrag({ id: d.id, x: back ? d.originX : snap.x, y: back ? d.originY : snap.y, originX: d.originX, originY: d.originY, back, guideX: !back && snap.snappedX !== "grid", guideY: !back && snap.snappedY !== "grid" });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.started) endDrag(true);
      else dragRef.current = null;
    };
    const cancel = (e: PointerEvent) => {
      if (dragRef.current && e.pointerId === dragRef.current.pointerId) endDrag(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        e.preventDefault();
        endDrag(false);
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [endDrag, wrapRef]);
  const awayRef = useRef(awayIds);
  awayRef.current = awayIds;

  // two fingers on the sheet zoom the SHEET, not the page
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e), zoom: zoomRef.current };
    };
    const onMove = (e: TouchEvent) => {
      // a finger that went down on an item drags it: the sheet must not scroll under it
      // (touch-action on SVG children is not honoured everywhere, so say it here too)
      if (e.touches.length === 1 && dragRef.current) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (e.touches.length !== 2 || !start) return;
      e.preventDefault();
      setZoom(Math.max(1, Math.min(4, Math.round(start.zoom * (dist(e) / start.dist) * 20) / 20)));
    };
    const onEnd = () => {
      start = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [wrapRef]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  function itemPointerDown(id: string, e: ReactPointerEvent<SVGGElement>) {
    if (placeMode) return; // the next touch says WHERE the selected item goes, whatever is under it
    setSelectedId(id);
    if (!canManage || (e.pointerType === "mouse" && e.button !== 0)) return;
    const it = shownModel.items.find((i) => i.id === id);
    if (!it || awayIds.includes(id)) return;
    // a finger hides what it touches: the dragged item rides 56 px above it
    dragRef.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: it.x, originY: it.y, started: false, lift: e.pointerType === "touch" ? 56 : 0 };
  }

  function sheetPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.started) return;
    const onItem = (e.target as Element).closest("[data-item]");
    if (placeMode && selected && canManage) {
      const at = clientToMm(e.clientX, e.clientY);
      if (!at) return;
      const snap = snapPosition(liveModel, selected, at, { toleranceMm: 150 });
      place(selected.id, { x: snap.x, y: snap.y });
      setPlaceMode(false);
      return;
    }
    if (!onItem) setSelectedId(null);
  }

  function itemKey(id: string, e: KeyboardEvent<SVGGElement>) {
    const by = e.shiftKey ? 500 : step;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      setSelectedId(id);
      if (canManage && !awayIds.includes(id)) nudge(id, arrows[e.key]![0], arrows[e.key]![1], by);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedId(id);
    } else if (e.key === "r" || e.key === "R") {
      if (canManage) rotate(id, e.shiftKey ? -15 : 15);
    } else if (e.key === "Escape") {
      setSelectedId(null);
      setPlaceMode(false);
    }
  }

  /* ── words ── */
  const sizeOf = (it: Pick<PlanItem, "shape" | "diameterMm" | "widthMm" | "lengthMm">) => itemSizeText(it, locale);
  const tableName = (it: PlanItem) => (it.kind === "table" ? t("table", { label: it.label }) : it.label);
  const seatsText = (it: PlanItem) => (it.seats === null ? t("seatsUnknown", { taken: it.seated ?? 0 }) : t("seatsOf", { taken: it.seated ?? 0, seats: it.seats }));
  const ariaFor = (it: PlanItem) =>
    [tableName(it), it.source === "custom" ? t("custom") : t("venueSupplied"), sizeOf(it) ?? t("sizeUnknown"), it.kind === "table" ? seatsText(it) : null, awayIds.includes(it.id) ? t("stage.away") : null, fit.conflictIds.includes(it.id) ? t("hasProblem") : null]
      .filter(Boolean)
      .join(", ");
  const issueText = (i: FitIssue) => {
    const [a, b] = i.labels;
    const name = (id: string, label: string) => {
      const it = liveModel.items.find((x) => x.id === id);
      return it ? tableName(it) : label;
    };
    if (i.type === "overlap") return t("issues.overlap", { a: name(i.itemIds[0]!, a!), b: name(i.itemIds[1]!, b!) });
    if (i.type === "tooClose") return t("issues.tooClose", { a: name(i.itemIds[0]!, a!), b: name(i.itemIds[1]!, b!), gap: Math.round((i.value ?? 0) / 10), min: Math.round(props.model.aisleMm / 10) });
    if (i.type === "outside") return t("issues.outside", { a: name(i.itemIds[0]!, a!) });
    return t("issues.overInventory", { name: a!, count: i.value ?? 0 });
  };

  const tables = baseModel.items.filter((i) => i.kind === "table");
  const unseatedHouseholds = roster
    .filter((h) => h.attending !== "no")
    .map((h) => ({ h, adults: h.adults.filter((a) => !a.tableItemId), extra: h.extra && !h.extra.tableItemId ? h.extra : null, children: h.children && !h.children.tableItemId ? h.children : null }))
    .filter((x) => x.adults.length > 0 || x.extra || x.children);
  const unseatedCount = unseatedHouseholds.reduce((n, x) => n + x.adults.length + (x.extra?.count ?? 0) + (x.children?.count ?? 0), 0);

  const tabMark = (status: FitResult["status"]) => (
    <span className={styles.tabMark} data-status={status}>
      {status === "fits" ? <IconCheck size={14} /> : status === "no" ? <IconAlert size={14} /> : <IconInfo size={14} />}
      <span className="ed-vh">{t(`fit.short.${status}`)}</span>
    </span>
  );

  const itemProps = (id: string) => {
    const it = shownModel.items.find((i) => i.id === id);
    if (!it) return undefined;
    const sc = scene.items.find((s) => s.id === id);
    const dragging = drag?.id === id && !drag.back;
    return {
      className: `${styles.item} ${canManage ? styles.grab : ""} ${dragging ? styles.itemDrag : ""}`,
      tabIndex: 0,
      role: "button" as const,
      "aria-label": ariaFor(it),
      "aria-pressed": selectedId === id,
      // Q10: magnified and lifted while it is being dragged
      transform: dragging && sc ? `translate(${sc.cx} ${sc.cy}) scale(1.18) translate(${-sc.cx} ${-sc.cy})` : undefined,
      onPointerDown: (e: ReactPointerEvent<SVGGElement>) => itemPointerDown(id, e),
      onFocus: () => setSelectedId(id),
      onKeyDown: (e: KeyboardEvent<SVGGElement>) => itemKey(id, e),
    };
  };

  const dragOrigin = drag ? { x: scene.originX + drag.originX * scene.scale, y: scene.originY + drag.originY * scene.scale } : null;
  const dragAt = drag ? { x: scene.originX + drag.x * scene.scale, y: scene.originY + drag.y * scene.scale } : null;

  return (
    <div className={styles.frame}>
      {/* stage tabs: the base layout, then one variant per stage of the meal */}
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label={t("stage.tabs")}>
          <button type="button" role="tab" className={styles.tab} aria-selected={stageId === "base"} onClick={() => setStageId("base")}>
            {t("stage.base")}
            {tabMark(baseFit)}
          </button>
          {stages.map((s) => (
            <button key={s.id} type="button" role="tab" className={styles.tab} aria-selected={stageId === s.id} onClick={() => setStageId(s.id)}>
              {s.name}
              {tabMark(stageFits.get(s.id) ?? "unknown")}
            </button>
          ))}
        </div>
        {canManage ? (
          <Button size="sm" variant="quiet" onClick={() => setSheet("stages")}>
            {t("stage.manage")}
          </Button>
        ) : null}
      </div>

      <FitStrip
        fit={fit}
        attending={props.attending}
        invited={props.invited}
        stageName={stage?.name ?? null}
        locale={locale}
        issueText={issueText}
        onShow={(id) => {
          setSelectedId(id);
          wrapRef.current?.querySelector<SVGGElement>(`[data-item="${id}"]`)?.focus();
        }}
      />

      <div
        ref={wrapRef}
        className={`ed-plan ${styles.sheet} ${styles.tall} ${placeMode ? styles.crosshair : ""}`}
        data-zoomed={zoom > 1 ? "true" : undefined}
        data-backdrop={props.pictureUrl && scene.backdrop ? "true" : undefined}
        onPointerUp={sheetPointerUp}
      >
        <PlanSvg
          scene={scene}
          label={t("planLabel", { name: props.title.name })}
          pictureUrl={props.pictureUrl}
          selectedId={selectedId}
          conflictIds={fit.conflictIds}
          awayIds={awayIds}
          itemProps={itemProps}
          displayWidth={zoom > 1 ? width : undefined}
          svgProps={zoom > 1 ? { style: { width, height: "auto" } } : undefined}
        >
          {drag && dragOrigin && dragAt ? (
            <>
              <circle cx={dragOrigin.x} cy={dragOrigin.y} r={16} data-role="origin" />
              {drag.guideX ? <line x1={dragAt.x} y1={0} x2={dragAt.x} y2={scene.height} data-role="halo" /> : null}
              {drag.guideY ? <line x1={0} y1={dragAt.y} x2={scene.width} y2={dragAt.y} data-role="halo" /> : null}
            </>
          ) : null}
        </PlanSvg>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolGroup}>
          <IconButton label={t("zoom.out")} onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 2) / 2))} disabled={zoom <= 1}>
            <IconMinus />
          </IconButton>
          <span className="ed-small ed-num" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton label={t("zoom.in")} onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.5) * 2) / 2))} disabled={zoom >= 4}>
            <IconPlus />
          </IconButton>
        </div>
        <span className={styles.saveState} role="status" aria-live="polite">
          {saving > 0 ? t("saving") : savedOnce ? t("saved") : ""}
        </span>
      </div>

      <ul className={styles.key}>
        <li>
          <span className={styles.swatch} data-kind="venue" />
          {t("key.venue")}
        </li>
        <li>
          <span className={styles.swatch} data-kind="custom" />
          {t("key.custom")}
        </li>
        <li>
          <span className={styles.swatch} data-kind="fixture" />
          {t("key.fixture")}
        </li>
        <li>
          <span className={styles.swatch} data-kind="unknown" />
          {t("key.unknown")}
        </li>
      </ul>

      {props.poiLabels.length > 0 ? (
        <ol className={styles.legend}>
          {props.poiLabels.map((text, i) => (
            <li key={i}>
              <span className={styles.legendMark}>{i + 1}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {problem ? (
        <Notice tone="danger" title={problem} role="alert">
          {t("errors.reloaded")}
        </Notice>
      ) : null}
      {stage ? <p className="ed-small ed-muted">{t("stage.hint", { name: stage.name })}</p> : null}

      {/* ── the selected item's actions: at the bottom, in thumb reach ── */}
      {selected ? (
        <div className={styles.bar} role="region" aria-label={t("bar.label", { name: tableName(selected) })}>
          <div className={styles.barHead}>
            <div className={styles.barTitle}>
              <strong>{tableName(selected)}</strong>
              <span className={styles.barMeta}>
                {selected.name} · {sizeOf(selected) ?? <Unknown label={t("sizeUnknown")} />}
                {selected.kind === "table" ? <> · {seatsText(selected)}</> : null}
              </span>
              <span>
                <Tag>{selected.source === "custom" ? t("custom") : t("venueSupplied")}</Tag>
              </span>
            </div>
            <IconButton
              label={t("bar.deselect")}
              onClick={() => {
                setSelectedId(null);
                setPlaceMode(false);
              }}
            >
              <IconClose />
            </IconButton>
          </div>
          {!itemHasDims(selected) ? (
            <p className={styles.barNote} data-tone="unknown">
              <IconInfo size={16} />
              <span>{t("bar.unknownDims")}</span>
            </p>
          ) : null}
          {selectedAway ? (
            <p className={styles.barNote} data-tone="unknown">
              <IconInfo size={16} />
              <span>{t("stage.awayNote", { name: stage?.name ?? "" })}</span>
            </p>
          ) : null}
          {fit.issues
            .filter((i) => i.itemIds.includes(selected.id))
            .map((i, n) => (
              <p className={styles.barNote} key={n}>
                <IconAlert size={16} />
                <span>{issueText(i)}</span>
              </p>
            ))}
          {selected.kind === "table" && selected.seats !== null && (selected.seated ?? 0) > selected.seats ? (
            <p className={styles.barNote}>
              <IconAlert size={16} />
              <span>{t("bar.overCapacity", { over: (selected.seated ?? 0) - selected.seats })}</span>
            </p>
          ) : null}
          {placeMode ? (
            <div className={styles.placing} role="status">
              <span>{t("bar.placeHint")}</span>
              <Button size="sm" variant="quiet" onClick={() => setPlaceMode(false)}>
                {t("bar.placeCancel")}
              </Button>
            </div>
          ) : null}
          {canManage ? (
            <div className={styles.barBody}>
              {!selectedAway ? (
                <div className={styles.pad} role="group" aria-label={t("bar.move")}>
                  <Button aria-label={t("bar.left", { cm: step / 10 })} title={t("bar.left", { cm: step / 10 })} onClick={() => nudge(selected.id, -1, 0)}>
                    <IconArrowLeft />
                  </Button>
                  <Button aria-label={t("bar.up", { cm: step / 10 })} title={t("bar.up", { cm: step / 10 })} onClick={() => nudge(selected.id, 0, -1)}>
                    <IconArrowLeft style={{ transform: "rotate(90deg)" }} />
                  </Button>
                  <Button aria-label={t("bar.down", { cm: step / 10 })} title={t("bar.down", { cm: step / 10 })} onClick={() => nudge(selected.id, 0, 1)}>
                    <IconArrowRight style={{ transform: "rotate(90deg)" }} />
                  </Button>
                  <Button aria-label={t("bar.right", { cm: step / 10 })} title={t("bar.right", { cm: step / 10 })} onClick={() => nudge(selected.id, 1, 0)}>
                    <IconArrowRight />
                  </Button>
                  <Button className={styles.padStep} variant="quiet" aria-label={t("bar.stepLabel", { cm: step / 10 })} title={t("bar.stepLabel", { cm: step / 10 })} onClick={() => setStep((s) => (s === 100 ? 500 : 100))}>
                    {t("bar.step", { cm: step / 10 })}
                  </Button>
                </div>
              ) : null}
              <div className={styles.barActions}>
                {!selectedAway ? (
                  <>
                    <div className={styles.rot} role="group" aria-label={t("bar.rotate")}>
                      <Button onClick={() => rotate(selected.id, -15)} aria-label={t("bar.rotateLeft")}>
                        −15°
                      </Button>
                      <Button onClick={() => rotate(selected.id, 15)} aria-label={t("bar.rotateRight")}>
                        +15°
                      </Button>
                      <Button onClick={() => rotate(selected.id, 90)} aria-label={t("bar.rotateQuarter")}>
                        90°
                      </Button>
                    </div>
                    <Button aria-pressed={placeMode} onClick={() => setPlaceMode((v) => !v)}>
                      {t("bar.placeHere")}
                    </Button>
                  </>
                ) : null}
                {stage ? (
                  <Button onClick={() => setPresent(selected.id, selectedAway)}>{selectedAway ? t("stage.bringBack") : t("stage.putAway")}</Button>
                ) : selected.kind === "table" ? (
                  <Button onClick={() => setSheet("assign")}>{t("bar.guests")}</Button>
                ) : null}
                <Button variant="quiet" onClick={() => setSheet("more")}>
                  {t("bar.more")}
                </Button>
              </div>
            </div>
          ) : selected.kind === "table" ? (
            <div>
              <Button size="sm" onClick={() => setSheet("assign")}>
                {t("bar.seeGuests")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : canManage ? (
        <div className="ed-actionbar">
          <Button variant="primary" onClick={() => setSheet("add")}>
            <IconPlus size={16} />
            {t("add.open")}
          </Button>
        </div>
      ) : null}

      {/* ── tables and people ── */}
      <div className={styles.twoCol}>
        <Section title={t("tables.title", { count: tables.length })} level={3}>
          {tables.length === 0 ? (
            <p className="ed-muted">{canManage ? t("tables.empty") : t("tables.emptyRead")}</p>
          ) : (
            <div>
              {tables.map((it) => (
                <button
                  type="button"
                  className={styles.tableRow}
                  key={it.id}
                  onClick={() => {
                    setSelectedId(it.id);
                    setStageId("base");
                    setSheet("assign");
                  }}
                >
                  <span className={styles.tableNo}>{it.label}</span>
                  <span className={styles.tableMain}>
                    <span>{it.name}</span>
                    <span className="ed-small ed-muted">
                      {it.source === "custom" ? t("custom") : t("venueSupplied")} · {sizeOf(it) ?? t("sizeUnknown")}
                    </span>
                  </span>
                  <span className={styles.tableEnd}>
                    {seatsText(it)}
                    {it.seats !== null && (it.seated ?? 0) > it.seats ? (
                      <>
                        <br />
                        <Tag tone="danger">{t("tables.over")}</Tag>
                      </>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>
        <Section title={t("unseated.title", { count: unseatedCount })} level={3}>
          {unseatedHouseholds.length === 0 ? (
            <p className="ed-muted">{roster.length === 0 ? t("unseated.noGuests") : t("unseated.none")}</p>
          ) : (
            <ul className={styles.people}>
              {unseatedHouseholds.map(({ h, adults, extra, children }) => (
                <li key={h.householdId}>
                  <span className={styles.personMain}>
                    <strong>{h.name}</strong>
                    <span className="ed-small ed-muted">
                      {[...adults.map((a) => a.name), extra ? t(`people.extra.${pluralKey(extra.count, locale)}`, { count: extra.count }) : null, children ? t(`people.children.${pluralKey(children.count, locale)}`, { count: children.count }) : null].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  <span className={styles.personEnd}>{h.attending === "yes" ? <Tag tone="success">{t("people.confirmed")}</Tag> : <Tag>{t("people.notAnswered")}</Tag>}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="ed-small ed-muted">{t("unseated.how")}</p>
        </Section>
      </div>

      {/* ── sheets ── */}
      {sheet === "add" ? (
        <AddSheet
          locale={locale}
          model={baseModel}
          onClose={() => setSheet(null)}
          centre={() => {
            const el = wrapRef.current;
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const at = clientToMm(r.left + r.width / 2, r.top + Math.min(r.height, window.innerHeight - r.top) / 2);
            return at ? { x: Math.round(at.x / 100) * 100, y: Math.round(at.y / 100) * 100 } : null;
          }}
          onAdd={async (specs) => {
            setSheet(null);
            let last: string | null = null;
            for (const spec of specs) {
              const id = newClientId();
              const res = await run(() => (spec.fixture ? addFixtureAction({ occasionId, id, ...spec.fixture, x: spec.x, y: spec.y }) : addTableAction({ occasionId, id, tableTypeId: spec.tableTypeId, custom: spec.custom, x: spec.x, y: spec.y })));
              if (res) {
                setItems((list) => (list.some((i) => i.id === res.id) ? list : [...list, res]));
                last = res.id;
              }
            }
            if (last) {
              setStageId("base");
              setSelectedId(last);
            }
          }}
        />
      ) : null}

      {sheet === "more" && selected ? (
        <Sheet open onClose={() => setSheet(null)} title={tableName(selected)} closeLabel={tc("actions.close")}>
          <div className="ed-stack" data-gap="2">
            {!selectedAway ? (
              <Button block onClick={() => setSheet("position")}>
                {t("bar.exact")}
              </Button>
            ) : null}
            {stage ? (
              stage.states.some((x) => x.itemId === selected.id) ? (
                <Button
                  block
                  onClick={() => {
                    resetStageItem(selected.id);
                    setSheet(null);
                  }}
                >
                  {t("stage.asBase")}
                </Button>
              ) : (
                <p className="ed-small ed-muted">{t("stage.sameAsBase")}</p>
              )
            ) : (
              <>
                <Button block onClick={() => setSheet("edit")}>
                  {t("bar.edit")}
                </Button>
                <Button block variant="danger-quiet" onClick={() => setSheet("remove")}>
                  {t("bar.remove")}
                </Button>
              </>
            )}
          </div>
        </Sheet>
      ) : null}

      {sheet === "position" && selected ? (
        <PositionSheet
          key={selected.id}
          item={selected}
          locale={locale}
          title={t("position.title", { name: tableName(selected) })}
          onClose={() => setSheet(null)}
          onSave={(to) => {
            place(selected.id, to);
            setSheet(null);
          }}
        />
      ) : null}

      {sheet === "edit" && selected ? (
        <EditSheet
          key={selected.id}
          item={selected}
          locale={locale}
          onClose={() => setSheet(null)}
          onSave={async (patch) => {
            const res = await run(() => updateItemAction({ itemId: selected.id, ...patch, version: itemsRef.current.find((i) => i.id === selected.id)?.version }));
            if (res) {
              setItems((list) => list.map((i) => (i.id === res.id ? { ...res, x: i.x, y: i.y, rotation: i.rotation } : i)));
              setSheet(null);
            }
            return !!res;
          }}
        />
      ) : null}

      {sheet === "remove" && selected ? (
        <Sheet
          open
          onClose={() => setSheet(null)}
          title={t("remove.title", { name: tableName(selected) })}
          closeLabel={tc("actions.close")}
          footer={
            <>
              <Button onClick={() => setSheet(null)}>{t("remove.keep")}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const id = selected.id;
                  setSheet(null);
                  setSelectedId(null);
                  setItems((list) => list.filter((i) => i.id !== id));
                  void run(() => removeItemAction({ occasionId, itemId: id }), { refresh: true });
                }}
              >
                {t("remove.confirm", { name: tableName(selected) })}
              </Button>
            </>
          }
        >
          <p>{selected.kind === "table" && (selected.seated ?? 0) > 0 ? t("remove.bodySeated", { count: selected.seated ?? 0 }) : t("remove.body")}</p>
        </Sheet>
      ) : null}

      {sheet === "assign" && selected && selected.kind === "table" ? (
        <AssignSheet
          key={selected.id}
          table={baseModel.items.find((i) => i.id === selected.id) ?? selected}
          tableTitle={tableName(selected)}
          roster={roster}
          locale={locale}
          canManage={canManage}
          occasionId={occasionId}
          onClose={() => setSheet(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}

      {sheet === "stages" ? <StagesSheet occasionId={occasionId} stages={stages} onClose={() => setSheet(null)} onChanged={() => router.refresh()} /> : null}
    </div>
  );
}

/* ── Fit-check strip (C-02): the answer in words, on the sheet's top edge ── */

function FitStrip({
  fit,
  attending,
  invited,
  stageName,
  locale,
  issueText,
  onShow,
}: {
  fit: FitResult;
  attending: number;
  invited: number | null;
  stageName: string | null;
  locale: Locale;
  issueText: (i: FitIssue) => string;
  onShow: (itemId: string) => void;
}) {
  const t = useTranslations("seating");
  const excludedTables = fit.excluded.filter((e) => e.kind === "table").length;
  const verdict =
    fit.status === "fits"
      ? t("fit.fits")
      : fit.status === "no"
        ? fit.issues.length > 0
          ? t(`fit.problemsVerdict.${pluralKey(fit.issues.length, locale)}`, { count: fit.issues.length })
          : t(`fit.missingVerdict.${pluralKey(fit.seats.missing, locale)}`, { count: fit.seats.missing })
        : fit.excluded.length > 0
          ? excludedTables === fit.excluded.length
            ? t(`fit.unknownTables.${pluralKey(fit.excluded.length, locale)}`, { count: fit.excluded.length })
            : t(`fit.unknownItems.${pluralKey(fit.excluded.length, locale)}`, { count: fit.excluded.length })
          : fit.unknown.includes("noFloorArea")
            ? t("fit.unknownFloor")
            : t("fit.unknownSeats");
  const m2 = (v: number) => mm2ToM2(v).toString().replace(".", locale === "ro" ? "," : ".");
  const invitedMissing = invited === null ? null : Math.max(0, invited - fit.seats.available);
  const lines = fit.issues.length + fit.excluded.length + fit.seatsUnknown.length;
  return (
    <div className={styles.strip} role="status" aria-live="polite" aria-label={stageName ? t("fit.labelStage", { name: stageName }) : t("fit.label")}>
      <div className={styles.stripHead}>
        <span className={styles.verdict} data-status={fit.status}>
          {fit.status === "fits" ? <IconCheck size={20} /> : fit.status === "no" ? <IconAlert size={20} /> : <IconInfo size={20} />}
          {verdict}
        </span>
        <span className="ed-label">{stageName ?? t("stage.base")}</span>
      </div>
      <ul className={styles.stripFacts}>
        <li>
          {t("fit.seats")} <strong>{fit.seats.available}</strong> · {t("fit.attending")} <strong>{attending}</strong>
          {fit.status === "no" && fit.issues.length > 0 && fit.seats.missing > 0 ? <> · {t(`fit.missingAlso.${pluralKey(fit.seats.missing, locale)}`, { count: fit.seats.missing })}</> : null}
        </li>
        {invited !== null && invited < attending ? null : (
        <li>
          {t("fit.invited")} {invited === null ? <Unknown label={t("fit.unknownWord")} /> : <strong>{invited}</strong>}
          {invitedMissing !== null && invitedMissing > 0 ? <> · {t(`fit.invitedMissing.${pluralKey(invitedMissing, locale)}`, { count: invitedMissing })}</> : null}
        </li>
        )}
        <li>
          {t("fit.area")} <strong>{m2(fit.area.usedMm2)}</strong> {t("fit.of")} {fit.area.usableMm2 === null ? <Unknown label={t("fit.unknownWord")} /> : <strong>{m2(fit.area.usableMm2)} m²</strong>}
        </li>
      </ul>
      {lines > 0 ? (
        <details className={styles.stripDetails} open={lines <= 3}>
          <summary>{t(`fit.details.${pluralKey(lines, locale)}`, { count: lines })}</summary>
          <ul className={styles.issues}>
            {fit.issues.map((i, n) => (
              <li key={`i${n}`}>
                <span>
                  <IconAlert size={16} />
                  {issueText(i)}
                </span>
                <Button size="sm" variant="quiet" onClick={() => onShow(i.itemIds[0]!)}>
                  {t("fit.show")}
                </Button>
              </li>
            ))}
            {fit.excluded.map((e) => (
              <li key={`e${e.id}`} data-tone="unknown">
                <span>
                  <IconInfo size={16} />
                  {t("fit.excluded", { name: e.kind === "table" ? t("table", { label: e.label }) : e.label, kind: e.name })}
                </span>
                <Button size="sm" variant="quiet" onClick={() => onShow(e.id)}>
                  {t("fit.show")}
                </Button>
              </li>
            ))}
            {fit.seatsUnknown.map((e) => (
              <li key={`s${e.id}`} data-tone="unknown">
                <span>
                  <IconInfo size={16} />
                  {t("fit.seatsUnknownLine", { name: t("table", { label: e.label }) })}
                </span>
                <Button size="sm" variant="quiet" onClick={() => onShow(e.id)}>
                  {t("fit.show")}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/* ── Add a table / fixture ── */

type AddSpec = {
  tableTypeId?: string;
  custom?: { name: string; shape: TableShape; diameterMm: number | null; widthMm: number | null; lengthMm: number | null; seats: number };
  fixture?: { name: string; widthMm: number | null; lengthMm: number | null };
  x?: number;
  y?: number;
};

function AddSheet({ model, locale, onClose, onAdd, centre }: { model: PlanModel; locale: Locale; onClose: () => void; onAdd: (specs: AddSpec[]) => void; centre: () => { x: number; y: number } | null }) {
  const t = useTranslations("seating");
  const tc = useTranslations("common");
  const id = useId();
  const [kind, setKind] = useState<"table" | "fixture">("table");
  const [v, setV] = useState<Record<string, string>>({ name: "", shape: "round", diameter: "", w: "", l: "", seats: "10", count: "1" });
  const [preset, setPreset] = useState("");
  const fm = (mm: number | null) => (mm === null ? "" : mmToMetresText(mm, locale));
  const presetName = (p: (typeof TABLE_PRESETS)[number]) => `${t(`presetGroups.${p.group}`)} ${itemSizeText(p, locale) ?? ""}`.trim();
  /** A ready-made table fills the form; every field stays editable. */
  const choosePreset = (key: string) => {
    setPreset(key);
    const p = TABLE_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setV((s) => ({ ...s, name: presetName(p), shape: p.shape, diameter: fm(p.diameterMm), w: fm(p.widthMm), l: fm(p.lengthMm), seats: String(p.seats) }));
    setErr({});
  };
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const at = (n: number): { x?: number; y?: number } => {
    const c = centre();
    return c ? { x: c.x + (n % 4) * 2600, y: c.y + Math.floor(n / 4) * 2600 } : {};
  };
  /** Each new item goes to the nearest free floor around the view's centre, never on top of another. */
  const placeAll = (specs: AddSpec[]): AddSpec[] => {
    const c = centre() ?? { x: 0, y: 0 };
    const others = [...model.items];
    return specs.map((spec, n) => {
      const type = spec.tableTypeId ? model.tableTypes.find((x) => x.id === spec.tableTypeId) : undefined;
      const dims = spec.custom ?? (type ? { shape: type.shape, diameterMm: type.diameterMm, widthMm: type.widthMm, lengthMm: type.lengthMm, seats: type.seats ?? 0 } : spec.fixture ? { shape: "rect" as const, diameterMm: null, widthMm: spec.fixture.widthMm, lengthMm: spec.fixture.lengthMm, seats: 0 } : null);
      if (!dims) return spec;
      const probe = { kind: spec.fixture ? ("fixture" as const) : ("table" as const), rotation: 0, ...dims };
      const spot = findFreeSpot(model, probe, c, others);
      const pos = spot ?? at(n);
      if (pos.x !== undefined && pos.y !== undefined) others.push({ ...probe, id: `new${n}`, source: "custom", name: "", label: "", x: pos.x, y: pos.y });
      return { ...spec, ...pos };
    });
  };
  const placed = (typeId: string) => model.items.filter((i) => i.kind === "table" && i.source === "venue" && i.venueRef === typeId).length;
  const size = (x: { shape: TableShape; diameterMm: number | null; widthMm: number | null; lengthMm: number | null }) => itemSizeText(x, locale);

  function submit(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const measure = (k: string) => {
      const mm = parseMetres(v[k]);
      if (mm === null) return null;
      if (Number.isNaN(mm) || mm <= 0) {
        errors[k] = t("errors.measure");
        return null;
      }
      return mm;
    };
    const name = (v.name ?? "").trim() || (kind === "table" ? t("add.customDefault") : "");
    if (!name) errors.name = tc("validation.required");
    if (kind === "fixture") {
      const w = measure("w");
      const l = measure("l");
      if ((w === null) !== (l === null) && !errors.w && !errors.l) errors[w === null ? "w" : "l"] = t("errors.bothSides");
      setErr(errors);
      if (Object.keys(errors).length) return focusFirst(id, errors);
      onAdd(placeAll([{ fixture: { name, widthMm: w, lengthMm: l } }]));
      return;
    }
    const shape = (v.shape ?? "round") as TableShape;
    const round = shapeUsesDiameter(shape);
    const d = round ? measure("diameter") : null;
    const w = round ? null : measure("w");
    const l = round ? null : measure("l");
    if (!round && (w === null) !== (l === null) && !errors.w && !errors.l) errors[w === null ? "w" : "l"] = t("errors.bothSides");
    const seats = /^\d+$/.test((v.seats ?? "").trim()) ? Number(v.seats) : NaN;
    if (Number.isNaN(seats) || seats > 60) errors.seats = t("errors.seats");
    const count = /^\d+$/.test((v.count ?? "").trim()) ? Number(v.count) : NaN;
    if (Number.isNaN(count) || count < 1 || count > 40) errors.count = t("errors.count");
    setErr(errors);
    if (Object.keys(errors).length) return focusFirst(id, errors);
    onAdd(placeAll(Array.from({ length: count }, () => ({ custom: { name, shape, diameterMm: d, widthMm: w, lengthMm: l, seats } }))));
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t("add.title")}
      closeLabel={tc("actions.close")}
      footer={
        <>
          <Button onClick={onClose}>{tc("actions.cancel")}</Button>
          <Button variant="primary" type="submit" form={id}>
            {kind === "table" ? t("add.customSubmit") : t("add.fixtureSubmit")}
          </Button>
        </>
      }
    >
      {model.tableTypes.length > 0 ? (
        <div className="ed-stack" data-gap="2">
          <strong>{t("add.venueTitle")}</strong>
          <p className="ed-small ed-muted">{t("add.venueHint")}</p>
          <ul className={styles.inventory}>
            {model.tableTypes.map((type) => {
              const used = placed(type.id);
              const left = type.count === null ? null : Math.max(0, type.count - used);
              return (
                <li key={type.id}>
                  <span className={styles.personMain}>
                    <strong>{type.name}</strong>
                    <span className="ed-small ed-muted">
                      {size(type) ?? <Unknown label={t("sizeUnknown")} />} · {type.seats === null ? <Unknown label={t("add.seatsUnknown")} /> : t("add.seats", { count: type.seats })} ·{" "}
                      {left === null ? <Unknown label={t("add.countUnknown")} /> : t("add.left", { left, count: type.count ?? 0 })}
                    </span>
                  </span>
                  <Button size="sm" disabled={left === 0} onClick={() => onAdd(placeAll([{ tableTypeId: type.id }]))} aria-label={t("add.venueAddLabel", { name: type.name })}>
                    {left === 0 ? t("add.allPlaced") : t("add.venueAdd")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <form id={id} className="ed-form" onSubmit={submit} noValidate>
        <SelectField id={`${id}-kind`} label={t("add.what")} value={kind} onChange={(e) => setKind(e.target.value as "table" | "fixture")}>
          <option value="table">{t("add.customTable")}</option>
          <option value="fixture">{t("add.customFixture")}</option>
        </SelectField>
        <p className="ed-small ed-muted">{t("add.customNote")}</p>
        {kind === "table" ? (
          <SelectField id={`${id}-preset`} label={t("add.preset")} hint={t("add.presetHint")} value={preset} onChange={(e) => choosePreset(e.target.value)}>
            <option value="">{t("add.presetCustom")}</option>
            {TABLE_PRESET_GROUPS.map((g) => (
              <optgroup key={g} label={t(`presetGroups.${g}`)}>
                {TABLE_PRESETS.filter((p) => p.group === g).map((p) => (
                  <option key={p.key} value={p.key}>
                    {itemSizeText(p, locale)} · {p.seats === 0 ? t("add.standing") : t("add.seats", { count: p.seats })}
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectField>
        ) : null}
        <TextField id={`${id}-name`} label={t("fields.name")} hint={kind === "table" ? t("fields.tableNameHint") : t("fields.fixtureNameHint")} value={v.name} onChange={set("name")} error={err.name} autoComplete="off" />
        {kind === "table" ? (
          <SelectField id={`${id}-shape`} label={t("fields.shape")} value={v.shape} onChange={set("shape")}>
            {TABLE_SHAPE_VALUES.map((x) => (
              <option key={x} value={x}>
                {t(`shapes.${x}`)}
              </option>
            ))}
          </SelectField>
        ) : null}
        {kind === "table" && shapeUsesDiameter(v.shape as TableShape) ? (
          <TextField id={`${id}-diameter`} label={t("fields.diameter")} optionalLabel={t("fields.emptyUnknown")} inputMode="decimal" value={v.diameter} onChange={set("diameter")} error={err.diameter} autoComplete="off" />
        ) : (
          <div className={styles.fields2}>
            <TextField id={`${id}-w`} label={t("fields.width")} optionalLabel={t("fields.emptyUnknown")} inputMode="decimal" value={v.w} onChange={set("w")} error={err.w} autoComplete="off" />
            <TextField id={`${id}-l`} label={t("fields.length")} optionalLabel={t("fields.emptyUnknown")} inputMode="decimal" value={v.l} onChange={set("l")} error={err.l} autoComplete="off" />
          </div>
        )}
        {kind === "table" ? (
          <div className={styles.fields2}>
            <TextField id={`${id}-seats`} label={t("fields.seats")} hint={t("fields.seatsHint")} inputMode="numeric" value={v.seats} onChange={set("seats")} error={err.seats} autoComplete="off" />
            <TextField id={`${id}-count`} label={t("fields.howMany")} inputMode="numeric" value={v.count} onChange={set("count")} error={err.count} autoComplete="off" />
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}

function focusFirst(formId: string, errors: Record<string, string>) {
  const first = Object.keys(errors)[0];
  if (first) document.getElementById(`${formId}-${first}`)?.focus();
}

/* ── Exact position: typed coordinates — the keyboard's equal of dragging ── */

function PositionSheet({ item, locale, title, onClose, onSave }: { item: PlanItem; locale: Locale; title: string; onClose: () => void; onSave: (to: { x: number; y: number; rotation: number }) => void }) {
  const t = useTranslations("seating");
  const tc = useTranslations("common");
  const id = useId();
  const [v, setV] = useState({ x: mmToMetresText(item.x, locale), y: mmToMetresText(item.y, locale), rotation: String(item.rotation) });
  const [err, setErr] = useState<Record<string, string>>({});
  function submit(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const x = parseMetres(v.x);
    const y = parseMetres(v.y);
    if (x === null || Number.isNaN(x)) errors.x = t("errors.measure");
    if (y === null || Number.isNaN(y)) errors.y = t("errors.measure");
    const rot = /^-?\d+$/.test(v.rotation.trim()) ? Number(v.rotation) : NaN;
    if (Number.isNaN(rot) || Math.abs(rot) > 360) errors.rotation = t("errors.rotation");
    setErr(errors);
    if (Object.keys(errors).length) return focusFirst(id, errors);
    onSave({ x: x!, y: y!, rotation: rot });
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      closeLabel={tc("actions.close")}
      footer={
        <>
          <Button onClick={onClose}>{tc("actions.cancel")}</Button>
          <Button variant="primary" type="submit" form={id}>
            {t("position.submit")}
          </Button>
        </>
      }
    >
      <form id={id} className="ed-form" onSubmit={submit} noValidate>
        <p className="ed-muted">{t("position.body")}</p>
        <div className={styles.fields2}>
          <TextField id={`${id}-x`} label={t("position.x")} inputMode="decimal" value={v.x} onChange={(e) => setV((s) => ({ ...s, x: e.target.value }))} error={err.x} autoComplete="off" />
          <TextField id={`${id}-y`} label={t("position.y")} inputMode="decimal" value={v.y} onChange={(e) => setV((s) => ({ ...s, y: e.target.value }))} error={err.y} autoComplete="off" />
        </div>
        <TextField id={`${id}-rotation`} label={t("position.rotation")} inputMode="numeric" value={v.rotation} onChange={(e) => setV((s) => ({ ...s, rotation: e.target.value }))} error={err.rotation} autoComplete="off" />
      </form>
    </Sheet>
  );
}

/* ── Rename / resize (custom items only: the venue's facts are the venue's) ── */

function EditSheet({
  item,
  locale,
  onClose,
  onSave,
}: {
  item: PlanItem;
  locale: Locale;
  onClose: () => void;
  onSave: (patch: { label?: string; custom?: { name?: string; shape?: TableShape; diameterMm?: number | null; widthMm?: number | null; lengthMm?: number | null; seats?: number } }) => Promise<boolean>;
}) {
  const t = useTranslations("seating");
  const tc = useTranslations("common");
  const id = useId();
  const fm = (mm: number | null) => (mm === null ? "" : mmToMetresText(mm, locale));
  const custom = item.source === "custom";
  const [v, setV] = useState<Record<string, string>>({ label: item.label, name: item.name, shape: item.shape, diameter: fm(item.diameterMm), w: fm(item.widthMm), l: fm(item.lengthMm), seats: item.seats === null ? "" : String(item.seats) });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const measure = (k: string) => {
      const mm = parseMetres(v[k]);
      if (mm === null) return null;
      if (Number.isNaN(mm) || mm <= 0) {
        errors[k] = t("errors.measure");
        return null;
      }
      return mm;
    };
    const patch: Parameters<typeof onSave>[0] = {};
    if (item.kind === "table") {
      if (!(v.label ?? "").trim()) errors.label = tc("validation.required");
      else patch.label = v.label!.trim();
    }
    if (custom) {
      const name = (v.name ?? "").trim();
      if (!name) errors.name = tc("validation.required");
      const shape: TableShape = item.kind === "table" ? (v.shape as TableShape) : "rect";
      const round = shapeUsesDiameter(shape);
      const d = round ? measure("diameter") : null;
      const w = round ? null : measure("w");
      const l = round ? null : measure("l");
      if (!round && (w === null) !== (l === null) && !errors.w && !errors.l) errors[w === null ? "w" : "l"] = t("errors.bothSides");
      const seats = /^\d+$/.test((v.seats ?? "").trim()) ? Number(v.seats) : NaN;
      if (item.kind === "table" && (Number.isNaN(seats) || seats > 60)) errors.seats = t("errors.seats");
      patch.custom = { name, shape, diameterMm: d, widthMm: w, lengthMm: l, ...(item.kind === "table" ? { seats } : {}) };
    }
    setErr(errors);
    if (Object.keys(errors).length) return focusFirst(id, errors);
    setBusy(true);
    const ok = await onSave(patch);
    if (!ok) setBusy(false);
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={t("edit.title", { name: item.label })}
      closeLabel={tc("actions.close")}
      footer={
        <>
          <Button onClick={onClose}>{tc("actions.cancel")}</Button>
          <Button variant="primary" type="submit" form={id} disabled={busy}>
            {busy ? t("saving") : t("edit.submit")}
          </Button>
        </>
      }
    >
      <form id={id} className="ed-form" onSubmit={submit} noValidate>
        {item.kind === "table" ? <TextField id={`${id}-label`} label={t("fields.label")} hint={t("fields.labelHint")} value={v.label} onChange={set("label")} error={err.label} maxLength={24} autoComplete="off" /> : null}
        {custom ? (
          <>
            <TextField id={`${id}-name`} label={t("fields.name")} value={v.name} onChange={set("name")} error={err.name} autoComplete="off" />
            {item.kind === "table" ? (
              <SelectField id={`${id}-shape`} label={t("fields.shape")} value={v.shape} onChange={set("shape")}>
                {TABLE_SHAPE_VALUES.map((x) => (
                  <option key={x} value={x}>
                    {t(`shapes.${x}`)}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {item.kind === "table" && shapeUsesDiameter(v.shape as TableShape) ? (
              <TextField id={`${id}-diameter`} label={t("fields.diameter")} optionalLabel={t("fields.emptyUnknown")} inputMode="decimal" value={v.diameter} onChange={set("diameter")} error={err.diameter} autoComplete="off" />
            ) : (
              <div className={styles.fields2}>
                <TextField id={`${id}-w`} label={t("fields.width")} optionalLabel={t("fields.emptyUnknown")} inputMode="decimal" value={v.w} onChange={set("w")} error={err.w} autoComplete="off" />
                <TextField id={`${id}-l`} label={t("fields.length")} optionalLabel={t("fields.emptyUnknown")} inputMode="decimal" value={v.l} onChange={set("l")} error={err.l} autoComplete="off" />
              </div>
            )}
            {item.kind === "table" ? <TextField id={`${id}-seats`} label={t("fields.seats")} inputMode="numeric" value={v.seats} onChange={set("seats")} error={err.seats} autoComplete="off" /> : null}
          </>
        ) : (
          <p className="ed-small ed-muted">{t("edit.venueFacts")}</p>
        )}
      </form>
    </Sheet>
  );
}

/* ── Who sits at this table ── */

function AssignSheet({
  table,
  tableTitle,
  roster,
  locale,
  canManage,
  occasionId,
  onClose,
  onChanged,
}: {
  table: PlanItem;
  tableTitle: string;
  roster: RosterHousehold[];
  locale: Locale;
  canManage: boolean;
  occasionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("seating");
  const tc = useTranslations("common");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const extraLabel = (n: number) => t(`people.extra.${pluralKey(n, locale)}`, { count: n });
  const childLabel = (n: number) => t(`people.children.${pluralKey(n, locale)}`, { count: n });

  type Unit = { key: string; label: string; places: number; guestId?: string; group?: { householdId: string; kind: "extra" | "children" }; seatNo?: number | null };
  const here: Array<{ household: string; unit: Unit }> = [];
  const free: Array<{ household: RosterHousehold; units: Unit[] }> = [];
  for (const h of roster) {
    const mine: Unit[] = [];
    const add = (u: Unit, tableId: string | null) => {
      if (tableId === table.id) here.push({ household: h.name, unit: u });
      else if (!tableId && h.attending !== "no") mine.push(u);
    };
    for (const a of h.adults) add({ key: `g:${a.guestId}`, label: a.name, places: 1, guestId: a.guestId, seatNo: a.seatNo }, a.tableItemId);
    if (h.extra) add({ key: `x:${h.householdId}`, label: extraLabel(h.extra.count), places: h.extra.count, group: { householdId: h.householdId, kind: "extra" } }, h.extra.tableItemId);
    if (h.children) add({ key: `c:${h.householdId}`, label: childLabel(h.children.count), places: h.children.count, group: { householdId: h.householdId, kind: "children" } }, h.children.tableItemId);
    if (mine.length > 0) free.push({ household: h, units: mine });
  }
  const taken = here.reduce((n, x) => n + x.unit.places, 0);
  const all = free.flatMap((f) => f.units);
  const pickedPlaces = all.filter((u) => picked.has(u.key)).reduce((n, u) => n + u.places, 0);
  const left = table.seats === null ? null : table.seats - taken;
  const tooMany = left !== null && pickedPlaces > left;
  const needle = q.trim().toLocaleLowerCase(locale);
  const shown = needle ? free.filter((f) => f.household.name.toLocaleLowerCase(locale).includes(needle) || f.units.some((u) => u.label.toLocaleLowerCase(locale).includes(needle))) : free;

  async function act(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message ?? tc("errors.UNEXPECTED"));
      errorRef.current?.focus();
      return false;
    }
    onChanged();
    return true;
  }
  const seatOptions = table.seats ? Array.from({ length: table.seats }, (_, i) => i + 1) : [];
  const usedSeats = new Set(here.map((x) => x.unit.seatNo).filter((n): n is number => !!n));

  return (
    <Sheet
      open
      onClose={onClose}
      title={tableTitle}
      closeLabel={tc("actions.close")}
      footer={
        canManage ? (
          <>
            <Button onClick={onClose}>{t("assign.done")}</Button>
            <Button
              variant="primary"
              disabled={busy || picked.size === 0}
              onClick={async () => {
                const units = all.filter((u) => picked.has(u.key));
                const ok = await act(() => assignSeatsAction({ occasionId, tableItemId: table.id, guestIds: units.flatMap((u) => (u.guestId ? [u.guestId] : [])), groups: units.flatMap((u) => (u.group ? [u.group] : [])) }));
                if (ok) setPicked(new Set());
              }}
            >
              {busy ? t("saving") : picked.size === 0 ? t("assign.submit") : t(`assign.submitCount.${pluralKey(pickedPlaces, locale)}`, { count: pickedPlaces })}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{tc("actions.close")}</Button>
        )
      }
    >
      <p>
        <strong className="ed-num">{table.seats === null ? t("seatsUnknown", { taken }) : t("seatsOf", { taken, seats: table.seats })}</strong>
        <span className="ed-muted"> · {table.name}</span>
      </p>
      <div ref={errorRef} tabIndex={-1}>
        {error ? <Notice tone="danger" title={error} role="alert" /> : null}
        {tooMany && !error ? <Notice tone="attention" title={t("assign.tooMany", { picked: pickedPlaces, left: Math.max(0, left ?? 0) })} /> : null}
      </div>

      <div className="ed-stack" data-gap="2">
        <strong>{t("assign.here")}</strong>
        {here.length === 0 ? (
          <p className="ed-muted">{t("assign.nobody")}</p>
        ) : (
          <ul className={styles.people}>
            {here.map(({ household, unit }) => (
              <li key={unit.key}>
                <span className={styles.personMain}>
                  <span>{unit.label}</span>
                  <span className="ed-small ed-muted">{household}</span>
                </span>
                {canManage ? (
                  <span className={styles.personEnd}>
                    {unit.guestId && seatOptions.length > 0 ? (
                      <select
                        className={`ed-select ${styles.seatSelect}`}
                        aria-label={t("assign.seatFor", { name: unit.label })}
                        value={unit.seatNo ?? ""}
                        disabled={busy}
                        onChange={(e) => void act(() => setSeatNumberAction({ occasionId, guestId: unit.guestId!, seatNo: e.target.value ? Number(e.target.value) : null }))}
                      >
                        <option value="">{t("assign.noSeat")}</option>
                        {seatOptions.map((n) => (
                          <option key={n} value={n} disabled={usedSeats.has(n) && unit.seatNo !== n}>
                            {t("assign.seat", { n })}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      aria-label={t("assign.removeLabel", { name: unit.label })}
                      onClick={() => void act(() => unassignSeatsAction({ occasionId, guestIds: unit.guestId ? [unit.guestId] : [], groups: unit.group ? [unit.group] : [] }))}
                    >
                      {t("assign.remove")}
                    </Button>
                  </span>
                ) : unit.seatNo ? (
                  <span className="ed-small ed-num">{t("assign.seat", { n: unit.seatNo })}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage ? (
        <div className="ed-stack" data-gap="2">
          <strong>{t("assign.unseated")}</strong>
          {free.length === 0 ? (
            <p className="ed-muted">{t("assign.everyoneSeated")}</p>
          ) : (
            <>
              {free.length > 8 ? <TextField id="assign-search" label={t("assign.search")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /> : null}
              <div className={styles.checks}>
                {shown.map(({ household, units }) => (
                  <fieldset className={styles.house} key={household.householdId}>
                    <legend>{household.name}</legend>
                    {units.map((u) => (
                      <Checkbox
                        key={u.key}
                        label={u.label}
                        checked={picked.has(u.key)}
                        onChange={(e) =>
                          setPicked((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(u.key);
                            else next.delete(u.key);
                            return next;
                          })
                        }
                      />
                    ))}
                  </fieldset>
                ))}
                {shown.length === 0 ? <p className="ed-muted">{t("assign.noMatch")}</p> : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ── Stages of the meal ── */

function StagesSheet({ occasionId, stages, onClose, onChanged }: { occasionId: string; stages: MealStageView[]; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("seating");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  async function act(fn: () => Promise<{ ok: boolean; error?: { message: string; fieldErrors?: Record<string, string[]> } }>, field?: string) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setError({ field: res.error?.fieldErrors?.name ? field : undefined, message: res.error?.fieldErrors?.name?.[0] ?? res.error?.message ?? "" });
      return false;
    }
    onChanged();
    return true;
  }
  return (
    <Sheet open onClose={onClose} title={t("stage.sheetTitle")} closeLabel={tc("actions.close")} footer={<Button onClick={onClose}>{t("assign.done")}</Button>}>
      <p className="ed-muted">{t("stage.sheetBody")}</p>
      {error && !error.field ? <Notice tone="danger" title={error.message} role="alert" /> : null}
      {stages.length === 0 ? (
        <div>
          <Button disabled={busy} onClick={() => void act(() => addDefaultStagesAction({ occasionId }))}>
            {t("stage.addDefaults")}
          </Button>
        </div>
      ) : (
        <div>
          {stages.map((s, i) => (
            <div className={styles.stageRow} key={s.id}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(() => renameMealStageAction({ occasionId, stageId: s.id, name: names[s.id] ?? s.name }), `rename-${s.id}`);
                }}
              >
                <TextField
                  id={`stage-${s.id}`}
                  label={t("stage.nameOf", { n: i + 1 })}
                  value={names[s.id] ?? s.name}
                  onChange={(e) => setNames((m) => ({ ...m, [s.id]: e.target.value }))}
                  error={error?.field === `rename-${s.id}` ? error.message : undefined}
                  maxLength={60}
                  autoComplete="off"
                />
                {names[s.id] !== undefined && names[s.id] !== s.name ? (
                  <Button type="submit" size="sm" disabled={busy}>
                    {tc("actions.save")}
                  </Button>
                ) : null}
              </form>
              <IconButton label={t("stage.up", { name: s.name })} disabled={busy || i === 0} onClick={() => void act(() => moveMealStageAction({ occasionId, stageId: s.id, direction: "up" }))}>
                <IconArrowLeft style={{ transform: "rotate(90deg)" }} />
              </IconButton>
              <IconButton label={t("stage.down", { name: s.name })} disabled={busy || i === stages.length - 1} onClick={() => void act(() => moveMealStageAction({ occasionId, stageId: s.id, direction: "down" }))}>
                <IconArrowRight style={{ transform: "rotate(90deg)" }} />
              </IconButton>
              <IconButton label={t("stage.remove", { name: s.name })} disabled={busy} onClick={() => void act(() => removeMealStageAction({ occasionId, stageId: s.id }))}>
                <IconClose />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <form
        className="ed-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => addMealStageAction({ occasionId, name }), "new").then((ok) => ok && setName(""));
        }}
      >
        <TextField id="stage-new" label={t("stage.newName")} hint={t("stage.newHint")} value={name} onChange={(e) => setName(e.target.value)} error={error?.field === "new" ? error.message : undefined} maxLength={60} autoComplete="off" />
        <div>
          <Button type="submit" disabled={busy}>
            {t("stage.add")}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
