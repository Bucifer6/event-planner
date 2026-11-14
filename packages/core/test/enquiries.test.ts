import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accounts,
  bookingEvents,
  bookings,
  businesses,
  categories,
  emailOutbox,
  enquiries,
  enquiryMessages,
  enquiryStatEvents,
  eq,
  jobs,
  localities,
  occasionMembers,
  occasions,
  quoteLinks,
  sessions,
  staffMembers,
  statsDaily,
  suppliers,
  type StaffRole,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { runOnce } from "@ed/jobs";
import { isAppError, newId } from "@ed/shared";
import { createLocalTransport, setStorageTransport, uploadAsset } from "@ed/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusiness } from "../src/business";
import { accountCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { requestDeletion } from "../src/deletion";
import {
  acceptQuote,
  buildQuoteRequestPayload,
  closeEnquiry,
  enquiryNumbers,
  getBusinessThread,
  getEnquiryPrefill,
  getPlannerThread,
  getQuoteLink,
  listBusinessEnquiries,
  listOccasionEnquiries,
  listThreadsForBooking,
  MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY,
  MAX_ENQUIRIES_PER_OCCASION,
  registerJobs,
  replyAsBusiness,
  replyAsPlanner,
  reportEnquiry,
  resendEnquiry,
  sendEnquiry,
  sendQuoteRequest,
} from "../src/enquiries";
import { createListing, createUnclaimedListing, submitListing } from "../src/listings";
import { computeListingStats } from "../src/listingstats";
import { decideRevision } from "../src/moderation";
import { purgeDueOccasions } from "../src/occasions";
import { getSupplier } from "../src/suppliers";

let t: TestDb;
let dir: string;
let foto: { id: string };
let flori: { id: string };
let cluj: { id: string };
let moderator: Ctx;

const T0 = new Date("2026-05-04T08:00:00Z");
const PLANNER_EMAIL = "planner-secret@example.test";
let seq = 0;
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

async function mkAccount(email?: string): Promise<{ id: string; ctx: Ctx; at: (now: Date) => Ctx }> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: email ?? `enq${++seq}@example.test` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: at(24 * 30), freshAuthAt: at(-0.01) });
  return { id, ctx: accountCtx(t.db, id, { now: T0 }), at: (now) => accountCtx(t.db, id, { now }) };
}
async function mkStaff(roles: StaffRole[]): Promise<Ctx> {
  const acc = await mkAccount();
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc.id, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc.id, staffId: row!.id, roles }, { now: T0 });
}
async function mkLive(name: string, categoryId = foto.id, over: Record<string, unknown> = {}) {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `${name} SRL` });
  const listing = await createListing(owner.ctx, {
    businessId: business.id,
    payload: { name, descriptionRo: "Lucrăm la evenimente din județul Cluj de peste zece ani.", categoryIds: [categoryId], countyCodes: ["CJ"], localityIds: [cluj.id], ...over },
  });
  const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
  await decideRevision(moderator, { id: revisionId, decision: "approve" });
  return { owner, business, listingId: listing.id };
}
async function mkOccasion(ownerId: string, title = "Nunta Ioanei și a lui Andrei"): Promise<string> {
  const id = newId();
  await t.db.insert(occasions).values({ id, ownerAccountId: ownerId, title, kind: "nunta", startsAt: new Date("2027-06-12T09:00:00Z"), venueName: "Conacul Polizu" });
  await t.db.insert(occasionMembers).values({ occasionId: id, accountId: ownerId, role: "owner" });
  return id;
}
const enquiry = (occasionId: string, listingId: string, over: Record<string, unknown> = {}) => ({
  occasionId,
  listingId,
  occasionKind: "nunta" as const,
  date: "2027-06-12",
  guests: "120",
  countyCode: "CJ",
  localityId: cluj.id,
  budgetBand: "5000_10000",
  message: "Bună ziua, sunteți liberi pe 12 iunie?",
  idempotencyKey: `key-${newId()}`,
  ...over,
});
async function failure(fn: () => Promise<unknown>): Promise<{ code: string; key: string | undefined }> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? { code: e.code, key: e.messageKey } : { code: `THROWN:${String(e)}`, key: undefined };
  }
  return { code: "OK", key: undefined };
}
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
const mailsTo = async (to: string) => t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, to));

