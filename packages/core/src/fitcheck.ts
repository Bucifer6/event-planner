import {
  CHAIR_ZONE_MM,
  footprintArea,
  insideAreas,
  itemFootprint,
  itemHasDims,
  polygonArea,
  shapeGap,
  type Footprint,
  type PlanItem,
  type PlanModel,
} from "./spacemodel";

// FIT CHECKS (C-02, V6, principle 5) — pure, runs in the browser and on the server.
//
//   checkFit(model, { needed })   one layout (the base one, or a meal stage via applyStage)
//
// What is checked, against STATED dimensions only:
//   · seats: places at tables with known size and known seat count vs people attending
//   · overlap: two items cover the same floor
//   · tooClose: tables whose chairs leave less than the aisle (default 60 cm) between them, or
//     a table whose chairs run into a fixture
//   · outside: an item not fully on usable floor
//   · overInventory: more venue tables of a type placed than the venue says it has
//   · area: floor covered (tables with their chairs + fixtures) vs usable floor
//
// Unknown stays visible: an item without dimensions is EXCLUDED (listed by name) and the
// answer can then never be "fits" — at best "unknown". A space without usable floor areas
// gives "unknown" too. A definite problem among the known items is still a definite "no".

export type FitIssueType = "overlap" | "tooClose" | "outside" | "overInventory";
export type FitIssue = {
  type: FitIssueType;
  itemIds: string[];
  /** Labels of the items, for the sentence ("Masa 3 și Masa 4"). */
  labels: string[];
  /** tooClose: the free passage found, in mm. overInventory: how many too many. */
  value?: number;
};

export type FitStatus = "fits" | "no" | "unknown";

export type FitResult = {
  status: FitStatus;
  seats: {
    /** Places at tables whose size and seat count are known. */
    available: number;
    /** People to seat; null = not known yet. */
    needed: number | null;
    /** max(0, needed − available) */
    missing: number;
  };
  area: { usedMm2: number; usableMm2: number | null };
  issues: FitIssue[];
  /** V6: items left out because nobody stated their dimensions. */
  excluded: Array<{ id: string; label: string; name: string; kind: PlanItem["kind"] }>;
  /** Tables drawn to size whose number of places is unknown (their seats are not counted). */
  seatsUnknown: Array<{ id: string; label: string }>;
  /** Why the answer cannot be more than "unknown". */
  unknown: Array<"excludedItems" | "noFloorArea" | "seatsUnknown" | "attendanceUnknown">;
  /** Every item taking part in an issue — the renderer marks them. */
  conflictIds: string[];
};

export type FitInput = {
  /** People to seat (attending guests). null = unknown. */
  needed: number | null;
};

function itemLabel(it: PlanItem): string {
  return it.label || it.name;
}

/** Checks one layout. Never throws; never counts an unknown as fitting. */
export function checkFit(model: PlanModel, input: FitInput): FitResult {
  const issues: FitIssue[] = [];
  const excluded: FitResult["excluded"] = [];
  const seatsUnknown: FitResult["seatsUnknown"] = [];
  const known: Array<{ item: PlanItem; body: Footprint; zone: Footprint }> = [];
  let available = 0;
  let used = 0;

  for (const item of model.items) {
    if (!itemHasDims(item)) {
      excluded.push({ id: item.id, label: itemLabel(item), name: item.name, kind: item.kind });
      continue;
    }
    const body = itemFootprint(item)!;
    const zone = item.kind === "table" ? itemFootprint(item, CHAIR_ZONE_MM)! : body;
    known.push({ item, body, zone });
    used += footprintArea(zone);
    if (item.kind === "table") {
      if (item.seats === null) seatsUnknown.push({ id: item.id, label: itemLabel(item) });
      else available += item.seats;
    }
  }

  // pairs: overlap, then passage
  for (let i = 0; i < known.length; i++) {
    for (let j = i + 1; j < known.length; j++) {
      const a = known[i]!;
      const b = known[j]!;
      const ids = [a.item.id, b.item.id];
      const labels = [itemLabel(a.item), itemLabel(b.item)];
      if (shapeGap(a.body, b.body) < -0.5) {
        issues.push({ type: "overlap", itemIds: ids, labels });
        continue;
      }
      const bothTables = a.item.kind === "table" && b.item.kind === "table";
      const anyTable = a.item.kind === "table" || b.item.kind === "table";
      if (!anyTable) continue;
      // free passage once the chairs are out
      const passage = shapeGap(a.zone, b.zone);
      const min = bothTables ? model.aisleMm : 0;
      if (passage < min - 0.5) issues.push({ type: "tooClose", itemIds: ids, labels, value: Math.max(0, Math.round(passage)) });
    }
  }

  // usable floor
  const usable = model.areas.length > 0 ? model.areas.reduce((s, a) => s + polygonArea(a.points), 0) : null;
  if (usable !== null) {
    for (const k of known) {
      if (!insideAreas(k.body, model.areas)) issues.push({ type: "outside", itemIds: [k.item.id], labels: [itemLabel(k.item)] });
    }
  }

  // venue inventory: never more of a type than the venue states it has
  const byType = new Map<string, PlanItem[]>();
  for (const it of model.items) {
    if (it.kind !== "table" || it.source !== "venue" || !it.venueRef) continue;
    byType.set(it.venueRef, [...(byType.get(it.venueRef) ?? []), it]);
  }
  for (const [ref, placed] of byType) {
    const type = model.tableTypes.find((t) => t.id === ref);
    if (type && type.count !== null && placed.length > type.count) {
      const extra = placed.slice(type.count);
      issues.push({ type: "overInventory", itemIds: extra.map((e) => e.id), labels: [type.name], value: placed.length - type.count });
    }
  }

  const needed = input.needed;
  const missing = needed === null ? 0 : Math.max(0, needed - available);
  const unknown: FitResult["unknown"] = [];
  if (excluded.length > 0) unknown.push("excludedItems");
  if (usable === null) unknown.push("noFloorArea");
  if (seatsUnknown.length > 0 && missing > 0) unknown.push("seatsUnknown");
  if (needed === null) unknown.push("attendanceUnknown");

  let status: FitStatus;
  if (issues.length > 0) status = "no";
  else if (missing > 0) {
    // seats are short among the tables we can count; tables we cannot count might cover it
    const uncounted = excluded.some((e) => e.kind === "table") || seatsUnknown.length > 0;
    status = uncounted ? "unknown" : "no";
  } else status = unknown.length > 0 ? "unknown" : "fits";

  return {
    status,
    seats: { available, needed, missing },
    area: { usedMm2: Math.round(used), usableMm2: usable === null ? null : Math.round(usable) },
    issues,
    excluded,
    seatsUnknown,
    unknown,
    conflictIds: [...new Set(issues.flatMap((i) => i.itemIds))],
  };
}

/** Issues that involve one item — for the note beside the selected table. */
export function issuesForItem(result: FitResult, itemId: string): FitIssue[] {
  return result.issues.filter((i) => i.itemIds.includes(itemId));
}

/** mm² → m² with one decimal. */
export function mm2ToM2(mm2: number): number {
  return Math.round(mm2 / 100_000) / 10;
}
