import {
  accounts,
  and,
  auditLog,
  businessFactChecks,
  businessNotices,
  businesses,
  categories,
  contentReports,
  eq,
  jobs,
  listingCategories,
  listingLocalities,
  listingRevisions,
  listings,
  localities,
  sessions,
  sql,
  staffMembers,
  type StaffRole,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  acceptBusinessInvite,
  assertBusinessCanCreate,
  canManageRole,
  createBusiness,
  getBusinessBadges,
  getBusinessView,
  inviteBusinessMember,
  isBusinessLapsed,
  listBusinessMembers,
  recordFactCheck,
  removeBusinessMember,
  requireBusinessMember,
  setBusinessStatus,
  updateBusinessMemberRole,
} from "../src/business";
import { accountCtx, anonymousCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { mergeLocality } from "../src/geography";
import {
  createListing,
  createUnclaimedListing,
  getListingEditor,
  listBusinessListings,
  saveListingDraft,
  submitListing,
  suspendListing,
  restoreListing,
  validateListingPayload,
} from "../src/listings";
import { decideRevision, getModerationRevision, listModerationQueue, setModerationTargetHours, submitForModeration } from "../src/moderation";
import { decideContentReport } from "../src/reports";

let t: TestDb;
let cat: string[] = [];
let cj: { id: string; slug: string }[] = [];
let ifov: { id: string; slug: string }[] = [];
let bSectors: { id: string }[] = [];

const T0 = new Date("2026-05-04T08:00:00Z");
let seq = 0;

beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
  cat = (await t.db.select().from(categories).orderBy(categories.sortOrder)).map((c) => c.id);
  cj = await t.db.select({ id: localities.id, slug: localities.slug }).from(localities).where(eq(localities.countyCode, "CJ")).orderBy(localities.sortOrder);
  ifov = await t.db.select({ id: localities.id, slug: localities.slug }).from(localities).where(eq(localities.countyCode, "IF")).orderBy(localities.sortOrder);
  bSectors = await t.db.select({ id: localities.id }).from(localities).where(eq(localities.countyCode, "B"));
});
afterAll(async () => {
  await t.close();
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (isAppError(e)) return e.code;
    if (e instanceof z.ZodError) return "VALIDATION"; // the action wrapper reports it the same way
    throw e;
  }
}
async function fieldErrors(p: Promise<unknown>): Promise<Record<string, string[]>> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return (e.details?.fieldErrors as Record<string, string[]>) ?? {};
    throw e;
  }
  return {};
}

async function mkAccount(opts: { anonymous?: boolean; fresh?: boolean } = {}): Promise<{ id: string; email: string | null; ctx: Ctx }> {
  const id = newId();
  const email = opts.anonymous ? null : `firma${++seq}@example.test`;
  await t.db.insert(accounts).values(opts.anonymous ? { id, kind: "anonymous", username: `anon${++seq}` } : { id, kind: "email", email });
  if (opts.fresh !== false) {
    await t.db.insert(sessions).values({
      accountId: id,
      tokenHash: newId(),
      lastSeenAt: T0,
      expiresAt: new Date(T0.getTime() + 30 * 86_400_000),
      freshAuthAt: new Date(T0.getTime() - 60_000),
    });
  }
  return { id, email, ctx: accountCtx(t.db, id, { now: T0 }) };
}

async function mkStaff(roles: StaffRole[], accountId?: string): Promise<Ctx> {
  const acc = accountId ?? (await mkAccount()).id;
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc, staffId: row!.id, roles }, { now: T0 });
}

const basePayload = () => ({
  name: `Foto Lumina ${++seq}`,
  descriptionRo: "Fotografie de eveniment în Cluj și împrejurimi, cu livrare în trei săptămâni.",
  categoryIds: [cat[7]!],
  countyCodes: ["CJ"],
  localityIds: [cj[0]!.id],
  contactPhone: "0264 123 456",
  website: "https://foto-lumina.example",
});

async function mkBusiness() {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `Firma ${++seq} SRL` });
  return { owner, business };
}

async function mkLiveListing(moderator: Ctx, overrides: Record<string, unknown> = {}) {
  const { owner, business } = await mkBusiness();
  const listing = await createListing(owner.ctx, { businessId: business.id, payload: { ...basePayload(), ...overrides } });
  const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
  await decideRevision(moderator, { id: revisionId, decision: "approve" });
  return { owner, business, listingId: listing.id, revisionId };
}

