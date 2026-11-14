import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accounts, arrangementVersions, categories, enquiries, enquiryMessages, eq, localities, occasionMembers, occasions, sessions, staffMembers, whatifPreviews, type OccasionRole, type StaffRole } from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { createLocalTransport, setStorageTransport } from "@ed/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ARRANGEMENT_FORM_KEYS, arrangementToSvg, diffVersions, indicativeCost, layoutArrangement, seasonState } from "../src/arrangementkit";
import {
  archiveArrangementDesign,
  buildQuoteDescription,
  getArrangementDesign,
  indicativeCostText,
  listArrangementDesigns,
  proposeArrangementDesign,
  requestArrangementQuote,
  saveArrangementDesign,
} from "../src/arrangements";
import { createBusiness } from "../src/business";
import { createCatalogue, saveCatalogueItem, submitCatalogue } from "../src/catalogues";
import { accountCtx, makeCtx, type Ctx } from "../src/context";
import { acceptQuote, getPlannerThread, replyAsBusiness } from "../src/enquiries";
import { createListing, submitListing } from "../src/listings";
import { decideRevision } from "../src/moderation";
import { confirmPreview } from "../src/whatif";

// C-13 (F3–F6): designs from catalogue items with an INDICATIVE cost (never a quote, unknown
// never counted as zero), immutable versions, the F5 quote request and the F6 delta.

let t: TestDb;
let dir: string;
let flori: { id: string };
let cluj: { id: string };
let moderator: Ctx;
const T0 = new Date("2027-03-01T08:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);
let seq = 0;

type Person = { id: string; ctx: Ctx; at: (now: Date) => Ctx };
async function mkAccount(): Promise<Person> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `arr${++seq}@example.test` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: at(24 * 30), freshAuthAt: at(-0.01) });
  return { id, ctx: accountCtx(t.db, id, { now: T0 }), at: (now) => accountCtx(t.db, id, { now }) };
}
async function mkStaff(roles: StaffRole[]): Promise<Ctx> {
  const acc = await mkAccount();
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc.id, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc.id, staffId: row!.id, roles }, { now: T0 });
}
/** A live florist with an approved catalogue: priced rose, unpriced peony (bunch price only), priced eucalyptus. */
async function mkFlorist(name: string) {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `${name} SRL` });
  const listing = await createListing(owner.ctx, { businessId: business.id, payload: { name, descriptionRo: "Flori proaspete pentru evenimente, în Cluj-Napoca și împrejurimi.", categoryIds: [flori.id], countyCodes: ["CJ"], localityIds: [cluj.id] } });
  await decideRevision(moderator, { id: (await submitListing(owner.ctx, { listingId: listing.id })).revisionId, decision: "approve" });
  const catalogue = await createCatalogue(owner.ctx, { businessId: business.id, listingId: listing.id, name: "Flori de sezon" });
  const rose = await saveCatalogueItem(owner.ctx, { catalogueId: catalogue.id, item: { varietyName: "Trandafir Avalanche", pricePerStemMinor: 900, seasonMonths: [5, 6, 7, 8, 9], colours: ["white", "pink"] } });
  const peony = await saveCatalogueItem(owner.ctx, { catalogueId: catalogue.id, item: { varietyName: "Bujor Sarah Bernhardt", pricePerBunchMinor: 12000, seasonMonths: [5, 6], colours: ["pink"] } });
  const eucalyptus = await saveCatalogueItem(owner.ctx, { catalogueId: catalogue.id, item: { kind: "foliage", varietyName: "Eucalipt", pricePerStemMinor: 450, seasonMonths: [], colours: ["green"] } });
  await decideRevision(moderator, { id: (await submitCatalogue(owner.ctx, { catalogueId: catalogue.id })).revisionId, decision: "approve" });
  return { owner, business, listingId: listing.id, rose: rose.itemId, peony: peony.itemId, eucalyptus: eucalyptus.itemId };
}
async function mkOccasion(owner: Person): Promise<string> {
  const id = newId();
  await t.db.insert(occasions).values({ id, ownerAccountId: owner.id, title: "Nunta Ioanei și a lui Andrei", kind: "nunta", startsAt: new Date("2027-06-12T09:00:00Z"), venueName: "Conacul Polizu" });
  await t.db.insert(occasionMembers).values({ occasionId: id, accountId: owner.id, role: "owner" });
  return id;
}
async function join_(occasionId: string, role: OccasionRole): Promise<Person> {
  const p = await mkAccount();
  await t.db.insert(occasionMembers).values({ occasionId, accountId: p.id, role });
  return p;
}
async function failure(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? `${e.code}:${e.messageKey}` : `THROWN:${String(e).slice(0, 120)}`;
  }
  return "OK";
}
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
const mcp = (p: Person, scope: "read" | "read_propose") => makeCtx(t.db, { kind: "mcp", accountId: p.id, tokenId: newId(), scope }, { now: T0 });

