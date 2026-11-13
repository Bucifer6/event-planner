import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  accounts,
  businesses,
  categories,
  counties,
  eq,
  listingStats,
  listings,
  localities,
  occasionMembers,
  occasions,
  sessions,
  staffMembers,
  statsDaily,
  type StaffRole,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { LAUNCH_CATEGORIES } from "../../db/src/seed/categories";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusiness } from "../src/business";
import { accountCtx, anonymousCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import {
  dismissDirectoryLink,
  getDirectoryIndex,
  getDirectoryPrefill,
  getDirectoryResults,
  getDirectoryStats,
  getPublicListing,
  guessAreaFromText,
  organicOrder,
  recordDirectorySearch,
  recordListingView,
  restoreDirectoryLink,
  suggestDirectoryLink,
} from "../src/directory";
import { getPicklists, updateCategory, updateLocality } from "../src/geography";
import { createListing, createUnclaimedListing, setListingHideStats, submitListing, suspendListing } from "../src/listings";
import { computeListingStats, getPublishedListingStats, publishableStats, setEnquiryStatsProvider } from "../src/listingstats";
import { decideRevision } from "../src/moderation";
import { runNightlyStats } from "../src/stats";

let t: TestDb;
let foto: { id: string; slug: string };
let sali: { id: string; slug: string };
let cluj: { id: string };
let turda: { id: string };
let moderator: Ctx;
let moderator2: Ctx;

const T0 = new Date("2026-05-04T08:00:00Z");
let seq = 0;

async function mkAccount(): Promise<{ id: string; ctx: Ctx }> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `dir${++seq}@example.test` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000), freshAuthAt: new Date(T0.getTime() - 60_000) });
  return { id, ctx: accountCtx(t.db, id, { now: T0 }) };
}
async function mkStaff(roles: StaffRole[]): Promise<Ctx> {
  const acc = await mkAccount();
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc.id, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc.id, staffId: row!.id, roles }, { now: T0 });
}
async function mkLive(name: string, over: Record<string, unknown> = {}) {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `${name} SRL` });
  const listing = await createListing(owner.ctx, {
    businessId: business.id,
    payload: {
      name,
      descriptionRo: "Fotografie de eveniment, cu experiență de zece ani în județul Cluj.",
      categoryIds: [foto.id],
      countyCodes: ["CJ"],
      localityIds: [cluj.id],
      ...over,
    },
  });
  const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
  await decideRevision(moderator, { id: revisionId, decision: "approve" });
  return { owner, business, listingId: listing.id };
}

beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
  const cats = await t.db.select().from(categories);
  foto = cats.find((c) => c.slug === "fotografi")!;
  sali = cats.find((c) => c.slug === "sali-de-evenimente")!;
  const locs = await t.db.select().from(localities).where(eq(localities.countyCode, "CJ"));
  cluj = locs.find((l) => l.slug === "cluj-napoca")!;
  turda = locs.find((l) => l.slug === "turda")!;
  moderator = await mkStaff(["listing_moderator"]);
  moderator2 = await mkStaff(["listing_moderator"]);
});
afterAll(async () => {
  setEnquiryStatsProvider(null);
  await t.close();
});

