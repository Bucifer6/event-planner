import { eq, idempotencyKeys, platformSettings, sql } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit";
import { accountCtx, systemCtx, type Ctx } from "../src/context";
import { withIdempotency } from "../src/idempotency";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

/** A non-idempotent side effect: increments a counter row. */
async function bump(ctx: Ctx, name: string): Promise<{ count: number }> {
  const [row] = await ctx.db
    .insert(platformSettings)
    .values({ key: name, value: 1 })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: sql`(${platformSettings.value}::text::int + 1)::text::jsonb` },
    })
    .returning();
  return { count: Number(row!.value) };
}

async function counter(name: string): Promise<number> {
  const [row] = await t.db.select().from(platformSettings).where(eq(platformSettings.key, name));
  return row ? Number(row.value) : 0;
}

describe("withIdempotency", () => {
  it("runs once and replays the stored result", async () => {
    const ctx = accountCtx(t.db, "acc_1");
    let calls = 0;
    const run = () =>
      withIdempotency(ctx, "test.bump", "key-1", async (tx) => {
        calls++;
        return bump(tx, "c1");
      });
    expect(await run()).toEqual({ count: 1 });
    expect(await run()).toEqual({ count: 1 });
    expect(await run()).toEqual({ count: 1 });
    expect(calls).toBe(1);
    expect(await counter("c1")).toBe(1);
  });

  it("treats different keys and different scopes as different operations", async () => {
    const ctx = accountCtx(t.db, "acc_1");
    await withIdempotency(ctx, "scope.a", "same-key", (tx) => bump(tx, "c2"));
    await withIdempotency(ctx, "scope.b", "same-key", (tx) => bump(tx, "c2"));
    await withIdempotency(ctx, "scope.a", "other-key", (tx) => bump(tx, "c2"));
    expect(await counter("c2")).toBe(3);
  });

  it("parallel double-submit applies once and every caller gets the same result", async () => {
    const ctx = accountCtx(t.db, "acc_1");
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        withIdempotency(ctx, "test.parallel", "double-tap", async (tx) => {
          calls++;
          await new Promise((r) => setTimeout(r, 50));
          const out = await bump(tx, "c3");
          await audit(tx, { action: "counter.bumped", objectType: "counter", objectId: "c3" });
          return out;
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(results).toEqual(Array(8).fill({ count: 1 }));
    expect(await counter("c3")).toBe(1);
  });

  it("stores nothing when fn throws, so a retry runs again", async () => {
    const ctx = systemCtx(t.db);
    await expect(
      withIdempotency(ctx, "test.fail", "k", async (tx) => {
        await bump(tx, "c4");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await counter("c4")).toBe(0);
    expect(
      await t.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.scope, "test.fail")),
    ).toHaveLength(0);
    expect(await withIdempotency(ctx, "test.fail", "k", (tx) => bump(tx, "c4"))).toEqual({
      count: 1,
    });
  });

  it("replays void results and refuses another account's key", async () => {
    const a = accountCtx(t.db, "acc_a");
    const b = accountCtx(t.db, "acc_b");
    let calls = 0;
    const fn = async () => {
      calls++;
    };
    await withIdempotency(a, "test.void", "k", fn);
    await withIdempotency(a, "test.void", "k", fn);
    expect(calls).toBe(1);
    await expect(withIdempotency(b, "test.void", "k", fn)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(calls).toBe(1);
  });
});