describe("business accounts (P1, P29)", () => {
  it("needs an email account; an anonymous account is told to add an email first", async () => {
    const anon = await mkAccount({ anonymous: true });
    await expect(createBusiness(anon.ctx, { name: "Fără email SRL" })).rejects.toMatchObject({ code: "FORBIDDEN", messageKey: "business.errors.emailRequired" });
    expect(await code(createBusiness(anonymousCtx(t.db), { name: "Nimeni SRL" }))).toBe("UNAUTHENTICATED");
  });

  it("creates the business with its owner, once per account; outsiders get NOT_FOUND", async () => {
    const { owner, business } = await mkBusiness();
    expect((await requireBusinessMember(owner.ctx, business.id)).role).toBe("owner");
    expect(await code(createBusiness(owner.ctx, { name: "A doua SRL" }))).toBe("CONFLICT");
    const stranger = await mkAccount();
    expect(await code(requireBusinessMember(stranger.ctx, business.id))).toBe("NOT_FOUND");
    expect(await code(getBusinessView(stranger.ctx, business.id))).toBe("NOT_FOUND");
  });
});

describe("team roles (P18)", () => {
  it("canManageRole: an admin cannot create or remove admins; nobody touches the owner role", () => {
    expect(canManageRole("owner", null, "admin")).toBe(true);
    expect(canManageRole("owner", "admin", null)).toBe(true);
    expect(canManageRole("owner", "staff", "admin")).toBe(true);
    expect(canManageRole("admin", null, "staff")).toBe(true);
    expect(canManageRole("admin", "staff", null)).toBe(true);
    expect(canManageRole("admin", null, "admin")).toBe(false);
    expect(canManageRole("admin", "staff", "admin")).toBe(false);
    expect(canManageRole("admin", "admin", null)).toBe(false);
    expect(canManageRole("admin", "admin", "staff")).toBe(false);
    expect(canManageRole("staff", null, "staff")).toBe(false);
    expect(canManageRole("owner", "owner", null)).toBe(false);
    expect(canManageRole("owner", "staff", "owner")).toBe(false);
  });

  it("enforces the rule end to end, and role changes need a fresh confirmation", async () => {
    const { owner, business } = await mkBusiness();
    const admin = await mkAccount();
    const staff = await mkAccount();
    const other = await mkAccount();
    const join = async (who: { email: string | null; ctx: Ctx }, role: "admin" | "staff", inviter: Ctx) => {
      await inviteBusinessMember(inviter, { businessId: business.id, email: who.email!, role });
      // the emailed token is only stored hashed: bind the invitation the way the link would
      const token = `tok-${newId()}-${newId()}`;
      const { hashToken } = await import("@ed/shared");
      await t.db.execute(sql`update business_members set invite_token_hash = ${hashToken(token)} where business_id = ${business.id} and invite_email = ${who.email}`);
      await acceptBusinessInvite(who.ctx, { token });
    };
    await join(admin, "admin", owner.ctx);
    await join(staff, "staff", admin.ctx);

    // admin → may not invite an admin, promote staff to admin, or remove an admin
    await expect(inviteBusinessMember(admin.ctx, { businessId: business.id, email: other.email!, role: "admin" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "business.errors.adminCannotManageAdmins",
    });
    const team = await listBusinessMembers(owner.ctx, business.id);
    const staffRow = team.find((m) => m.name === staff.email)!;
    const adminRow = team.find((m) => m.name === admin.email)!;
    expect(await code(updateBusinessMemberRole(admin.ctx, { businessId: business.id, memberId: staffRow.id, role: "admin" }))).toBe("FORBIDDEN");
    const second = await mkAccount();
    await join(second, "admin", owner.ctx);
    const secondRow = (await listBusinessMembers(owner.ctx, business.id)).find((m) => m.name === second.email)!;
    expect(await code(removeBusinessMember(admin.ctx, { businessId: business.id, memberId: secondRow.id }))).toBe("FORBIDDEN");
    // staff manage nobody
    expect(await code(inviteBusinessMember(staff.ctx, { businessId: business.id, email: other.email!, role: "staff" }))).toBe("FORBIDDEN");
    // the owner can; without a fresh confirmation the change is refused
    const stale = accountCtx(t.db, owner.id, { now: new Date(T0.getTime() + 3 * 3_600_000) });
    await expect(updateBusinessMemberRole(stale, { businessId: business.id, memberId: staffRow.id, role: "admin" })).rejects.toMatchObject({
      messageKey: "account.errors.freshAuthRequired",
    });
    await updateBusinessMemberRole(owner.ctx, { businessId: business.id, memberId: staffRow.id, role: "admin" });
    await removeBusinessMember(owner.ctx, { businessId: business.id, memberId: adminRow.id });
    expect(await code(requireBusinessMember(admin.ctx, business.id))).toBe("NOT_FOUND");
    // the owner cannot be removed
    const ownerRow = (await listBusinessMembers(owner.ctx, business.id)).find((m) => m.role === "owner")!;
    expect(await code(removeBusinessMember(owner.ctx, { businessId: business.id, memberId: ownerRow.id }))).toBe("FORBIDDEN");
  });

  it("an invitation only works for the invited email address", async () => {
    const { owner, business } = await mkBusiness();
    const invited = await mkAccount();
    const thief = await mkAccount();
    await inviteBusinessMember(owner.ctx, { businessId: business.id, email: invited.email!, role: "staff" });
    const token = `tok-${newId()}-${newId()}`;
    const { hashToken } = await import("@ed/shared");
    await t.db.execute(sql`update business_members set invite_token_hash = ${hashToken(token)} where business_id = ${business.id} and invite_email = ${invited.email}`);
    await expect(acceptBusinessInvite(thief.ctx, { token })).rejects.toMatchObject({ messageKey: "business.errors.inviteOtherEmail" });
    await acceptBusinessInvite(invited.ctx, { token });
    expect(await code(acceptBusinessInvite(invited.ctx, { token }))).toBe("NOT_FOUND");
  });
});

describe("listing picklists (P1, P2) — free text is impossible", () => {
  it("accepts a valid payload and normalises it", async () => {
    const { owner, business } = await mkBusiness();
    const p = await validateListingPayload(owner.ctx, { ...basePayload(), website: "https://exemplu.ro/pagina" }, { businessId: business.id, mode: "submit" });
    expect(p.categoryIds).toEqual([cat[7]]);
    expect(p.website).toBe("https://exemplu.ro/pagina");
    expect(p.descriptionEn).toBeNull();
  });

  it("rejects an unknown category, county or locality, and any typed place or category", async () => {
    const { owner, business } = await mkBusiness();
    const v = (over: Record<string, unknown>) => fieldErrors(validateListingPayload(owner.ctx, { ...basePayload(), ...over }, { businessId: business.id, mode: "submit" }));
    expect((await v({ categoryIds: ["Fotografi"] })).categoryIds).toContain("listings.errors.unknownCategory");
    expect((await v({ categoryIds: [newId()] })).categoryIds).toContain("listings.errors.unknownCategory");
    expect((await v({ countyCodes: ["Cluj"] })).countyCodes).toContain("listings.errors.unknownCounty");
    expect((await v({ countyCodes: ["ZZ"] })).countyCodes).toContain("listings.errors.unknownCounty");
    expect((await v({ localityIds: ["Cluj-Napoca"] })).localityIds).toContain("listings.errors.unknownLocality");
    // a free-text field that the shape does not know is refused outright
    expect((await v({ city: "Cluj-Napoca" }))._form).toContain("listings.errors.unknownField");
    expect((await v({ category: "Fotografi de nuntă" }))._form).toContain("listings.errors.unknownField");
  });

  it("rejects a locality outside the chosen counties, and a county without a locality", async () => {
    const { owner, business } = await mkBusiness();
    const v = (over: Record<string, unknown>) => fieldErrors(validateListingPayload(owner.ctx, { ...basePayload(), ...over }, { businessId: business.id, mode: "submit" }));
    expect((await v({ countyCodes: ["CJ"], localityIds: [cj[0]!.id, ifov[0]!.id] })).localityIds).toContain("listings.errors.localityOutsideCounties");
    expect((await v({ countyCodes: ["CJ", "IF"], localityIds: [cj[0]!.id] })).localityIds).toContain("listings.errors.countyWithoutLocality");
    expect(Object.keys(await v({ countyCodes: ["CJ", "IF"], localityIds: [cj[0]!.id, ifov[0]!.id] }))).toEqual([]);
  });

  it("enforces 1–5 categories, at most 5 counties and 1–20 localities", async () => {
    const { owner, business } = await mkBusiness();
    const v = (over: Record<string, unknown>) => fieldErrors(validateListingPayload(owner.ctx, { ...basePayload(), ...over }, { businessId: business.id, mode: "submit" }));
    expect((await v({ categoryIds: cat.slice(0, 6) })).categoryIds).toContain("listings.errors.tooManyCategories");
    expect((await v({ categoryIds: [] })).categoryIds).toContain("listings.errors.noCategory");
    expect(Object.keys(await v({ categoryIds: cat.slice(0, 5) }))).toEqual([]);
    expect((await v({ countyCodes: ["CJ", "IF", "B", "AB", "AR", "AG"] })).countyCodes).toContain("listings.errors.tooManyCounties");
    expect((await v({ countyCodes: ["IF"], localityIds: ifov.slice(0, 21).map((l) => l.id) })).localityIds).toContain("listings.errors.tooManyLocalities");
    expect(Object.keys(await v({ countyCodes: ["IF"], localityIds: ifov.slice(0, 20).map((l) => l.id) }))).toEqual([]);
    expect((await v({ localityIds: [] })).localityIds).toContain("listings.errors.noLocality");
  });

  it("accepts https websites only", async () => {
    const { owner, business } = await mkBusiness();
    const v = (website: string) => fieldErrors(validateListingPayload(owner.ctx, { ...basePayload(), website }, { businessId: business.id, mode: "submit" }));
    expect((await v("http://exemplu.ro")).website).toContain("listings.errors.websiteHttps");
    expect((await v("javascript:alert(1)")).website).toContain("listings.errors.websiteHttps");
    expect((await v("https://user:pass@exemplu.ro")).website).toContain("listings.errors.websiteHttps");
    expect((await v("exemplu.ro")).website).toContain("listings.errors.websiteHttps");
  });

  it("allows five listings per business and refuses the sixth", async () => {
    const { owner, business } = await mkBusiness();
    for (let i = 0; i < 5; i++) await createListing(owner.ctx, { businessId: business.id, payload: basePayload() });
    await expect(createListing(owner.ctx, { businessId: business.id, payload: basePayload() })).rejects.toMatchObject({
      code: "LIMIT",
      messageKey: "listings.errors.tooManyListings",
    });
    expect((await listBusinessListings(owner.ctx, business.id)).length).toBe(5);
  });
});

describe("moderation (P3, W2)", () => {
  it("a new listing is not live until approved; approval writes the live content", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, business } = await mkBusiness();
    const listing = await createListing(owner.ctx, { businessId: business.id, payload: basePayload() });
    expect(listing.status).toBe("draft");
    const { revisionId, listing: after } = await submitListing(owner.ctx, { listingId: listing.id });
    expect(after.status).toBe("pending");
    expect((await t.db.select().from(listingCategories).where(eq(listingCategories.listingId, listing.id))).length).toBe(0);
    const queue = await listModerationQueue(moderator);
    expect(queue.items.some((i) => i.id === revisionId && !i.isEdit)).toBe(true);
    await decideRevision(moderator, { id: revisionId, decision: "approve" });
    const [live] = await t.db.select().from(listings).where(eq(listings.id, listing.id));
    expect(live!.status).toBe("live");
    expect(live!.liveRevisionId).toBe(revisionId);
    expect((await t.db.select().from(listingCategories).where(eq(listingCategories.listingId, listing.id))).length).toBe(1);
    const locs = await t.db.select().from(listingLocalities).where(eq(listingLocalities.listingId, listing.id));
    expect(locs.map((l) => l.countyCode)).toEqual(["CJ"]);
  });

  it("the live version stays up, unchanged, while an edit is pending — and after a rejection", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, listingId } = await mkLiveListing(moderator);
    const [before] = await t.db.select().from(listings).where(eq(listings.id, listingId));
    const edited = { ...basePayload(), name: "Nume nou neaprobat", categoryIds: [cat[7]!, cat[8]!] };
    const { revisionId } = await submitListing(owner.ctx, { listingId, payload: edited });
    const [during] = await t.db.select().from(listings).where(eq(listings.id, listingId));
    expect(during!.status).toBe("live");
    expect(during!.name).toBe(before!.name);
    expect((await t.db.select().from(listingCategories).where(eq(listingCategories.listingId, listingId))).length).toBe(1);
    const editor = await getListingEditor(owner.ctx, listingId);
    expect(editor.live?.name).toBe(before!.name);
    expect(editor.pending?.payload.name).toBe("Nume nou neaprobat");

    // rejection: reason is mandatory, stored, and shown to the business; live still unchanged
    expect(await code(decideRevision(moderator, { id: revisionId, decision: "reject" }))).toBe("VALIDATION");
    await decideRevision(moderator, { id: revisionId, decision: "reject", reason: "Numele nu corespunde firmei înregistrate." });
    const [rev] = await t.db.select().from(listingRevisions).where(eq(listingRevisions.id, revisionId));
    expect(rev!.state).toBe("rejected");
    expect(rev!.decisionReason).toBe("Numele nu corespunde firmei înregistrate.");
    const [afterReject] = await t.db.select().from(listings).where(eq(listings.id, listingId));
    expect(afterReject!.name).toBe(before!.name);
    expect(afterReject!.status).toBe("live");
    const after = await getListingEditor(owner.ctx, listingId);
    expect(after.lastRejection?.reason).toBe("Numele nu corespunde firmei înregistrate.");
    expect(after.draft?.name).toBe("Nume nou neaprobat"); // nothing typed is lost
    const notices = await t.db.select().from(businessNotices).where(eq(businessNotices.listingId, listingId));
    expect(notices.some((n) => n.kind === "revision.rejected" && n.reason === "Numele nu corespunde firmei înregistrate.")).toBe(true);
  });

  it("a moderator who is a member of the business gets FORBIDDEN; so does a non-moderator", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, business } = await mkBusiness();
    const insider = await mkStaff(["listing_moderator"], owner.id);
    const listing = await createListing(owner.ctx, { businessId: business.id, payload: basePayload() });
    const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
    await expect(decideRevision(insider, { id: revisionId, decision: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN", messageKey: "moderation.errors.ownBusiness" });
    expect((await getModerationRevision(insider, revisionId)).blockedReason).toBe("ownBusiness");
    const admin = await mkStaff(["platform_admin"]);
    expect(await code(decideRevision(admin, { id: revisionId, decision: "approve" }))).toBe("FORBIDDEN");
    expect(await code(decideRevision(owner.ctx, { id: revisionId, decision: "approve" }))).toBe("FORBIDDEN");
    const [still] = await t.db.select().from(listings).where(eq(listings.id, listing.id));
    expect(still!.status).toBe("pending");
    await decideRevision(moderator, { id: revisionId, decision: "approve" });
  });

  it("a decided revision is immutable — in core and in the database", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { revisionId } = await mkLiveListing(moderator);
    expect(await code(decideRevision(moderator, { id: revisionId, decision: "reject", reason: "M-am răzgândit după aprobare." }))).toBe("CONFLICT");
    await expect(t.db.update(listingRevisions).set({ decisionReason: "altceva" }).where(eq(listingRevisions.id, revisionId))).rejects.toThrow();
    await expect(t.db.update(listingRevisions).set({ state: "pending" }).where(eq(listingRevisions.id, revisionId))).rejects.toThrow();
  });

  it("submitting again while waiting replaces the waiting content and keeps one row", async () => {
    const { owner, business } = await mkBusiness();
    const listing = await createListing(owner.ctx, { businessId: business.id, payload: basePayload() });
    const first = await submitListing(owner.ctx, { listingId: listing.id });
    const second = await submitListing(owner.ctx, { listingId: listing.id, payload: { ...basePayload(), name: "A doua variantă" } });
    expect(second.revisionId).toBe(first.revisionId);
    const rows = await t.db.select().from(listingRevisions).where(eq(listingRevisions.subjectId, listing.id));
    expect(rows.length).toBe(1);
    expect((rows[0]!.payload as { name: string }).name).toBe("A doua variantă");
  });

  it("the queue measures waiting time against the operator's target; only a platform admin sets it", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const admin = await mkStaff(["platform_admin"]);
    expect(await code(setModerationTargetHours(moderator, { hours: 24 }))).toBe("FORBIDDEN");
    await setModerationTargetHours(admin, { hours: 24 });
    const { owner, business } = await mkBusiness();
    const listing = await createListing(owner.ctx, { businessId: business.id, payload: basePayload() });
    const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
    const later = { ...moderator, now: new Date(T0.getTime() + 25 * 3_600_000) };
    const q = await listModerationQueue(later);
    expect(q.targetHours).toBe(24);
    const item = q.items.find((i) => i.id === revisionId)!;
    expect(item.waitingMinutes).toBe(25 * 60);
    expect(item.overdue).toBe(true);
    expect((await listModerationQueue(moderator)).items.find((i) => i.id === revisionId)!.overdue).toBe(false);
    const detail = await getModerationRevision(moderator, revisionId);
    expect(detail.description.fields.find((f) => f.key === "categories")?.after).toBe("Fotografi");
    expect(detail.description.fields.find((f) => f.key === "localities")?.after).toBe("Cluj-Napoca");
  });

  it("other content kinds reuse the same queue through registerModerationKind", async () => {
    const { registerModerationKind } = await import("../src/moderation");
    const applied: string[] = [];
    registerModerationKind("test_drawing", {
      labelKey: "moderation.kinds.listing",
      describe: async (_ctx, rev) => ({ title: `Plan ${rev.subjectId}`, fields: [] }),
      apply: async (_tx, rev) => {
        applied.push(rev.subjectId);
      },
    });
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, business } = await mkBusiness();
    const stranger = await mkAccount();
    expect(await code(submitForModeration(stranger.ctx, { kind: "test_drawing", subjectId: "d1", payload: { a: 1 }, businessId: business.id }))).toBe("NOT_FOUND");
    const rev = await submitForModeration(owner.ctx, { kind: "test_drawing", subjectId: "d1", payload: { a: 1 }, businessId: business.id });
    expect((await listModerationQueue(moderator)).items.find((i) => i.id === rev.id)?.title).toBe("Plan d1");
    await decideRevision(moderator, { id: rev.id, decision: "approve" });
    expect(applied).toEqual(["d1"]);
  });
});