describe("seeds (P2, geography)", () => {
  it("has exactly the 21 launch categories of PRD P2, in Romanian with English names", async () => {
    const expected = [
      "Săli de evenimente", "Catering", "Torturi și cofetărie", "Baruri mobile", "Trupe (inclusiv lăutari)", "Muzicieni și soliști", "DJ",
      "Fotografi", "Videografi", "Floriști", "Decorațiuni și styling", "Închiriere corturi", "Închiriere echipamente de petrecere",
      "Transport autocare și microbuze", "Cazare", "Animatori", "Coafură și make-up", "Invitații și tipografie", "Mașini de nuntă",
      "Securitate și personal de evenimente", "Sonorizare, AV și lumini",
    ];
    expect(LAUNCH_CATEGORIES.map((c) => c[1])).toEqual(expected);
    const rows = await t.db.select().from(categories).orderBy(categories.sortOrder);
    expect(rows.map((r) => r.nameRo)).toEqual(expected);
    expect(rows.every((r) => r.nameEn.length > 0 && r.active && /^[a-z0-9-]+$/.test(r.slug))).toBe(true);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(21);
  });

  it("has 41 counties + București, every one with localities; București as six sectors", async () => {
    const cos = await t.db.select().from(counties);
    expect(cos.length).toBe(42);
    const locs = await t.db.select().from(localities);
    for (const c of cos) expect(locs.filter((l) => l.countyCode === c.code).length, c.code).toBeGreaterThanOrEqual(3);
    expect(locs.filter((l) => l.countyCode === "B").map((l) => l.nameRo).sort()).toEqual(["Sectorul 1", "Sectorul 2", "Sectorul 3", "Sectorul 4", "Sectorul 5", "Sectorul 6"]);
    expect(cos.filter((c) => c.launchArea).map((c) => c.code).sort()).toEqual(["B", "CJ", "IF"]);
    expect(locs.filter((l) => l.countyCode === "IF").length).toBe(40);
    expect(locs.filter((l) => l.countyCode === "CJ").map((l) => l.nameRo)).toEqual(expect.arrayContaining(["Cluj-Napoca", "Turda", "Câmpia Turzii"]));
    // re-running the seed changes nothing
    await runSeeds(t.db, ["categories", "geography"]);
    expect((await t.db.select().from(localities)).length).toBe(locs.length);
    const en = await getPicklists(anonymousCtx(t.db, { locale: "en" }));
    expect(en.counties.find((c) => c.code === "B")?.name).toBe("Bucharest");
    expect(en.categories.find((c) => c.slug === "fotografi")?.name).toBe("Photographers");
  });
});

