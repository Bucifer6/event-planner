import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { accounts, businessMembers, businessNotices, categories, eq, featuredSlots, guests, households, jobs, localities, monetizationSwitch, occasionMembers, platformNoticeSends, sessions, staffMembers, suppliers, type StaffRole } from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusiness } from "../src/business";
import { listPlatformNotices, previewAudience, sendPlatformNotice } from "../src/comms";
import { accountCtx, anonymousCtx, makeCtx, type Ctx } from "../src/context";
import { getDirectoryResults, getPublicListing, organicOrder, recordDirectorySearch } from "../src/directory";
import { listExports, runExport } from "../src/exports";
import { createFeaturedSlot, expectedShare, featuredForSearch, getFeaturedPreview, listFeaturedSlots, pickRandom } from "../src/featured";
import { createHousehold } from "../src/guests";
import { getGuestView, resolveGuestLink } from "../src/invitations";
import { createListing, submitListing } from "../src/listings";
import { decideRevision } from "../src/moderation";
import { createOccasion } from "../src/occasions";
import { createSupplier } from "../src/suppliers";

let t: TestDb;
const T0 = new Date("2026-05-04T08:00:00Z");
let seq = 0;
let foto: typeof categories.$inferSelect;
let cluj: typeof localities.$inferSelect;
let turda: typeof localities.$inferSelect;
let moderator: Ctx;
let commercial: Ctx;

async function mkAccount(email?: string): Promise<{ id: string; email: string; ctx: Ctx }> {
  const id = newId();
  const addr = email ?? `f${++seq}@example.test`;
  await t.db.insert(accounts).values({ id, kind: "email", email: addr });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000), freshAuthAt: new Date(T0.getTime() - 60_000) });
  return { id, email: addr, ctx: accountCtx(t.db, id, { now: T0 }) };
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
    payload: { name, descriptionRo: "Fotografie de eveniment, cu experiență de zece ani în județul Cluj.", categoryIds: [foto.id], countyCodes: ["CJ"], localityIds: [cluj.id], ...over },
  });
  const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
  await decideRevision(moderator, { id: revisionId, decision: "approve" });
  return { owner, business, listingId: listing.id };
}
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}
const setSwitch = (on: boolean) =>
  t.db.update(monetizationSwitch).set(on ? { state: "on", noticeStartsAt: new Date(T0.getTime() - 61 * 86_400_000), effectiveAt: new Date(T0.getTime() - 86_400_000) } : { state: "off", noticeStartsAt: null, effectiveAt: null });

const made: Array<Awaited<ReturnType<typeof mkLive>>> = [];
const search = () => ({ categoryId: foto.id, countyCode: "CJ" });

beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography", "monetization", "templates"]);
  const cats = await t.db.select().from(categories);
  foto = cats.find((c) => c.slug === "fotografi")!;
  const locs = await t.db.select().from(localities).where(eq(localities.countyCode, "CJ"));
  cluj = locs.find((l) => l.slug === "cluj-napoca")!;
  turda = locs.find((l) => l.slug === "turda")!;
  moderator = await mkStaff(["listing_moderator"]);
  commercial = await mkStaff(["commercial_manager"]);
  for (let i = 0; i < 8; i++) made.push(await mkLive(`Studio ${i + 1}`, i === 0 ? { localityIds: [cluj.id, turda.id] } : {}));
});
afterAll(async () => {
  await t.close();
});