beforeAll(async () => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.APP_URL = "https://app.example.test";
  process.env.MEDIA_URL = "https://media.example.test";
  dir = mkdtempSync(join(tmpdir(), "ed-enq-"));
  setStorageTransport(createLocalTransport(dir));
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
  const cats = await t.db.select().from(categories);
  foto = cats.find((c) => c.slug === "fotografi")!;
  flori = cats.find((c) => c.slug === "floristi")!;
  const locs = await t.db.select().from(localities).where(eq(localities.countyCode, "CJ"));
  cluj = locs.find((l) => l.slug === "cluj-napoca")!;
  moderator = await mkStaff(["listing_moderator"]);
  registerJobs();
});
afterAll(async () => {
  setStorageTransport(null);
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});

describe("sending an enquiry (P8–P10)", () => {
  it("creates the thread in the plan: supplier record + booking, reused on the next thread", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const biz = await mkLive("Foto Lumen");
    const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    const [row] = await t.db.select().from(enquiries).where(eq(enquiries.id, sent.enquiryId));
    expect(row).toMatchObject({ state: "sent", kind: "enquiry", bookingId: sent.bookingId, businessId: biz.business.id, emailShared: false, sharedEmail: null });
    expect(row!.shared).toEqual({ occasionKind: "nunta", date: "2027-06-12", guests: 120, countyCode: "CJ", localityId: cluj.id, budgetBand: "5000_10000" });

    const supplier = await getSupplier(planner.ctx, sent.supplierId);
    expect(supplier.supplier).toMatchObject({ name: "Foto Lumen", listingId: biz.listingId, categoryLabel: "Fotografi" });
    expect(supplier.booking).toMatchObject({ id: sent.bookingId, state: "enquired" });

    // the thread sits on the supplier page
    const onBooking = await listThreadsForBooking(planner.ctx, sent.bookingId);
    expect(onBooking.map((x) => x.id)).toEqual([sent.enquiryId]);
    expect(onBooking[0]!.messages.map((m) => [m.side, m.body])).toEqual([["planner", "Bună ziua, sunteți liberi pe 12 iunie?"]]);

    // closing and writing again reuses the same supplier record and booking (P10)
    await closeEnquiry(planner.ctx, { enquiryId: sent.enquiryId });
    const second = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    expect(second.supplierId).toBe(sent.supplierId);
    expect(second.bookingId).toBe(sent.bookingId);
    expect(await t.db.select().from(suppliers).where(eq(suppliers.occasionId, occasionId))).toHaveLength(1);
  });

  it("a double submit creates one thread; a second open enquiry to the same listing is refused", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const biz = await mkLive("Foto Dublu");
    const input = enquiry(occasionId, biz.listingId);
    const [a, b] = await Promise.all([sendEnquiry(planner.ctx, input), sendEnquiry(planner.ctx, input)]);
    expect(a.enquiryId).toBe(b.enquiryId);
    expect(await t.db.select().from(enquiries).where(eq(enquiries.occasionId, occasionId))).toHaveLength(1);
    expect(await failure(() => sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId)))).toEqual({ code: "CONFLICT", key: "enquiries.errors.alreadyOpen" });
  });

  it("needs a signed-in planner who manages the occasion; validates the picklists", async () => {
    const planner = await mkAccount();
    const stranger = await mkAccount();
    const helper = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    await t.db.insert(occasionMembers).values({ occasionId, accountId: helper.id, role: "contributor" });
    const biz = await mkLive("Foto Acces");
    expect((await failure(() => sendEnquiry(stranger.ctx, enquiry(occasionId, biz.listingId)))).code).toBe("NOT_FOUND");
    expect((await failure(() => sendEnquiry(helper.ctx, enquiry(occasionId, biz.listingId)))).code).toBe("FORBIDDEN");
    expect((await failure(() => sendEnquiry(makeCtx(t.db, { kind: "anonymous" }), enquiry(occasionId, biz.listingId)))).code).toBe("UNAUTHENTICATED");
    expect((await failure(() => sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId, { localityId: "nope" })))).code).toBe("VALIDATION");
    await expect(sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId, { budgetBand: "a lot" }))).rejects.toThrow(); // fixed bands only
    // unknown keys are refused: nothing outside the P8 fields can be sent
    await expect(sendEnquiry(planner.ctx, { ...enquiry(occasionId, biz.listingId), plannerName: "Ioana" } as never)).rejects.toThrow();
  });

  it("prefill comes from the plan and stays editable", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const prefill = await getEnquiryPrefill(planner.ctx, { occasionId });
    expect(prefill).toMatchObject({ occasionKind: "nunta", date: "2027-06-12", guests: null, leftForOccasion: MAX_ENQUIRIES_PER_OCCASION, leftToday: MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY, hasEmail: true });
  });
});