describe("organic order (P5, invariant 7)", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `listing${String(i).padStart(4, "0")}x`);

  it("is identical for everyone within a day and different the next day", () => {
    const a = organicOrder(ids, "2026-05-04", "cat1|CJ");
    const b = organicOrder([...ids].reverse(), "2026-05-04", "cat1|CJ");
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...ids].sort());
    const next = organicOrder(ids, "2026-05-05", "cat1|CJ");
    expect(next).not.toEqual(a);
    expect(organicOrder(ids, "2026-05-04", "cat2|CJ")).not.toEqual(a);
    // a real rotation: over a month nearly every listing gets a turn at the top
    const tops = new Set(Array.from({ length: 30 }, (_, d) => organicOrder(ids, `2026-06-${String(d + 1).padStart(2, "0")}`, "cat1|CJ")[0]));
    expect(tops.size).toBeGreaterThan(15);
  });

  it("takes only ids, the day and the search key — it cannot see a business or a listing row", () => {
    expect(organicOrder.length).toBe(3);
    const src = readFileSync(resolve(__dirname, "../src/directory.ts"), "utf8");
    const body = src.slice(src.indexOf("export function organicOrder"), src.indexOf("export function rotationDay"));
    expect(body).not.toMatch(/plan|lapsed|paid|billing|subscription|featured|badge|stats/i);
  });

  it("search results follow it, and no billing-like field changes the order", async () => {
    const made: Array<Awaited<ReturnType<typeof mkLive>>> = [];
    for (let i = 0; i < 6; i++) made.push(await mkLive(`Studio ${i + 1}`));
    const anon = anonymousCtx(t.db, { now: T0 });
    const r1 = await getDirectoryResults(anon, { categoryId: foto.id, countyCode: "CJ" });
    const order = r1.organic.map((c) => c.id);
    expect(order).toEqual(organicOrder(made.map((m) => m.listingId), "2026-05-04", `${foto.id}|CJ`));
    expect((await getDirectoryResults(accountCtx(t.db, made[0]!.owner.id, { now: T0 }), { categoryId: foto.id, countyCode: "CJ" })).organic.map((c) => c.id)).toEqual(order);

    // every billing-like and trust-like field on some businesses changes; the order must not
    await t.db.update(businesses).set({ planLapsedAt: T0 }).where(eq(businesses.id, made[0]!.business.id));
    await t.db.update(businesses).set({ planLapsedAt: new Date("2020-01-01T00:00:00Z"), hideStats: true, nudge48h: false }).where(eq(businesses.id, made[1]!.business.id));
    await t.db
      .update(businesses)
      .set({ onrcRegistration: "J12/1/2020", onrcVerifiedAt: T0, insuranceValidUntil: "2027-01-01", insuranceSeenAt: T0 })
      .where(eq(businesses.id, made[2]!.business.id));
    const r2 = await getDirectoryResults(anon, { categoryId: foto.id, countyCode: "CJ" });
    expect(r2.organic.map((c) => c.id)).toEqual(order);
    expect(r2.organic.find((c) => c.id === made[2]!.listingId)?.badges.map((b) => b.kind)).toEqual(["onrc", "insurance"]);

    const tomorrow = await getDirectoryResults(anonymousCtx(t.db, { now: new Date("2026-05-05T08:00:00Z") }), { categoryId: foto.id, countyCode: "CJ" });
    expect(tomorrow.day).toBe("2026-05-05");
    expect([...tomorrow.organic.map((c) => c.id)].sort()).toEqual([...order].sort());
  });

  it("Featured is always empty while monetization is off (MON5)", async () => {
    const r = await getDirectoryResults(anonymousCtx(t.db, { now: T0 }), { categoryId: foto.id, countyCode: "CJ" });
    expect(r.featured).toEqual([]);
    expect(r.organic.length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toMatch(/promovat|plasare|paid/i);
  });

  it("shows only live listings of businesses that are not suspended; a locality search is a subset in the same order", async () => {
    const anon = anonymousCtx(t.db, { now: T0 });
    const inTurda = await mkLive("Studio Turda", { localityIds: [cluj.id, turda.id] });
    const down = await mkLive("Studio Suspendat");
    await suspendListing(moderator, { listingId: down.listingId, reason: "Suspendat pentru verificare suplimentară." });
    const hiddenBusiness = await mkLive("Studio Firmă Suspendată");
    await t.db.update(businesses).set({ status: "suspended" }).where(eq(businesses.id, hiddenBusiness.business.id));
    const draftOwner = await mkAccount();
    const b = await createBusiness(draftOwner.ctx, { name: "Ciornă SRL" });
    const draft = await createListing(draftOwner.ctx, { businessId: b.id, payload: { name: "Doar ciornă", categoryIds: [foto.id], countyCodes: ["CJ"], localityIds: [cluj.id] } });

    const all = await getDirectoryResults(anon, { categoryId: foto.id, countyCode: "CJ" });
    const ids = all.organic.map((c) => c.id);
    expect(ids).toContain(inTurda.listingId);
    expect(ids).not.toContain(down.listingId);
    expect(ids).not.toContain(hiddenBusiness.listingId);
    expect(ids).not.toContain(draft.id);
    expect(await getPublicListing(anon, down.listingId)).toBeNull();
    expect(await getPublicListing(anon, draft.id)).toBeNull();
    expect(await getPublicListing(anon, hiddenBusiness.listingId)).toBeNull();

    const turdaOnly = await getDirectoryResults(anon, { categoryId: foto.id, countyCode: "CJ", localityId: turda.id });
    expect(turdaOnly.organic.map((c) => c.id)).toEqual([inTurda.listingId]);
    const clujOnly = await getDirectoryResults(anon, { categoryId: foto.id, countyCode: "CJ", localityId: cluj.id });
    expect(clujOnly.organic.map((c) => c.id)).toEqual(ids.filter((id) => clujOnly.organic.some((c) => c.id === id)));
    expect((await getDirectoryResults(anon, { categoryId: sali.id, countyCode: "CJ" })).organic).toEqual([]);
  });
});

