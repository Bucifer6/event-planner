import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { giftEstimates, occasionMembers, occasions } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { newId } from "@ed/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, type Actor } from "../src/context";
import { listExports, runExport } from "../src/exports";
import { deleteGiftEstimate, DEFAULT_GIFT_GUIDE, estimateGift, getGiftGuide, getGiftPage, resetGiftGuide, saveGiftEstimate, saveGiftGuide } from "../src/gifts";
import { createHousehold } from "../src/guests";
import { getGuestView } from "../src/invitations";
import "../src/briefingpdf";
import "../src/printpack";
import "../src/seating";
import { as, code, guestCtx, HELPER, OUTSIDER, OWNER, PM, seedAccounts } from "./_releasec";

// C-11: a private, per-account cultural guide. Transparent table, editable; results are seen
// by the account that made them and by nobody and nothing else.

let t: TestDb;
let dir: string;
const SECRET = "Notiță-foarte-personală";

async function mkOccasion(): Promise<string> {
  const id = newId();
  await t.db.insert(occasions).values({ id, ownerAccountId: OWNER, title: "Nunta Ioanei", kind: "nunta", startsAt: new Date("2027-06-12T09:00:00Z") });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: PM, role: "pm" },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}

beforeAll(async () => {
  process.env.APP_URL = "https://app.example.test";
  dir = mkdtempSync(join(tmpdir(), "ed-gifts-"));
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});

describe("the guide: a range from three questions, from a table anyone can read", () => {
  it("computes range = base × closeness × distance × adults, rounded to 50 RON", () => {
    const friend = estimateGift(DEFAULT_GIFT_GUIDE, { relationship: "friend", distance: "local", venue: "restaurant", adults: 2 });
    expect(friend).toMatchObject({ lowMinor: 60000, highMinor: 100000, currency: "RON" });
    expect(friend.reasoning).toEqual({ baseLowMinor: 30000, baseHighMinor: 50000, relationshipPct: 100, distancePct: 100, adults: 2 });
    // closer → more; from far away → less (they also bear the journey)
    const family = estimateGift(DEFAULT_GIFT_GUIDE, { relationship: "close_family", distance: "local", venue: "restaurant", adults: 2 });
    expect(family.lowMinor).toBe(90000);
    const abroad = estimateGift(DEFAULT_GIFT_GUIDE, { relationship: "friend", distance: "abroad", venue: "restaurant", adults: 2 });
    expect(abroad.highMinor).toBe(80000);
    const one = estimateGift(DEFAULT_GIFT_GUIDE, { relationship: "colleague", distance: "country", venue: "home", adults: 1 });
    expect(one).toMatchObject({ lowMinor: 10000, highMinor: 20000 }); // 150 × 0.8 × 0.9 = 108 → 100; 300 × 0.72 = 216 → 200
    for (const v of [friend, family, abroad, one]) {
      expect(v.lowMinor % 5000).toBe(0);
      expect(v.highMinor).toBeGreaterThanOrEqual(v.lowMinor);
    }
  });

  it("the default table is a neutral placeholder each account can change for itself alone", async () => {
    expect(await getGiftGuide(as(t, OWNER))).toEqual({ guide: DEFAULT_GIFT_GUIDE, isDefault: true });
    const mine = structuredClone(DEFAULT_GIFT_GUIDE);
    mine.base.restaurant = { lowMinor: 40000, highMinor: 70000 };
    mine.relationshipPct.friend = 110;
    await saveGiftGuide(as(t, OWNER), mine);
    expect((await getGiftGuide(as(t, OWNER))).guide.base.restaurant.highMinor).toBe(70000);
    expect((await getGiftGuide(as(t, OWNER))).isDefault).toBe(false);
    expect((await getGiftGuide(as(t, PM))).isDefault).toBe(true); // nothing is shared between planners
    expect(await code(() => saveGiftGuide(as(t, OWNER), { ...mine, base: { ...mine.base, home: { lowMinor: 500, highMinor: 100 } } }))).toMatch(/^THROWN|VALIDATION/);
    await resetGiftGuide(as(t, OWNER));
    expect((await getGiftGuide(as(t, OWNER))).isDefault).toBe(true);
  });
});

