import { jobRuns, sql, statsDaily } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountCtx, systemCtx } from "../src/context";
import {
  FORBIDDEN_DIMENSION,
  readDailyStats,
  recordEvent,
  registerStatCollector,
  runNightlyStats,
} from "../src/stats";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("daily statistics (INF11, D4)", () => {
  it("recordEvent increments one daily row per metric + dimensions, atomically", async () => {
    const ctx = accountCtx(t.db, "acc_visitor_1", { now: new Date("2026-06-14T10:00:00Z"), ip: "203.0.113.9" });
    await Promise.all(
      Array.from({ length: 25 }, () => recordEvent(ctx, "directory.search", { county: "CJ", category: "foto" })),
    );
    await recordEvent(ctx, "directory.search", { category: "foto", county: "CJ" }, 5); // key order is irrelevant
    await recordEvent(ctx, "directory.search", { county: "B" });
    const rows = await readDailyStats(ctx, { metric: "directory.search", from: "2026-06-14", to: "2026-06-14" });
    expect([...rows].sort((a, b) => a.value - b.value)).toEqual([
      { day: "2026-06-14", metric: "directory.search", dimensions: { county: "B" }, value: 1 },
      { day: "2026-06-14", metric: "directory.search", dimensions: { category: "foto", county: "CJ" }, value: 30 },
    ]);
    expect(
      await readDailyStats(ctx, { metric: "directory.search", from: "2026-06-01", to: "2026-06-30", dims: { county: "CJ" } }),
    ).toHaveLength(1);
  });

  it("buckets by the Europe/Bucharest day, not the UTC day", async () => {
    // 22:30Z on 14 June is already 01:30 on 15 June in Bucharest
    await recordEvent(systemCtx(t.db, { now: new Date("2026-06-14T22:30:00Z") }), "listing.viewed");
    const rows = await readDailyStats(systemCtx(t.db), { metric: "listing.viewed", from: "2026-06-01", to: "2026-06-30" });
    expect(rows.map((r) => r.day)).toEqual(["2026-06-15"]);
  });

  it("stores nothing about who triggered the event", async () => {
    const all = await t.db.select().from(statsDaily);
    const dump = JSON.stringify(all);
    expect(dump).not.toContain("acc_visitor_1");
    expect(dump).not.toContain("203.0.113.9");
  });

  it("the table has no column that could hold a visitor identifier", async () => {
    const res = await t.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'stats_daily' order by 1`,
    );
    const columns = res.rows.map((r) => r.column_name);
    expect(columns).toEqual(["day", "dimension_key", "dimensions", "id", "metric", "updated_at", "value"]);
    for (const c of columns) {
      expect(c).not.toMatch(/visitor|session|device|cookie|account|user|guest|email|phone|ip|agent|token/);
    }
  });

  it("refuses identifying dimensions", async () => {
    const ctx = systemCtx(t.db);
    for (const key of ["accountId", "visitorId", "sessionId", "ip", "email", "userAgent", "deviceId", "guestName"]) {
      expect(FORBIDDEN_DIMENSION.test(key)).toBe(true);
      await expect(recordEvent(ctx, "x.y", { [key]: "v" })).rejects.toThrow(/not allowed/);
    }
    await expect(recordEvent(ctx, "x.y", { county: "someone@example.com" })).rejects.toThrow();
    await expect(recordEvent(ctx, "x.y", { a: 1, b: 2, c: 3, d: 4, e: 5 })).rejects.toThrow();
    // ordinary labels, including an owner-scoped listing id, are fine
    await recordEvent(ctx, "x.y", { listing: "lst_abc", county: "CJ" });
  });

  it("the nightly job stores collector results for yesterday and is repeatable", async () => {
    let seen: { day: string; from: string; to: string } | null = null;
    registerStatCollector({
      name: "test-listings",
      collect: async (_ctx, day, range) => {
        seen = { day, from: range.from.toISOString(), to: range.to.toISOString() };
        return [
          { metric: "directory.listings", dims: { county: "CJ" }, value: 12 },
          { metric: "directory.listings", dims: { county: "B" }, value: 40 },
        ];
      },
    });
    registerStatCollector({
      name: "test-broken",
      collect: async () => {
        throw new Error("boom");
      },
    });
    const ctx = systemCtx(t.db, { now: new Date("2026-06-15T21:20:00Z") }); // 00:20 on the 16th, Bucharest
    const first = await runNightlyStats(ctx);
    expect(first).toMatchObject({ day: "2026-06-15", values: 2, failed: ["test-broken"] });
    expect(seen).toEqual({ day: "2026-06-15", from: "2026-06-14T21:00:00.000Z", to: "2026-06-15T21:00:00.000Z" });
    await runNightlyStats(ctx); // at-least-once delivery: a repeat must not double the numbers
    const rows = await readDailyStats(ctx, { metric: "directory.listings", from: "2026-06-15", to: "2026-06-15" });
    expect(rows.map((r) => [r.dimensions.county, r.value]).sort()).toEqual([["B", 40], ["CJ", 12]]);
    const runs = (await t.db.select().from(jobRuns)).filter((r) => r.name === "stats.nightly");
    expect(runs).toHaveLength(2);
    expect(runs[0]!.status).toBe("failed");
    await expect(runNightlyStats(accountCtx(t.db, "acc_1"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