describe("what the business learns (P9, D3)", () => {
  it("sees only the shared fields — no email, name, account or occasion unless the box was ticked", async () => {
    const planner = await mkAccount(PLANNER_EMAIL);
    const occasionId = await mkOccasion(planner.id, "Nunta secretă a Ioanei Popescu");
    const biz = await mkLive("Foto Discret");
    const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    const thread = await getBusinessThread(biz.owner.ctx, sent.enquiryId);
    const inbox = await listBusinessEnquiries(biz.owner.ctx, biz.business.id);
    const seen = JSON.stringify({ thread, inbox });
    expect(seen).not.toContain(PLANNER_EMAIL);
    expect(seen).not.toContain(planner.id);
    expect(seen).not.toContain(occasionId);
    expect(seen).not.toContain("Ioanei Popescu");
    expect(seen).not.toContain("Conacul Polizu");
    expect(thread.sharedEmail).toBeNull();
    expect(Object.keys(thread).sort()).toEqual(
      ["canReply", "closedBy", "id", "kind", "lastMessageAt", "listingId", "listingName", "messages", "reportedAt", "resentAt", "sentAt", "shared", "sharedEmail", "state", "waitingMinutes"].sort(),
    );
    expect(thread.shared).toEqual({ kind: "enquiry", occasionKind: "nunta", date: "2027-06-12", guests: 120, county: "Cluj", locality: "Cluj-Napoca", budgetBand: "5000_10000" });
    expect(Object.keys(thread.messages[0]!).sort()).toEqual(["at", "body", "id", "quote", "side"]);

    // ticking the box shares the email — and only then
    const occasion2 = await mkOccasion(planner.id);
    const ticked = await sendEnquiry(planner.ctx, enquiry(occasion2, biz.listingId, { shareEmail: "on" }));
    const thread2 = await getBusinessThread(biz.owner.ctx, ticked.enquiryId);
    expect(thread2.sharedEmail).toBe(PLANNER_EMAIL);
    expect(JSON.stringify(thread2)).not.toContain(planner.id);
  });

  it("only members of that business read the thread; any active member may answer", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const biz = await mkLive("Foto Echipa");
    const other = await mkLive("Foto Vecin");
    const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    expect((await failure(() => getBusinessThread(other.owner.ctx, sent.enquiryId))).code).toBe("NOT_FOUND");
    expect((await failure(() => getBusinessThread(planner.ctx, sent.enquiryId))).code).toBe("NOT_FOUND");
    expect((await failure(() => replyAsBusiness(other.owner.ctx, { enquiryId: sent.enquiryId, body: "Salut" }))).code).toBe("NOT_FOUND");
    expect((await failure(() => getPlannerThread(biz.owner.ctx, sent.enquiryId))).code).toBe("NOT_FOUND");
  });
});

describe("limits (P11)", () => {
  it("the 11th enquiry of an occasion is refused with a clear message; quote requests count too", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const florist = await mkLive("Florăria Limită", flori.id);
    for (let i = 0; i < 9; i++) {
      await t.db.insert(enquiries).values({
        occasionId,
        listingId: florist.listingId,
        businessId: florist.business.id,
        kind: "quote_request",
        shared: buildQuoteRequestPayload({ description: `Aranjament ${i}`, imageAssetId: null, designRef: null, date: null, guests: null }),
        idempotencyKey: `seed-${i}`,
        sentAt: T0,
        lastMessageAt: T0,
      });
    }
    await sendQuoteRequest(planner.ctx, { occasionId, listingId: florist.listingId, arrangement: { description: "Buchet de mireasă" }, date: "2027-06-12", guests: 120, message: "", idempotencyKey: `key-${newId()}` });
    const refused = await failure(() => sendEnquiry(planner.ctx, enquiry(occasionId, florist.listingId)));
    expect(refused).toEqual({ code: "LIMIT", key: "enquiries.errors.occasionLimit" });
    const refusedQuote = await failure(() =>
      sendQuoteRequest(planner.ctx, { occasionId, listingId: florist.listingId, arrangement: { description: "Încă unul" }, date: null, guests: null, message: "", idempotencyKey: `key-${newId()}` }),
    );
    expect(refusedQuote).toEqual({ code: "LIMIT", key: "enquiries.errors.occasionLimit" });
    expect(await t.db.select().from(enquiries).where(eq(enquiries.occasionId, occasionId))).toHaveLength(10);
  });

  it("30 per account per day across occasions; the next day it works again", async () => {
    const planner = await mkAccount();
    const biz = await mkLive("Foto Zilnic");
    const filler = await mkOccasion(planner.id);
    for (let i = 0; i < 30; i++) {
      await t.db.insert(enquiries).values({
        occasionId: filler,
        listingId: biz.listingId,
        businessId: biz.business.id,
        senderAccountId: planner.id,
        kind: "quote_request",
        shared: buildQuoteRequestPayload({ description: "x", imageAssetId: null, designRef: null, date: null, guests: null }),
        idempotencyKey: `day-${i}`,
        sentAt: at(1),
        lastMessageAt: at(1),
      });
    }
    const fresh = await mkOccasion(planner.id);
    expect(await failure(() => sendEnquiry(planner.at(at(2)), enquiry(fresh, biz.listingId)))).toEqual({ code: "LIMIT", key: "enquiries.errors.dailyLimit" });
    const tomorrow = await sendEnquiry(planner.at(at(30)), enquiry(fresh, biz.listingId));
    expect(tomorrow.enquiryId).toBeTruthy();
  });
});

