import { and, eq, inArray, occasions, taskDayState, taskDependencies } from "@ed/db";
import { AppError, isAppError } from "@ed/shared/errors";
import { zonedToUtc } from "@ed/shared/time";
import { z } from "zod";
import { requireMember } from "./access";
import type { Ctx } from "./context";
import { listDeliveries } from "./deliveries";
import { getItinerary } from "./itinerary";
import { listRoomsUnchecked } from "./rooms";
import { listActivities, listPeopleUnchecked } from "./subgroups";
import { PLANNING_ROLES } from "./suppliers";
import { queryTasks } from "./tasks";
import { instantToDay, shiftDay, zDay } from "./templates";
import { listTransport } from "./transport";

// RELEASE E (E-01): rehearsal — step through a day and see what collides, WITHOUT changing
// anything (principle 3). simulateDay() only reads: no insert, update, audit row, stat or
// preview is ever written, and it keeps no state between calls — "the step" is just a number
// the screen passes back.
//
// Any domain adds its moments to the rehearsal through a provider:
//
//   registerTimelineSource({
//     key: "programme",
//     list: async (ctx, occasionId, day) => [{ id, title, kind: "moment", startsAt, endsAt, people, place }],
//   });
//
// list() runs with the ctx of the person rehearsing and must do its OWN access check (call your
// checked read); a source that throws FORBIDDEN / NOT_FOUND is simply left out. It must not
// write. Built-in sources: tasks with a time of day (event day), itinerary legs, transport
// legs, optional activities, deliveries.

export type TimelineItem = {
  /** Unique within its source. */
  id: string;
  title: string;
  /** "moment" (programme), "task", "leg", "transport", "activity", "delivery", "return" … */
  kind: string;
  /** UTC instants. endsAt null = a point in time. */
  startsAt: Date;
  endsAt: Date | null;
  /** Zone to show the times in (default: the occasion's). */
  tz?: string;
  /** Who is busy with it: person keys ("m:<memberId>", "h:<householdId>", "g:<guestId>") with a label. */
  people?: Array<{ key: string; label: string }>;
  /** Everyone on the trip / at the event is busy with it. */
  everyone?: boolean;
  supplier?: { id: string; label: string } | null;
  place?: string | null;
  /** Full ids ("<sourceKey>:<id>") of items that must come first. */
  dependsOn?: string[];
  capacity?: { total: number; used: number } | null;
  /** Path under /occasions/<id>/ where the record lives. */
  slug?: string;
};

export type TimelineSource = {
  key: string;
  /** `day` = "YYYY-MM-DD" in the occasion's zone. Read-only. */
  list: (ctx: Ctx, occasionId: string, day: string) => Promise<TimelineItem[]>;
};

const g = globalThis as unknown as { __edTimelineSources?: Map<string, TimelineSource> };
const sources: Map<string, TimelineSource> = (g.__edTimelineSources ??= new Map());

/** Registers (or replaces, by key) one source of the rehearsal timeline. */
export function registerTimelineSource(source: TimelineSource): void {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(source.key)) throw new Error(`Invalid timeline source key: ${source.key}`);
  sources.set(source.key, source);
}
export function timelineSourceKeys(): string[] {
  return [...sources.keys()];
}

/** [from, to) of one calendar day in `tz`, as UTC instants. */
export function dayRange(day: string, tz: string): { from: Date; to: Date } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const from = zonedToUtc({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0 }, tz);
  const next = shiftDay(day, { days: 1 });
  const [ny, nm, nd] = next.split("-").map(Number) as [number, number, number];
  return { from, to: zonedToUtc({ year: ny, month: nm, day: nd, hour: 0, minute: 0, second: 0 }, tz) };
}

export type ConflictCode =
  | "overlap_person"
  | "overlap_supplier"
  | "overlap_place"
  | "task_in_busy_block"
  | "dependency_order"
  | "over_capacity"
  | "delivery_late";

export type RehearsalConflict = {
  code: ConflictCode;
  /** Full ids of the steps involved (empty for conflicts that are not on the timeline, e.g. a room). */
  stepIds: string[];
  /** Values for the sentence (operate.rehearsal.conflicts.<code>). Times are ISO instants. */
  params: Record<string, string | number>;
};