describe("factual badges (P4)", () => {
  it("only the two kinds can be stored; the database refuses any other", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { business } = await mkBusiness();
    const staffId = (moderator.actor as { staffId: string }).staffId;
    await expect(
      t.db.insert(businessFactChecks).values({ businessId: business.id, kind: "verified" as never, staffId, seen: "ceva", checkedAt: T0 }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(businessFactChecks).values({ businessId: business.id, kind: "top_rated" as never, staffId, seen: "ceva", checkedAt: T0 }),
    ).rejects.toThrow();
  });

  it("a moderator records what was seen; badges follow the record and the insurance one expires", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, business } = await mkBusiness();
    expect(getBusinessBadges(business, T0)).toEqual([]);
    // no ONRC number stated → nothing to check
    expect(await code(recordFactCheck(moderator, { businessId: business.id, kind: "onrc", seen: "Extras ONRC 123" }))).toBe("CONFLICT");
    await t.db.update(businesses).set({ onrcRegistration: "J12/345/2020" }).where(eq(businesses.id, business.id));
    await recordFactCheck(moderator, { businessId: business.id, kind: "onrc", seen: "Extras ONRC nr. 123 din 02.05.2026" });
    expect(await code(recordFactCheck(moderator, { businessId: business.id, kind: "insurance", seen: "Poliță Allianz 99" }))).toBe("VALIDATION");
    await recordFactCheck(moderator, { businessId: business.id, kind: "insurance", seen: "Poliță Allianz 99", validUntil: "2026-12-31" });
    const [b] = await t.db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(getBusinessBadges(b!, T0)).toEqual([{ kind: "onrc" }, { kind: "insurance", validUntil: "2026-12-31" }]);
    expect(getBusinessBadges(b!, new Date("2027-01-02T10:00:00Z"))).toEqual([{ kind: "onrc" }]);
    const checks = await t.db.select().from(businessFactChecks).where(eq(businessFactChecks.businessId, business.id));
    expect(checks.map((c) => c.kind).sort()).toEqual(["insurance", "onrc"]);
    expect(checks.every((c) => c.staffId && c.seen.length > 0)).toBe(true);
    // not by the business itself, not by a moderator who works there, not by other roles
    expect(await code(recordFactCheck(owner.ctx, { businessId: business.id, kind: "onrc", seen: "Eu însumi" }))).toBe("FORBIDDEN");
    const insider = await mkStaff(["listing_moderator"], owner.id);
    expect(await code(recordFactCheck(insider, { businessId: business.id, kind: "onrc", seen: "Colegul meu" }))).toBe("FORBIDDEN");
    const admin = await mkStaff(["platform_admin"]);
    expect(await code(recordFactCheck(admin, { businessId: business.id, kind: "onrc", seen: "Extras ONRC" }))).toBe("FORBIDDEN");
  });
});