describe("unclaimed listings (P29)", () => {
  it("accept no enquiries and no quote requests, server-side", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const { listingId, revisionId } = await createUnclaimedListing(systemCtx(t.db, { now: T0 }), {
      name: "Florăria Necunoscută",
      categoryIds: [flori.id],
      localityIds: [cluj.id],
      publicContactRoute: "0264 000 000",
      sourceUrl: "https://example.org/floraria",
    });
    await decideRevision(moderator, { id: revisionId, decision: "approve" });
    expect(await failure(() => sendEnquiry(planner.ctx, enquiry(occasionId, listingId)))).toEqual({ code: "FORBIDDEN", key: "enquiries.errors.unclaimed" });
    expect(
      await failure(() => sendQuoteRequest(planner.ctx, { occasionId, listingId, arrangement: { description: "Buchet" }, date: null, guests: null, message: "", idempotencyKey: `key-${newId()}` })),
    ).toEqual({ code: "FORBIDDEN", key: "enquiries.errors.unclaimed" });
    expect(await t.db.select().from(enquiries).where(eq(enquiries.listingId, listingId))).toHaveLength(0);
  });
});

describe("the state machine (P33) and notifications (P32)", () => {
  it("sent → answered → awaiting → answered → closed; either side can close", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const biz = await mkLive("Foto Stări");
    const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    let thread = await getPlannerThread(planner.ctx, sent.enquiryId);
    expect(thread).toMatchObject({ state: "sent", canResend: false });
    expect(thread.sentAt).toEqual(T0); // an unanswered enquiry shows "trimisă <data>"
    expect(thread.resendFrom).toEqual(at(24 * 7));

    await replyAsBusiness(biz.owner.at(at(3)), { enquiryId: sent.enquiryId, body: "Da, suntem liberi." });
    thread = await getPlannerThread(planner.at(at(3)), sent.enquiryId);
    expect(thread).toMatchObject({ state: "answered", resendFrom: null });
    expect(thread.firstAnsweredAt).toEqual(at(3));

    await replyAsPlanner(planner.at(at(4)), { enquiryId: sent.enquiryId, body: "Minunat. Cât costă?" });
    expect((await getPlannerThread(planner.at(at(4)), sent.enquiryId)).state).toBe("awaiting");
    const inbox = await listBusinessEnquiries(biz.owner.at(at(5)), biz.business.id);
    expect(inbox.find((x) => x.id === sent.enquiryId)).toMatchObject({ state: "awaiting", waitingMinutes: 60 });

    await replyAsBusiness(biz.owner.at(at(6)), { enquiryId: sent.enquiryId, body: "Trimitem o ofertă." });
    expect((await getPlannerThread(planner.at(at(6)), sent.enquiryId)).state).toBe("answered");

    expect(await closeEnquiry(biz.owner.at(at(7)), { enquiryId: sent.enquiryId })).toEqual({ closedBy: "business" });
    expect(await closeEnquiry(planner.at(at(8)), { enquiryId: sent.enquiryId })).toEqual({ closedBy: "business" });
    thread = await getPlannerThread(planner.at(at(8)), sent.enquiryId);
    expect(thread).toMatchObject({ state: "closed", closedBy: "business" });
    expect((await failure(() => replyAsPlanner(planner.at(at(9)), { enquiryId: sent.enquiryId, body: "Mai sunteți?" }))).key).toBe("enquiries.errors.closed");
    expect((await failure(() => replyAsBusiness(biz.owner.at(at(9)), { enquiryId: sent.enquiryId, body: "Da" }))).key).toBe("enquiries.errors.closed");
    expect((await listOccasionEnquiries(planner.ctx, occasionId)).map((x) => x.state)).toEqual(["closed"]);
  });

  it("re-send: once, after 7 days without an answer, on the same thread", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const biz = await mkLive("Foto Tăcut");
    const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    expect((await failure(() => resendEnquiry(planner.at(at(24 * 6)), { enquiryId: sent.enquiryId }))).key).toBe("enquiries.errors.resendTooEarly");
    const day8 = at(24 * 8);
    expect((await getPlannerThread(planner.at(day8), sent.enquiryId)).canResend).toBe(true);
    const before = await t.db.select().from(suppliers).where(eq(suppliers.occasionId, occasionId));
    await resendEnquiry(planner.at(day8), { enquiryId: sent.enquiryId });
    const rows = await t.db.select().from(enquiries).where(eq(enquiries.occasionId, occasionId));
    expect(rows).toHaveLength(1); // no duplicate thread
    expect(rows[0]).toMatchObject({ id: sent.enquiryId, state: "sent", bookingId: sent.bookingId });
    expect(rows[0]!.resentAt).toEqual(day8);
    expect(await t.db.select().from(suppliers).where(eq(suppliers.occasionId, occasionId))).toHaveLength(before.length);
    expect(await t.db.select().from(bookings).where(eq(bookings.occasionId, occasionId))).toHaveLength(1);
    expect(await t.db.select().from(enquiryMessages).where(eq(enquiryMessages.enquiryId, sent.enquiryId))).toHaveLength(1);
    const thread = await getPlannerThread(planner.at(at(24 * 20)), sent.enquiryId);
    expect(thread).toMatchObject({ canResend: false, resendFrom: null });
    expect((await failure(() => resendEnquiry(planner.at(at(24 * 20)), { enquiryId: sent.enquiryId }))).key).toBe("enquiries.errors.resendOnce");

    // an answered thread is never re-sent
    const other = await mkLive("Foto Prompt");
    const answered = await sendEnquiry(planner.ctx, enquiry(occasionId, other.listingId));
    await replyAsBusiness(other.owner.at(at(1)), { enquiryId: answered.enquiryId, body: "Bună!" });
    expect((await failure(() => resendEnquiry(planner.at(day8), { enquiryId: answered.enquiryId }))).key).toBe("enquiries.errors.resendAnswered");
  });

  it("arrival notice in Romanian to the listing's address, then exactly ONE nudge after 48 hours", async () => {
    const planner = await mkAccount(`quiet-planner${++seq}@example.test`);
    const occasionId = await mkOccasion(planner.id);
    const biz = await mkLive("Foto Notificat", foto.id, { contactEmail: "contact@foto-notificat.example" });
    const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    const due = await t.db.select().from(jobs);
    expect(due.filter((j) => (j.payload as { enquiryId?: string }).enquiryId === sent.enquiryId).map((j) => j.name).sort()).toEqual(["enquiries.notify-arrival", "enquiries.nudge-48h"]);

    await runOnce({ db: t.db, now: at(0.1) }, { limit: 50 });
    let mails = await mailsTo("contact@foto-notificat.example");
    expect(mails.map((m) => m.template)).toEqual(["enquiries.arrival"]);
    expect(mails[0]!.locale).toBe("ro");
    expect(mails[0]!.subject).toBe("Cerere nouă pentru Foto Notificat");
    // nothing about the planner in the notice (D3)
    expect(`${mails[0]!.bodyText}`).not.toContain("quiet-planner");
    expect(`${mails[0]!.bodyText}`).not.toContain(planner.id);
    // L4: the listing has no English version → Romanian only
    expect(`${mails[0]!.bodyText}`).not.toContain("New enquiry");

    // not yet 48 hours: nothing more
    await runOnce({ db: t.db, now: at(47) }, { limit: 50 });
    expect(await mailsTo("contact@foto-notificat.example")).toHaveLength(1);
    await runOnce({ db: t.db, now: at(49) }, { limit: 50 });
    mails = await mailsTo("contact@foto-notificat.example");
    expect(mails.map((m) => m.template).sort()).toEqual(["enquiries.arrival", "enquiries.nudge"]);

    // nudges stop after that one: later passes, and even the re-send, add no second nudge
    await runOnce({ db: t.db, now: at(24 * 5) }, { limit: 50 });
    await resendEnquiry(planner.at(at(24 * 8)), { enquiryId: sent.enquiryId });
    await runOnce({ db: t.db, now: at(24 * 8 + 1) }, { limit: 50 });
    await runOnce({ db: t.db, now: at(24 * 12) }, { limit: 50 });
    mails = await mailsTo("contact@foto-notificat.example");
    expect(mails.filter((m) => m.template === "enquiries.nudge")).toHaveLength(1);
    expect(mails.map((m) => m.template).sort()).toEqual(["enquiries.arrival", "enquiries.nudge", "enquiries.resent"]);
  });

  it("the nudge48h switch turns off the nudge only; an answered enquiry is never nudged", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const off = await mkLive("Foto Fără Memento", foto.id, { contactEmail: "contact@fara-memento.example" });
    await t.db.update(businesses).set({ nudge48h: false }).where(eq(businesses.id, off.business.id));
    const prompt = await mkLive("Foto Răspunde", foto.id, { contactEmail: "contact@raspunde.example" });
    await sendEnquiry(planner.ctx, enquiry(occasionId, off.listingId));
    const answered = await sendEnquiry(planner.ctx, enquiry(occasionId, prompt.listingId));
    await runOnce({ db: t.db, now: at(0.1) }, { limit: 50 });
    await replyAsBusiness(prompt.owner.at(at(2)), { enquiryId: answered.enquiryId, body: "Răspundem imediat." });
    await runOnce({ db: t.db, now: at(50) }, { limit: 50 });
    expect((await mailsTo("contact@fara-memento.example")).map((m) => m.template)).toEqual(["enquiries.arrival"]);
    expect((await mailsTo("contact@raspunde.example")).map((m) => m.template)).toEqual(["enquiries.arrival"]);
  });

  it("report: either side; it becomes a content report and flags the thread", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const biz = await mkLive("Foto Raportat");
    const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
    const { reference } = await reportEnquiry(planner.ctx, { enquiryId: sent.enquiryId, reasonCategory: "fraud", description: "Cere bani în avans în afara platformei." });
    expect(reference).toMatch(/^R-/);
    const [row] = await t.db.select().from(enquiries).where(eq(enquiries.id, sent.enquiryId));
    expect(row).toMatchObject({ reportedBy: "planner", state: "sent" });
    const second = await reportEnquiry(biz.owner.ctx, { enquiryId: sent.enquiryId, reasonCategory: "offensive", description: "Mesaje jignitoare repetate." });
    expect(second.reference).toMatch(/^R-/);
  });
});

