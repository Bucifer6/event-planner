import {
  accounts,
  approvalRequests,
  auditLog,
  businessMembers,
  categories,
  discoveryBatches,
  discoveryDrafts,
  discoverySources,
  discoverySuppressions,
  emailOutbox,
  eq,
  listingClaims,
  listingRevisions,
  listings,
  localities,
  objectionRecords,
  occasionMembers,
  occasions,
  sessions,
  staffMembers,
  type DiscoverySourceConfig,
  type DiscoverySourceKind,
  type StaffRole,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { runOnce } from "@ed/jobs";
import { isAppError, newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveRequest } from "../src/approvals";
import { CLAIM_CODE_ATTEMPTS, getClaimView, listClaims, registerJobs as registerClaims, startClaim, submitClaimForApproval, verifyClaimCode } from "../src/claims";
import { accountCtx, anonymousCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { getDirectoryResults, getPublicListing } from "../src/directory";
import {
  createDiscoverySource,
  decideDiscoveryDrafts,
  decideObjection,
  dedupeKeysFor,
  extractFromPage,
  getRemovalContext,
  listDiscoveryDrafts,
  listDiscoveryRuns,
  listObjections,
  normaliseName,
  parseCsv,
  parseDataset,
  registerJobs as registerDiscovery,
  registerOnrcAdapter,
  runDiscoverySource,
  sendClaimInvitation,
  setDiscoveryDraftPlace,
  setDiscoverySourceEnabled,
  submitObjection,
  type DiscoveryFetcher,
} from "../src/discovery";
import { sendEnquiry } from "../src/enquiries";
import { createBusiness } from "../src/business";
import { createListing, submitListing } from "../src/listings";
import { decideRevision } from "../src/moderation";
import { issueFormStamp } from "../src/ratelimit";
import { listRetentionRules, runRetention } from "../src/retention";

let t: TestDb;
let flori: { id: string };
let foto: { id: string };
let cluj: { id: string };
let turda: { id: string };
let mod1: Ctx;
let mod2: Ctx;
let admin: Ctx;

const T0 = new Date("2026-05-04T08:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);
let seq = 0;

async function mkAccount(email?: string) {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: email ?? `disc${++seq}@example.test` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: at(24 * 30), freshAuthAt: at(-0.01) });
  return { id, ctx: accountCtx(t.db, id, { now: T0, ip: `198.51.100.${(seq % 200) + 1}` }), at: (now: Date) => accountCtx(t.db, id, { now, ip: `198.51.100.${(seq % 200) + 1}` }) };
}
async function mkStaff(roles: StaffRole[]): Promise<Ctx> {
  const acc = await mkAccount();
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc.id, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc.id, staffId: row!.id, roles }, { now: T0 });
}
async function mkSource(kind: DiscoverySourceKind, config: DiscoverySourceConfig, over: { rate?: number; enabled?: boolean } = {}) {
  const [row] = await t.db
    .insert(discoverySources)
    .values({ name: `Sursa ${++seq}`, kind, config, rateLimitPerHour: over.rate ?? 100, enabled: over.enabled ?? true, termsReference: "Contract 12/2026" })
    .returning();
  return row!;
}
async function failure(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? `${e.code}:${e.messageKey}` : `THROWN:${String(e).slice(0, 80)}`;
  }
  return "OK";
}
const sys = (now = T0) => systemCtx(t.db, { now });
const csv = (rows: string[]) => ["name,category,county,locality,contact,email,phone,url", ...rows].join("\n");
const page = (ld: object, extra = "") => `<html><head>${extra}<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><p>Sunați la 0700 000 000 — text vizibil, necitit</p></body></html>`;
function fetcherOf(pages: Record<string, string | { status: number; body: string }>, log: string[] = []): DiscoveryFetcher {
  return async (url) => {
    log.push(url);
    if (url.endsWith("/robots.txt") && !(url in pages)) return { status: 404, body: "" };
    const hit = pages[url];
    if (hit === undefined) return { status: 404, body: "" };
    return typeof hit === "string" ? { status: 200, body: hit } : hit;
  };
}
const draftsOf = (sourceId: string) => t.db.select().from(discoveryDrafts).where(eq(discoveryDrafts.sourceId, sourceId));
const stamp = () => issueFormStamp(new Date(T0.getTime() - 60_000));

beforeAll(async () => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.APP_URL = "https://app.example.test";
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
  const cats = await t.db.select().from(categories);
  flori = cats.find((c) => c.slug === "floristi")!;
  foto = cats.find((c) => c.slug === "fotografi")!;
  const locs = await t.db.select().from(localities).where(eq(localities.countyCode, "CJ"));
  cluj = locs.find((l) => l.slug === "cluj-napoca")!;
  turda = locs.find((l) => l.slug === "turda")!;
  mod1 = await mkStaff(["listing_moderator"]);
  mod2 = await mkStaff(["listing_moderator"]);
  admin = await mkStaff(["platform_admin"]);
  registerDiscovery();
  registerClaims();
});
afterAll(async () => {
  registerOnrcAdapter(null);
  await t.close();
});