describe("restriction and suspension (W3)", () => {
  it("is data with a recorded reason, visible to the business, and blocks new content", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, business, listingId } = await mkLiveListing(moderator);
    expect(await code(setBusinessStatus(moderator, { businessId: business.id, status: "restricted" }))).toBe("VALIDATION");
    await setBusinessStatus(moderator, { businessId: business.id, status: "restricted", reason: "Descrieri înșelătoare raportate de trei ori." });
    // a brand-new ctx (another "session") still sees it: it is stored, not remembered
    const view = await getBusinessView(accountCtx(t.db, owner.id, { now: new Date(T0.getTime() + 86_400_000) }), business.id);
    expect(view.business.status).toBe("restricted");
    expect(view.business.restrictionReason).toBe("Descrieri înșelătoare raportate de trei ori.");
    expect(view.notices.some((n) => n.kind === "business.restricted")).toBe(true);
    expect(await code(createListing(owner.ctx, { businessId: business.id, payload: basePayload() }))).toBe("FORBIDDEN");
    expect(await code(submitListing(owner.ctx, { listingId, payload: basePayload() }))).toBe("FORBIDDEN");
    const mail = await t.db.select().from(jobs).where(eq(jobs.name, "business.notice-email"));
    expect(mail.some((j) => (j.payload as { businessId: string }).businessId === business.id)).toBe(true);
    const audit = await t.db.select().from(auditLog).where(and(eq(auditLog.objectId, business.id), eq(auditLog.action, "business.restricted")));
    expect(audit.length).toBe(1);
    await setBusinessStatus(moderator, { businessId: business.id, status: "active" });
    expect((await getBusinessView(owner.ctx, business.id)).business.restrictionReason).toBeNull();
    expect(await code(setBusinessStatus(owner.ctx, { businessId: business.id, status: "active" }))).toBe("FORBIDDEN");
  });

  it("a listing can be suspended and restored to what it was", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, listingId } = await mkLiveListing(moderator);
    await suspendListing(moderator, { listingId, reason: "Fotografii care nu aparțin firmei." });
    const editor = await getListingEditor(owner.ctx, listingId);
    expect(editor.listing.status).toBe("suspended");
    expect(editor.listing.suspensionReason).toBe("Fotografii care nu aparțin firmei.");
    expect(editor.canEdit).toBe(false);
    expect(await code(saveListingDraft(owner.ctx, { listingId, payload: basePayload() }))).toBe("CONFLICT");
    await restoreListing(moderator, { listingId });
    expect((await getListingEditor(owner.ctx, listingId)).listing.status).toBe("live");
  });

  it("an actioned content report suspends the listing and delivers the reason to the business", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { business, listingId } = await mkLiveListing(moderator);
    const mkReport = async (targetType: string, targetId: string) => {
      const [r] = await t.db
        .insert(contentReports)
        .values({ reference: `R-${newId().slice(0, 8).toUpperCase()}`, targetRef: "listare", targetType, targetId, reasonCategory: "other" as never, description: "Conținut ilegal raportat de un vizitator.", state: "received" })
        .returning();
      return r!.id;
    };
    const dismissed = await mkReport("listing", listingId);
    await decideContentReport(moderator, { id: dismissed, decision: "dismissed", reasonGivenToAffected: "Raportul nu se confirmă după verificare." });
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.status).toBe("live");

    const actioned = await mkReport("listing", listingId);
    await decideContentReport(moderator, { id: actioned, decision: "actioned", reasonGivenToAffected: "Listarea promovează un serviciu neautorizat." });
    const [l] = await t.db.select().from(listings).where(eq(listings.id, listingId));
    expect(l!.status).toBe("suspended");
    expect(l!.suspensionReason).toBe("Listarea promovează un serviciu neautorizat.");
    const notices = await t.db.select().from(businessNotices).where(eq(businessNotices.businessId, business.id));
    expect(notices.some((n) => n.kind === "listing.suspended" && n.reason === "Listarea promovează un serviciu neautorizat.")).toBe(true);

    const onBusiness = await mkReport("business", business.id);
    await decideContentReport(moderator, { id: onBusiness, decision: "actioned", reasonGivenToAffected: "Firma a publicat repetat conținut ilegal." });
    const [b] = await t.db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(b!.status).toBe("restricted");
    expect(b!.restrictionReason).toBe("Firma a publicat repetat conținut ilegal.");
  });
});

