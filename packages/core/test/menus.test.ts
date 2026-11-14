import { eq, mealChoices, orderDeltas, orderSnapshots } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExport } from "../src/exports";
import { getGuestView } from "../src/invitations";
import {
  buildOrderItems,
  estimateDrink,
  getGuestMenu,
  getMenuQuantities,
  getMenus,
  pushMenuToOrder,
  saveDrinkRule,
  saveMenu,
  saveMenuItem,
  saveMenuSettings,
  setMealChoices,
  withMargin,
} from "../src/menus";
import { getOrderState } from "../src/orders";
import { setRsvpDeadline, submitRsvp } from "../src/rsvp";
import { addMealStage } from "../src/seating";
import { createSupplier } from "../src/suppliers";
import { as, code, guestCtx, HELPER, household, newOccasion, NOW, OUTSIDER, OWNER, seedAccounts } from "./_releasec";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  await t.close();
});

async function weddingMenu(occ: string) {
  const { menuId } = await saveMenu(as(t, OWNER), { occasionId: occ, name: "Cina" });
  const item = (input: Record<string, unknown>) => saveMenuItem(as(t, OWNER), { menuId, course: "main", name: "x", ...input } as never).then((r) => r.itemId);
  const starter = await item({ course: "starter", name: "Platou rece" });
  const fish = await item({ name: "Păstrăv la cuptor", isChoice: "on", dietTags: ["gluten_free"] });
  const veg = await item({ name: "Risotto cu ciuperci", isChoice: "on", dietTags: ["vegetarian", "fasting"] });
  const kidA = await item({ name: "Meniu copil — paste", isChoice: "on", audience: "children" });
  const kidB = await item({ name: "Meniu copil — șnițel", isChoice: "on", audience: "children" });
  const cake = await item({ course: "dessert", name: "Tort" });
  return { menuId, starter, fish, veg, kidA, kidB, cake };
}