describe("listing page and unclaimed listings (P29, L4)", () => {
  it("a claimed listing shows its contact fields, falls back to Romanian with a note, and accepts enquiries", async () => {
    const { listingId } = await mkLive("Atelier Foto", { contactPhone: "0722 000 111", website: "https://atelier.example" });
    const ro = await getPublicListing(anonymousCtx(t.db, { now: T0 }), listingId);
    expect(ro).toMatchObject({ claimed: true, acceptsEnquiries: true, unclaimed: null, romanianOnly: false });
    expect(ro!.contact).toEqual({ phone: "0722 000 111", email: null, website: "https://atelier.example/" });
    expect(ro!.categories.map((c) => c.name)).toEqual(["Fotografi"]);
    expect(ro!.localities.map((l) => l.name)).toEqual(["Cluj-Napoca"]);
    const en = await getPublicListing(anonymousCtx(t.db, { now: T0, locale: "en" }), listingId);
    expect(en!.romanianOnly).toBe(true);
    expect(en!.description).toContain("Fotografie de eveniment");
    expect(en!.categories.map((c) => c.name)).toEqual(["Photographers"]);
  });

  it("an unclaimed listing carries the label data, only the published contact route, and no enquiries", async () => {
    const { listingId, revisionId } = await createUnclaimedListing(moderator, {
      name: "Salon Belvedere",
      categoryIds: [sali.id],
      localityIds: [cluj.id],
      publicContactRoute: "0264 555 010 — conform paginii proprii",
      sourceUrl: "https://belvedere.example/contact",
    });
    const anon = anonymousCtx(t.db, { now: T0 });
    expect(await getPublicListing(anon, listingId)).toBeNull(); // never public before approval (BD2)
    expect((await getDirectoryResults(anon, { categoryId: sali.id, countyCode: "CJ" })).organic).toEqual([]);
    await decideRevision(moderator2, { id: revisionId, decision: "approve" });
    const page = await getPublicListing(anon, listingId);
    expect(page).toMatchObject({ claimed: false, acceptsEnquiries: false, contact: null, badges: [], stats: null, photos: [] });
    expect(page!.unclaimed).toMatchObject({ publicContactRoute: "0264 555 010 — conform paginii proprii", sourceUrl: "https://belvedere.example/contact" });
    const card = (await getDirectoryResults(anon, { categoryId: sali.id, countyCode: "CJ" })).organic[0]!;
    expect(card).toMatchObject({ id: listingId, claimed: false, badges: [] });
  });
});