describe("lapse groundwork (P23, invariant 8)", () => {
  it("blocks new listings only; existing ones stay live and can be corrected", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const { owner, business, listingId } = await mkLiveListing(moderator);
    await t.db.update(businesses).set({ planLapsedAt: T0 }).where(eq(businesses.id, business.id));
    const [b] = await t.db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(isBusinessLapsed(b!)).toBe(true);
    await expect(assertBusinessCanCreate(owner.ctx, business.id)).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });
    expect(await code(createListing(owner.ctx, { businessId: business.id, payload: basePayload() }))).toBe("FORBIDDEN");
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.status).toBe("live");
    const { revisionId } = await submitListing(owner.ctx, { listingId, payload: { ...basePayload(), name: "Corectură după expirare" } });
    await decideRevision(moderator, { id: revisionId, decision: "approve" });
    expect((await t.db.select().from(listings).where(eq(listings.id, listingId)))[0]!.name).toBe("Corectură după expirare");
  });
});

describe("unclaimed listings (P29, BD2) and W4 merges", () => {
  it("an unclaimed draft is never public until approved, and its creator cannot approve it", async () => {
    const creator = await mkStaff(["listing_moderator"]);
    const other = await mkStaff(["listing_moderator"]);
    const { listingId, revisionId } = await createUnclaimedListing(creator, {
      name: "Sala Panoramic",
      categoryIds: [cat[0]!],
      localityIds: [bSectors[0]!.id],
      publicContactRoute: "Telefon 021 555 01 23 (de pe site-ul propriu)",
      sourceUrl: "https://sala-panoramic.example/contact",
    });
    const [draft] = await t.db.select().from(listings).where(eq(listings.id, listingId));
    expect(draft).toMatchObject({ status: "pending", claimed: false, businessId: null });
    expect(await code(decideRevision(creator, { id: revisionId, decision: "approve" }))).toBe("FORBIDDEN");
    await decideRevision(other, { id: revisionId, decision: "approve" });
    const [live] = await t.db.select().from(listings).where(eq(listings.id, listingId));
    expect(live).toMatchObject({ status: "live", claimed: false, publicContactRoute: "Telefon 021 555 01 23 (de pe site-ul propriu)" });
    // system (discovery) can create too; ordinary accounts cannot
    const acc = await mkAccount();
    const input = { name: "Alt loc", categoryIds: [cat[0]!], localityIds: [bSectors[1]!.id], publicContactRoute: "Str. Exemplu 1", sourceUrl: "https://alt.example" };
    expect(await code(createUnclaimedListing(acc.ctx, input))).toBe("FORBIDDEN");
    expect((await createUnclaimedListing(systemCtx(t.db, { now: T0 }), input)).listingId).toBeTruthy();
  });

  it("merging a locality keeps every listing attached, without duplicates", async () => {
    const moderator = await mkStaff(["listing_moderator"]);
    const from = ifov[10]!;
    const into = ifov[11]!;
    const a = await mkLiveListing(moderator, { countyCodes: ["IF"], localityIds: [from.id] });
    const b = await mkLiveListing(moderator, { countyCodes: ["IF"], localityIds: [from.id, into.id] });
    // a waiting edit that still names the old locality
    const pendingEdit = await submitListing(a.owner.ctx, { listingId: a.listingId, payload: { ...basePayload(), countyCodes: ["IF"], localityIds: [from.id] } });
    const res = await mergeLocality(moderator, { fromId: from.id, intoId: into.id });
    expect(res.listingsMoved).toBe(2);
    const la = await t.db.select().from(listingLocalities).where(eq(listingLocalities.listingId, a.listingId));
    expect(la.map((x) => x.localityId)).toEqual([into.id]);
    const lb = await t.db.select().from(listingLocalities).where(eq(listingLocalities.listingId, b.listingId));
    expect(lb.map((x) => x.localityId)).toEqual([into.id]);
    const [old] = await t.db.select().from(localities).where(eq(localities.id, from.id));
    expect(old).toMatchObject({ active: false, mergedIntoId: into.id });
    // the waiting edit is resolved to the surviving locality on approval
    await decideRevision(moderator, { id: pendingEdit.revisionId, decision: "approve" });
    const after = await t.db.select().from(listingLocalities).where(eq(listingLocalities.listingId, a.listingId));
    expect(after.map((x) => x.localityId)).toEqual([into.id]);
    // the retired locality is no longer offered to new listings
    const { owner, business } = await mkBusiness();
    const errs = await fieldErrors(validateListingPayload(owner.ctx, { ...basePayload(), countyCodes: ["IF"], localityIds: [from.id] }, { businessId: business.id, mode: "submit" }));
    expect(Object.keys(errs)).toEqual([]); // follows the merge instead of failing
  });
});
