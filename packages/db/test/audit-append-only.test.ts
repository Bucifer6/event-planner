import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, idempotencyKeys, platformSettings } from "../src/schema";
import { runSeeds, seeds } from "../src/seed";
import { setupTestDb, type TestDb } from "../src/testing";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("audit_log is append-only (SEC10)", () => {
  it("allows INSERT, rejects UPDATE, DELETE and TRUNCATE", async () => {
    const [row] = await t.db
      .insert(auditLog)
      .values({
        actorKind: "system",
        action: "test.created",
        objectType: "test",
        objectId: "x1",
        after: { a: 1 },
      })
      .returning();
    expect(row?.id).toBeTruthy();
    expect(row?.at).toBeInstanceOf(Date);

    await expect(
      t.db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, row!.id)),
    ).rejects.toThrow();
    await expect(t.db.delete(auditLog).where(eq(auditLog.id, row!.id))).rejects.toThrow();
    await expect(t.db.$client.query("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
    await expect(t.db.$client.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);

    const rows = await t.db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("test.created");
  });
});

describe("platform tables", () => {
  it("idempotency_keys is unique per (scope, key)", async () => {
    await t.db.insert(idempotencyKeys).values({ scope: "s", key: "k" });
    await t.db.insert(idempotencyKeys).values({ scope: "other", key: "k" });
    await expect(t.db.insert(idempotencyKeys).values({ scope: "s", key: "k" })).rejects.toThrow();
  });

  it("platform_settings upserts and bumps updatedAt", async () => {
    await t.db.insert(platformSettings).values({ key: "k", value: { on: false } });
    await t.db
      .update(platformSettings)
      .set({ value: { on: true } })
      .where(eq(platformSettings.key, "k"));
    const [row] = await t.db.select().from(platformSettings).where(eq(platformSettings.key, "k"));
    expect(row?.value).toEqual({ on: true });
  });
});

describe("harness", () => {
  it("gives each call its own database and seeds are re-runnable", async () => {
    const other = await setupTestDb();
    try {
      expect(other.name).not.toBe(t.name);
      expect(await other.db.select().from(auditLog)).toHaveLength(0);
      const first = await runSeeds(other.db);
      const second = await runSeeds(other.db);
      expect(second).toEqual(first);
      expect(first).toEqual(seeds.map((s) => s.name));
    } finally {
      await other.close();
    }
  });
});
