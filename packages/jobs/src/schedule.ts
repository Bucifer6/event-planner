import type { Ctx } from "@ed/core/context";
import { eq, jobSchedules, sql } from "@ed/db";
import { addZonedDays, bucharestParts, bucharestToUtc, HOUR_MS } from "@ed/shared/time";
import { enqueue } from "./queue";

// Recurring jobs. The last enqueued slot of every schedule is stored in job_schedules, and
// each slot's job carries a unique key — so a restart, or two workers ticking at the same
// moment, never runs a slot twice. A worker that was down runs the latest missed slot once.

export type Every =
  | { kind: "hourly"; /** minute of the hour, default 0 */ minute?: number }
  | { kind: "daily"; /** "HH:MM", Europe/Bucharest */ at: string }
  | { kind: "monthly"; /** 1–28 */ day: number; /** "HH:MM", Europe/Bucharest */ at: string };

export type ScheduleDefinition = {
  /** Unique schedule name, e.g. "retention.purge.daily". */
  name: string;
  /** Job to enqueue (a defineJob name). */
  job: string;
  every: Every;
  payload?: unknown;
};

const g = globalThis as unknown as { __edSchedules?: Map<string, ScheduleDefinition> };
const schedules: Map<string, ScheduleDefinition> = (g.__edSchedules ??= new Map());

function parseAt(at: string): { hour: number; minute: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
  if (!m) throw new Error(`Invalid schedule time "${at}" (expected HH:MM)`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Registers (or replaces) a recurring schedule. Times are Europe/Bucharest wall-clock. */
export function defineSchedule(def: ScheduleDefinition): ScheduleDefinition {
  if (def.every.kind !== "hourly") parseAt(def.every.at);
  if (def.every.kind === "monthly" && (def.every.day < 1 || def.every.day > 28)) {
    throw new Error("Monthly schedules run on day 1–28");
  }
  schedules.set(def.name, def);
  return def;
}

export function listSchedules(): ScheduleDefinition[] {
  return [...schedules.values()];
}

/** The most recent slot at or before `now`. */
export function currentSlot(every: Every, now: Date): Date {
  if (every.kind === "hourly") {
    const minute = every.minute ?? 0;
    const slot = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + minute * 60_000);
    return slot > now ? new Date(slot.getTime() - HOUR_MS) : slot;
  }
  const { hour, minute } = parseAt(every.at);
  const p = bucharestParts(now);
  if (every.kind === "daily") {
    const slot = bucharestToUtc({ year: p.year, month: p.month, day: p.day, hour, minute });
    return slot > now ? addZonedDays(slot, -1) : slot;
  }
  const slot = bucharestToUtc({ year: p.year, month: p.month, day: every.day, hour, minute });
  if (slot <= now) return slot;
  const prev = p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
  return bucharestToUtc({ ...prev, day: every.day, hour, minute });
}

/**
 * Enqueues the due slot of every schedule, at most once per slot. The first time a schedule
 * is seen its current slot is only recorded (nothing runs just because the worker booted).
 * Returns the names of the schedules that were enqueued.
 */
export async function tickSchedules(ctx: Pick<Ctx, "db" | "now">): Promise<string[]> {
  const fired: string[] = [];
  for (const def of schedules.values()) {
    const slot = currentSlot(def.every, ctx.now);
    const ran = await ctx.db.transaction(async (tx) => {
      const first = await tx
        .insert(jobSchedules)
        .values({ name: def.name, lastSlot: slot })
        .onConflictDoNothing({ target: jobSchedules.name })
        .returning({ name: jobSchedules.name });
      if (first.length > 0) return false;
      const locked = await tx.execute<{ last_slot: Date }>(
        sql`select last_slot from job_schedules where name = ${def.name} for update`,
      );
      const last = locked.rows[0]?.last_slot;
      if (last && new Date(last).getTime() >= slot.getTime()) return false;
      const res = await enqueue({ db: tx, now: ctx.now }, def.job, def.payload ?? {}, {
        uniqueKey: `schedule:${def.name}:${slot.toISOString()}`,
      });
      await tx.update(jobSchedules).set({ lastSlot: slot }).where(eq(jobSchedules.name, def.name));
      return !res.deduped;
    });
    if (ran) fired.push(def.name);
  }
  return fired;
}