describe("quote requests and accepted quotes (F5, F6, P12)", () => {
  it("the payload has exactly the F5 fields", async () => {
    const planner = await mkAccount(`flower-planner${++seq}@example.test`);
    const occasionId = await mkOccasion(planner.id);
    const florist = await mkLive("Florăria Ana", flori.id);
    const image = await uploadAsset(planner.ctx, { ownerType: "occasion", ownerId: occasionId, file: { name: "schita.png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") } });
    const sent = await sendQuoteRequest(planner.ctx, {
      occasionId,
      listingId: florist.listingId,
      arrangement: { description: "Aranjament de masă, alb și verde, fără crini.", imageAssetId: image.id, designRef: { designId: "dsn_abc123", version: 2 } },
      date: "2027-06-12",
      guests: 120,
      message: "Avem 12 mese rotunde.",
      idempotencyKey: `key-${newId()}`,
    });
    const [row] = await t.db.select().from(enquiries).where(eq(enquiries.id, sent.enquiryId));
    expect(row!.kind).toBe("quote_request");
    expect(Object.keys(row!.shared).sort()).toEqual(["arrangement", "date", "guests"]);
    expect(row!.shared).toEqual({
      arrangement: { description: "Aranjament de masă, alb și verde, fără crini.", imageAssetId: image.id, designRef: { designId: "dsn_abc123", version: 2 } },
      date: "2027-06-12",
      guests: 120,
    });
    expect(row!.emailShared).toBe(false);
    // the business reads the arrangement, the date, the guests and the message — nothing else
    const thread = await getBusinessThread(florist.owner.ctx, sent.enquiryId);
    expect(Object.keys(thread.shared).sort()).toEqual(["date", "description", "designRef", "guests", "imageUrl", "kind"]);
    expect(thread.shared).toMatchObject({ kind: "quote_request", date: "2027-06-12", guests: 120, designRef: { designId: "dsn_abc123", version: 2 } });
    expect(thread.messages.map((m) => m.body)).toEqual(["Avem 12 mese rotunde."]);
    expect(thread.sharedEmail).toBeNull();
    expect(JSON.stringify(thread)).not.toContain("flower-planner");
    // unknown keys are refused: nothing else can ride along
    await expect(
      sendQuoteRequest(planner.ctx, { occasionId, listingId: florist.listingId, arrangement: { description: "x" }, date: null, guests: null, message: "", idempotencyKey: `key-${newId()}`, budgetBand: "over_50000" } as never),
    ).rejects.toThrow();
    // only florists and stylists take quote requests
    const photographer = await mkLive("Foto Nu Flori");
    expect(
      (await failure(() => sendQuoteRequest(planner.ctx, { occasionId, listingId: photographer.listingId, arrangement: { description: "Buchet" }, date: null, guests: null, message: "", idempotencyKey: `key-${newId()}` }))).key,
    ).toBe("enquiries.errors.notFloral");
  });

  it("a PDF reply marks the booking as quoted; accepting lands it in the supplier record and the booking's agreed amount", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const florist = await mkLive("Florăria Ofertă", flori.id);
    const sent = await sendQuoteRequest(planner.ctx, {
      occasionId,
      listingId: florist.listingId,
      arrangement: { description: "Arcadă cu trandafiri", designRef: { designId: "dsn_arc", version: 1 } },
      date: "2027-06-12",
      guests: 120,
      message: "",
      idempotencyKey: `key-${newId()}`,
    });
    expect((await failure(() => replyAsBusiness(florist.owner.at(at(1)), { enquiryId: sent.enquiryId, body: "", quoteFile: { name: "oferta.pdf", bytes: Buffer.from("not a pdf") } }))).key).toBe("common.errors.VALIDATION");
    const reply = await replyAsBusiness(florist.owner.at(at(2)), { enquiryId: sent.enquiryId, body: "Oferta noastră, valabilă 30 de zile.", quoteFile: { name: "oferta.pdf", bytes: pdf() } });
    expect(reply.quoteAssetId).toBeTruthy();
    let [booking] = await t.db.select().from(bookings).where(eq(bookings.id, sent.bookingId));
    expect(booking).toMatchObject({ state: "quoted", quoteAssetId: reply.quoteAssetId, agreedMinor: null });
    const events = await t.db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, sent.bookingId));
    // recorded as a system transition: no business member's identity in the planner's booking history
    expect(events.find((e) => e.toState === "quoted")).toMatchObject({ actorKind: "system", actorId: null });

    const thread = await getPlannerThread(planner.at(at(3)), sent.enquiryId);
    const quoteMessage = thread.messages.find((m) => m.quote)!;
    expect(quoteMessage.quote).toMatchObject({ name: "oferta.pdf" });
    expect(quoteMessage.quote!.url).toContain("/api/media/");
    // the business can read its own quote back, without being a member of the occasion
    expect((await getBusinessThread(florist.owner.at(at(3)), sent.enquiryId)).messages.find((m) => m.quote)!.quote!.name).toBe("oferta.pdf");

    const accepted = await acceptQuote(planner.at(at(4)), { enquiryId: sent.enquiryId, messageId: quoteMessage.id, agreedAmount: "4.500" });
    expect(accepted).toEqual({ version: 1, bookingId: sent.bookingId });
    [booking] = await t.db.select().from(bookings).where(eq(bookings.id, sent.bookingId));
    expect(booking).toMatchObject({ state: "booked", agreedMinor: 450000, quoteAssetId: reply.quoteAssetId });
    // repeating the same acceptance is not a new version
    expect(await acceptQuote(planner.at(at(5)), { enquiryId: sent.enquiryId, messageId: quoteMessage.id, agreedAmount: "4.500" })).toEqual({ version: 1, bookingId: sent.bookingId });

    let link = (await getQuoteLink(planner.at(at(5)), { enquiryId: sent.enquiryId }))!;
    expect(link.current).toMatchObject({ version: 1, designRef: { designId: "dsn_arc", version: 1 }, agreedMinor: 450000, quoteAssetId: reply.quoteAssetId });
    expect(link.changes).toEqual([]);
    expect(link.designChangedSinceQuote).toBe(false);
    expect((await getQuoteLink(planner.at(at(5)), { bookingId: sent.bookingId }))!.enquiryId).toBe(sent.enquiryId);

    // a new quote, accepted: version 2, shown as a delta
    const reply2 = await replyAsBusiness(florist.owner.at(at(6)), { enquiryId: sent.enquiryId, body: "Ofertă revizuită.", quoteFile: { name: "oferta-v2.pdf", bytes: pdf() } });
    await acceptQuote(planner.at(at(7)), { enquiryId: sent.enquiryId, messageId: reply2.messageId, agreedAmount: "4.800" });
    link = (await getQuoteLink(planner.at(at(7)), { enquiryId: sent.enquiryId }))!;
    expect(link.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(link.changes).toEqual([
      { field: "quote", before: reply.quoteAssetId, after: reply2.quoteAssetId },
      { field: "amount", before: "450000", after: "480000" },
    ]);
    expect(await t.db.select().from(quoteLinks).where(eq(quoteLinks.enquiryId, sent.enquiryId))).toHaveLength(2);
    [booking] = await t.db.select().from(bookings).where(eq(bookings.id, sent.bookingId));
    expect(booking).toMatchObject({ agreedMinor: 480000, state: "booked" });

    // only a quote message can be accepted, and only by a manager of the occasion
    const plain = thread.messages.find((m) => !m.quote);
    if (plain) expect((await failure(() => acceptQuote(planner.ctx, { enquiryId: sent.enquiryId, messageId: plain.id }))).key).toBe("enquiries.errors.noQuote");
    expect((await failure(() => acceptQuote(florist.owner.ctx, { enquiryId: sent.enquiryId, messageId: quoteMessage.id }))).code).toBe("NOT_FOUND");
    expect((await failure(() => getQuoteLink(florist.owner.ctx, { enquiryId: sent.enquiryId }))).code).toBe("NOT_FOUND");
  });
});

