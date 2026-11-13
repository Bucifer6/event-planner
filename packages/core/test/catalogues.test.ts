import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accounts, businesses, catalogueItems, categories, eq, flowerCatalogues, listingRevisions, localities, sessions, staffMembers, type StaffRole } from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { createLocalTransport, setStorageTransport, uploadAsset } from "@ed/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusiness } from "../src/business";
import {
  CATALOGUE_KIND,
  createCatalogue,
  getCatalogueEditor,
  getCatalogueItem,
  listBusinessCatalogues,
  listFloralListings,
  listPublicCatalogues,
  removeCatalogueItem,
  retireCatalogue,
  saveCatalogueItem,
  submitCatalogue,
} from "../src/catalogues";
import { accountCtx, anonymousCtx, makeCtx, type Ctx } from "../src/context";
import { createListing, submitListing } from "../src/listings";
import { decideRevision, getModerationRevision, listModerationQueue } from "../src/moderation";

let t: TestDb;
let dir: string;
let flori: { id: string };
let foto: { id: string };
let cluj: { id: string };
let moderator: Ctx;
const T0 = new Date("2026-05-04T08:00:00Z");
let seq = 0;

async function mkAccount() {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `cat${++seq}@example.test` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000), freshAuthAt: new Date(T0.getTime() - 60_000) });
  return { id, ctx: accountCtx(t.db, id, { now: T0 }) };
}
async function mkStaff(roles: StaffRole[]): Promise<Ctx> {
  const acc = await mkAccount();
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc.id, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc.id, staffId: row!.id, roles }, { now: T0 });
}
async function mkLive(name: string, categoryId: string) {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `${name} SRL` });
  const listing = await createListing(owner.ctx, {
    businessId: business.id,
    payload: { name, descriptionRo: "Flori proaspete pentru evenimente, în Cluj-Napoca și împrejurimi.", categoryIds: [categoryId], countyCodes: ["CJ"], localityIds: [cluj.id] },
  });
  const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
  await decideRevision(moderator, { id: revisionId, decision: "approve" });
  return { owner, business, listingId: listing.id };
}
async function failure(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? `${e.code}:${e.messageKey}` : `THROWN:${String(e).slice(0, 80)}`;
  }
  return "OK";
}
const png = () => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.APP_URL = "https://app.example.test";
  process.env.MEDIA_URL = "https://media.example.test";
  dir = mkdtempSync(join(tmpdir(), "ed-cat-"));
  setStorageTransport(createLocalTransport(dir));
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
  const cats = await t.db.select().from(categories);
  flori = cats.find((c) => c.slug === "floristi")!;
  foto = cats.find((c) => c.slug === "fotografi")!;
  cluj = (await t.db.select().from(localities).where(eq(localities.countyCode, "CJ"))).find((l) => l.slug === "cluj-napoca")!;
  moderator = await mkStaff(["listing_moderator"]);
});
afterAll(async () => {
  setStorageTransport(null);
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});