describe("parsing and dedupe keys", () => {
  it("normalises names, reads CSV/JSON datasets and a page's own JSON-LD only", () => {
    expect(normaliseName("S.C. Florăria Ana S.R.L.")).toBe("floraria ana");
    expect(normaliseName("FLORARIA  ANA srl")).toBe("floraria ana");
    expect(parseCsv('nume;localitate\n"Florăria ""Ana""";Cluj-Napoca\n')).toEqual([{ nume: 'Florăria "Ana"', localitate: "Cluj-Napoca" }]);
    const rows = parseDataset("json", JSON.stringify([{ Denumire: "Foto X", Județ: "Cluj", Localitate: "Turda", Telefon: "0264 111 222" }, { fara: "nume" }]), "https://data.example/set.json");
    expect(rows).toEqual([expect.objectContaining({ name: "Foto X", county: "Cluj", locality: "Turda", phone: "0264 111 222", contactRoute: "0264 111 222", sourceUrl: "https://data.example/set.json" })]);

    const c = extractFromPage(
      page({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Site" }, { "@type": ["Florist", "LocalBusiness"], name: "Florăria Iris", telephone: "+40 264 123 456", email: "mailto:Contact@Iris.example", address: { "@type": "PostalAddress", streetAddress: "Str. Memorandumului 1", addressLocality: "Cluj-Napoca", addressRegion: "Cluj" } }] }),
      "https://iris.example/",
    )!;
    expect(c).toMatchObject({ name: "Florăria Iris", email: "contact@iris.example", locality: "Cluj-Napoca", county: "Cluj", contactRoute: "+40 264 123 456 · Str. Memorandumului 1, Cluj-Napoca, Cluj", sourceUrl: "https://iris.example/" });
    // the visible text of a page is never read: no JSON-LD and no meta name → nothing
    expect(extractFromPage("<html><body><h1>Florăria Fără Date</h1><p>contact@x.example</p></body></html>", "https://x.example/")).toBeNull();
    expect(extractFromPage('<html><head><meta property="og:site_name" content="Sala Mare"></head></html>', "https://sala.example/")).toMatchObject({ name: "Sala Mare", email: null, contactRoute: "https://sala.example/" });

    const a = dedupeKeysFor({ name: "S.C. Florăria Ana S.R.L.", localityKey: "x1", email: "A@B.ro" });
    const b = dedupeKeysFor({ name: "floraria ana", localityKey: "x1", email: "a@b.ro" });
    expect(a).toEqual(b);
    expect(a.every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true); // stored only as hashes
  });
});

describe("running a source (BD1–BD3, BD7, SEC6)", () => {
  it("a dataset creates drafts that are never public; the run is logged; a re-run adds nothing", async () => {
    const source = await mkSource("licensed_dataset", {
      format: "csv",
      inline: csv([
        "Florăria Dalia SRL,Floriști,Cluj,Cluj-Napoca,Str. Horea 5,contact@dalia.example,0264 555 111,https://dalia.example/",
        "Foto Carpați,Fotografi,Cluj,Turda,Piața Republicii 2,,0264 555 222,https://fotocarpati.example/",
        "Firma Ciudată,Reparații auto,Cluj,Nicăieri,Str. X,,,https://ciudata.example/",
      ]),
    });
    const run = await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" }, { fetcher: fetcherOf({}) });
    expect(run).toMatchObject({ itemsSeen: 3, draftsCreated: 3, duplicatesQueued: 0, skipped: 0, errors: [], stoppedReason: null, triggeredBy: "test" });
    expect(run.finishedAt).not.toBeNull();
    const drafts = await draftsOf(source.id);
    expect(drafts.map((d) => d.state)).toEqual(["pending", "pending", "pending"]);
    const dalia = drafts.find((d) => d.name === "Florăria Dalia SRL")!;
    expect(dalia).toMatchObject({ categoryGuessId: flori.id, countyCode: "CJ", localityId: cluj.id, publicEmail: "contact@dalia.example", publicContactRoute: "0264 555 111 · Str. Horea 5", sourceUrl: "https://dalia.example/" });
    expect(dalia.collectedAt).toEqual(T0);
    const odd = drafts.find((d) => d.name === "Firma Ciudată")!;
    expect(odd).toMatchObject({ categoryGuessId: null, localityId: null, categoryGuessText: "Reparații auto", areaText: "Nicăieri, Cluj" });

    // BD2: nothing is public — no listing exists, the directory is empty
    expect(await t.db.select().from(listings)).toHaveLength(0);
    expect((await getDirectoryResults(anonymousCtx(t.db, { now: T0 }), { categoryId: flori.id, countyCode: "CJ" })).total).toBe(0);

    const again = await runDiscoverySource(sys(at(1)), { sourceId: source.id, triggeredBy: "test" }, { fetcher: fetcherOf({}) });
    expect(again).toMatchObject({ itemsSeen: 3, draftsCreated: 0, duplicatesQueued: 0, skipped: 3 });
    expect(await draftsOf(source.id)).toHaveLength(3);

    // BD7: the log
    const log = await listDiscoveryRuns(mod1, { sourceId: source.id });
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ sourceName: source.name, itemsSeen: 3, draftsCreated: 3 });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "discovery.run"));
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("suspected duplicates — of another draft or of a listing — are queued for a person, never merged", async () => {
    const owner = await mkAccount();
    const business = await createBusiness(owner.ctx, { name: "Foto Zenit SRL" });
    const listing = await createListing(owner.ctx, { businessId: business.id, payload: { name: "Foto Zenit", descriptionRo: "Fotografie de nuntă și botez în Cluj-Napoca.", categoryIds: [foto.id], countyCodes: ["CJ"], localityIds: [cluj.id] } });
    const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
    await decideRevision(mod1, { id: revisionId, decision: "approve" });

    const first = await mkSource("licensed_dataset", { format: "csv", inline: csv(["Florăria Mara,Floriști,Cluj,Turda,Str. Y 1,mara@mara.example,,https://mara.example/"]) });
    await runDiscoverySource(sys(), { sourceId: first.id, triggeredBy: "test" });
    const second = await mkSource("licensed_dataset", {
      format: "csv",
      inline: csv(["S.C. FLORARIA MARA S.R.L.,Floriști,Cluj,Turda,Alt contact,,,https://alt.example/mara", "Foto Zenit S.R.L.,Fotografi,Cluj,Cluj-Napoca,Str. Z 3,,,https://zenit.example/", "Florăria Nouă,Floriști,Cluj,Turda,Str. N 9,,,https://noua.example/"]),
    });
    const run = await runDiscoverySource(sys(), { sourceId: second.id, triggeredBy: "test" });
    expect(run).toMatchObject({ itemsSeen: 3, draftsCreated: 1, duplicatesQueued: 2 });
    const rows = await listDiscoveryDrafts(mod1, { state: "duplicate_review", sourceId: second.id });
    expect(rows.map((r) => [r.draft.name, r.duplicateOf?.kind, r.duplicateOf?.name]).sort()).toEqual([
      ["Foto Zenit S.R.L.", "listing", "Foto Zenit"],
      ["S.C. FLORARIA MARA S.R.L.", "draft", "Florăria Mara"],
    ]);
    // nothing was merged: the first draft and the listing are untouched
    expect((await draftsOf(first.id))[0]).toMatchObject({ name: "Florăria Mara", state: "pending" });
    expect((await t.db.select().from(listings).where(eq(listings.id, listing.id)))[0]!.name).toBe("Foto Zenit");
  });

  it("business pages: robots.txt is honoured, only the page's own structured data is read, errors are logged", async () => {
    const log: string[] = [];
    const source = await mkSource("business_page", { urls: ["https://iris.example/", "https://blocked.example/contact", "https://empty.example/", "https://down.example/"], defaultCategoryId: flori.id });
    const fetcher = fetcherOf(
      {
        "https://iris.example/": page({ "@type": "Florist", name: "Florăria Iris", telephone: "0264 123 456", email: "contact@iris.example", address: { addressLocality: "Cluj-Napoca", addressRegion: "Cluj" } }),
        "https://blocked.example/robots.txt": "User-agent: *\nDisallow: /contact\n",
        "https://blocked.example/contact": page({ "@type": "Florist", name: "Nu Trebuia Citită" }),
        "https://empty.example/": "<html><body><h1>Doar text</h1></body></html>",
        "https://down.example/robots.txt": { status: 503, body: "" },
      },
      log,
    );
    const run = await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" }, { fetcher });
    expect(run).toMatchObject({ itemsSeen: 4, draftsCreated: 1 });
    expect(run.errors).toHaveLength(3);
    expect(run.errors.join("\n")).toContain("robots.txt");
    // the disallowed page and the page behind an unreachable robots.txt were never requested
    expect(log).not.toContain("https://blocked.example/contact");
    expect(log).not.toContain("https://down.example/");
    const [draft] = await draftsOf(source.id);
    expect(draft).toMatchObject({ name: "Florăria Iris", publicEmail: "contact@iris.example", categoryGuessId: flori.id, localityId: cluj.id, sourceUrl: "https://iris.example/" });
  });

  it("without an injected fetcher every request goes through the SSRF guard", async () => {
    const source = await mkSource("business_page", { urls: ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "https://localhost/x"] });
    const run = await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" });
    expect(run.draftsCreated).toBe(0);
    expect(run.errors).toHaveLength(3);
    for (const e of run.errors) expect(e).toContain("blocked");
    // and the console refuses such addresses when a source is configured
    expect(await failure(() => createDiscoverySource(mod1, { name: "Rea", kind: "business_page", termsReference: "Termeni", rateLimitPerHour: 10, urls: "http://10.0.0.1/\nhttps://ok.example/" }))).toBe("VALIDATION:common.errors.VALIDATION");
  });

  it("the kill switch stops a source at once, also in the middle of a run", async () => {
    const off = await mkSource("licensed_dataset", { format: "csv", inline: csv(["Florăria Oprită,Floriști,Cluj,Turda,x,,,https://oprita.example/"]) }, { enabled: false });
    const stopped = await runDiscoverySource(sys(), { sourceId: off.id, triggeredBy: "test" });
    expect(stopped).toMatchObject({ itemsSeen: 0, draftsCreated: 0, stoppedReason: "kill_switch" });

    const urls = ["https://k1.example/", "https://k2.example/", "https://k3.example/"];
    const source = await mkSource("business_page", { urls });
    const pages = Object.fromEntries(urls.map((u, i) => [u, page({ "@type": "LocalBusiness", name: `Firma K${i + 1}`, address: { addressLocality: "Turda", addressRegion: "Cluj" } })]));
    const inner = fetcherOf(pages);
    const seen: string[] = [];
    const fetcher: DiscoveryFetcher = async (url, opts) => {
      seen.push(url);
      const res = await inner(url, opts);
      // a moderator pauses the source while the first page is being read
      if (url === "https://k1.example/") await setDiscoverySourceEnabled(mod1, { id: source.id, enabled: false });
      return res;
    };
    const run = await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" }, { fetcher });
    expect(run).toMatchObject({ stoppedReason: "kill_switch", draftsCreated: 0 });
    expect(seen.filter((u) => !u.endsWith("robots.txt"))).toEqual(["https://k1.example/"]);
    expect(await draftsOf(source.id)).toHaveLength(0);
  });

  it("the per-source hourly limit ends a run; the next hour it continues", async () => {
    const urls = ["https://r1.example/", "https://r2.example/", "https://r3.example/"];
    const source = await mkSource("business_page", { urls }, { rate: 4 }); // 2 requests per page (robots + page)
    const pages = Object.fromEntries(urls.map((u, i) => [u, page({ "@type": "LocalBusiness", name: `Firma R${i + 1}`, address: { addressLocality: "Turda", addressRegion: "Cluj" } })]));
    const run = await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" }, { fetcher: fetcherOf(pages) });
    expect(run).toMatchObject({ draftsCreated: 2, stoppedReason: "rate_limit" });
    const later = await runDiscoverySource(sys(at(2)), { sourceId: source.id, triggeredBy: "test" }, { fetcher: fetcherOf(pages) });
    expect(later).toMatchObject({ draftsCreated: 1, skipped: 2, stoppedReason: null });
  });

  it("ONRC is an adapter seam: without the operator's adapter a run produces nothing and says why", async () => {
    const source = await mkSource("onrc_public", {});
    const none = await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" });
    expect(none).toMatchObject({ itemsSeen: 0, draftsCreated: 0 });
    expect(none.errors[0]).toContain("ONRC adapter not configured");
    registerOnrcAdapter(async () => [{ name: "Sala Regală SRL", categoryText: "Săli de evenimente", county: "CJ", locality: "Turda", contactRoute: "Str. Regală 1", identifier: "RO123456", sourceUrl: "https://onrc.example/RO123456" }]);
    const withAdapter = await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" });
    expect(withAdapter).toMatchObject({ itemsSeen: 1, draftsCreated: 1 });
    registerOnrcAdapter(null);
  });

  it("only moderators and admins reach discovery", async () => {
    const someone = await mkAccount();
    expect(await failure(() => listDiscoveryDrafts(someone.ctx))).toMatch(/^(FORBIDDEN|NOT_FOUND|UNAUTHENTICATED)/);
    const privacy = await mkStaff(["privacy_owner"]);
    expect(await failure(() => listDiscoveryDrafts(privacy))).toMatch(/^FORBIDDEN/);
    expect(await failure(() => runDiscoverySource(someone.ctx, { sourceId: "x", triggeredBy: "me" }))).toMatch(/^(FORBIDDEN|NOT_FOUND|UNAUTHENTICATED)/);
  });
});