beforeAll(async () => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.APP_URL = "https://app.example.test";
  process.env.MEDIA_URL = "https://media.example.test";
  dir = mkdtempSync(join(tmpdir(), "ed-arr-"));
  setStorageTransport(createLocalTransport(dir));
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
  flori = (await t.db.select().from(categories)).find((c) => c.slug === "floristi")!;
  cluj = (await t.db.select().from(localities).where(eq(localities.countyCode, "CJ"))).find((l) => l.slug === "cluj-napoca")!;
  moderator = await mkStaff(["listing_moderator"]);
});
afterAll(async () => {
  setStorageTransport(null);
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});

describe("the kit: indicative cost and the sketch", () => {
  it("never counts an unknown price as zero: the total becomes 'at least X + n items without a price'", () => {
    const priced = { stems: 20, pricePerStemMinor: 900, currency: "RON" };
    const unpriced = { stems: 10, pricePerStemMinor: null, currency: "RON" };
    expect(indicativeCost([priced, { stems: 10, pricePerStemMinor: 450, currency: "RON" }])).toMatchObject({ state: "full", known: [{ currency: "RON", minor: 22500 }], unpricedLines: 0 });
    const partial = indicativeCost([priced, unpriced, unpriced]);
    expect(partial).toMatchObject({ state: "partial", known: [{ currency: "RON", minor: 18000 }], unpricedLines: 2, unpricedStems: 20, totalStems: 40 });
    expect(indicativeCostText(partial, "ro")).toBe("≥ 180 RON + articole fără preț: 2");
    expect(indicativeCostText(indicativeCost([unpriced]), "ro")).toBe("necunoscut"); // not "0 RON"
    expect(indicativeCostText(indicativeCost([priced]), "ro")).toBe("180 RON");
    expect(indicativeCost([])).toMatchObject({ state: "empty", known: [] });
    expect(indicativeCostText(indicativeCost([priced, unpriced]), "en")).toBe("≥ 180 RON + items without a price: 1");
  });

  it("lays the stem marks out deterministically inside every base form", () => {
    const lines = [
      { stems: 24, colour: "white", kind: "flower" as const },
      { stems: 9, colour: "pink", kind: "flower" as const },
      { stems: 12, colour: "green", kind: "foliage" as const },
    ];
    for (const form of ARRANGEMENT_FORM_KEYS) {
      const a = layoutArrangement(form, lines);
      const b = layoutArrangement(form, lines);
      expect(a, form).toEqual(b); // same input, same picture
      expect(a.marks, form).toHaveLength(45);
      expect(a.stemsPerMark).toBe(1);
      for (const m of a.marks) {
        expect(m.x, form).toBeGreaterThan(0);
        expect(m.x, form).toBeLessThan(a.width);
        expect(m.y, form).toBeGreaterThan(0);
        expect(m.y, form).toBeLessThan(a.height);
      }
      // colours follow the counts
      expect(a.marks.filter((m) => m.kind === "foliage")).toHaveLength(12);
      const svg = arrangementToSvg(a);
      expect(svg).not.toMatch(/<image|href=|<script/);
    }
    // a very large design is thinned out, and says so; a single stem is still seen
    const big = layoutArrangement("round_bouquet", [{ stems: 500, colour: "red", kind: "flower" }, { stems: 500, colour: "white", kind: "flower" }, { stems: 1, colour: "blue", kind: "flower" }]);
    expect(big.stemsPerMark).toBe(4);
    expect(big.marks.length).toBeLessThanOrEqual(260);
    expect(big.marks.some((m) => m.fill === "#6f8fc0")).toBe(true);
    expect(layoutArrangement("wreath", []).marks).toEqual([]);
    expect(seasonState([5, 6], 6)).toBe("in");
    expect(seasonState([5, 6], 11)).toBe("out");
    expect(seasonState([], 6)).toBe("unknown");
  });
});

