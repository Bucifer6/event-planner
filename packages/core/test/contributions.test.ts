import { accounts, contributionClaims, contributionNeeds, eq, occasionMembers, occasions } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountCtx, anonymousCtx, makeCtx, type Ctx } from "../src/context";
import { listNeeds, releaseContribution, saveNeed, setContribution } from "../src/contributions";
import { createHousehold } from "../src/guests";
import { getGuestView, resolveGuestLink } from "../src/invitations";
import { confirmPreview, createPreview } from "../src/whatif";

let t: TestDb;
const OWNER = "acc_owner_c";
const HELPER = "acc_helper_c";
const OCC = "occ_contrib";

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(accounts).values([
    { id: OWNER, kind: "email", email: "owner-c@example.test" },
    { id: HELPER, kind: "email", email: "maria.helper@example.test" },
  ]);
  await t.db.insert(occasions).values({ id: OCC, ownerAccountId: OWNER, title: "Picnic", kind: "picnic" });
  await t.db.insert(occasionMembers).values([
    { occasionId: OCC, accountId: OWNER, role: "owner" },
    { occasionId: OCC, accountId: HELPER, role: "contributor" },
  ]);
});
afterAll(async () => {
  await t.close();
});

const owner = (): Ctx => accountCtx(t.db, OWNER);
async function guest(name: string): Promise<{ ctx: Ctx; householdId: string }> {
  const h = await createHousehold(owner(), { occasionId: OCC, name });
  const link = await resolveGuestLink(anonymousCtx(t.db), h.token);
  return { ctx: makeCtx(t.db, link!.actor), householdId: h.householdId };
}
async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return isAppError(e) ? `${e.code}:${e.messageKey}` : `THROWN:${String(e)}`;
  }
}
const claimed = async (needId: string) =>
  (await t.db.select().from(contributionNeeds).where(eq(contributionNeeds.id, needId)))[0]!.unitsClaimed;

describe("contributions — Cine ce aduce (A9)", () => {
  it("parallel claims on the last units: exactly one wins; release returns the units", async () => {
    const { needId } = await saveNeed(owner(), { occasionId: OCC, title: "Sticle de vin", unitsNeeded: 12 });
    const first = await guest("Familia Unu");
    await setContribution(first.ctx, { needId, units: 10 });
    expect(await claimed(needId)).toBe(10);

    const rivals = await Promise.all(Array.from({ length: 5 }, (_, i) => guest(`Rival ${i}`)));
    const outcomes = await Promise.all(rivals.map((r) => code(() => setContribution(r.ctx, { needId, units: 2 }))));
    expect(outcomes.filter((o) => o === "OK")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "TAKEN:contributions.errors.taken")).toHaveLength(4);
    expect(await claimed(needId)).toBe(12);
    expect(await t.db.select().from(contributionClaims).where(eq(contributionClaims.needId, needId))).toHaveLength(2);

    // the loser is told what is left
    const loser = rivals[outcomes.findIndex((o) => o !== "OK")]!;
    let err: unknown;
    await setContribution(loser.ctx, { needId, units: 1 }).catch((e) => (err = e));
    expect(isAppError(err) && err.details?.params).toEqual({ left: 0 });

    // change (down) and release give units back; then the loser can claim
    await setContribution(first.ctx, { needId, units: 7 });
    expect(await claimed(needId)).toBe(9);
    await setContribution(loser.ctx, { needId, units: 3 });
    expect(await claimed(needId)).toBe(12);
    await releaseContribution(first.ctx, { needId });
    await releaseContribution(first.ctx, { needId }); // twice is harmless
    expect(await claimed(needId)).toBe(5);
    // growing past what is free keeps the old claim
    expect(await code(() => setContribution(loser.ctx, { needId, units: 11 }))).toBe("TAKEN:contributions.errors.taken");
    expect(await claimed(needId)).toBe(5);
  });

  it("a double tap applies once; members claim in the app; guests see only totals and their own claim", async () => {
    const { needId } = await saveNeed(owner(), { occasionId: OCC, title: "Prăjituri", unitsNeeded: 6 });
    const a = await guest("Familia Dublu");
    const taps = await Promise.all([
      setContribution(a.ctx, { needId, units: 2 }),
      setContribution(a.ctx, { needId, units: 2 }),
      setContribution(a.ctx, { needId, units: 2 }),
    ]);
    expect(taps.filter((r) => r.changed)).toHaveLength(1);
    expect(await claimed(needId)).toBe(2);

    await setContribution(accountCtx(t.db, HELPER), { needId, units: 3 });
    const planner = await listNeeds(owner(), OCC);
    const need = planner.needs.find((n) => n.id === needId)!;
    expect(need).toMatchObject({ unitsNeeded: 6, unitsClaimed: 5, unitsLeft: 1 });
    expect(need.claims.map((c) => [c.kind, c.by, c.units])).toEqual([
      ["household", "Familia Dublu", 2],
      ["member", "maria.helper", 3],
    ]);
    expect(JSON.stringify(planner)).not.toContain("@example.test");
    expect((await listNeeds(accountCtx(t.db, HELPER), OCC)).needs.find((n) => n.id === needId)!.mine).toBe(3);

    const b = await guest("Familia Alta");
    const section = (await getGuestView(b.ctx)).sections.find((s) => s.key === "contributions")!.data as {
      needs: Array<{ id: string; unitsLeft: number; mine: number }>;
    };
    expect(section.needs.find((n) => n.id === needId)).toMatchObject({ unitsLeft: 1, mine: 0 });
    expect(JSON.stringify(section)).not.toContain("Familia Dublu");
    expect(JSON.stringify(section)).not.toContain("maria");

    // units cannot be set below what is claimed; a guest of another occasion cannot claim
    expect(await code(() => saveNeed(owner(), { occasionId: OCC, needId, title: "Prăjituri", unitsNeeded: 4 }))).toBe(
      "VALIDATION:contributions.errors.belowClaimed",
    );
    expect(await code(() => setContribution(anonymousCtx(t.db), { needId, units: 1 }))).toMatch(/^UNAUTHENTICATED/);
    expect(await code(() => saveNeed(accountCtx(t.db, HELPER), { occasionId: OCC, title: "X", unitsNeeded: 1 }))).toMatch(/^FORBIDDEN/);

    // removing a household (What-if) gives its units back
    const p = await createPreview(owner(), {
      kind: "guests.removeHousehold",
      occasionId: OCC,
      subjectType: "household",
      subjectId: a.householdId,
      input: { householdId: a.householdId },
    });
    expect(await claimed(needId)).toBe(5); // a preview changes nothing
    await confirmPreview(owner(), p.id);
    expect(await claimed(needId)).toBe(3);
  });
});