describe("statistics from enquiry events (P31, INF11)", () => {
  it("received, answered = first business reply, median reply minutes; daily aggregates carry no identifiers", async () => {
    const planner = await mkAccount();
    const biz = await mkLive("Foto Statistic");
    const replies = [30, 90, 600];
    for (const minutes of replies) {
      const occasionId = await mkOccasion(planner.id);
      const sent = await sendEnquiry(planner.ctx, enquiry(occasionId, biz.listingId));
      await replyAsBusiness(biz.owner.at(new Date(T0.getTime() + minutes * 60_000)), { enquiryId: sent.enquiryId, body: "Răspuns" });
      // a second reply does not change the measured time
      await replyAsBusiness(biz.owner.at(at(40)), { enquiryId: sent.enquiryId, body: "Încă ceva" });
    }
    const unanswered = await mkOccasion(planner.id);
    await sendEnquiry(planner.ctx, enquiry(unanswered, biz.listingId));
    const numbers = await enquiryNumbers({ db: t.db }, { listingIds: [biz.listingId], until: at(100) });
    expect(numbers.get(biz.listingId)).toEqual({ received: 4, answered: 3, medianReplyMinutes: 90 });
    // "until" is honoured: before the slow reply only two were answered
    expect((await enquiryNumbers({ db: t.db }, { listingIds: [biz.listingId], until: at(5) })).get(biz.listingId)).toEqual({ received: 4, answered: 2, medianReplyMinutes: 60 });

    // the registered provider feeds the nightly listing statistics
    expect(await computeListingStats(systemCtx(t.db, { now: at(100) }), "2026-05-08", at(100))).toBeGreaterThan(0);

    const daily = await t.db.select().from(statsDaily);
    const mine = daily.filter((d) => d.metric.startsWith("enquiries."));
    expect(mine.length).toBeGreaterThan(0);
    for (const d of mine) expect(Object.keys(d.dimensions as object).every((k) => ["kind", "side"].includes(k))).toBe(true);
  });
});

