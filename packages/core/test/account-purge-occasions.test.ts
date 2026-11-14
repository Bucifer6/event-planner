import { accounts, eq, households, occasionMembers, occasions } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/all";
import { purgeDueAccounts } from "../src/accounts";
import { accountCtx, systemCtx } from "../src/context";
import { requestDeletion } from "../src/deletion";

// D6 / INF6: a purged account must not leave its occasions (and their guest data) behind.
let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const T0 = new Date("2026-11-14T10:00:00Z");
const later = new Date(T0.getTime() + 8 * 86_400_000);

async function account(email: string): Promise<string> {
  const [row] = await t.db.insert(accounts).values({ kind: "email", email, emailVerifiedAt: T0 }).returning();
  return row!.id;
}
async function occasion(ownerAccountId: string, title: string): Promise<string> {
  const [o] = await t.db.insert(occasions).values({ ownerAccountId, title, kind: "aniversare", dateMode: "poll" }).returning();
  await t.db.insert(occasionMembers).values({ occasionId: o!.id, accountId: ownerAccountId, role: "owner", grantFinance: true, grantPrivateRequests: true });
  return o!.id;
}

describe("account purge releases the account's occasions", () => {
  it("hands an occasion to its longest-standing project manager, deletes one with nobody left, and ends seats elsewhere", async () => {
    const leaving = await account("leaving@example.ro");
    const pm = await account("pm@example.ro");
    const other = await account("other@example.ro");

    const shared = await occasion(leaving, "Cu echipă");
    await t.db.insert(occasionMembers).values({ occasionId: shared, accountId: pm, role: "pm", grantFinance: false, grantPrivateRequests: false });
    const solo = await occasion(leaving, "Doar eu");
    await t.db.insert(households).values({ occasionId: solo, name: "Familia Popescu", language: "ro" } as never);
    const foreign = await occasion(other, "A altcuiva");
    await t.db.insert(occasionMembers).values({ occasionId: foreign, accountId: leaving, role: "contributor", grantFinance: false, grantPrivateRequests: false });

    await requestDeletion(accountCtx(t.db, leaving, { now: T0 }), { targetType: "account", targetId: leaving });
    expect(await purgeDueAccounts(systemCtx(t.db, { now: later }))).toContain(leaving);

    const [kept] = await t.db.select().from(occasions).where(eq(occasions.id, shared));
    expect(kept?.ownerAccountId).toBe(pm);
    const pmSeat = (await t.db.select().from(occasionMembers).where(eq(occasionMembers.occasionId, shared))).find((m) => m.accountId === pm);
    expect(pmSeat?.role).toBe("owner");

    expect(await t.db.select().from(occasions).where(eq(occasions.id, solo))).toHaveLength(0);
    expect(await t.db.select().from(households).where(eq(households.occasionId, solo))).toHaveLength(0);

    expect(await t.db.select().from(occasions).where(eq(occasions.id, foreign))).toHaveLength(1);
    const seats = await t.db.select().from(occasionMembers).where(eq(occasionMembers.accountId, leaving));
    expect(seats.every((s) => s.removedAt !== null)).toBe(true);
  });
});