describe("batch review, the unclaimed listing and the single invitation (W5, BD4, BD5, P29)", () => {
  it("approval makes a minimal unclaimed listing with the source cited; ONE reason per batch", async () => {
    const source = await mkSource("licensed_dataset", {
      format: "csv",
      inline: csv([
        "Florăria Lavanda,Floriști,Cluj,Turda,Str. Lavandei 3 · 0264 700 100,contact@lavanda.example,,https://lavanda.example/",
        "Florăria Fără Email,Floriști,Cluj,Turda,Str. Mută 4,,,https://faraemail.example/",
        "Firma Neîncadrată,Altceva,Cluj,Nicăieri,Str. Q,,,https://neincadrata.example/",
      ]),
    });
    await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" });
    const drafts = await draftsOf(source.id);
    const lavanda = drafts.find((d) => d.name === "Florăria Lavanda")!;
    const noEmail = drafts.find((d) => d.name === "Florăria Fără Email")!;
    const unplaced = drafts.find((d) => d.name === "Firma Neîncadrată")!;

    // an admin without the moderator role cannot approve (BD4: a ListingModerator approves)
    expect(await failure(() => decideDiscoveryDrafts(admin, { draftIds: [lavanda.id], action: "approve", reason: "Verificat față de sursă." }))).toMatch(/^FORBIDDEN/);
    // one reason is mandatory
    expect(await failure(() => decideDiscoveryDrafts(mod1, { draftIds: [lavanda.id], action: "approve", reason: "ok" }))).toMatch(/^THROWN/);
    // all or nothing: an unplaced draft fails the batch and nothing is created
    expect(await failure(() => decideDiscoveryDrafts(mod1, { draftIds: [lavanda.id, unplaced.id], action: "approve", reason: "Verificat față de sursă." }))).toBe("VALIDATION:discovery.errors.draftIncomplete");
    expect(await t.db.select().from(listings).where(eq(listings.name, "Florăria Lavanda"))).toHaveLength(0);

    const { batchId, listingIds } = await decideDiscoveryDrafts(mod1, { draftIds: [lavanda.id, noEmail.id], action: "approve", reason: "Verificat față de sursă: nume, zonă și contact corespund." });
    expect(listingIds).toHaveLength(2);
    const [batch] = await t.db.select().from(discoveryBatches).where(eq(discoveryBatches.id, batchId));
    expect(batch).toMatchObject({ action: "approve", draftCount: 2, reason: "Verificat față de sursă: nume, zonă și contact corespund." });

    const [approved] = await t.db.select().from(discoveryDrafts).where(eq(discoveryDrafts.id, lavanda.id));
    const listingId = approved!.listingId!;
    const pub = (await getPublicListing(anonymousCtx(t.db, { now: T0 }), listingId))!;
    expect(pub).toMatchObject({ name: "Florăria Lavanda", claimed: false, acceptsEnquiries: false, contact: null, photos: [] });
    expect(pub.unclaimed).toMatchObject({ publicContactRoute: "Str. Lavandei 3 · 0264 700 100", sourceUrl: "https://lavanda.example/" });
    expect(pub.description).toBeNull(); // minimal and factual: nothing the source does not state
    // BD4: the source is cited in the moderation record, approved by the reviewing moderator
    const [rev] = await t.db.select().from(listingRevisions).where(eq(listingRevisions.subjectId, listingId));
    expect(rev).toMatchObject({ state: "approved", businessId: null, submittedByStaffId: null });
    expect(rev!.sourceNote).toContain("https://lavanda.example/");
    expect(rev!.sourceNote).toContain("Contract 12/2026");
    expect(rev!.moderatorStaffId).toBe((mod1.actor as { staffId: string }).staffId);

    // P29: it cannot receive enquiries
    const planner = await mkAccount();
    const occasionId = newId();
    await t.db.insert(occasions).values({ id: occasionId, ownerAccountId: planner.id, title: "Botez", kind: "botez" });
    await t.db.insert(occasionMembers).values({ occasionId, accountId: planner.id, role: "owner" });
    expect(
      await failure(() => sendEnquiry(planner.ctx, { occasionId, listingId, occasionKind: "botez", date: null, guests: null, message: "Bună ziua", idempotencyKey: "k-unclaimed-1" })),
    ).toBe("FORBIDDEN:enquiries.errors.unclaimed");

    // BD5: exactly one invitation, only to the publicly listed address; none without one
    await runOnce({ db: t.db, now: at(0.1) }, { limit: 50 });
    await runOnce({ db: t.db, now: at(1) }, { limit: 50 });
    expect(await sendClaimInvitation(sys(at(2)), { draftId: lavanda.id })).toBe(false); // a second call sends nothing
    expect(await sendClaimInvitation(sys(at(2)), { draftId: noEmail.id })).toBe(false);
    const invitations = (await t.db.select().from(emailOutbox)).filter((m) => m.template === "discovery.claim_invitation");
    expect(invitations.map((m) => m.toEmail)).toEqual(["contact@lavanda.example"]);
    const body = `${invitations[0]!.bodyText}`;
    expect(body).toContain("EventDesk");
    expect(body).toContain("https://lavanda.example/"); // who added it and from where
    expect(body).toContain(`https://app.example.test/claim/${listingId}`); // how to claim / correct
    expect(body).toContain(`/claim/${listingId}/remove?t=`); // how to be removed
    // nothing else was ever sent to a discovered contact
    const toDiscovered = (await t.db.select().from(emailOutbox)).filter((m) => m.toEmail.endsWith("lavanda.example") || m.toEmail.endsWith("faraemail.example"));
    expect(toDiscovered).toHaveLength(1);

    // the moderator corrects the guess, then the third draft can be decided; reject leaves nothing public
    await setDiscoveryDraftPlace(mod1, { id: unplaced.id, categoryId: foto.id, localityId: turda.id });
    await decideDiscoveryDrafts(admin, { draftIds: [unplaced.id], action: "discard", reason: "Nu este o firmă de evenimente." });
    expect((await t.db.select().from(discoveryDrafts).where(eq(discoveryDrafts.id, unplaced.id)))[0]).toMatchObject({ state: "rejected", listingId: null });
    expect(await failure(() => decideDiscoveryDrafts(mod1, { draftIds: [unplaced.id], action: "approve", reason: "Încă o dată, de probă." }))).toBe("CONFLICT:discovery.errors.alreadyDecided");
  });

  it("retention rules: rejected drafts go after 90 days, handled objections after 3 years", async () => {
    expect(listRetentionRules()).toEqual(expect.arrayContaining(["discovery-rejected-drafts", "objection-records", "claim-codes"]));
    const source = await mkSource("licensed_dataset", { format: "csv", inline: "" });
    const mk = async (name: string, decidedAt: Date) =>
      (await t.db.insert(discoveryDrafts).values({ sourceId: source.id, name, publicContactRoute: "x", sourceUrl: "https://x.example/", collectedAt: T0, state: "rejected", decidedAt, dedupeKeys: [] }).returning())[0]!;
    const old = await mk("Veche", at(-24 * 91));
    const recent = await mk("Recentă", at(-24 * 10));
    const [oldObjection] = await t.db.insert(objectionRecords).values({ listingId: "lst_old", listingName: "Veche", kind: "removal", state: "honoured", receivedAt: at(-24 * 1200), dueAt: at(-24 * 1170), handledAt: at(-24 * 1100) }).returning();
    const [openOld] = await t.db.insert(objectionRecords).values({ listingId: "lst_open", listingName: "Deschisă", kind: "objection", state: "received", receivedAt: at(-24 * 1200), dueAt: at(-24 * 1170) }).returning();
    await runRetention(sys());
    expect(await t.db.select().from(discoveryDrafts).where(eq(discoveryDrafts.id, old.id))).toHaveLength(0);
    expect(await t.db.select().from(discoveryDrafts).where(eq(discoveryDrafts.id, recent.id))).toHaveLength(1);
    expect(await t.db.select().from(objectionRecords).where(eq(objectionRecords.id, oldObjection!.id))).toHaveLength(0);
    expect(await t.db.select().from(objectionRecords).where(eq(objectionRecords.id, openOld!.id))).toHaveLength(1); // never dropped unhandled
  });
});