describe("response statistics (P31)", () => {
  it("publication rule: claimed AND at least ten answered AND not hidden", () => {
    const row = { day: "2026-05-03", enquiriesReceived: 14, enquiriesAnswered: 12, medianReplyMinutes: 190 };
    const base = { claimed: true, listingHidden: false, businessHidden: false, row };
    expect(publishableStats(base)).toEqual({ day: "2026-05-03", received: 14, answered: 12, answeredOfTen: 8, medianReplyMinutes: 190 });
    expect(publishableStats({ ...base, row: { ...row, enquiriesAnswered: 9 } })).toBeNull();
    expect(publishableStats({ ...base, row: { ...row, enquiriesReceived: 10, enquiriesAnswered: 10 } })?.answeredOfTen).toBe(10);
    expect(publishableStats({ ...base, claimed: false })).toBeNull();
    expect(publishableStats({ ...base, listingHidden: true })).toBeNull();
    expect(publishableStats({ ...base, businessHidden: true })).toBeNull();
    expect(publishableStats({ ...base, row: null })).toBeNull();
    // the rule has no input through which a payment could act
    expect(Object.keys(base).sort()).toEqual(["businessHidden", "claimed", "listingHidden", "row"]);
  });

  it("is computed nightly from the injected enquiry provider; hide switches and billing fields behave", async () => {
    const strong = await mkLive("Răspunde Repede");
    const weak = await mkLive("Abia Început");
    const sys = systemCtx(t.db, { now: new Date("2026-05-05T01:00:00Z") });
    setEnquiryStatsProvider(null);
    expect(await computeListingStats(sys, "2026-05-04", sys.now)).toBe(0);
    setEnquiryStatsProvider(async (_ctx, { listingIds }) => {
      expect(listingIds).toContain(strong.listingId);
      return new Map([
        [strong.listingId, { received: 20, answered: 18, medianReplyMinutes: 181.4 }],
        [weak.listingId, { received: 9, answered: 9, medianReplyMinutes: 30 }],
      ]);
    });
    const res = await runNightlyStats(sys, "2026-05-04");
    expect(res.failed).toEqual([]);
    const rows = await t.db.select().from(listingStats).where(eq(listingStats.listingId, strong.listingId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: "2026-05-04", enquiriesReceived: 20, enquiriesAnswered: 18, medianReplyMinutes: 181 });
    await runNightlyStats(sys, "2026-05-04"); // idempotent
    expect((await t.db.select().from(listingStats).where(eq(listingStats.listingId, strong.listingId))).length).toBe(1);

    const anon = anonymousCtx(t.db, { now: sys.now });
    expect(await getPublishedListingStats(anon, strong.listingId)).toMatchObject({ answeredOfTen: 9, medianReplyMinutes: 181, day: "2026-05-04" });
    expect(await getPublishedListingStats(anon, weak.listingId)).toBeNull(); // fewer than ten answered
    expect((await getPublicListing(anon, strong.listingId))!.stats?.answeredOfTen).toBe(9);

    // billing-like fields cannot influence it, in either direction
    await t.db.update(businesses).set({ planLapsedAt: T0 }).where(eq(businesses.id, strong.business.id));
    expect(await getPublishedListingStats(anon, strong.listingId)).toMatchObject({ answeredOfTen: 9 });
    await t.db.update(businesses).set({ planLapsedAt: null }).where(eq(businesses.id, weak.business.id));
    expect(await getPublishedListingStats(anon, weak.listingId)).toBeNull();

    // the listing's own switch, then the business-wide one
    await setListingHideStats(strong.owner.ctx, { listingId: strong.listingId, hide: true });
    expect(await getPublishedListingStats(anon, strong.listingId)).toBeNull();
    await setListingHideStats(strong.owner.ctx, { listingId: strong.listingId, hide: false });
    await t.db.update(businesses).set({ hideStats: true }).where(eq(businesses.id, strong.business.id));
    expect(await getPublishedListingStats(anon, strong.listingId)).toBeNull();
    expect((await getPublicListing(anon, strong.listingId))!.stats).toBeNull();
    setEnquiryStatsProvider(null);
  });
});