describe("Featured placement (P13–P16, MON5)", () => {
  it("does not exist while monetization is OFF — even with slots in the table", async () => {
    // slots planted straight into the table: the switch, not the data, decides
    await t.db.insert(featuredSlots).values(made.slice(0, 5).map((m) => ({ listingId: m.listingId, categoryId: foto.id, countyCode: "CJ", active: true, startsAt: new Date(T0.getTime() - 1000) })));
    const anon = anonymousCtx(t.db, { now: T0 });
    for (let i = 0; i < 5; i++) {
      const r = await getDirectoryResults(anon, search());
      expect(r.featured).toEqual([]);
      expect(JSON.stringify(r)).not.toMatch(/featured":true|promovat|plasare/i);
    }
    expect(await featuredForSearch(anon, search())).toEqual([]);
    expect(await listFeaturedSlots(commercial)).toEqual([]);
    expect(await code(createFeaturedSlot(commercial, { listingId: made[0]!.listingId, categoryId: foto.id }))).toBe("NOT_FOUND");
    expect(await code(getFeaturedPreview(made[0]!.owner.ctx, { listingId: made[0]!.listingId }))).toBe("NOT_FOUND");
  });

  it("when ON: up to three labelled cards, random per request, and the organic order is byte-identical", async () => {
    const anon = anonymousCtx(t.db, { now: T0 });
    const off = await getDirectoryResults(anon, search());
    await setSwitch(true);
    const featuredIds = new Set(made.slice(0, 5).map((m) => m.listingId));
    const seenSets = new Set<string>();
    const seenIds = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const on = await getDirectoryResults(anon, search());
      // invariant 7: organic is exactly what it was without Featured — same cards, same order, same bytes
      expect(JSON.stringify(on.organic)).toBe(JSON.stringify(off.organic));
      expect(on.total).toBe(off.total);
      expect(on.organic.map((c) => c.id)).toEqual(organicOrder(made.map((m) => m.listingId), on.day, `${foto.id}|CJ`));
      // Featured listings are NOT taken out of the organic list either
      expect(on.organic).toHaveLength(8);
      // P13: three, all from live matching slots; P14: every one carries its label
      expect(on.featured).toHaveLength(3);
      expect(new Set(on.featured.map((c) => c.id)).size).toBe(3);
      for (const c of on.featured) {
        expect(featuredIds.has(c.id)).toBe(true);
        expect(c).toMatchObject({ featured: true, labelKey: "featured.label" });
        seenIds.add(c.id);
      }
      for (const c of on.organic) expect("featured" in c).toBe(false);
      seenSets.add(on.featured.map((c) => c.id).join(","));
    }
    // random on every request: many different draws, and every slot gets a turn
    expect(seenSets.size).toBeGreaterThan(8);
    expect(seenIds.size).toBe(5);
    expect(pickRandom([1, 2, 3, 4], 2)).toHaveLength(2);

    // the label text is verbatim in both languages (P14)
    const ro = JSON.parse(readFileSync(resolve(__dirname, "../../i18n/messages/ro/featured.json"), "utf8")) as { label: string };
    const en = JSON.parse(readFileSync(resolve(__dirname, "../../i18n/messages/en/featured.json"), "utf8")) as { label: string };
    expect(ro.label).toBe("Promovat — plasare plătită");
    expect(en.label).toBe("Featured — paid placement");
  });

  it("only live, matching, in-time slots of public listings are drawn; fewer than three shows fewer", async () => {
    const anon = anonymousCtx(t.db, { now: T0 });
    // a locality search: only the one Featured listing that serves Turda
    const inTurda = await getDirectoryResults(anon, { ...search(), localityId: turda.id });
    expect(inTurda.featured.map((c) => c.id)).toEqual([made[0]!.listingId]);
    expect(inTurda.organic.map((c) => c.id)).toEqual([made[0]!.listingId]);
    // other county / other category: none
    expect((await getDirectoryResults(anon, { categoryId: foto.id, countyCode: "B" })).featured).toEqual([]);
    // ended, future and switched-off slots are not drawn
    await t.db.update(featuredSlots).set({ endsAt: new Date(T0.getTime() - 1) }).where(eq(featuredSlots.listingId, made[1]!.listingId));
    await t.db.update(featuredSlots).set({ startsAt: new Date(T0.getTime() + 86_400_000) }).where(eq(featuredSlots.listingId, made[2]!.listingId));
    await t.db.update(featuredSlots).set({ active: false }).where(eq(featuredSlots.listingId, made[3]!.listingId));
    for (let i = 0; i < 10; i++) {
      const r = await getDirectoryResults(anon, search());
      expect(r.featured.map((c) => c.id).sort()).toEqual([made[0]!.listingId, made[4]!.listingId].sort());
    }
    // staff can place a slot by hand in test mode; it must be in the listing's own category
    const sali = (await t.db.select().from(categories)).find((c) => c.slug === "sali-de-evenimente")!;
    expect(await code(createFeaturedSlot(commercial, { listingId: made[5]!.listingId, categoryId: sali.id }))).toBe("VALIDATION");
    await createFeaturedSlot(commercial, { listingId: made[5]!.listingId, categoryId: foto.id, countyCode: null, days: 30 });
    expect((await listFeaturedSlots(commercial)).some((s) => s.listingName === "Studio 6")).toBe(true);
  });

  it("P15: the pre-purchase view states the expected share min(1, 3 ÷ (n + 1)) and 30 days of searches", async () => {
    expect([0, 1, 2, 3, 5, 11].map(expectedShare)).toEqual([1, 1, 1, 0.75, 0.5, 0.25]);
    const anon = anonymousCtx(t.db, { now: T0 });
    for (let i = 0; i < 7; i++) await recordDirectorySearch(anon, { categorySlug: "fotografi", countyCode: "CJ" });
    await recordDirectorySearch(anonymousCtx(t.db, { now: new Date(T0.getTime() - 40 * 86_400_000) }), { categorySlug: "fotografi", countyCode: "CJ" }); // older than 30 days
    // live in fotografi × CJ now: Studio 1, Studio 5, Studio 6 → n = 3 for a newcomer
    const rows = await getFeaturedPreview(made[7]!.owner.ctx, { listingId: made[7]!.listingId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ categoryId: foto.id, countyCode: "CJ", current: 3, share: 0.75, searches30: 7 });
    // someone already Featured does not count itself
    expect((await getFeaturedPreview(made[0]!.owner.ctx, { listingId: made[0]!.listingId }))[0]).toMatchObject({ current: 2, share: 1 });
    // only the listing's own business
    expect(await code(getFeaturedPreview(made[1]!.owner.ctx, { listingId: made[7]!.listingId }))).toBe("NOT_FOUND");
  });

  it("P16: Featured never leaks — not into a listing page, a plan, a guest page or an export", async () => {
    const anon = anonymousCtx(t.db, { now: T0 });
    const featuredNow = (await getDirectoryResults(anon, search())).featured;
    expect(featuredNow.length).toBeGreaterThan(0);
    const leak = /featured|promovat|plasare|paid placement/i;
    // the public listing page of a Featured listing says nothing about it
    expect(JSON.stringify(await getPublicListing(anon, featuredNow[0]!.id))).not.toMatch(leak);

    // a plan that uses a Featured listing as its supplier: exports and the guest page carry no trace
    const planner = await mkAccount();
    const occ = await createOccasion(planner.ctx, { title: "Nunta fără reclame", kind: "blank", dateMode: "date", startsOn: "2027-06-12" });
    await createSupplier(planner.ctx, { occasionId: occ.id, name: featuredNow[0]!.name, categoryLabel: "Foto" });
    const household = await createHousehold(planner.ctx, { occasionId: occ.id, name: "Familia Popescu", guestNames: ["Ana Popescu"] });
    const link = await resolveGuestLink(anon, household.token);
    expect(JSON.stringify(await getGuestView(makeCtx(t.db, link!.actor, { now: T0 })))).not.toMatch(leak);
    const exportsList = await listExports(planner.ctx, occ.id);
    expect(exportsList.length).toBeGreaterThan(0);
    for (const e of exportsList) {
      const file = await runExport(planner.ctx, occ.id, e.key);
      if (typeof file.content === "string") expect(file.content, e.key).not.toMatch(leak);
    }
    // by construction: no source file outside the directory and Featured domains reads the slots table
    const { readdirSync, statSync } = await import("node:fs");
    const root = resolve(__dirname, "../../..");
    const allowed = /packages\/core\/src\/(featured|billing|directory)\.ts$|packages\/db\/src\/schema\/(featured|index)\.ts$/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === "test" || name.startsWith(".")) continue;
        const p = resolve(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !allowed.test(p) && /featuredSlots|featured_slots|featuredForSearch/.test(readFileSync(p, "utf8"))) offenders.push(p.slice(root.length + 1));
      }
    };
    walk(resolve(root, "packages"));
    walk(resolve(root, "apps"));
    expect(offenders).toEqual([]);
    // `featured: true` cards come out of exactly one function
    const src = readFileSync(resolve(root, "packages/core/src/directory.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src.match(/featured: true/g)?.length).toBe(2); // the type and the one place that builds it
    await setSwitch(false);
    expect((await getDirectoryResults(anon, search())).featured).toEqual([]);
  });
});