describe("removal and objection (BD6)", () => {
  async function approvedListing(name: string, email: string | null) {
    const source = await mkSource("licensed_dataset", { format: "csv", inline: csv([`${name},Floriști,Cluj,Turda,Str. O 1,${email ?? ""},,https://${normaliseName(name).replace(/ /g, "")}.example/`]) });
    await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" });
    const [draft] = await draftsOf(source.id);
    const { listingIds } = await decideDiscoveryDrafts(mod1, { draftIds: [draft!.id], action: "approve", reason: "Verificat față de sursa publică." });
    return { source, draftId: draft!.id, listingId: listingIds[0]! };
  }

  it("a public request is recorded with a 30-day deadline; honouring retires the listing at once and it is never re-discovered", async () => {
    const { source, listingId } = await approvedListing("Florăria Obiecție", null);
    const visitor = anonymousCtx(t.db, { now: T0, ip: "203.0.113.50" });
    // bot guard (SEC11): a filled honeypot or a missing stamp is refused
    expect(await failure(() => submitObjection(visitor, { listingId, kind: "removal", honeypot: "http://spam", renderedAt: stamp() }))).toMatch(/^RATE_LIMITED/);
    expect(await failure(() => submitObjection(visitor, { listingId, kind: "removal", honeypot: "", renderedAt: null }))).toMatch(/^RATE_LIMITED/);

    const { id, honoured } = await submitObjection(visitor, { listingId, kind: "removal", message: "Nu dorim să apărem.", contactEmail: "Owner@Obiectie.example", honeypot: "", renderedAt: stamp() });
    expect(honoured).toBe(false); // not proven yet: a person looks at it
    const [open] = (await listObjections(mod1)).filter((o) => o.id === id);
    expect(open).toMatchObject({ kind: "removal", state: "received", listingName: "Florăria Obiecție", contactEmail: "owner@obiectie.example", overdue: false, daysLeft: 30 });
    expect(open!.dueAt).toEqual(at(24 * 30));
    expect(await getPublicListing(anonymousCtx(t.db, { now: T0 }), listingId)).not.toBeNull();
    expect((await listObjections(makeCtx(t.db, mod1.actor, { now: at(24 * 31) }))).find((o) => o.id === id)).toMatchObject({ overdue: true });

    expect(await failure(() => decideObjection(mod1, { id, decision: "honour", note: "da" }))).toMatch(/^THROWN/);
    await decideObjection(mod1, { id, decision: "honour", note: "Cererea vine de la adresa de pe site-ul firmei; listarea a fost retrasă." });
    expect(await getPublicListing(anonymousCtx(t.db, { now: T0 }), listingId)).toBeNull(); // retired at once
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.status).toBe("retired");
    const [rec] = await t.db.select().from(objectionRecords).where(eq(objectionRecords.id, id));
    expect(rec).toMatchObject({ state: "honoured", handledByStaffId: (mod1.actor as { staffId: string }).staffId });
    expect(rec!.handlingNote).toContain("retrasă");
    expect((await t.db.select().from(discoverySuppressions)).length).toBeGreaterThan(0);

    // the same business is never discovered again — by the same source or by another
    const rerun = await runDiscoverySource(sys(at(1)), { sourceId: source.id, triggeredBy: "test" });
    expect(rerun).toMatchObject({ draftsCreated: 0, duplicatesQueued: 0 });
    const other = await mkSource("licensed_dataset", { format: "csv", inline: csv(["S.C. FLORARIA OBIECTIE SRL,Floriști,Cluj,Turda,Alt contact,,,https://alt-sursa.example/obiectie"]) });
    const fromOther = await runDiscoverySource(sys(at(1)), { sourceId: other.id, triggeredBy: "test" });
    expect(fromOther).toMatchObject({ itemsSeen: 1, draftsCreated: 0, duplicatesQueued: 0, skipped: 1 });
    expect(await draftsOf(other.id)).toHaveLength(0);
  });

  it("a removal through the invitation's own link is honoured at once; a declined request keeps its reason", async () => {
    const { draftId, listingId } = await approvedListing("Florăria Invitată", "office@invitata.example");
    await sendClaimInvitation(sys(), { draftId });
    const [mail] = (await t.db.select().from(emailOutbox)).filter((m) => m.toEmail === "office@invitata.example");
    const token = /remove\?t=([A-Za-z0-9_-]+)/.exec(`${mail!.bodyText}`)![1]!;
    expect(await getRemovalContext({ db: t.db }, { listingId, token })).toMatchObject({ viaInvitation: true });
    expect(await getRemovalContext({ db: t.db }, { listingId, token: "wrong" })).toMatchObject({ viaInvitation: false });
    const visitor = anonymousCtx(t.db, { now: at(1), ip: "203.0.113.51" });
    const res = await submitObjection(visitor, { listingId, kind: "removal", token, honeypot: "", renderedAt: issueFormStamp(at(0.5)) });
    expect(res.honoured).toBe(true);
    expect(await getPublicListing(anonymousCtx(t.db, { now: at(1) }), listingId)).toBeNull();
    expect((await t.db.select().from(objectionRecords).where(eq(objectionRecords.id, res.id)))[0]).toMatchObject({ state: "honoured", viaInvitation: true });
    // a retired listing has no removal page any more
    expect(await getRemovalContext({ db: t.db }, { listingId })).toBeNull();

    const second = await approvedListing("Florăria Refuzată", null);
    const req = await submitObjection(anonymousCtx(t.db, { now: T0, ip: "203.0.113.52" }), { listingId: second.listingId, kind: "objection", message: "Concurența noastră.", honeypot: "", renderedAt: stamp() });
    await decideObjection(admin, { id: req.id, decision: "decline", note: "Cererea nu vine de la firmă; datele sunt cele din sursa publică." });
    expect(await getPublicListing(anonymousCtx(t.db, { now: T0 }), second.listingId)).not.toBeNull();
    expect((await listObjections(mod1, { state: "handled" })).find((o) => o.id === req.id)).toMatchObject({ state: "declined" });
  });
});