describe("statistics are daily aggregates without visitor identifiers (D4, INF11)", () => {
  it("records searches and listing views by day only", async () => {
    const who = await mkAccount();
    const ctx = accountCtx(t.db, who.id, { now: T0, ip: "203.0.113.9" });
    await recordDirectorySearch(ctx, { categorySlug: "fotografi", countyCode: "CJ" });
    await recordDirectorySearch(anonymousCtx(t.db, { now: T0 }), { categorySlug: "fotografi", countyCode: "CJ" });
    await recordListingView(ctx, "listingabc123");
    const rows = await t.db.select().from(statsDaily);
    const search = rows.find((r) => r.metric === "directory.search")!;
    expect(search.value).toBe(2);
    expect(search.dimensions).toEqual({ category: "fotografi", county: "CJ" });
    expect(JSON.stringify(rows)).not.toContain(who.id);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
    const stats = await getDirectoryStats(moderator, { days: 7 });
    const row = stats.rows.find((r) => r.categorySlug === "fotografi" && r.countyCode === "CJ")!;
    expect(row.searches).toBe(2);
    expect(row.categoryName).toBe("Fotografi");
    expect(row.liveListings).toBeGreaterThan(0);
    await expect(getDirectoryStats(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("task link and pre-fill (P6, P7)", () => {
  async function mkOccasion(over: Partial<typeof occasions.$inferInsert> = {}) {
    const owner = await mkAccount();
    const [o] = await t.db
      .insert(occasions)
      .values({ ownerAccountId: owner.id, title: "Nunta Anei", kind: "nunta", venueName: "Restaurant Central", venueAddress: "Str. Memorandumului 3, Cluj-Napoca", ...over })
      .returning();
    await t.db.insert(occasionMembers).values({ occasionId: o!.id, accountId: owner.id, role: "owner" });
    return { owner, occasionId: o!.id };
  }

  it("finds the area from the venue text only when it names a seeded place", async () => {
    const anon = anonymousCtx(t.db);
    expect(await guessAreaFromText(anon, "Str. Memorandumului 3, Cluj-Napoca")).toEqual({ countyCode: "CJ", localityId: cluj.id });
    expect((await guessAreaFromText(anon, "Sala Mare, Sectorul 3, București"))?.countyCode).toBe("B");
    expect(await guessAreaFromText(anon, "undeva frumos")).toBeNull();
    expect(await guessAreaFromText(anon, null)).toBeNull();
  });

  it("suggests one link that names a category and an area — never a business — and can be switched off", async () => {
    await mkLive("Firma Care Nu Trebuie Numită");
    const { owner, occasionId } = await mkOccasion();
    const link = await suggestDirectoryLink(owner.ctx, { occasionId, templateTaskKey: "foto-video", taskTitle: "Rezervă fotograful și videograful" });
    expect(link).toMatchObject({ categorySlug: "fotografi", countyCode: "CJ", labelKey: "directory.taskLink.label", params: { category: "fotografi", area: "Cluj" } });
    expect(link!.href).toBe(`/directory/fotografi/cluj?occasion=${occasionId}`);
    expect(JSON.stringify(link)).not.toContain("Firma Care");
    expect((await suggestDirectoryLink(owner.ctx, { occasionId, taskTitle: "Alege florăria și decorul" }))?.categorySlug).toBe("floristi");
    expect(await suggestDirectoryLink(owner.ctx, { occasionId, templateTaskKey: "buget", taskTitle: "Stabilește bugetul" })).toBeNull();
    const outsider = await mkAccount();
    await expect(suggestDirectoryLink(outsider.ctx, { occasionId, templateTaskKey: "foto-video" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // per occasion
    await dismissDirectoryLink(owner.ctx, { scope: "occasion", occasionId });
    expect(await suggestDirectoryLink(owner.ctx, { occasionId, templateTaskKey: "foto-video" })).toBeNull();
    await restoreDirectoryLink(owner.ctx, { scope: "occasion", occasionId });
    expect(await suggestDirectoryLink(owner.ctx, { occasionId, templateTaskKey: "foto-video" })).not.toBeNull();
    // per account: off on every occasion of that person
    await dismissDirectoryLink(owner.ctx, { scope: "account" });
    await dismissDirectoryLink(owner.ctx, { scope: "account" }); // idempotent
    expect(await suggestDirectoryLink(owner.ctx, { occasionId, templateTaskKey: "foto-video" })).toBeNull();
    await restoreDirectoryLink(owner.ctx, { scope: "account" });

    // no known area → the link still names only the category
    const far = await mkOccasion({ venueAddress: null, venueName: null });
    const noArea = await suggestDirectoryLink(far.owner.ctx, { occasionId: far.occasionId, templateTaskKey: "tort" });
    expect(noArea).toMatchObject({ categorySlug: "torturi-si-cofetarie", countyCode: null, labelKey: "directory.taskLink.labelNoArea" });
  });

  it("pre-fills the search from the occasion for members only", async () => {
    const { owner, occasionId } = await mkOccasion({ kind: "botez" });
    const pre = await getDirectoryPrefill(owner.ctx, occasionId);
    expect(pre.countyCode).toBe("CJ");
    expect(pre.suggestedCategorySlugs[0]).toBe("sali-de-evenimente");
    const outsider = await mkAccount();
    let code = "OK";
    try {
      await getDirectoryPrefill(outsider.ctx, occasionId);
    } catch (e) {
      code = isAppError(e) ? e.code : "?";
    }
    expect(code).toBe("NOT_FOUND");
  });
});

describe("directory management (W4)", () => {
  it("unpublishing a category or county removes it from the public index; locality pages follow the toggle", async () => {
    const anon = anonymousCtx(t.db, { now: T0 });
    const before = await getDirectoryIndex(anon);
    expect(before.categories.length).toBe(21);
    expect(before.launchCounties.map((c) => c.code).sort()).toEqual(["B", "CJ", "IF"]);
    const dj = before.categories.find((c) => c.slug === "dj")!;
    await updateCategory(moderator, { id: dj.id, published: false });
    expect((await getDirectoryIndex(anon)).categories.some((c) => c.slug === "dj")).toBe(false);
    await updateCategory(moderator, { id: dj.id, published: true, nameEn: "DJs and MCs" });
    expect((await getPicklists(anonymousCtx(t.db, { locale: "en" }))).categories.find((c) => c.slug === "dj")?.name).toBe("DJs and MCs");
    const page = await updateLocality(moderator, { id: turda.id, publicPage: false });
    expect(page.publicPage).toBe(false);
    const who = await mkAccount();
    await expect(updateCategory(who.ctx, { id: dj.id, published: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("only factual badges exist (P4) — source scan", () => {
  // Forbidden anywhere in product source: generic "verified" badges, stars, scores,
  // testimonials. Tests, docs and the public marketing copy that states their ABSENCE
  // ("fără stele") are outside the scan or explicitly negated.
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["generic verified badge", /verified business|firm[ăa] verificat[ăa]|business verificat|trusted (seller|business)|top[- ]rated/i],
    ["stars", /★|☆|\bstele\b|\b[1-5][- ]stars?\b|star[- ]rating/i],
    ["ratings", /\bratings?\b|\bcalificativ/i],
    ["testimonials", /testimonial/i],
    ["review scores", /\brecenzi[ei]\b|review score|\bnot[ăa] medie\b/i],
  ];
  const NEGATION = /fără|\bno\b|\bnu\b|\bnot\b|\bnever\b|\bnicio\b|\bniciun\b|\bnici\b|instead of|non-goal|does not|do not/i;
  const root = resolve(__dirname, "../../..");

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === "test" || name === "tests" || name === "__tests__" || name.startsWith(".")) continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|css|json)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "tsconfig.tsbuildinfo") out.push(p);
    }
    return out;
  }

  it("no badge, star, score or testimonial string in apps/web or packages", () => {
    const files = [...walk(join(root, "apps/web")), ...walk(join(root, "packages"))];
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const [label, re] of FORBIDDEN) {
          if (re.test(line) && !NEGATION.test(line)) hits.push(`${file.slice(root.length + 1)}:${i + 1} [${label}] ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("the only badge wording in the product is the two factual sentences", () => {
    for (const locale of ["ro", "en"]) {
      const msgs = JSON.parse(readFileSync(join(root, `packages/i18n/messages/${locale}/directory.json`), "utf8")) as { badges: Record<string, string> };
      expect(Object.keys(msgs.badges).sort()).toEqual(["insurance", "onrc"]);
    }
    const ro = JSON.parse(readFileSync(join(root, "packages/i18n/messages/ro/directory.json"), "utf8")) as { badges: Record<string, string>; results: { rotation: string }; unclaimed: { label: string } };
    expect(ro.badges.onrc).toBe("Verificat: înregistrare ONRC");
    expect(ro.badges.insurance).toBe("Verificat: asigurare văzută până la {date}");
    expect(ro.results.rotation).toBe("rotație zilnică · ordinea nu se vinde");
    expect(ro.unclaimed.label).toBe("Adăugat de EventDesk — nefiind revendicat încă");
  });
});
