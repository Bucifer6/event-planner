import { and, asc, eq, gte, lte, sql, statsDaily } from "@ed/db";
import { defineJob, defineSchedule, recordJobRun } from "@ed/jobs";
import { addZonedDays, bucharestDateKey, bucharestToUtc } from "@ed/shared/time";
import { z } from "zod";
import { requireSystem, type Ctx } from "./context";

// Statistics (INF11, D4): server-side DAILY aggregates of application events. There is no
// visitor identifier anywhere — not in the table, not in dimensions. Two ways in:
//
//   await recordEvent(ctx, "directory.search", { county: "CJ", category: "foto" });
//       increments today's counter atomically. Call it from core when the event happens.
//
//   registerStatCollector({ name: "listings", collect: async (ctx, day) => [
//     { metric: "directory.listings.published", dims: { county }, value: n }, … ] });
//       the nightly job stores (replaces) these values for the day that just ended.
//
// Dimensions are small, low-cardinality labels (county, category, a business or listing id
// whose OWNER reads the numbers). Anything that identifies a visitor is refused.

export type StatDims = Record<string, string | number | boolean>;
export type StatValue = { metric: string; dims?: StatDims; value: number };
export type StatCollector = {
  name: string;
  /** `day` is the Europe/Bucharest day to aggregate ("YYYY-MM-DD"); from/to bound it in UTC. */
  collect: (ctx: Ctx, day: string, range: { from: Date; to: Date }) => Promise<StatValue[]>;
};

const metricSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+){0,5}$/).max(120);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Dimension names that would identify a person or a device are never accepted (D4). */
export const FORBIDDEN_DIMENSION = /visitor|session|device|cookie|account|user|guest|email|phone|(^|_)ip$|ipaddr|address|agent|fingerprint|token|name$/i;
const MAX_DIMS = 4;

export function normaliseDims(dims: StatDims = {}): { key: string; dims: Record<string, string> } {
  const entries = Object.entries(dims)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length > MAX_DIMS) throw new Error(`stats: at most ${MAX_DIMS} dimensions`);
  for (const [k, v] of entries) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(k) || FORBIDDEN_DIMENSION.test(k)) {
      throw new Error(`stats: dimension "${k}" is not allowed (no visitor identifiers, D4)`);
    }
    if (v.length > 80 || v.includes("@")) throw new Error(`stats: dimension "${k}" value not allowed`);
  }
  return {
    key: entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&"),
    dims: Object.fromEntries(entries),
  };
}

async function upsert(
  ctx: Ctx,
  day: string,
  metric: string,
  dims: StatDims | undefined,
  value: number,
  mode: "add" | "set",
): Promise<void> {
  metricSchema.parse(metric);
  daySchema.parse(day);
  if (!Number.isSafeInteger(value)) throw new Error("stats: value must be an integer");
  const d = normaliseDims(dims);
  await ctx.db
    .insert(statsDaily)
    .values({ day, metric, dimensionKey: d.key, dimensions: d.dims, value, updatedAt: ctx.now })
    .onConflictDoUpdate({
      target: [statsDaily.day, statsDaily.metric, statsDaily.dimensionKey],
      set: {
        value: mode === "add" ? sql`${statsDaily.value} + ${value}` : value,
        updatedAt: ctx.now,
      },
    });
}

/**
 * Counts one application event in today's (Europe/Bucharest) aggregate. Atomic: concurrent
 * calls never lose an increment. Nothing about the actor is stored — ctx is used for the
 * database and the clock only.
 */
export async function recordEvent(ctx: Ctx, metric: string, dims?: StatDims, by = 1): Promise<void> {
  await upsert(ctx, bucharestDateKey(ctx.now), metric, dims, by, "add");
}

/** Stores (replaces) a computed value for a day. Used by collectors; safe to repeat. */
export async function setDailyStat(ctx: Ctx, day: string, v: StatValue): Promise<void> {
  await upsert(ctx, day, v.metric, v.dims, v.value, "set");
}

export type DailyStat = { day: string; metric: string; dimensions: Record<string, string>; value: number };

/**
 * Reads daily aggregates. NO ACCESS CHECK here: call it only from a core function that has
 * already decided the caller may see these numbers (a business its own listing, staff the
 * directory) — never straight from a route.
 */
export async function readDailyStats(
  ctx: Ctx,
  q: { metric: string; from: string; to: string; dims?: StatDims },
): Promise<DailyStat[]> {
  metricSchema.parse(q.metric);
  daySchema.parse(q.from);
  daySchema.parse(q.to);
  const where = [eq(statsDaily.metric, q.metric), gte(statsDaily.day, q.from), lte(statsDaily.day, q.to)];
  if (q.dims) {
    // every given dimension must match; rows may carry more
    where.push(sql`${statsDaily.dimensions} @> ${JSON.stringify(normaliseDims(q.dims).dims)}::jsonb`);
  }
  const rows = await ctx.db
    .select()
    .from(statsDaily)
    .where(and(...where))
    .orderBy(asc(statsDaily.day), asc(statsDaily.dimensionKey));
  return rows.map((r) => ({ day: r.day, metric: r.metric, dimensions: r.dimensions, value: r.value }));
}

const g = globalThis as unknown as { __edStatCollectors?: Map<string, StatCollector> };
const collectors: Map<string, StatCollector> = (g.__edStatCollectors ??= new Map());

/** Registers (or replaces, by name) a nightly collector. */
export function registerStatCollector(collector: StatCollector): void {
  if (!/^[a-z][a-z0-9-]*$/.test(collector.name)) throw new Error(`Invalid collector name`);
  collectors.set(collector.name, collector);
}

export const NIGHTLY_STATS_JOB = "stats.nightly";

export type NightlyStatsResult = { day: string; collectors: number; values: number; failed: string[] };

/**
 * Runs every collector for `day` (default: yesterday in Europe/Bucharest) and stores the
 * results. Repeating it for the same day gives the same rows (values are set, not added).
 */
export async function runNightlyStats(ctx: Ctx, day?: string): Promise<NightlyStatsResult> {
  requireSystem(ctx);
  const target = day ? daySchema.parse(day) : bucharestDateKey(addZonedDays(ctx.now, -1));
  const [y, m, d] = target.split("-").map(Number) as [number, number, number];
  const from = bucharestToUtc({ year: y, month: m, day: d });
  const to = addZonedDays(from, 1);
  const out: NightlyStatsResult = { day: target, collectors: collectors.size, values: 0, failed: [] };
  for (const c of collectors.values()) {
    try {
      const values = await c.collect(ctx, target, { from, to });
      for (const v of values) {
        await setDailyStat(ctx, target, v);
        out.values++;
      }
    } catch {
      out.failed.push(c.name);
    }
  }
  await recordJobRun(ctx, {
    name: NIGHTLY_STATS_JOB,
    status: out.failed.length > 0 ? "failed" : "ok",
    detail: { day: target, collectors: out.collectors, values: out.values, failed: out.failed.join(",") },
  });
  return out;
}

export function registerJobs(): void {
  defineJob(NIGHTLY_STATS_JOB, z.object({ day: daySchema.optional() }), async (ctx, p) => {
    const res = await runNightlyStats(ctx, p.day);
    if (res.failed.length > 0) throw new Error(`stat collectors failed: ${res.failed.join(", ")}`);
  });
  defineSchedule({ name: "stats.nightly", job: NIGHTLY_STATS_JOB, every: { kind: "daily", at: "00:20" } });
}