describe("designs and versions (F3)", () => {
  it("saves from catalogue items of one or more businesses; every change is a new immutable version", async () => {
    const planner = await mkAccount();
    const occ = await mkOccasion(planner);
    const a = await mkFlorist("Florăria Lalea");
    const b = await mkFlorist("Atelier Verde");
    const first = await saveArrangementDesign(planner.ctx, {
      occasionId: occ,
      name: "Buchetul miresei",
      form: "round_bouquet",
      items: [
        { catalogueItemId: a.rose, stems: 20, colour: "white" },
        { catalogueItemId: a.peony, stems: 6 },
        { catalogueItemId: b.eucalyptus, stems: 10 },
      ],
      note: "Aerisit, fără panglici.",
    });
    expect(first).toMatchObject({ version: 1, created: true });
    const view = await getArrangementDesign(planner.ctx, first.designId);
    expect(view.version.lines.map((l) => [l.varietyName, l.stems, l.colour, l.listingName, l.pricePerStemMinor])).toEqual([
      ["Trandafir Avalanche", 20, "white", "Florăria Lalea", 900],
      ["Bujor Sarah Bernhardt", 6, "pink", "Florăria Lalea", null], // one published colour: taken; no price per stem: unknown
      ["Eucalipt", 10, "green", "Atelier Verde", 450],
    ]);
    // 20 × 9 + 10 × 4,50 = 225; the peony has only a bunch price → not counted, and said so
    expect(view.cost).toMatchObject({ state: "partial", known: [{ currency: "RON", minor: 22500 }], unpricedLines: 1 });
    expect(indicativeCostText(view.cost, "ro")).toBe("≥ 225 RON + articole fără preț: 1");

    // the same design again is not a new version; a changed stem count is
    expect(await saveArrangementDesign(planner.ctx, { occasionId: occ, designId: first.designId, name: "Buchetul miresei", form: "round_bouquet", items: [{ catalogueItemId: a.rose, stems: 20, colour: "white" }, { catalogueItemId: a.peony, stems: 6 }, { catalogueItemId: b.eucalyptus, stems: 10 }], note: "Aerisit, fără panglici." })).toMatchObject({ version: 1, created: false });
    expect(await saveArrangementDesign(planner.ctx, { occasionId: occ, designId: first.designId, name: "Buchetul miresei", form: "cascade", items: [{ catalogueItemId: a.rose, stems: 30, colour: "pink" }, { catalogueItemId: b.eucalyptus, stems: 10 }] })).toMatchObject({ version: 2, created: true });
    const v1 = await getArrangementDesign(planner.ctx, first.designId, 1);
    expect(v1.version.form).toBe("round_bouquet"); // version 1 is still exactly what was saved
    expect(v1.currentVersion).toBe(2);
    expect(v1.versions.map((x) => [x.version, x.stems])).toEqual([[2, 40], [1, 36]]);
    await expect(t.db.update(arrangementVersions).set({ form: "arch" }).where(eq(arrangementVersions.designId, first.designId))).rejects.toThrow();

    const list = await listArrangementDesigns(planner.ctx, occ);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Buchetul miresei", version: 2, form: "cascade", source: "planner" });

    // validation and access
    expect(await failure(() => saveArrangementDesign(planner.ctx, { occasionId: occ, name: "x", form: "wreath", items: [{ catalogueItemId: newId(), stems: 3 }] }))).toBe("VALIDATION:arrangements.errors.itemGone");
    expect(await failure(() => saveArrangementDesign(planner.ctx, { occasionId: occ, name: "x", form: "wreath", items: [] }))).toMatch(/^THROWN|VALIDATION/);
    expect(await failure(() => saveArrangementDesign(planner.ctx, { occasionId: occ, name: "x", form: "wreath", items: [{ catalogueItemId: a.rose, stems: 501 }] }))).toMatch(/^THROWN|VALIDATION/);
    const contributor = await join_(occ, "contributor");
    expect((await listArrangementDesigns(contributor.ctx, occ))[0]!.name).toBe("Buchetul miresei"); // planning members read
    expect(await failure(() => saveArrangementDesign(contributor.ctx, { occasionId: occ, name: "x", form: "wreath", items: [{ catalogueItemId: a.rose, stems: 3 }] }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    const guestRole = await join_(occ, "guest");
    expect(await failure(() => listArrangementDesigns(guestRole.ctx, occ))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    const stranger = await mkAccount();
    expect(await failure(() => getArrangementDesign(stranger.ctx, first.designId))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
    await archiveArrangementDesign(planner.ctx, { designId: first.designId });
    expect(await listArrangementDesigns(planner.ctx, occ)).toEqual([]);
  });
});

describe("quote request and accepted quote (F5, F6)", () => {
  it("the request carries ONLY the arrangement, the date, the guest count and the message; a later design change shows as a delta", async () => {
    const planner = await mkAccount();
    const occ = await mkOccasion(planner);
    const florist = await mkFlorist("Florăria Lalea");
    const other = await mkFlorist("Atelier Verde");
    const design = await saveArrangementDesign(planner.ctx, {
      occasionId: occ,
      name: "Aranjament de masă",
      form: "low_table",
      items: [{ catalogueItemId: florist.rose, stems: 12, colour: "white" }, { catalogueItemId: other.eucalyptus, stems: 8 }],
      note: "Joase, să ne vedem peste ele.",
    });
    const sent = await requestArrangementQuote(planner.at(at(1)), { designId: design.designId, listingId: florist.listingId, message: "Bună ziua, ne puteți face o ofertă pentru 12 mese?", idempotencyKey: `key-${newId()}` });
    expect(sent.version).toBe(1);

    // what was stored for the business to read: exactly the F5 fields
    const [row] = await t.db.select().from(enquiries).where(eq(enquiries.id, sent.enquiryId));
    expect(row!.kind).toBe("quote_request");
    expect(Object.keys(row!.shared as object).sort()).toEqual(["arrangement", "date", "guests"]);
    const shared = row!.shared as { arrangement: { description: string; imageAssetId: string | null; designRef: unknown }; date: string | null; guests: number | null };
    expect(Object.keys(shared.arrangement).sort()).toEqual(["description", "designRef", "imageAssetId"]);
    expect(shared).toMatchObject({ date: "2027-06-12", guests: null, arrangement: { imageAssetId: null, designRef: { designId: design.designId, version: 1 } } });
    expect(shared.arrangement.description).toBe(
      ["Aranjament de masă — Aranjament de masă, jos", "– 12 × Trandafir Avalanche (alb)", "– 8 × Eucalipt (verde)", "Total fire: 20", "Notă: Joase, să ne vedem peste ele."].join("\n"),
    );
    // not sent: the indicative cost, the other florist's name, prices, the planner's email
    expect(JSON.stringify(shared)).not.toMatch(/RON|orientativ|Atelier Verde|900|450|@example\.test/);
    expect(row!.emailShared).toBe(false);
    const [first] = await t.db.select().from(enquiryMessages).where(eq(enquiryMessages.enquiryId, sent.enquiryId));
    expect(first!.body).toBe("Bună ziua, ne puteți face o ofertă pentru 12 mese?");
    expect(buildQuoteDescription({ form: "arch", lines: [], note: null }, "Arcadă", "en")).toBe("Arcadă — Arch\nStems in total: 0");

    // nobody but a manager asks for quotes; an assistant never does
    const contributor = await join_(occ, "contributor");
    expect(await failure(() => requestArrangementQuote(contributor.ctx, { designId: design.designId, listingId: florist.listingId, idempotencyKey: `key-${newId()}` }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await failure(() => requestArrangementQuote(mcp(planner, "read_propose"), { designId: design.designId, listingId: florist.listingId, idempotencyKey: `key-${newId()}` }))).toMatch(/^FORBIDDEN/);

    // before a quote is accepted nothing is "changed after the quote"
    let view = await getArrangementDesign(planner.at(at(2)), design.designId);
    expect(view.quotes).toHaveLength(1);
    expect(view.quotes[0]).toMatchObject({ listingName: "Florăria Lalea", version: 1, link: null, changedSinceQuote: null });

    // the florist answers with a PDF quote; the planner accepts it → linked to design version 1
    await replyAsBusiness(florist.owner.at(at(3)), { enquiryId: sent.enquiryId, body: "Oferta noastră.", quoteFile: { name: "oferta.pdf", bytes: pdf() } });
    const thread = await getPlannerThread(planner.at(at(4)), sent.enquiryId);
    await acceptQuote(planner.at(at(4)), { enquiryId: sent.enquiryId, messageId: thread.messages.find((m) => m.quote)!.id, agreedAmount: "2.400" });
    view = await getArrangementDesign(planner.at(at(5)), design.designId);
    expect(view.quotes[0]!.link!.current.designRef).toEqual({ designId: design.designId, version: 1 });
    expect(view.quotes[0]!.changedSinceQuote).toBeNull();

    // the design moves on: "design modificat după ofertă", with what changed
    await saveArrangementDesign(planner.at(at(6)), { occasionId: occ, designId: design.designId, name: "Aranjament de masă", form: "low_table", items: [{ catalogueItemId: florist.rose, stems: 18, colour: "pink" }, { catalogueItemId: florist.peony, stems: 4 }], note: "Joase, să ne vedem peste ele." });
    view = await getArrangementDesign(planner.at(at(7)), design.designId);
    expect(view.quotes[0]!.changedSinceQuote).toEqual({
      quotedVersion: 1,
      currentVersion: 2,
      changes: [
        { kind: "stems", varietyName: "Trandafir Avalanche", before: 12, after: 18 },
        { kind: "colour", varietyName: "Trandafir Avalanche", before: "white", after: "pink" },
        { kind: "added", varietyName: "Bujor Sarah Bernhardt", stems: 4 },
        { kind: "removed", varietyName: "Eucalipt", stems: 8 },
      ],
    });
    expect(diffVersions({ form: "arch", note: null, lines: [] }, { form: "arch", note: null, lines: [] })).toEqual([]);
  });
});

describe("What-if arrangement.applyDesign (MCP propose_arrangement_design)", () => {
  it("an assistant with propose scope creates a preview only; the design exists after a person confirms, labelled", async () => {
    const planner = await mkAccount();
    const occ = await mkOccasion(planner);
    const florist = await mkFlorist("Florăria Lalea");
    const input = { occasionId: occ, name: "Coroniță", form: "wreath" as const, items: [{ catalogueItemId: florist.rose, stems: 15 }, { catalogueItemId: florist.peony, stems: 5 }], note: "Pentru fetița cu flori." };
    const { preview, cost, stems } = await proposeArrangementDesign(mcp(planner, "read_propose"), input);
    expect(stems).toBe(20);
    expect(cost).toMatchObject({ state: "partial", known: [{ currency: "RON", minor: 13500 }], unpricedLines: 1 });
    expect(preview).toMatchObject({ kind: "arrangement.applyDesign", state: "pending", proposedByKind: "mcp", occasionId: occ });
    const costRow = preview.delta.find((d) => d.key === "cost")!;
    expect(costRow.after).toBe("≥ 135 RON + articole fără preț: 1");
    expect(costRow.noteKey).toBe("arrangements.whatif.costNote"); // "cost orientativ … nu este o ofertă"
    expect(await listArrangementDesigns(planner.ctx, occ)).toEqual([]); // nothing applied

    // an assistant cannot confirm its own proposal; the person can
    expect(await failure(() => confirmPreview(mcp(planner, "read_propose"), preview.id))).toMatch(/^FORBIDDEN/);
    await confirmPreview(planner.ctx, preview.id);
    const [d] = await listArrangementDesigns(planner.ctx, occ);
    expect(d).toMatchObject({ name: "Coroniță", form: "wreath", version: 1, source: "assistant" });
    expect((await confirmPreview(planner.ctx, preview.id)).appliedNow).toBe(false); // once
    expect(await listArrangementDesigns(planner.ctx, occ)).toHaveLength(1);

    // a new version of that design, proposed by the planner in the app, shows before → after
    const next = await proposeArrangementDesign(planner.ctx, { occasionId: occ, designId: d!.id, name: "Coroniță", form: "wreath", items: [{ catalogueItemId: florist.rose, stems: 25 }] });
    expect(next.preview.delta.find((x) => x.what === "Trandafir Avalanche")).toMatchObject({ before: "15" });
    expect(next.preview.delta.find((x) => x.what === "Bujor Sarah Bernhardt")).toMatchObject({ before: "5", after: { key: "arrangements.whatif.removed" } });
  });

  it("is bounded by write access: a read-only token, a guest-role member, a contributor and a stranger cannot propose", async () => {
    const planner = await mkAccount();
    const occ = await mkOccasion(planner);
    const florist = await mkFlorist("Florăria Lalea");
    const input = { occasionId: occ, form: "round_bouquet" as const, items: [{ catalogueItemId: florist.rose, stems: 12 }] };
    expect(await failure(() => proposeArrangementDesign(mcp(planner, "read"), input))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    for (const role of ["guest", "supplier", "contributor"] as const) {
      const p = await join_(occ, role);
      expect(await failure(() => proposeArrangementDesign(mcp(p, "read_propose"), input)), role).toMatch(/^FORBIDDEN/);
      expect(await failure(() => proposeArrangementDesign(p.ctx, input)), role).toMatch(/^FORBIDDEN/);
    }
    const stranger = await mkAccount();
    expect(await failure(() => proposeArrangementDesign(mcp(stranger, "read_propose"), input))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
    // an unknown catalogue item is refused before anything is stored
    expect(await failure(() => proposeArrangementDesign(mcp(planner, "read_propose"), { ...input, items: [{ catalogueItemId: newId(), stems: 3 }] }))).toBe("VALIDATION:arrangements.errors.itemGone");
    expect(await t.db.select().from(whatifPreviews).where(eq(whatifPreviews.occasionId, occ))).toHaveLength(0);
  });
});