describe("communications to businesses only (W7)", () => {
  it("reaches owners and admins of businesses — never a contact a planner typed in", async () => {
    const editor = await mkStaff(["content_editor"]);
    expect(await code(sendPlatformNotice(moderator, { subject: "Salut", body: "Un anunț de probă pentru firme.", audience: "all" }))).toBe("FORBIDDEN");
    expect(await code(sendPlatformNotice(made[0]!.owner.ctx, { subject: "Salut", body: "Un anunț de probă pentru firme.", audience: "all" }))).toBe("FORBIDDEN");

    // planner-entered people who share nothing with a business
    const planner = await mkAccount();
    const occ = await createOccasion(planner.ctx, { title: "Botez", kind: "blank", dateMode: "poll" });
    await createHousehold(planner.ctx, { occasionId: occ.id, name: "Familia Invitată", leadEmail: "invitat@example.test", guestNames: ["Ion Invitat"] });
    await createSupplier(planner.ctx, { occasionId: occ.id, name: "Furnizor Introdus", contactEmail: "furnizor@example.test" });
    // an admin and a staff member of one business; an invitation not yet accepted
    const admin = await mkAccount("admin-firma@example.test");
    const staffer = await mkAccount("angajat@example.test");
    await t.db.insert(businessMembers).values([
      { businessId: made[0]!.business.id, accountId: admin.id, role: "admin" },
      { businessId: made[0]!.business.id, accountId: staffer.id, role: "staff" },
      { businessId: made[0]!.business.id, role: "admin", inviteEmail: "neacceptat@example.test", inviteTokenHash: newId() },
    ]);

    const everyone = await previewAudience(editor, { audience: "all" });
    expect(everyone).toEqual({ businesses: 8, emails: 9 }); // 8 owners + 1 admin
    const before = (await t.db.select().from(jobs)).length;
    const notice = await sendPlatformNotice(editor, { subject: "Mentenanță programată", body: "Duminică, între 02:00 și 03:00, zona de firme nu va fi disponibilă.", audience: "all" });
    expect(notice).toMatchObject({ businessCount: 8, emailCount: 9, audience: "all" });
    const emailJobs = (await t.db.select().from(jobs)).slice(before).filter((j) => j.name === "comms.notice-email");
    expect(emailJobs).toHaveLength(9);
    // every recipient is an account that is an owner/admin of that business
    const allowed = new Set([...made.map((m) => m.owner.id), admin.id]);
    for (const j of emailJobs) expect(allowed.has((j.payload as { accountId: string }).accountId)).toBe(true);
    const targets = new Set(emailJobs.map((j) => (j.payload as { accountId: string }).accountId));
    expect(targets.has(staffer.id)).toBe(false);
    expect(targets.has(planner.id)).toBe(false);
    expect(JSON.stringify(emailJobs.map((j) => j.payload))).not.toMatch(/invitat@|furnizor@|neacceptat@/);
    // in-app notice + send log per business
    expect(await t.db.select().from(platformNoticeSends).where(eq(platformNoticeSends.noticeId, notice.id))).toHaveLength(8);
    const inApp = await t.db.select().from(businessNotices).where(eq(businessNotices.businessId, made[0]!.business.id));
    expect(inApp.filter((n) => n.kind === "platform.notice")).toHaveLength(1);
    expect((await listPlatformNotices(editor))[0]!.id).toBe(notice.id);

    // audiences: a county, a category; nobody → refused
    expect(await previewAudience(commercial, { audience: "county", countyCode: "CJ" })).toMatchObject({ businesses: 8 });
    expect(await previewAudience(commercial, { audience: "county", countyCode: "TM" })).toEqual({ businesses: 0, emails: 0 });
    expect(await code(sendPlatformNotice(commercial, { subject: "Timiș", body: "Un anunț pentru firmele din Timiș.", audience: "county", countyCode: "TM" }))).toBe("CONFLICT");
    await expect(sendPlatformNotice(commercial, { subject: "Fără categorie", body: "Lipsește categoria aleasă.", audience: "category" })).rejects.toThrow();
    expect((await sendPlatformNotice(commercial, { subject: "Pentru fotografi", body: "O noutate pentru categoria voastră.", audience: "category", categoryId: foto.id })).businessCount).toBe(8);
    // tables of planner-entered contacts were never written or read for this
    expect((await t.db.select().from(households)).length).toBe(2);
    expect((await t.db.select().from(guests)).length).toBeGreaterThan(0);
    expect((await t.db.select().from(suppliers)).length).toBe(2);
    void occasionMembers;
  });

  it("by construction: the module cannot name a table of planner-entered contacts", () => {
    const src = readFileSync(resolve(__dirname, "../src/comms.ts"), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/households|guests|suppliers|invitations|supplierLinks|rsvp|contributions|occasionMembers|occasions/i);
    // the one and only recipient source
    expect(code.match(/\.from\(businessMembers\)/g)?.length).toBe(2);
    expect(code).toMatch(/innerJoin\(accounts, eq\(accounts\.id, businessMembers\.accountId\)\)/);
    const imports = [...code.matchAll(/from "(\.\/[a-z]+|@ed\/[a-z/]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./audit", "./business", "./context", "./staff", "./tx", "@ed/db", "@ed/email", "@ed/jobs", "@ed/shared/errors", "@ed/shared/zod"].sort());
  });
});
