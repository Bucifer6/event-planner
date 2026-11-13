import { eq, jobSchedules, jobs, platformSettings } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  backoffMs,
  computeQueueMetrics,
  currentSlot,
  DEFAULT_LEASE_MS,
  defineJob,
  defineSchedule,
  enqueue,
  leaseJobs,
  listJobRuns,
  readQueueMetrics,
  recordJobRun,
  releaseLeases,
  runOnce,
  tickSchedules,
  writeQueueMetrics,
} from "../src/index";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const T0 = new Date("2026-03-10T10:00:00Z");
const at = (ms: number) => ({ db: t.db, now: new Date(T0.getTime() + ms) });
const row = async (id: string) => (await t.db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

/** An idempotent side effect: one settings row per key, however often the handler runs. */
async function effect(key: string): Promise<void> {
  await t.db.insert(platformSettings).values({ key, value: 1 }).onConflictDoNothing();
}
async function effects(prefix: string): Promise<number> {
  const all = await t.db.select().from(platformSettings);
  return all.filter((r) => r.key.startsWith(prefix)).length;
}

describe("queue", () => {
  it("runs a job once it is due and marks it done", async () => {
    const calls: string[] = [];
    const job = defineJob("test.basic", z.object({ n: z.number() }), async (ctx, p, meta) => {
      expect(ctx.actor.kind).toBe("system");
      calls.push(`${p.n}:${meta.attempt}`);
    });
    const { id } = await job.enqueue(at(0), { n: 1 }, { runAt: new Date(T0.getTime() + 60_000) });
    expect(await runOnce(at(0), { names: ["test.basic"] })).toMatchObject({ leased: 0 });
    expect(await runOnce(at(61_000), { names: ["test.basic"] })).toMatchObject({ leased: 1, done: 1 });
    expect(calls).toEqual(["1:1"]);
    expect((await row(id)).doneAt).not.toBeNull();
    // done jobs are never leased again
    expect(await runOnce(at(120_000), { names: ["test.basic"] })).toMatchObject({ leased: 0 });
  });

  it("rejects a payload that does not match the schema at enqueue time", async () => {
    defineJob("test.schema", z.object({ id: z.string() }), async () => {});
    await expect(enqueue(at(0), "test.schema", { id: 5 })).rejects.toThrow();
  });

  it("is at-least-once: a failing handler is retried with exponential backoff, then succeeds", async () => {
    let attempts = 0;
    defineJob("test.retry", z.object({}), async () => {
      attempts++;
      await effect("retry:effect");
      if (attempts < 3) throw new Error("temporary");
    });
    const { id } = await enqueue(at(0), "test.retry", {});
    expect(await runOnce(at(0), { names: ["test.retry"] })).toMatchObject({ retried: 1 });
    let r = await row(id);
    expect(r.lastError).toContain("temporary");
    expect(r.runAt.getTime()).toBe(T0.getTime() + backoffMs(1));
    // not due yet
    expect(await runOnce(at(backoffMs(1) - 1), { names: ["test.retry"] })).toMatchObject({ leased: 0 });
    expect(await runOnce(at(backoffMs(1)), { names: ["test.retry"] })).toMatchObject({ retried: 1 });
    r = await row(id);
    expect(r.runAt.getTime()).toBe(T0.getTime() + backoffMs(1) + backoffMs(2));
    expect(backoffMs(2)).toBe(2 * backoffMs(1));
    expect(await runOnce(at(backoffMs(1) + backoffMs(2)), { names: ["test.retry"] })).toMatchObject({ done: 1 });
    expect(attempts).toBe(3);
    expect(await effects("retry:")).toBe(1); // idempotent handler: one effect after three runs
  });

  it("parks a job after max attempts and never runs it again", async () => {
    let n = 0;
    defineJob("test.dead", z.object({}), async () => {
      n++;
      throw new Error("always");
    }, { maxAttempts: 2 });
    const { id } = await enqueue(at(0), "test.dead", {});
    await runOnce(at(0), { names: ["test.dead"] });
    expect(await runOnce(at(backoffMs(1)), { names: ["test.dead"] })).toMatchObject({ failed: 1 });
    expect((await row(id)).failedAt).not.toBeNull();
    expect(await runOnce(at(10 * 3600_000), { names: ["test.dead"] })).toMatchObject({ leased: 0 });
    expect(n).toBe(2);
  });

  it("a killed worker's job resumes when its lease expires", async () => {
    let ran = 0;
    defineJob("test.killed", z.object({}), async () => {
      ran++;
    });
    const { id } = await enqueue(at(0), "test.killed", {});
    // worker A leases the job and then dies (never completes it)
    const leased = await leaseJobs(at(0), "worker-a", 5, ["test.killed"]);
    expect(leased.map((j) => j.id)).toEqual([id]);
    // while the lease is alive nobody else can take it
    expect(await runOnce(at(DEFAULT_LEASE_MS - 1), { names: ["test.killed"], workerId: "worker-b" })).toMatchObject({ leased: 0 });
    // lease expired: worker B picks it up and finishes it
    expect(await runOnce(at(DEFAULT_LEASE_MS), { names: ["test.killed"], workerId: "worker-b" })).toMatchObject({ done: 1 });
    expect(ran).toBe(1);
    const r = await row(id);
    expect(r.attempts).toBe(2);
    expect(r.doneAt).not.toBeNull();
  });

  it("a worker that lost its lease cannot mark the job (fencing), and a clean stop hands leases back", async () => {
    defineJob("test.release", z.object({}), async () => {});
    const { id } = await enqueue(at(0), "test.release", {});
    await leaseJobs(at(0), "worker-x", 5, ["test.release"]);
    expect(await releaseLeases({ db: t.db }, "worker-x")).toBe(1);
    const r = await row(id);
    expect(r.lockedBy).toBeNull();
    expect(r.attempts).toBe(0);
    expect(await runOnce(at(1), { names: ["test.release"] })).toMatchObject({ done: 1 });
  });

  it("two workers leasing at the same moment never take the same job (SKIP LOCKED)", async () => {
    defineJob("test.parallel", z.object({ i: z.number() }), async () => {});
    for (let i = 0; i < 20; i++) await enqueue(at(0), "test.parallel", { i });
    const [a, b, c] = await Promise.all([
      leaseJobs(at(1), "w-a", 10, ["test.parallel"]),
      leaseJobs(at(1), "w-b", 10, ["test.parallel"]),
      leaseJobs(at(1), "w-c", 10, ["test.parallel"]),
    ]);
    const ids = [...a, ...b, ...c].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
  });

  it("uniqueKey dedupes: the second enqueue adds nothing, even in parallel", async () => {
    let n = 0;
    defineJob("test.unique", z.object({}), async () => {
      n++;
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => enqueue(at(0), "test.unique", {}, { uniqueKey: "unique:one" })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.deduped)).toHaveLength(1);
    await runOnce(at(1), { names: ["test.unique"] });
    // still deduped after the job ran (the key lives as long as the row)
    expect((await enqueue(at(2), "test.unique", {}, { uniqueKey: "unique:one" })).deduped).toBe(true);
    await runOnce(at(3), { names: ["test.unique"] });
    expect(n).toBe(1);
  });

  it("a job with no handler in this process is retried, not lost", async () => {
    const { id } = await enqueue(at(0), "test.unknown-here", { a: 1 });
    expect(await runOnce(at(0), { names: ["test.unknown-here"] })).toMatchObject({ retried: 1 });
    expect((await row(id)).doneAt).toBeNull();
  });
});

describe("schedules", () => {
  it("computes Europe/Bucharest slots across DST", () => {
    // winter: 03:30 Bucharest = 01:30Z; summer: 00:30Z
    expect(currentSlot({ kind: "daily", at: "03:30" }, new Date("2026-01-15T12:00:00Z")).toISOString()).toBe("2026-01-15T01:30:00.000Z");
    expect(currentSlot({ kind: "daily", at: "03:30" }, new Date("2026-07-15T00:00:00Z")).toISOString()).toBe("2026-07-14T00:30:00.000Z");
    expect(currentSlot({ kind: "hourly", minute: 15 }, new Date("2026-07-15T10:05:00Z")).toISOString()).toBe("2026-07-15T09:15:00.000Z");
    expect(currentSlot({ kind: "monthly", day: 1, at: "04:30" }, new Date("2026-03-01T00:00:00Z")).toISOString()).toBe("2026-02-01T02:30:00.000Z");
    expect(currentSlot({ kind: "monthly", day: 1, at: "04:30" }, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2025-12-01T02:30:00.000Z");
  });

  it("runs each slot once: no double-run after a restart or with two workers ticking", async () => {
    let runs = 0;
    defineJob("test.scheduled", z.object({}).passthrough(), async () => {
      runs++;
    });
    defineSchedule({ name: "test.sched.daily", job: "test.scheduled", every: { kind: "daily", at: "03:30" } });
    const only = (names: string[]) => names.filter((n) => n === "test.sched.daily");

    const day1 = { db: t.db, now: new Date("2026-05-10T09:00:00Z") };
    // first sight: the slot is recorded, nothing runs just because the worker booted
    expect(only(await tickSchedules(day1))).toEqual([]);
    expect(only(await tickSchedules(day1))).toEqual([]);

    // next day after 03:30 Bucharest (00:30Z): fires exactly once, however many ticks/workers
    const day2 = { db: t.db, now: new Date("2026-05-11T00:31:00Z") };
    const fired = await Promise.all([tickSchedules(day2), tickSchedules(day2), tickSchedules(day2)]);
    expect(fired.flatMap(only)).toHaveLength(1);
    // "restart": the process forgets everything, the database does not
    expect(only(await tickSchedules({ db: t.db, now: new Date("2026-05-11T08:00:00Z") }))).toEqual([]);
    await runOnce({ db: t.db, now: new Date("2026-05-11T08:00:00Z") }, { names: ["test.scheduled"] });
    expect(runs).toBe(1);

    // a worker that was down for three days runs the latest missed slot once, not three times
    const later = { db: t.db, now: new Date("2026-05-14T12:00:00Z") };
    expect(only(await tickSchedules(later))).toEqual(["test.sched.daily"]);
    expect(only(await tickSchedules(later))).toEqual([]);
    await runOnce(later, { names: ["test.scheduled"] });
    expect(runs).toBe(2);
    const [s] = await t.db.select().from(jobSchedules).where(eq(jobSchedules.name, "test.sched.daily"));
    expect(s!.lastSlot.toISOString()).toBe("2026-05-14T00:30:00.000Z");
  });
});

describe("metrics and run log", () => {
  it("writes queue depth and error rate, readable by staff/system only", async () => {
    const m = await writeQueueMetrics(at(20 * 3600_000), { depth: 0, errorRate: 0.01, oldestDueSeconds: 1 });
    expect(m.depth).toBeGreaterThanOrEqual(1); // the unknown-handler job is still waiting
    expect(m.dead).toBeGreaterThanOrEqual(1);
    expect(m.alerts).toContain("queue_depth");
    const computed = await computeQueueMetrics(at(1000));
    expect(computed.errorRate).toBeGreaterThan(0);
    expect(computed.errorRate).toBeLessThanOrEqual(1);
    const sys = { db: t.db, now: T0, actor: { kind: "system" as const }, locale: "ro" as const };
    expect((await readQueueMetrics(sys))?.depth).toBe(m.depth);
    const acc = { ...sys, actor: { kind: "account" as const, accountId: "acc_1" } };
    await expect(readQueueMetrics(acc)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records operational runs", async () => {
    await recordJobRun(at(0), { name: "backup.run", status: "skipped", detail: { reason: "not set" } });
    const sys = { db: t.db, now: T0, actor: { kind: "system" as const }, locale: "ro" as const };
    const runs = await listJobRuns(sys, "backup.run");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("skipped");
  });
});