export type RehearsalStep = TimelineItem & { fullId: string; source: string; tz: string };

export type Rehearsal = {
  occasion: { id: string; title: string; timezone: string };
  day: string | null;
  days: string[];
  steps: RehearsalStep[];
  conflicts: RehearsalConflict[];
};

const end = (i: Pick<TimelineItem, "startsAt" | "endsAt">) => (i.endsAt ?? i.startsAt).getTime();
const isBlock = (i: Pick<TimelineItem, "startsAt" | "endsAt">) => i.endsAt !== null && i.endsAt.getTime() > i.startsAt.getTime();
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function sharedPerson(a: RehearsalStep, b: RehearsalStep): string | null {
  const pa = a.people ?? [];
  const pb = b.people ?? [];
  if (a.everyone && b.everyone) return "*";
  if (a.everyone && pb[0]) return pb[0].label;
  if (b.everyone && pa[0]) return pa[0].label;
  const keys = new Set(pb.map((p) => p.key));
  return pa.find((p) => keys.has(p.key))?.label ?? null;
}

/**
 * The conflicts of a timeline — pure. Overlaps for the same person / supplier / place, a task
 * falling inside a block its owner is busy in, dependencies out of order, things over their
 * capacity, deliveries arriving after the day's first moment needs them.
 */
export function findConflicts(steps: RehearsalStep[]): RehearsalConflict[] {
  const out: RehearsalConflict[] = [];
  const byId = new Map(steps.map((s) => [s.fullId, s]));
  for (let i = 0; i < steps.length; i++) {
    const a = steps[i]!;
    for (let j = i + 1; j < steps.length; j++) {
      const b = steps[j]!;
      if (b.startsAt.getTime() >= end(a) && !(b.startsAt.getTime() === a.startsAt.getTime() && isBlock(a) && isBlock(b))) {
        if (b.startsAt.getTime() > end(a)) break; // sorted by start: nothing later overlaps a
        continue;
      }
      // b starts before a ends
      const aBlock = isBlock(a);
      const bBlock = isBlock(b);
      if (!aBlock && !bBlock) continue; // two points never overlap
      const strictlyInside = (p: RehearsalStep, blk: RehearsalStep) => p.startsAt.getTime() > blk.startsAt.getTime() && p.startsAt.getTime() < end(blk);
      const person = sharedPerson(a, b);
      if (person !== null) {
        if (aBlock && bBlock) {
          out.push({ code: "overlap_person", stepIds: [a.fullId, b.fullId], params: { person, a: a.title, b: b.title } });
        } else {
          const [point, block] = aBlock ? [b, a] : [a, b];
          if (strictlyInside(point, block)) {
            out.push({ code: point.kind === "task" ? "task_in_busy_block" : "overlap_person", stepIds: [point.fullId, block.fullId], params: { person, a: point.title, b: block.title } });
          }
        }
      }
      if (aBlock && bBlock) {
        if (a.supplier && b.supplier && a.supplier.id === b.supplier.id) {
          out.push({ code: "overlap_supplier", stepIds: [a.fullId, b.fullId], params: { supplier: a.supplier.label, a: a.title, b: b.title } });
        }
        if (norm(a.place) !== "" && norm(a.place) === norm(b.place) && a.kind !== "delivery" && b.kind !== "delivery" && a.kind !== "return" && b.kind !== "return") {
          out.push({ code: "overlap_place", stepIds: [a.fullId, b.fullId], params: { place: a.place ?? "", a: a.title, b: b.title } });
        }
      }
    }
  }
  for (const s of steps) {
    for (const dep of s.dependsOn ?? []) {
      const first = byId.get(dep);
      if (first && first.startsAt.getTime() > s.startsAt.getTime()) {
        out.push({ code: "dependency_order", stepIds: [s.fullId, first.fullId], params: { a: s.title, b: first.title } });
      }
    }
    if (s.capacity && s.capacity.used > s.capacity.total) {
      out.push({ code: "over_capacity", stepIds: [s.fullId], params: { what: s.title, used: s.capacity.used, total: s.capacity.total } });
    }
  }
  // Deliveries are needed before the day's first moment (at the same place, when both name one).
  const moments = steps.filter((s) => s.kind === "moment" || s.kind === "task");
  for (const d of steps.filter((s) => s.kind === "delivery")) {
    const first = moments.find((m) => norm(d.place) === "" || norm(m.place) === "" || norm(m.place) === norm(d.place));
    if (first && end(d) > first.startsAt.getTime()) {
      out.push({ code: "delivery_late", stepIds: [d.fullId, first.fullId], params: { a: d.title, at: new Date(end(d)).toISOString(), b: first.title, need: first.startsAt.toISOString() } });
    }
  }
  return out;
}