describe("flower catalogues (F1, F2)", () => {
  it("only a florist or styling listing can carry a catalogue", async () => {
    const florist = await mkLive("Florăria Ana", flori.id);
    const photographer = await mkLive("Foto Lumen", foto.id);
    expect((await listFloralListings(florist.owner.ctx, florist.business.id)).map((l) => l.id)).toEqual([florist.listingId]);
    expect(await listFloralListings(photographer.owner.ctx, photographer.business.id)).toEqual([]);
    expect(await failure(() => createCatalogue(photographer.owner.ctx, { businessId: photographer.business.id, listingId: photographer.listingId, name: "Flori" }))).toBe("VALIDATION:common.errors.VALIDATION");
    // someone else's listing is refused the same way
    expect(await failure(() => createCatalogue(photographer.owner.ctx, { businessId: photographer.business.id, listingId: florist.listingId, name: "Flori" }))).toBe("VALIDATION:common.errors.VALIDATION");
    expect(await failure(() => createCatalogue(photographer.owner.ctx, { businessId: florist.business.id, listingId: florist.listingId, name: "Flori" }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });

  it("nothing is public until a moderator approves; the queue shows it as a catalogue", async () => {
    const florist = await mkLive("Florăria Verificată", flori.id);
    const catalogue = await createCatalogue(florist.owner.ctx, { businessId: florist.business.id, listingId: florist.listingId, name: "Flori de sezon" });
    const image = await uploadAsset(florist.owner.ctx, { ownerType: "business", ownerId: florist.business.id, file: { name: "bujor.png", bytes: png() } });
    const { itemId } = await saveCatalogueItem(florist.owner.ctx, {
      catalogueId: catalogue.id,
      item: { varietyName: "Bujor Sarah Bernhardt", imageAssetId: image.id, seasonMonths: ["5", "6"], pricePerStemMinor: 1800, colours: ["pink", "white"], notes: "Tijă de 50 cm" },
    });
    await saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { kind: "foliage", varietyName: "Eucalipt", seasonMonths: [], colours: ["green"] } });
    expect(await listPublicCatalogues({ db: t.db, now: T0 }, { listingId: florist.listingId })).toEqual([]);
    expect(await getCatalogueItem({ db: t.db, now: T0 }, itemId)).toBeNull();

    const { revisionId } = await submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    expect(await listPublicCatalogues({ db: t.db, now: T0 }, { listingId: florist.listingId })).toEqual([]);
    const queue = await listModerationQueue(moderator);
    expect(queue.items.find((i) => i.id === revisionId)).toMatchObject({ kind: CATALOGUE_KIND, kindLabelKey: "catalogues.moderation.kind", title: "Flori de sezon", isEdit: false });
    const detail = await getModerationRevision(moderator, revisionId);
    expect(detail.description.imageAssetIds).toEqual([image.id]);
    expect(detail.description.fields.find((f) => f.key === "count")).toMatchObject({ before: null, after: "2" });
    // a member of the business cannot approve its own catalogue (P3, enforced by the queue)
    expect((await listBusinessCatalogues(florist.owner.ctx, florist.business.id))[0]).toMatchObject({ liveItems: 0, hasDraft: false });

    await decideRevision(moderator, { id: revisionId, decision: "approve" });
    const [pub] = await listPublicCatalogues(anonymousCtx(t.db, { now: T0 }), { listingId: florist.listingId });
    expect(pub).toMatchObject({ name: "Flori de sezon", listingId: florist.listingId, businessId: florist.business.id });
    expect(pub!.items.map((i) => i.varietyName)).toEqual(["Bujor Sarah Bernhardt", "Eucalipt"]);
    const peony = pub!.items[0]!;
    expect(peony).toMatchObject({ id: itemId, kind: "flower", seasonMonths: [5, 6], pricePerStemMinor: 1800, colours: ["pink", "white"], currency: "RON" });
    // unknown stays unknown: null, never zero
    expect(peony.pricePerBunchMinor).toBeNull();
    expect(pub!.items[1]).toMatchObject({ pricePerStemMinor: null, pricePerBunchMinor: null, imageUrl: null, seasonMonths: [] });
    expect(peony.imageUrl).toContain("/api/media/");
    // for the designer
    expect(await getCatalogueItem({ db: t.db, now: T0 }, itemId)).toMatchObject({ id: itemId, varietyName: "Bujor Sarah Bernhardt", catalogueId: catalogue.id });
    expect((await listPublicCatalogues({ db: t.db, now: T0 }, { businessId: florist.business.id, q: "eucal" }))[0]!.items.map((i) => i.varietyName)).toEqual(["Eucalipt"]);
    expect(await listPublicCatalogues({ db: t.db, now: T0 }, { businessId: florist.business.id, q: "orhidee" })).toEqual([]);
  });

  it("an edit goes through the queue while the live version stays up; item ids are stable; rejection changes nothing public", async () => {
    const florist = await mkLive("Florăria Editată", flori.id);
    const catalogue = await createCatalogue(florist.owner.ctx, { businessId: florist.business.id, listingId: florist.listingId, name: "Catalog" });
    const { itemId } = await saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { varietyName: "Trandafir Avalanche", pricePerStemMinor: 900, seasonMonths: [], colours: ["white"] } });
    const first = await submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    await decideRevision(moderator, { id: first.revisionId, decision: "approve" });

    // edit: price change + a new variety → nothing public changes yet
    await saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { id: itemId, varietyName: "Trandafir Avalanche", pricePerStemMinor: 1100, seasonMonths: [], colours: ["white"] } });
    await saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { varietyName: "Lalea", pricePerBunchMinor: 4500, seasonMonths: [3, 4], colours: ["red", "yellow"] } });
    let editor = await getCatalogueEditor(florist.owner.ctx, catalogue.id);
    expect(editor).toMatchObject({ hasUnsentChanges: true, pending: null });
    expect(editor.working.items).toHaveLength(2);
    const second = await submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    let [pub] = await listPublicCatalogues({ db: t.db, now: T0 }, { listingId: florist.listingId });
    expect(pub!.items.map((i) => [i.varietyName, i.pricePerStemMinor])).toEqual([["Trandafir Avalanche", 900]]);
    const [row] = await t.db.select().from(flowerCatalogues).where(eq(flowerCatalogues.id, catalogue.id));
    expect(row!.state).toBe("live");
    const detail = await getModerationRevision(moderator, second.revisionId);
    expect(detail.description.fields.filter((f) => f.key.startsWith("item."))).toHaveLength(2);

    await decideRevision(moderator, { id: second.revisionId, decision: "reject", reason: "Prețul la lalele pare greșit, verifică-l." });
    [pub] = await listPublicCatalogues({ db: t.db, now: T0 }, { listingId: florist.listingId });
    expect(pub!.items.map((i) => [i.varietyName, i.pricePerStemMinor])).toEqual([["Trandafir Avalanche", 900]]);
    editor = await getCatalogueEditor(florist.owner.ctx, catalogue.id);
    expect(editor.lastRejection?.reason).toBe("Prețul la lalele pare greșit, verifică-l.");
    expect(editor.working.items).toHaveLength(2); // the rejected content is back in the working copy

    const third = await submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    await decideRevision(moderator, { id: third.revisionId, decision: "approve" });
    [pub] = await listPublicCatalogues({ db: t.db, now: T0 }, { listingId: florist.listingId });
    expect(pub!.items.map((i) => [i.varietyName, i.pricePerStemMinor])).toEqual([
      ["Trandafir Avalanche", 1100],
      ["Lalea", null],
    ]);
    expect(pub!.items[0]!.id).toBe(itemId); // the designer's references survive edits

    // removing a variety also needs approval
    await removeCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, itemId });
    expect(await getCatalogueItem({ db: t.db, now: T0 }, itemId)).not.toBeNull();
    const fourth = await submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    await decideRevision(moderator, { id: fourth.revisionId, decision: "approve" });
    expect(await getCatalogueItem({ db: t.db, now: T0 }, itemId)).toBeNull();
    expect(await t.db.select().from(catalogueItems).where(eq(catalogueItems.catalogueId, catalogue.id))).toHaveLength(1);
  });

  it("validates: palette colours only, a price is never zero, images must be the business's own, not empty on submit", async () => {
    const florist = await mkLive("Florăria Strictă", flori.id);
    const other = await mkLive("Florăria Vecină", flori.id);
    const catalogue = await createCatalogue(florist.owner.ctx, { businessId: florist.business.id, listingId: florist.listingId, name: "Catalog" });
    const item = { varietyName: "Hortensie", seasonMonths: [], colours: [] };
    expect(await failure(() => saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { ...item, colours: ["turquoise"] } as never }))).toBe("VALIDATION:common.errors.VALIDATION");
    expect(await failure(() => saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { ...item, pricePerStemMinor: 0 } }))).toBe("VALIDATION:common.errors.VALIDATION");
    expect(await failure(() => saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { ...item, seasonMonths: [13] } }))).toBe("VALIDATION:common.errors.VALIDATION");
    const foreign = await uploadAsset(other.owner.ctx, { ownerType: "business", ownerId: other.business.id, file: { name: "x.png", bytes: png() } });
    expect(await failure(() => saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { ...item, imageAssetId: foreign.id } }))).toBe("VALIDATION:common.errors.VALIDATION");
    expect(await failure(() => submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id }))).toBe("VALIDATION:catalogues.errors.empty");
    expect(await failure(() => saveCatalogueItem(other.owner.ctx, { catalogueId: catalogue.id, item }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });

  it("a suspended business's catalogue is not public; a lapsed plan hides nothing (P23); retiring withdraws it", async () => {
    const florist = await mkLive("Florăria Stare", flori.id);
    const catalogue = await createCatalogue(florist.owner.ctx, { businessId: florist.business.id, listingId: florist.listingId, name: "Catalog" });
    const { itemId } = await saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { varietyName: "Frezie", seasonMonths: [2, 3], colours: ["yellow"] } });
    const { revisionId } = await submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    await decideRevision(moderator, { id: revisionId, decision: "approve" });

    await t.db.update(businesses).set({ planLapsedAt: T0 }).where(eq(businesses.id, florist.business.id));
    expect(await getCatalogueItem({ db: t.db, now: T0 }, itemId)).not.toBeNull();
    // …but a lapsed business cannot start a NEW catalogue
    expect(await failure(() => createCatalogue(florist.owner.ctx, { businessId: florist.business.id, listingId: florist.listingId, name: "Al doilea" }))).toBe("FORBIDDEN:business.errors.lapsed");
    await t.db.update(businesses).set({ planLapsedAt: null, status: "suspended" }).where(eq(businesses.id, florist.business.id));
    expect(await getCatalogueItem({ db: t.db, now: T0 }, itemId)).toBeNull();
    expect(await listPublicCatalogues({ db: t.db, now: T0 }, { listingId: florist.listingId })).toEqual([]);
    await t.db.update(businesses).set({ status: "active" }).where(eq(businesses.id, florist.business.id));

    // a pending edit is withdrawn when the catalogue is retired
    await saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { varietyName: "Anemonă", seasonMonths: [], colours: [] } });
    const pending = await submitCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    await retireCatalogue(florist.owner.ctx, { catalogueId: catalogue.id });
    expect(await listPublicCatalogues({ db: t.db, now: T0 }, { listingId: florist.listingId })).toEqual([]);
    const [rev] = await t.db.select().from(listingRevisions).where(eq(listingRevisions.id, pending.revisionId));
    expect(rev!.state).toBe("withdrawn");
    expect(await failure(() => saveCatalogueItem(florist.owner.ctx, { catalogueId: catalogue.id, item: { varietyName: "Dalie", seasonMonths: [], colours: [] } }))).toBe("CONFLICT:catalogues.errors.retired");
  });
});