describe("private to the planner's own account", () => {
  it("another member of the same occasion gets nothing; guests, assistants, staff and the system are refused", async () => {
    const occ = await mkOccasion();
    const h = await createHousehold(as(t, OWNER), { occasionId: occ, name: "Familia Popescu", guestNames: ["Ana Popescu"] });
    const kept = await saveGiftEstimate(as(t, OWNER), { occasionId: occ, householdId: h.householdId, relationship: "close_friend", distance: "county", venue: "ballroom", adults: 2 });
    expect(kept).toMatchObject({ label: "Familia Popescu", lowMinor: 95000, highMinor: 145000 });
    await saveGiftEstimate(as(t, OWNER), { occasionId: occ, label: SECRET, relationship: "friend", distance: "local", venue: "restaurant", adults: 1 });
    // one note per household: saving again replaces it
    await saveGiftEstimate(as(t, OWNER), { occasionId: occ, householdId: h.householdId, relationship: "family", distance: "local", venue: "ballroom", adults: 2 });
    const mine = await getGiftPage(as(t, OWNER), occ);
    expect(mine.estimates.map((e) => e.label).sort()).toEqual(["Familia Popescu", SECRET].sort());
    expect(mine.estimates.find((e) => e.householdId === h.householdId)!.relationship).toBe("family");
    expect(mine.households).toEqual([{ id: h.householdId, name: "Familia Popescu" }]);

    // the co-organiser and the contributor of the SAME occasion see their own (empty) notes
    expect((await getGiftPage(as(t, PM), occ)).estimates).toEqual([]);
    expect((await getGiftPage(as(t, HELPER), occ)).estimates).toEqual([]);
    // and cannot touch the owner's note even with its id
    await deleteGiftEstimate(as(t, PM), { id: kept.id });
    expect((await getGiftPage(as(t, OWNER), occ)).estimates).toHaveLength(2);
    // a stranger is not a member at all
    expect(await code(() => getGiftPage(as(t, OUTSIDER), occ))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);

    // never a guest: the household's own link shows nothing of it, and a guest actor is refused
    const guest = await guestCtx(t, h.token);
    expect(await code(() => getGiftPage(guest, occ))).toMatch(/^FORBIDDEN/);
    expect(JSON.stringify(await getGuestView(guest))).not.toMatch(/950|1450|gift|dar\b/i);
    // never MCP (not even the owner's own token), staff or the system
    for (const actor of [
      { kind: "mcp", accountId: OWNER, tokenId: "tok", scope: "read_propose" },
      { kind: "staff", accountId: OWNER, staffId: "s", roles: ["platform_admin"] },
      { kind: "system" },
    ] as Actor[]) {
      const ctx = makeCtx(t.db, actor);
      expect(await code(() => getGiftPage(ctx, occ)), actor.kind).toMatch(/^FORBIDDEN/);
      expect(await code(() => getGiftGuide(ctx)), actor.kind).toMatch(/^FORBIDDEN/);
      expect(await code(() => saveGiftEstimate(ctx, { occasionId: occ, label: "x", relationship: "friend", distance: "local", venue: "home", adults: 1 })), actor.kind).toMatch(/^FORBIDDEN/);
    }
    expect(await code(() => getGiftPage(makeCtx(t.db, { kind: "anonymous" }), occ))).toMatch(/^UNAUTHENTICATED/);

    // a household of another occasion cannot be attached; the owner removes their own note
    const other = await mkOccasion();
    expect(await code(() => saveGiftEstimate(as(t, OWNER), { occasionId: other, householdId: h.householdId, relationship: "friend", distance: "local", venue: "home", adults: 1 }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    await deleteGiftEstimate(as(t, OWNER), { id: kept.id });
    expect((await getGiftPage(as(t, OWNER), occ)).estimates.map((e) => e.label)).toEqual([SECRET]);
  });

  it("no export of the occasion contains it, for the owner or anyone else", async () => {
    const occ = await mkOccasion();
    await saveGiftEstimate(as(t, OWNER), { occasionId: occ, label: SECRET, relationship: "close_family", distance: "local", venue: "premium", adults: 2 });
    expect(await t.db.select().from(giftEstimates)).not.toHaveLength(0);
    const keys = (await listExports(as(t, OWNER), occ)).map((e) => e.key);
    expect(keys.length).toBeGreaterThan(3);
    expect(keys.join(" ")).not.toMatch(/gift|dar/);
    let all = "";
    for (const key of keys) {
      const file = await runExport(as(t, OWNER), occ, key).catch(() => null);
      if (!file) continue;
      if (file.mime === "application/pdf") {
        const path = join(dir, `${key}.pdf`);
        writeFileSync(path, file.content as unknown as Uint8Array);
        all += execFileSync("pdftotext", [path, "-"], { encoding: "utf8" });
      } else all += String(file.content);
    }
    expect(all.length).toBeGreaterThan(100);
    expect(all).not.toContain(SECRET);
    expect(all).not.toMatch(/1[.\s]?500 RON|2[.\s]?400 RON/);
  });

  it("no other module reads the gift tables: no export, guest section, digest, MCP tool or commercial tie-in", () => {
    const here = join(__dirname, "..", "src");
    const offenders: string[] = [];
    const scan = (folder: string) => {
      for (const f of readdirSync(folder)) {
        if (!f.endsWith(".ts") || f === "gifts.ts") continue;
        if (/giftEstimates|giftGuideSettings|from "\.\/gifts"|core\/gifts/.test(readFileSync(join(folder, f), "utf8"))) offenders.push(f);
      }
    };
    scan(here);
    scan(join(__dirname, "..", "..", "mcp", "src"));
    expect(offenders).toEqual([]);
    const own = readFileSync(join(here, "gifts.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(own).not.toMatch(/registerExport|registerGuestSection|registerDigestSection|registerOverviewSection|registerMcpTool|registerWhatIf|monetization|billing|featured|audit\(/i);
  });
});
