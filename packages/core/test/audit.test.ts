import { auditLog, eq } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, type AppError } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit";
import { accountCtx, anonymousCtx, makeCtx, requireAccount, systemCtx } from "../src/context";
import { inTx } from "../src/tx";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("audit", () => {
  it("records actor, action, object and snapshots at ctx.now", async () => {
    const now = new Date("2026-03-01T10:00:00.000Z");
    const ctx = accountCtx(t.db, "acc_1", { now });
    const id = await audit(ctx, {
      action: "task.completed",
      objectType: "task",
      objectId: "task_1",
      before: { status: "open" },
      after: { status: "done", at: now },
      meta: { via: "test" },
    });
    const [row] = await t.db.select().from(auditLog).where(eq(auditLog.id, id));
    expect(row).toMatchObject({
      actorKind: "account",
      actorId: "acc_1",
      action: "task.completed",
      objectType: "task",
      objectId: "task_1",
      before: { status: "open" },
      after: { status: "done", at: "2026-03-01T10:00:00.000Z" },
      meta: { via: "test" },
    });
    expect(row?.at.toISOString()).toBe(now.toISOString());
  });

  it("identifies system, mcp and staff actors", async () => {
    const a = await audit(systemCtx(t.db), { action: "job.ran", objectType: "job" });
    const b = await audit(
      makeCtx(t.db, { kind: "mcp", accountId: "acc_2", tokenId: "tok_1", scope: "read_propose" }),
      { action: "proposal.created", objectType: "proposal", objectId: "p1" },
    );
    const c = await audit(
      makeCtx(t.db, { kind: "staff", accountId: "acc_3", staffId: "st_1", roles: ["Support"] }),
      {
        action: "listing.moderated",
        objectType: "listing",
        objectId: "l1",
      },
    );
    const rows = await t.db.select().from(auditLog);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)).toMatchObject({
      actorKind: "system",
      actorId: null,
      objectId: null,
      before: null,
    });
    expect(byId.get(b)).toMatchObject({
      actorKind: "mcp",
      actorId: "tok_1",
      meta: { actorAccountId: "acc_2" },
    });
    expect(byId.get(c)).toMatchObject({
      actorKind: "staff",
      actorId: "st_1",
      meta: { actorAccountId: "acc_3" },
    });
  });

  it("rolls back together with the surrounding transaction", async () => {
    const ctx = accountCtx(t.db, "acc_tx");
    await expect(
      inTx(ctx, async (tx) => {
        await audit(tx, { action: "x.rolled_back", objectType: "x" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, "x.rolled_back"));
    expect(rows).toHaveLength(0);

    await inTx(ctx, async (tx) => {
      await audit(tx, { action: "x.committed", objectType: "x" });
    });
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, "x.committed")),
    ).toHaveLength(1);
  });
});

describe("requireAccount", () => {
  it("returns the account for account, mcp and staff actors", () => {
    expect(requireAccount(accountCtx(t.db, "a1"))).toBe("a1");
    expect(
      requireAccount(makeCtx(t.db, { kind: "mcp", accountId: "a2", tokenId: "t", scope: "read" })),
    ).toBe("a2");
    expect(
      requireAccount(makeCtx(t.db, { kind: "staff", accountId: "a3", staffId: "s", roles: [] })),
    ).toBe("a3");
  });

  it("throws UNAUTHENTICATED for system, guest and anonymous actors", () => {
    for (const ctx of [
      systemCtx(t.db),
      anonymousCtx(t.db),
      makeCtx(t.db, { kind: "guest", invitationId: "i", householdId: "h", occasionId: "o" }),
    ]) {
      try {
        requireAccount(ctx);
        throw new Error("should have thrown");
      } catch (e) {
        expect(isAppError(e)).toBe(true);
        expect((e as AppError).code).toBe("UNAUTHENTICATED");
      }
    }
  });
});