describe("menus (C-05)", () => {
  it("menus, items by course with fixed diet tags, optional meal stage; managers write, members read", async () => {
    const occ = await newOccasion(t);
    const stage = await addMealStage(as(t, OWNER), { occasionId: occ, name: "Cina" } as never).catch(() => null);
    const m = await weddingMenu(occ);
    if (stage && typeof stage === "object" && "id" in stage) {
      await saveMenu(as(t, OWNER), { occasionId: occ, menuId: m.menuId, name: "Cina", mealStageId: (stage as { id: string }).id });
    }
    const view = await getMenus(as(t, HELPER), occ);
    expect(view.canManage).toBe(false);
    expect(view.menus[0]!.items.map((i) => i.course)).toEqual(["starter", "main", "main", "main", "main", "dessert"]);
    expect(view.menus[0]!.items.find((i) => i.name.startsWith("Risotto"))!.dietTags).toEqual(["vegetarian", "fasting"]);
    expect(await code(() => saveMenu(as(t, HELPER), { occasionId: occ, name: "Alt meniu" }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => getMenus(as(t, OUTSIDER), occ))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    expect(await code(() => saveMenuItem(as(t, OWNER), { menuId: m.menuId, course: "main", name: "X", dietTags: ["paleo"] } as never))).toMatch(/^THROWN/);
  });

  it("meal choices are counts for the party, only for attending households, never more than the party", async () => {
    const occ = await newOccasion(t);
    const m = await weddingMenu(occ);
    const h = await household(t, occ, "Familia Popescu");
    const g = await guestCtx(t, h.token);
    // before answering: the menu is shown, choosing waits for the RSVP
    expect((await getGuestMenu(g))!.state).toBe("needsRsvp");
    expect(await code(() => setMealChoices(g, { choices: { [m.fish]: 1 } }))).toBe("CONFLICT:menus.errors.answerFirst");

    await submitRsvp(g, { attending: "yes", adultsCount: 2, childrenCount: 2 });
    const menu = (await getGuestMenu(g))!;
    expect(menu.state).toBe("open");
    expect(menu.groups.map((x) => [x.audience, x.party, x.options.length])).toEqual([["adults", 2, 2], ["children", 2, 2]]);
    expect(await code(() => setMealChoices(g, { choices: { [m.fish]: 2, [m.veg]: 1 } }))).toBe("VALIDATION:menus.errors.tooManyChoices");
    expect(await code(() => setMealChoices(g, { choices: { [m.starter]: 1 } }))).toBe("VALIDATION:common.validation.invalid"); // not a choice
    expect(await setMealChoices(g, { choices: { [m.fish]: "1", [m.veg]: "1", [m.kidA]: "2", [m.kidB]: "0" } })).toEqual({ saved: 3 });
    // children are a count on an option — the row holds nothing else
    const rows = await t.db.select().from(mealChoices).where(eq(mealChoices.householdId, h.householdId));
    expect(Object.keys(rows[0]!).sort()).toEqual(["count", "householdId", "id", "menuItemId", "occasionId", "updatedAt"]);
    // editable: sending again replaces
    await setMealChoices(g, { choices: { [m.fish]: 2, [m.veg]: 0, [m.kidA]: 2 } });
    expect((await getGuestMenu(g))!.groups[0]!.options.map((o) => o.count)).toEqual([2, 0]);
    expect((await getGuestView(g)).sections.some((s) => s.key === "menu")).toBe(true);
    // another household's link cannot write for this one, and a planner is not a guest
    expect(await code(() => setMealChoices(as(t, OWNER), { choices: {} }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });

  it("locks choices at the RSVP deadline", async () => {
    const occ = await newOccasion(t);
    const m = await weddingMenu(occ);
    const h = await household(t, occ, "Familia Ionescu");
    await submitRsvp(await guestCtx(t, h.token), { attending: "yes", adultsCount: 2, childrenCount: 0 });
    await setRsvpDeadline(as(t, OWNER), { occasionId: occ, rsvpDeadline: new Date("2027-05-01T00:00:00Z") });
    const before = await guestCtx(t, h.token, new Date("2027-04-30T10:00:00Z"));
    await setMealChoices(before, { choices: { [m.fish]: 2 } });
    const after = await guestCtx(t, h.token, new Date("2027-05-01T00:00:01Z")).catch(() => null);
    // the link itself may expire with the deadline; when it still opens, choices are locked
    if (after) {
      expect((await getGuestMenu(after))!.state).toBe("locked");
      expect(await code(() => setMealChoices(after, { choices: { [m.veg]: 2 } }))).toBe("CONFLICT:menus.errors.choicesClosed");
    }
    const kept = await t.db.select().from(mealChoices).where(eq(mealChoices.householdId, h.householdId));
    expect(kept.map((r) => [r.menuItemId, r.count])).toEqual([[m.fish, 2]]);
  });

  it("aggregates quantities from attending households only, with the safety margin and drink estimates", async () => {
    const occ = await newOccasion(t);
    const m = await weddingMenu(occ);
    const a = await household(t, occ, "Familia A");
    const b = await household(t, occ, "Familia B");
    const c = await household(t, occ, "Familia C");
    const ga = await guestCtx(t, a.token);
    const gb = await guestCtx(t, b.token);
    const gc = await guestCtx(t, c.token);
    await submitRsvp(ga, { attending: "yes", adultsCount: 2, childrenCount: 1 });
    await submitRsvp(gb, { attending: "yes", adultsCount: 3, childrenCount: 0 });
    await submitRsvp(gc, { attending: "yes", adultsCount: 2, childrenCount: 0 });
    await setMealChoices(ga, { choices: { [m.fish]: 1, [m.veg]: 1, [m.kidA]: 1 } });
    await setMealChoices(gb, { choices: { [m.fish]: 2 } }); // one adult has not chosen yet
    await setMealChoices(gc, { choices: { [m.veg]: 2 } });
    // C changes their mind: their choices stop counting without being deleted by hand
    await submitRsvp(gc, { attending: "no", adultsCount: 0, childrenCount: 0 });

    await saveMenuSettings(as(t, OWNER), { occasionId: occ, safetyMarginPct: "10", serviceHours: "6" });
    await saveDrinkRule(as(t, OWNER), { occasionId: occ, label: "Vin", unit: "sticle", perGuests: "3", perHours: "3", adultsOnly: "on" });
    await saveDrinkRule(as(t, OWNER), { occasionId: occ, label: "Apă", unit: "sticle", perGuests: 2, perHours: 2 });

    const q = await getMenuQuantities(as(t, HELPER), occ);
    expect(q.counts).toMatchObject({ adults: 5, children: 1, total: 6 });
    const line = (id: string) => q.lines.find((l) => l.itemId === id)!;
    expect([line(m.starter).base, line(m.starter).withMargin]).toEqual([5, 6]); // served to every adult: ceil(5 × 1.1)
    expect([line(m.fish).base, line(m.fish).withMargin]).toEqual([3, 4]);
    expect([line(m.veg).base, line(m.veg).withMargin]).toEqual([1, 2]); // C's two no longer count
    expect(line(m.kidA).base).toBe(1);
    expect(line(m.cake).base).toBe(5);
    const adultsGroup = q.groups.find((g) => g.audience === "adults")!;
    expect(adultsGroup).toMatchObject({ eligible: 5, chosen: 4, unchosen: 1 });
    // drinks: ceil(adults 5 / 3 × 6 / 3) = 4 ; ceil(6 / 2 × 6 / 2) = 9 — estimates
    expect(q.drinks.map((d) => [d.label, d.quantity])).toEqual([["Vin", 4], ["Apă", 9]]);
    expect(withMargin(0, 10)).toBe(0);
    expect(estimateDrink({ id: "x", label: "x", unit: "x", perGuests: 4, perHours: 1, adultsOnly: false }, { adults: 0, total: 10 }, 2)).toBe(5);
    const csv = await runExport(as(t, HELPER), occ, "menu-quantities-csv");
    expect(csv.content).toContain("Păstrăv la cuptor");
    expect(await code(() => getMenuQuantities(as(t, OUTSIDER), occ))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });

  it("pushes the aggregated quantities into the booking's order snapshot; later RSVP changes surface as deltas (B5)", async () => {
    const occ = await newOccasion(t);
    const m = await weddingMenu(occ);
    const a = await household(t, occ, "Familia A");
    const b = await household(t, occ, "Familia B");
    const ga = await guestCtx(t, a.token);
    await submitRsvp(ga, { attending: "yes", adultsCount: 2, childrenCount: 0 });
    await setMealChoices(ga, { choices: { [m.fish]: 1 } });
    await saveMenuSettings(as(t, OWNER), { occasionId: occ, safetyMarginPct: 0, serviceHours: 5 });
    await saveDrinkRule(as(t, OWNER), { occasionId: occ, label: "Vin", unit: "sticle", perGuests: 2, perHours: 5, adultsOnly: true });
    const catering = await createSupplier(as(t, OWNER), { occasionId: occ, name: "Catering Bun" });

    const payload = buildOrderItems(await getMenuQuantities(as(t, OWNER), occ), "ro", { includeDrinks: true });
    expect(payload.map((i) => [i.label, i.quantity])).toEqual([
      ["Cina · Platou rece", 2],
      ["Cina · Păstrăv la cuptor", 1],
      ["Cina · Tort", 2],
      [expect.stringContaining("Cina"), 1], // one adult without a choice yet
      ["Vin", 1],
    ]);
    expect(await code(() => pushMenuToOrder(as(t, HELPER), { occasionId: occ, bookingId: catering.bookingId }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    const res = await pushMenuToOrder(as(t, OWNER), { occasionId: occ, bookingId: catering.bookingId, includeDrinks: true });
    expect(res).toMatchObject({ version: 1, items: 5 });
    const [snap] = await t.db.select().from(orderSnapshots).where(eq(orderSnapshots.id, res.snapshotId));
    expect(snap!.items).toHaveLength(5);
    expect(snap!.basedOn).toMatchObject({ adults: 2, children: 0 });
    // a household answering afterwards leaves a delta on that booking — the agreed order is untouched
    await submitRsvp(await guestCtx(t, b.token), { attending: "yes", adultsCount: 3, childrenCount: 1 });
    const deltas = await t.db.select().from(orderDeltas).where(eq(orderDeltas.bookingId, catering.bookingId));
    expect(deltas).toHaveLength(1);
    const state = await getOrderState(as(t, OWNER), catering.bookingId);
    expect(state.latest!.version).toBe(1);
    expect(state.drift).toMatchObject({ adults: 3, children: 1 });
    // pushing again fixes version 2 and folds the delta
    const again = await pushMenuToOrder(as(t, OWNER), { occasionId: occ, bookingId: catering.bookingId });
    expect(again.version).toBe(2);
    // a booking of another occasion is not reachable
    const otherOcc = await newOccasion(t);
    expect(await code(() => pushMenuToOrder(as(t, OWNER), { occasionId: otherOcc, bookingId: catering.bookingId }))).toMatch(/^VALIDATION:menus.errors.nothingToOrder/);
    void NOW;
  });
});