function occasionDays(o: { startsAt: Date | null; endsAt: Date | null; timezone: string }): string[] {
  if (!o.startsAt) return [];
  const first = instantToDay(o.startsAt, o.timezone);
  const last = o.endsAt ? instantToDay(o.endsAt, o.timezone) : first;
  const days = [first];
  while (days[days.length - 1]! < last && days.length < 31) days.push(shiftDay(days[days.length - 1]!, { days: 1 }));
  return days;
}

/**
 * E-01. Merges every registered source into ONE timeline for a day (UTC instants, in order) and
 * lists the conflicts in it. STRICTLY READ-ONLY. Planning roles only; `day` defaults to today
 * when today is a day of the occasion, else its first day.
 */
export async function simulateDay(ctx: Ctx, occasionId: string, opts: { day?: string } = {}): Promise<Rehearsal> {
  const id = z.string().min(1).max(64).parse(occasionId);
  await requireMember(ctx, id, { roles: PLANNING_ROLES });
  const [occasion] = await ctx.db.select().from(occasions).where(eq(occasions.id, id));
  if (!occasion) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const tz = occasion.timezone;
  const days = occasionDays(occasion);
  const today = instantToDay(ctx.now, tz);
  const asked = opts.day && zDay.safeParse(opts.day).success ? opts.day : undefined;
  const day = asked ?? (days.includes(today) ? today : (days[0] ?? null));
  const base = { occasion: { id: occasion.id, title: occasion.title, timezone: tz }, day, days };
  if (!day) return { ...base, steps: [], conflicts: [] };

  const steps: RehearsalStep[] = [];
  for (const source of sources.values()) {
    let items: TimelineItem[];
    try {
      items = await source.list(ctx, id, day);
    } catch (e) {
      if (isAppError(e) && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND")) continue;
      throw e;
    }
    for (const item of items) steps.push({ ...item, fullId: `${source.key}:${item.id}`, source: source.key, tz: item.tz ?? tz });
  }
  steps.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || end(a) - end(b) || a.fullId.localeCompare(b.fullId));
  const conflicts = findConflicts(steps);

  // Not on the timeline: rooms holding more people than they have beds (counts only).
  const [roomRows, people] = await Promise.all([listRoomsUnchecked(ctx, id), listPeopleUnchecked(ctx, id)]);
  const size = new Map(people.map((p) => [p.key, p.size]));
  for (const r of roomRows) {
    const used = Math.max(r.occupants, r.assignments.reduce((n, a) => n + (size.get(a.personKey) ?? a.places), 0));
    if (used > r.capacity) conflicts.push({ code: "over_capacity", stepIds: [], params: { what: r.name, used, total: r.capacity } });
  }
  return { ...base, steps, conflicts };
}

/* ── Built-in sources ───────────────────────────────────────────────────── */

const inDay = (d: Date | null, r: { from: Date; to: Date }) => d !== null && d.getTime() >= r.from.getTime() && d.getTime() < r.to.getTime();
/** A block touches the day when it starts in it, or started before and is still running. */
const touchesDay = (s: Date, e: Date | null, r: { from: Date; to: Date }) => inDay(s, r) || (e !== null && s.getTime() < r.from.getTime() && e.getTime() > r.from.getTime());

async function zoneOf(ctx: Ctx, occasionId: string): Promise<string> {
  const [o] = await ctx.db.select({ tz: occasions.timezone }).from(occasions).where(eq(occasions.id, occasionId));
  return o?.tz ?? "Europe/Bucharest";
}