describe("claiming (P29, P30)", () => {
  async function unclaimed(name: string, email: string | null) {
    const source = await mkSource("licensed_dataset", { format: "csv", inline: csv([`${name},Floriști,Cluj,Turda,Str. C 1,${email ?? ""},,https://${normaliseName(name).replace(/ /g, "")}.example/`]) });
    await runDiscoverySource(sys(), { sourceId: source.id, triggeredBy: "test" });
    const [draft] = await draftsOf(source.id);
    const { listingIds } = await decideDiscoveryDrafts(mod1, { draftIds: [draft!.id], action: "approve", reason: "Verificat față de sursa publică." });
    return listingIds[0]!;
  }
  const codeFor = async (to: string) => {
    const mails = (await t.db.select().from(emailOutbox)).filter((m) => m.toEmail === to && m.template === "claims.code");
    return /\b(\d{6})\b/.exec(`${mails[mails.length - 1]!.bodyText}`)![1]!;
  };
  const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

  it("a wrong code fails generically; the right code + a second person's approval converts the listing", async () => {
    const listingId = await unclaimed("Florăria Revendicată", "office@revendicata.example");
    const claimant = await mkAccount("ana@claimant.example");
    const view = (await getClaimView(claimant.ctx, listingId))!;
    expect(view).toMatchObject({ unclaimed: true, maskedEmail: "o•••@revendicata.example", signedIn: true, hasEmail: true, ownBusiness: null, claim: null });
    // the business name is needed when the account owns no business yet
    expect(await failure(() => startClaim(claimant.ctx, { listingId }))).toBe("VALIDATION:common.errors.VALIDATION");
    const { claimId, method } = await startClaim(claimant.ctx, { listingId, businessName: "Florăria Revendicată SRL", statement: "Sunt administratorul firmei." });
    expect(method).toBe("code");
    // the code went to the PUBLISHED address, not to the claimant's
    expect((await t.db.select().from(emailOutbox)).filter((m) => m.template === "claims.code").map((m) => m.toEmail)).toEqual(["office@revendicata.example"]);
    const [stored] = await t.db.select().from(listingClaims).where(eq(listingClaims.id, claimId));
    const code = await codeFor("office@revendicata.example");
    expect(stored!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.codeHash).not.toContain(code);
    expect(stored!.codeExpiresAt).toEqual(at(0.25));

    const generic = "VALIDATION:claims.errors.codeInvalid";
    expect(await failure(() => verifyClaimCode(claimant.ctx, { claimId, code: wrongOf(code) }))).toBe(generic);
    expect(await failure(() => verifyClaimCode(claimant.ctx, { claimId: "nope", code }))).toBe(generic); // no such claim: same answer
    const stranger = await mkAccount();
    expect(await failure(() => verifyClaimCode(stranger.ctx, { claimId, code }))).toBe(generic); // someone else's claim: same answer
    expect(await failure(() => verifyClaimCode(claimant.at(at(1)), { claimId, code }))).toBe(generic); // expired: same answer
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.claimed).toBe(false);

    expect(await verifyClaimCode(claimant.at(at(0.1)), { claimId, code })).toEqual({ verified: true });
    expect((await t.db.select().from(listingClaims).where(eq(listingClaims.id, claimId)))[0]).toMatchObject({ state: "verified", codeHash: null });
    // proof alone changes nothing: still unclaimed, still no enquiries
    const planner = await mkAccount();
    const occasionId = newId();
    await t.db.insert(occasions).values({ id: occasionId, ownerAccountId: planner.id, title: "Nuntă", kind: "nunta" });
    await t.db.insert(occasionMembers).values({ occasionId, accountId: planner.id, role: "owner" });
    const enquiry = (key: string) => ({ occasionId, listingId, occasionKind: "nunta" as const, date: null, guests: null, message: "Bună ziua", idempotencyKey: key });
    expect(await failure(() => sendEnquiry(planner.ctx, enquiry("k-claim-before")))).toBe("FORBIDDEN:enquiries.errors.unclaimed");

    // W9: a moderator sends it to the approvals queue; the requester cannot approve it
    const row = (await listClaims(mod1)).find((c) => c.claim.id === claimId)!;
    expect(row).toMatchObject({ claimantEmail: "ana@claimant.example", listingName: "Florăria Revendicată" });
    expect(row.claim.codeHash).toBeNull();
    const { approvalRequestId } = await submitClaimForApproval(mod1, { claimId, checkNote: "" });
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.claimed).toBe(false);
    expect(await failure(() => approveRequest(mod1, approvalRequestId))).toMatch(/^FORBIDDEN/);
    const done = await approveRequest(mod2, approvalRequestId);
    expect(done.executed).toBe(true);

    const [listing] = await t.db.select().from(listings).where(eq(listings.id, listingId));
    expect(listing).toMatchObject({ claimed: true, status: "live" });
    const [membership] = await t.db.select().from(businessMembers).where(eq(businessMembers.accountId, claimant.id));
    expect(membership).toMatchObject({ role: "owner", businessId: listing!.businessId });
    expect((await t.db.select().from(listingClaims).where(eq(listingClaims.id, claimId)))[0]).toMatchObject({ state: "approved", businessId: listing!.businessId });
    const pub = (await getPublicListing(anonymousCtx(t.db, { now: T0 }), listingId))!;
    expect(pub).toMatchObject({ claimed: true, acceptsEnquiries: true, unclaimed: null });
    // …and now it accepts enquiries
    const sent = await sendEnquiry(planner.ctx, enquiry("k-claim-after"));
    expect(sent.enquiryId).toBeTruthy();
    expect((await getClaimView(claimant.ctx, listingId))!).toMatchObject({ unclaimed: false, claim: { state: "approved" } });
    expect(await failure(() => startClaim(stranger.ctx, { listingId, businessName: "Alții SRL" }))).toBe("CONFLICT:listings.errors.alreadyClaimed");
  });

  it("the attempts are capped: after five wrong codes even the right one fails, generically", async () => {
    const listingId = await unclaimed("Florăria Ghicită", "office@ghicita.example");
    const claimant = await mkAccount();
    const { claimId } = await startClaim(claimant.ctx, { listingId, businessName: "Ghicită SRL" });
    const code = await codeFor("office@ghicita.example");
    for (let i = 0; i < CLAIM_CODE_ATTEMPTS; i++) {
      expect(await failure(() => verifyClaimCode(claimant.ctx, { claimId, code: wrongOf(code) }))).toBe("VALIDATION:claims.errors.codeInvalid");
    }
    expect(await failure(() => verifyClaimCode(claimant.ctx, { claimId, code }))).toBe("VALIDATION:claims.errors.codeInvalid");
    // a new code works again
    await startClaim(claimant.at(at(0.05)), { listingId });
    const fresh = await codeFor("office@ghicita.example");
    expect(await verifyClaimCode(claimant.at(at(0.06)), { claimId, code: fresh })).toEqual({ verified: true });
  });

  it("no public email: a moderator verifies against the public source and the check is recorded", async () => {
    const listingId = await unclaimed("Florăria Fără Adresă", null);
    const claimant = await mkAccount("dan@claimant.example");
    expect((await getClaimView(claimant.ctx, listingId))!.maskedEmail).toBeNull();
    const { claimId, method } = await startClaim(claimant.ctx, { listingId, businessName: "Fără Adresă SRL", statement: "Asociat unic." });
    expect(method).toBe("moderator");
    expect((await t.db.select().from(emailOutbox)).filter((m) => m.toEmail === "dan@claimant.example")).toHaveLength(0); // no code to a typed or private address
    expect((await t.db.select().from(listingClaims).where(eq(listingClaims.id, claimId)))[0]).toMatchObject({ state: "needs_check", method: "moderator", codeHash: null });
    // there is no code to guess
    expect(await failure(() => verifyClaimCode(claimant.ctx, { claimId, code: "123456" }))).toBe("VALIDATION:claims.errors.codeInvalid");

    // the check is mandatory and stored with who and when
    expect(await failure(() => submitClaimForApproval(mod1, { claimId, checkNote: "ok" }))).toBe("VALIDATION:common.errors.VALIDATION");
    const note = "Comparat cu extrasul public ONRC: administratorul Dan Ionescu corespunde actului trimis.";
    const { approvalRequestId } = await submitClaimForApproval(mod1, { claimId, checkNote: note });
    const [claim] = await t.db.select().from(listingClaims).where(eq(listingClaims.id, claimId));
    expect(claim).toMatchObject({ state: "in_approval", checkNote: note, checkedByStaffId: (mod1.actor as { staffId: string }).staffId, approvalRequestId });
    expect(claim!.checkedAt).toEqual(T0);
    const [request] = await t.db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalRequestId));
    expect(request).toMatchObject({ action: "listing.claim", state: "pending", reason: note });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "claim.check_recorded"));
    expect(audits.some((a) => a.objectId === claimId)).toBe(true);
    // queued = no effect until a second person approves (W9)
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.claimed).toBe(false);

    await approveRequest(mod2, approvalRequestId);
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.claimed).toBe(true);
  });

  it("an anonymous visitor or an account without an email cannot start a claim", async () => {
    const listingId = await unclaimed("Florăria Publică", "office@publica.example");
    expect((await getClaimView(anonymousCtx(t.db, { now: T0 }), listingId))!).toMatchObject({ signedIn: false, claim: null });
    expect(await failure(() => startClaim(anonymousCtx(t.db, { now: T0 }), { listingId, businessName: "X SRL" }))).toMatch(/^UNAUTHENTICATED/);
    const anonId = newId();
    await t.db.insert(accounts).values({ id: anonId, kind: "anonymous" });
    expect(await failure(() => startClaim(accountCtx(t.db, anonId, { now: T0 }), { listingId, businessName: "X SRL" }))).toBe("FORBIDDEN:claims.errors.emailRequired");
    expect(await getClaimView(anonymousCtx(t.db, { now: T0 }), "nope")).toBeNull();
  });
});
