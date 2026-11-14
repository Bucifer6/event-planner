import { accounts, eq, sessions } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId, type AppError } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getOwnAccount,
  onAccountPurge,
  purgeDueAccounts,
  requestAccountDeletion,
  undoAccountDeletion,
} from "../src/accounts";
import { accountCtx, anonymousCtx, systemCtx } from "../src/context";
import { getOpenDeletion, listDue, requestDeletion, undoDeletion } from "../src/deletion";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const DAY = 24 * 60 * 60_000;
const T0 = new Date("2026-04-01T09:00:00.000Z");
const plus = (days: number) => new Date(T0.getTime() + days * DAY);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return (e as AppError).code;
    throw e;
  }
  return "OK";
}

async function makeAccount(fresh: Date | null) {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `${id}@example.ro` });
  await t.db.insert(sessions).values({
    accountId: id,
    tokenHash: newId(),
    lastSeenAt: T0,
    expiresAt: plus(30),
    freshAuthAt: fresh,
  });
  return id;
}

describe("generic deletion requests (D6)", () => {
  it("opens with a 7-day undo, is idempotent, and can be undone inside the window", async () => {
    const ctx = accountCtx(t.db, "acc_del", { now: T0 });
    const a = await requestDeletion(ctx, { targetType: "occasion", targetId: "occ_1", retainedNote: "receipts" });
    expect(a.undoUntil.toISOString()).toBe(plus(7).toISOString());
    const b = await requestDeletion(accountCtx(t.db, "acc_del", { now: plus(1) }), { targetType: "occasion", targetId: "occ_1" });
    expect(b.id).toBe(a.id);
    expect(b.undoUntil.toISOString()).toBe(a.undoUntil.toISOString());

    await undoDeletion(accountCtx(t.db, "acc_del", { now: plus(6.9) }), { targetType: "occasion", targetId: "occ_1" });
    expect(await getOpenDeletion(ctx, { targetType: "occasion", targetId: "occ_1" })).toBeNull();
    // a new request can be opened afterwards
    const c = await requestDeletion(accountCtx(t.db, "acc_del", { now: plus(8) }), { targetType: "occasion", targetId: "occ_1" });
    expect(c.id).not.toBe(a.id);
  });

  it("cannot be undone after seven days; listDue is worker-only and returns it then", async () => {
    const ctx = accountCtx(t.db, "acc_del2", { now: T0 });
    await requestDeletion(ctx, { targetType: "occasion", targetId: "occ_2" });
    expect(await code(undoDeletion(accountCtx(t.db, "acc_del2", { now: plus(7.01) }), { targetType: "occasion", targetId: "occ_2" }))).toBe("CONFLICT");
    expect(await code(listDue(ctx))).toBe("FORBIDDEN");
    expect((await listDue(systemCtx(t.db, { now: plus(6.9) }), { targetType: "occasion" })).map((r) => r.targetId)).not.toContain("occ_2");
    expect((await listDue(systemCtx(t.db, { now: plus(7.01) }), { targetType: "occasion" })).map((r) => r.targetId)).toContain("occ_2");
    expect(await code(requestDeletion(anonymousCtx(t.db), { targetType: "occasion", targetId: "x" }))).toBe("UNAUTHENTICATED");
    expect(await code(undoDeletion(ctx, { targetType: "occasion", targetId: "nope" }))).toBe("NOT_FOUND");
  });
});

describe("account deletion (D6, S4)", () => {
  it("needs fresh auth", async () => {
    const stale = await makeAccount(new Date(T0.getTime() - 11 * 60_000));
    expect(await code(requestAccountDeletion(accountCtx(t.db, stale, { now: T0 })))).toBe("FORBIDDEN");
    const never = await makeAccount(null);
    expect(await code(requestAccountDeletion(accountCtx(t.db, never, { now: T0 })))).toBe("FORBIDDEN");
  });

  it("is restorable for 7 days and states what is retained", async () => {
    const id = await makeAccount(new Date(T0.getTime() - 60_000));
    const res = await requestAccountDeletion(accountCtx(t.db, id, { now: T0 }));
    expect(res.undoUntil.toISOString()).toBe(plus(7).toISOString());
    expect(res.retained).toEqual({ receiptsYears: 7, objectionRecordsYears: 3, auditYears: 2 });
    const view = await getOwnAccount(accountCtx(t.db, id, { now: plus(1) }));
    expect(view.deletion?.undoUntil.toISOString()).toBe(plus(7).toISOString());

    // the worker does not touch it inside the window
    expect(await purgeDueAccounts(systemCtx(t.db, { now: plus(6) }))).not.toContain(id);
    await undoAccountDeletion(accountCtx(t.db, id, { now: plus(6) }));
    expect((await getOwnAccount(accountCtx(t.db, id, { now: plus(6) }))).deletion).toBeNull();
    expect(await purgeDueAccounts(systemCtx(t.db, { now: plus(30) }))).not.toContain(id);
    const [row] = await t.db.select().from(accounts).where(eq(accounts.id, id));
    expect(row?.email).toBe(`${id}@example.ro`);
  });

  it("is purged after 7 days: sessions gone, identity removed, purge hooks called", async () => {
    const id = await makeAccount(new Date(T0.getTime() - 60_000));
    const hooked: string[] = [];
    onAccountPurge(async (_ctx, accountId) => {
      hooked.push(accountId);
    });
    await requestAccountDeletion(accountCtx(t.db, id, { now: T0 }));
    expect(await code(undoAccountDeletion(accountCtx(t.db, id, { now: plus(7.5) })))).toBe("CONFLICT");
    expect(await purgeDueAccounts(systemCtx(t.db, { now: plus(7.5) }))).toContain(id);
    expect(hooked).toContain(id);
    const [row] = await t.db.select().from(accounts).where(eq(accounts.id, id));
    expect(row).toMatchObject({ email: null, username: null, passwordHash: null });
    expect(row?.deletedAt).not.toBeNull();
    expect(await t.db.select().from(sessions).where(eq(sessions.accountId, id))).toHaveLength(0);
    expect(await code(getOwnAccount(accountCtx(t.db, id, { now: plus(8) })))).toBe("UNAUTHENTICATED");
    // running again is a no-op
    expect(await purgeDueAccounts(systemCtx(t.db, { now: plus(9) }))).not.toContain(id);
  });
});