// Tasks of the day that have a time of day (the event-day programme).
registerTimelineSource({
  key: "tasks",
  list: async (ctx, occasionId, day) => {
    const tz = await zoneOf(ctx, occasionId);
    const page = await queryTasks(ctx, occasionId, { dueFrom: day, dueTo: day, limit: 500 });
    if (page.rows.length === 0) return [];
    const ids = page.rows.map((t) => t.id);
    const [times, deps] = await Promise.all([
      ctx.db.select().from(taskDayState).where(and(eq(taskDayState.occasionId, occasionId), inArray(taskDayState.taskId, ids))),
      ctx.db.select().from(taskDependencies).where(inArray(taskDependencies.taskId, ids)),
    ]);
    const timeOf = new Map(times.map((t) => [t.taskId, t.startTime]));
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    const out: TimelineItem[] = [];
    for (const t of page.rows) {
      const time = timeOf.get(t.id);
      if (!time) continue; // no time of day: it has no place on a timeline
      const [hh, mm] = time.split(":").map(Number) as [number, number];
      out.push({
        id: t.id,
        title: t.title,
        kind: "task",
        startsAt: zonedToUtc({ year: y, month: m, day: d, hour: hh, minute: mm, second: 0 }, tz),
        endsAt: null,
        people: t.ownerMemberId ? [{ key: `m:${t.ownerMemberId}`, label: t.ownerName ?? "—" }] : [],
        dependsOn: deps.filter((x) => x.taskId === t.id).map((x) => `tasks:${x.dependsOnTaskId}`),
        slug: `tasks/${t.id}`,
      });
    }
    return out;
  },
});

registerTimelineSource({
  key: "itinerary",
  list: async (ctx, occasionId, day) => {
    const it = await getItinerary(ctx, occasionId);
    const range = dayRange(day, it.occasion.timezone);
    return it.legs
      .filter((l) => (l.kind === "stay" ? inDay(l.startsAt, range) : touchesDay(l.startsAt, l.endsAt, range)))
      .map((l) => ({
        id: l.id,
        title: l.title,
        kind: "leg",
        startsAt: l.startsAt,
        // a stay is where people sleep, not something that keeps them busy: shown as a point
        endsAt: l.kind === "stay" ? null : l.endsAt,
        tz: l.startTz,
        everyone: l.kind !== "stay" && l.subgroupId === null,
        place: l.placeFrom,
        slug: "travel/itinerary",
      }));
  },
});

registerTimelineSource({
  key: "transport",
  list: async (ctx, occasionId, day) => {
    const range = dayRange(day, await zoneOf(ctx, occasionId));
    return (await listTransport(ctx, occasionId))
      .filter((t) => t.departsAt !== null && touchesDay(t.departsAt, t.arrivesAt, range))
      .map((t) => ({
        id: t.id,
        title: t.label,
        kind: "transport",
        startsAt: t.departsAt!,
        endsAt: t.arrivesAt,
        tz: t.tz,
        people: t.people.map((p) => ({ key: p.key, label: p.label })),
        place: t.placeFrom,
        capacity: t.seats === null ? null : { total: t.seats, used: t.taken },
        slug: "travel/transport",
      }));
  },
});

registerTimelineSource({
  key: "activities",
  list: async (ctx, occasionId, day) => {
    const range = dayRange(day, await zoneOf(ctx, occasionId));
    return (await listActivities(ctx, occasionId))
      .filter((a) => a.startsAt !== null && touchesDay(a.startsAt, a.endsAt, range))
      .map((a) => ({
        id: a.id,
        title: a.title,
        kind: "activity",
        startsAt: a.startsAt!,
        endsAt: a.endsAt,
        tz: a.tz,
        people: a.people.map((p) => ({ key: p.key, label: p.label })),
        place: a.place,
        capacity: a.capacity === null ? null : { total: a.capacity, used: a.taken },
        slug: "travel/groups",
      }));
  },
});

registerTimelineSource({
  key: "deliveries",
  list: async (ctx, occasionId, day) => {
    const range = dayRange(day, await zoneOf(ctx, occasionId));
    return (await listDeliveries(ctx, occasionId)).items
      .filter((d) => inDay(d.expectedFrom, range))
      .map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind === "return" ? "return" : "delivery",
        startsAt: d.expectedFrom!,
        endsAt: d.expectedTo,
        supplier: d.supplierId ? { id: d.supplierId, label: d.supplierName ?? "—" } : null,
        place: d.place,
        slug: "deliveries",
      }));
  },
});