describe("retention (INF6)", () => {
  it("threads go with the occasion; the identity-free stat events stay", async () => {
    const planner = await mkAccount();
    const occasionId = await mkOccasion(planner.id);
    const florist = await mkLive("Florăria Purjare", flori.id);
    const sent = await sendQuoteRequest(planner.ctx, { occasionId, listingId: florist.listingId, arrangement: { description: "Buchet" }, date: null, guests: null, message: "Salut", idempotencyKey: `key-${newId()}` });
    const reply = await replyAsBusiness(florist.owner.at(at(1)), { enquiryId: sent.enquiryId, body: "Ofertă", quoteFile: { name: "o.pdf", bytes: pdf() } });
    await acceptQuote(planner.at(at(2)), { enquiryId: sent.enquiryId, messageId: reply.messageId });
    const eventsBefore = await t.db.select().from(enquiryStatEvents).where(eq(enquiryStatEvents.listingId, florist.listingId));
    expect(eventsBefore).toHaveLength(1);

    await requestDeletion(planner.ctx, { targetType: "occasion", targetId: occasionId });
    const purged = await purgeDueOccasions(systemCtx(t.db, { now: at(24 * 9) }));
    expect(purged).toContain(occasionId);
    expect(await t.db.select().from(enquiries).where(eq(enquiries.occasionId, occasionId))).toHaveLength(0);
    expect(await t.db.select().from(enquiryMessages).where(eq(enquiryMessages.enquiryId, sent.enquiryId))).toHaveLength(0);
    expect(await t.db.select().from(quoteLinks).where(eq(quoteLinks.occasionId, occasionId))).toHaveLength(0);
    expect(await t.db.select().from(enquiryStatEvents).where(eq(enquiryStatEvents.listingId, florist.listingId))).toHaveLength(1);
    expect((await listBusinessEnquiries(florist.owner.ctx, florist.business.id, { state: "all" })).map((x) => x.id)).not.toContain(sent.enquiryId);
  });
});
