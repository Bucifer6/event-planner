import {
  accounts,
  auditLog,
  businessLibraryLinks,
  businessMembers,
  businessOccasionSeats,
  businesses,
  eq,
  mcpTokens,
  occasionHandovers,
  occasionMembers,
  occasions,
  sessions,
  statsDaily,
  suppliers,
  taskCheckItems,
  tasks,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { uploadAsset } from "@ed/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMember, requireMember } from "../src/access";
import {
  createBusinessOccasion,
  ensureBusinessSeat,
  getBusinessOccasionContext,
  getBusinessReport,
  getOccasionBranding,
  listBusinessOccasions,
  readableOn,
  recordAssetUse,
  saveBranding,
  saveTeamGrants,
} from "../src/bizoccasions";
import { canManageRole, createBusiness, removeBusinessMember, setBusinessStatus, updateBusinessMemberRole } from "../src/business";
import { accountCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { createHousehold } from "../src/guests";
import { listHandoverCandidates, proposeHandover } from "../src/handover";
import { getGuestView, resolveGuestLink } from "../src/invitations";
import { archiveLibraryItem, createLibraryItem, listLibrary, listOccasionLibraryFiles, parseTemplateLines, proposeLibraryApply, shareLibraryFile } from "../src/library";
import { createListing } from "../src/listings";
import { BUSINESS_PLAN_CAPABILITIES, PERMANENT_FREE_TIER } from "../src/monetization";
import { getOccasion, updateOccasion } from "../src/occasions";
import { createTask, queryTasks } from "../src/tasks";
import { confirmPreview } from "../src/whatif";

let t: TestDb;
const T0 = new Date("2026-05-04T08:00:00Z");
let seq = 0;

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  process.env.APP_URL ??= "https://app.example.test";
  process.env.MEDIA_URL ??= "https://media.example.test";
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography", "templates"]);
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
    throw e;
  }
}

async function mkAccount(fresh = true): Promise<{ id: string; email: string; ctx: Ctx }> {
  const id = newId();
  const email = `om${++seq}@example.test`;
  await t.db.insert(accounts).values({ id, kind: "email", email });
  if (fresh) {
    await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000), freshAuthAt: new Date(T0.getTime() - 60_000) });
  }
  return { id, email, ctx: accountCtx(t.db, id, { now: T0 }) };
}

async function mkTeam() {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `Agenția ${++seq} SRL` });
  const join = async (role: "admin" | "staff") => {
    const person = await mkAccount();
    await t.db.insert(businessMembers).values({ businessId: business.id, accountId: person.id, role });
    return person;
  };
  return { owner, business, admin: await join("admin"), staff: await join("staff") };
}

/** A client who is a normal, joined member of the occasion. */
async function addClient(occasionId: string, role: "pm" | "contributor" = "contributor") {
  const client = await mkAccount();
  const [row] = await t.db.insert(occasionMembers).values({ occasionId, accountId: client.id, role }).returning();
  return { ...client, memberId: row!.id };
}

const occasionInput = (title: string) => ({ title, kind: "nunta" as const, dateMode: "date" as const, startsOn: "2027-06-12" });

describe("business occasions (P17, P18)", () => {
  it("any active member creates one; it has the full planning features; non-members see nothing", async () => {
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.staff.ctx, { businessId: team.business.id, occasion: occasionInput("Nunta Mara & Vlad") });
    expect(occ.businessId).toBe(team.business.id);
    // the template ran: it is an ordinary occasion with its tasks
    expect((await t.db.select().from(tasks).where(eq(tasks.occasionId, occ.id))).length).toBeGreaterThan(5);
    await queryTasks(team.staff.ctx, occ.id, {});
    const outsider = await mkAccount();
    expect(await code(createBusinessOccasion(outsider.ctx, { businessId: team.business.id, occasion: occasionInput("x y") }))).toBe("NOT_FOUND");
    expect(await getMember(outsider.ctx, occ.id)).toBeNull();
    const list = await listBusinessOccasions(team.owner.ctx, team.business.id);
    expect(list.running.map((r) => r.id)).toEqual([occ.id]);
    expect(await code(listBusinessOccasions(outsider.ctx, team.business.id))).toBe("NOT_FOUND");
  });

  it("the team reaches it through membership: a synthetic manager with the business's grants", async () => {
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.staff.ctx, { businessId: team.business.id, occasion: occasionInput("Botez Ilinca") });
    const creator = await requireMember(team.staff.ctx, occ.id);
    expect(creator.role).toBe("owner");
    expect(creator.viaBusiness).toBeUndefined();
    const admin = await requireMember(team.admin.ctx, occ.id, { manage: true });
    expect(admin).toMatchObject({ role: "pm", grants: { finance: true, privateRequests: false } });
    expect(admin.viaBusiness?.businessId).toBe(team.business.id);
    expect(admin.id.startsWith("bm_")).toBe(true);
    // a manager can work: edit the occasion, add a task
    await updateOccasion(team.admin.ctx, { occasionId: occ.id, venueName: "Conacul Polizu" });
    await createTask(team.admin.ctx, { occasionId: occ.id, title: "Sună florăria" });
    expect(await code(requireMember(team.admin.ctx, occ.id, { grant: "privateRequests" }))).toBe("FORBIDDEN");

    // the owner changes what the team path carries
    expect(await code(saveTeamGrants(team.admin.ctx, { businessId: team.business.id, finance: false, privateRequests: true }))).toBe("FORBIDDEN");
    // S4 (security review 14 Nov 2026, F-08): a capability grant needs a FRESH confirmation — an hour-old one is refused
    const staleOwner = { ...team.owner.ctx, now: new Date(T0.getTime() + 60 * 60_000) };
    const stale = await saveTeamGrants(staleOwner, { businessId: team.business.id, finance: false, privateRequests: true }).catch((e) => e);
    expect(stale).toMatchObject({ code: "FORBIDDEN", messageKey: "account.errors.freshAuthRequired" });
    expect((await requireMember(team.admin.ctx, occ.id)).grants).toEqual({ finance: true, privateRequests: false });
    await saveTeamGrants(team.owner.ctx, { businessId: team.business.id, finance: false, privateRequests: true });
    expect((await requireMember(team.admin.ctx, occ.id)).grants).toEqual({ finance: false, privateRequests: true });

    // an ordinary occasion of the same person is untouched by any of this
    const personal = await mkAccount();
    expect(await getMember(team.admin.ctx, (await (await import("../src/occasions")).createOccasion(personal.ctx, { title: "Aniversare", kind: "blank", dateMode: "poll" })).id)).toBeNull();
  });

  it("a seat gives a real member row; leaving the business ends both paths", async () => {
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.owner.ctx, { businessId: team.business.id, occasion: occasionInput("Nunta Seat") });
    const seat = await ensureBusinessSeat(team.staff.ctx, occ.id);
    expect((await ensureBusinessSeat(team.staff.ctx, occ.id)).occasionMemberId).toBe(seat.occasionMemberId); // idempotent
    const m = await requireMember(team.staff.ctx, occ.id);
    expect(m.id).toBe(seat.occasionMemberId);
    expect(m.viaBusiness).toBeUndefined();
    await createTask(team.staff.ctx, { occasionId: occ.id, title: "A mea", owner: "me" });
    expect((await getBusinessOccasionContext(team.staff.ctx, occ.id))?.hasSeat).toBe(true);

    const [bm] = await t.db.select().from(businessMembers).where(eq(businessMembers.accountId, team.staff.id));
    await removeBusinessMember(team.owner.ctx, { businessId: team.business.id, memberId: bm!.id });
    expect(await getMember(team.staff.ctx, occ.id)).toBeNull(); // the seat died with the membership
    // the admin (no seat) too, once removed
    const [bm2] = await t.db.select().from(businessMembers).where(eq(businessMembers.accountId, team.admin.id));
    expect(await getMember(team.admin.ctx, occ.id)).not.toBeNull();
    await removeBusinessMember(team.owner.ctx, { businessId: team.business.id, memberId: bm2!.id });
    expect(await getMember(team.admin.ctx, occ.id)).toBeNull();
  });

  it("a suspended business loses the team path; the client keeps the occasion", async () => {
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.owner.ctx, { businessId: team.business.id, occasion: occasionInput("Nunta W3") });
    const client = await addClient(occ.id, "pm");
    const staffAcc = await mkAccount();
    const [row] = await t.db.insert((await import("@ed/db")).staffMembers).values({ accountId: staffAcc.id, roles: ["listing_moderator"] }).returning();
    const moderator = makeCtx(t.db, { kind: "staff", accountId: staffAcc.id, staffId: row!.id, roles: ["listing_moderator"] }, { now: T0 });
    await setBusinessStatus(moderator, { businessId: team.business.id, status: "suspended", reason: "Verificare în curs, motiv de test." });
    expect(await getMember(team.admin.ctx, occ.id)).toBeNull();
    expect(await getMember(team.owner.ctx, occ.id)).toBeNull();
    expect((await requireMember(client.ctx, occ.id)).role).toBe("pm");
    expect(await getOccasionBranding(client.ctx, occ.id)).toBeNull();
  });

  it("P18: an admin cannot make or remove admins", async () => {
    expect(canManageRole("admin", "staff", "admin")).toBe(false);
    expect(canManageRole("admin", "admin", null)).toBe(false);
    const team = await mkTeam();
    const [staffRow] = await t.db.select().from(businessMembers).where(eq(businessMembers.accountId, team.staff.id));
    expect(await code(updateBusinessMemberRole(team.admin.ctx, { businessId: team.business.id, memberId: staffRow!.id, role: "admin" }))).toBe("FORBIDDEN");
  });
});

describe("shared library (P19)", () => {
  it("templates, checklists and contacts are applied through What-if, once", async () => {
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.owner.ctx, { businessId: team.business.id, occasion: { title: "Petrecere firmă", kind: "blank", dateMode: "date", startsOn: "2027-06-12" } });
    expect(parseTemplateLines("Alege locația; 6\n\nTrimite invitațiile ; 2\nProbă meniu").map((x) => [x.title, x.offsetMonths])).toEqual([["Alege locația", 6], ["Trimite invitațiile", 2], ["Probă meniu", 0]]);
    const tpl = await createLibraryItem(team.staff.ctx, { businessId: team.business.id, item: { kind: "template", title: "Nuntă clasică", lines: "Alege locația; 6\nTrimite invitațiile; 2\nProbă meniu" } });
    const check = await createLibraryItem(team.staff.ctx, { businessId: team.business.id, item: { kind: "checklist", title: "Ziua dinainte", lines: "Confirmă florile\nVerifică sonorizarea" } });
    const contact = await createLibraryItem(team.admin.ctx, { businessId: team.business.id, item: { kind: "contact", title: "Florăria Iris", category: "Flori", person: "Ioana", email: "IRIS@example.test", phone: "0722 000 111" } });
    expect((await listLibrary(team.staff.ctx, team.business.id)).items.map((i) => i.kind).sort()).toEqual(["checklist", "contact", "template"]);

    const preview = await proposeLibraryApply(team.admin.ctx, { itemId: tpl.id, occasionId: occ.id });
    expect(preview.state).toBe("pending");
    expect(preview.delta.filter((d) => !d.key.startsWith("_"))).toHaveLength(3);
    expect(await t.db.select().from(tasks).where(eq(tasks.occasionId, occ.id))).toHaveLength(0); // nothing until confirmed
    await confirmPreview(team.admin.ctx, preview.id);
    const made = await t.db.select().from(tasks).where(eq(tasks.occasionId, occ.id));
    expect(made.map((m) => m.title).sort()).toEqual(["Alege locația", "Probă meniu", "Trimite invitațiile"]);
    expect(made.find((m) => m.title === "Alege locația")!.dueAt!.toISOString().slice(0, 10)).toBe("2026-12-12");
    // applying it again adds nothing
    const again = await proposeLibraryApply(team.admin.ctx, { itemId: tpl.id, occasionId: occ.id });
    await confirmPreview(team.admin.ctx, again.id);
    expect(await t.db.select().from(tasks).where(eq(tasks.occasionId, occ.id))).toHaveLength(3);

    await confirmPreview(team.owner.ctx, (await proposeLibraryApply(team.owner.ctx, { itemId: check.id, occasionId: occ.id })).id);
    const [checkTask] = await t.db.select().from(tasks).where(eq(tasks.templateTaskKey, `lib:${check.id}`));
    expect((await t.db.select().from(taskCheckItems).where(eq(taskCheckItems.taskId, checkTask!.id))).map((c) => c.label)).toEqual(["Confirmă florile", "Verifică sonorizarea"]);

    await confirmPreview(team.owner.ctx, (await proposeLibraryApply(team.owner.ctx, { itemId: contact.id, occasionId: occ.id })).id);
    const [sup] = await t.db.select().from(suppliers).where(eq(suppliers.occasionId, occ.id));
    expect(sup).toMatchObject({ name: "Florăria Iris", contactEmail: "iris@example.test" });

    // not on another business's occasion, not by outsiders
    const other = await mkTeam();
    const foreign = await createBusinessOccasion(other.owner.ctx, { businessId: other.business.id, occasion: occasionInput("Alt client") });
    expect(await code(proposeLibraryApply(team.owner.ctx, { itemId: tpl.id, occasionId: foreign.id }))).toBe("NOT_FOUND");
    expect(await code(proposeLibraryApply(other.owner.ctx, { itemId: tpl.id, occasionId: foreign.id }))).toBe("NOT_FOUND");
    expect(await code(listLibrary(other.owner.ctx, team.business.id))).toBe("NOT_FOUND");

    // P21 / D4: use is counted as a daily total with no visitor identifier
    const stats = await t.db.select().from(statsDaily).where(eq(statsDaily.metric, "asset.use"));
    const mine = stats.filter((s) => s.dimensions.business === team.business.id);
    expect(mine.reduce((a, s) => a + s.value, 0)).toBe(4);
    for (const s of mine) expect(Object.keys(s.dimensions).sort()).toEqual(["business", "item", "kind"]);
    const report = await getBusinessReport(team.staff.ctx, team.business.id);
    expect(report.assetUse.total).toBe(4);
    expect(report.assetUse.byKind.find((k) => k.kind === "library_template")?.value).toBe(2);
    expect(report.occasions).toMatchObject({ total: 1, handedOver: 0 });
    expect(report.enquiries).toBeNull(); // unknown, not zero
    await expect(recordAssetUse(team.owner.ctx, { businessId: team.business.id, kind: "Bad Kind" })).rejects.toThrow();
  });
});

describe("branding (P20)", () => {
  it("name, logo and one accent show to guests of a business occasion; the text colour is chosen from luminance", async () => {
    expect(readableOn("#ffe680")).toBe("#17161b");
    expect(readableOn("#1c2452")).toBe("#fffdf8");
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.owner.ctx, { businessId: team.business.id, occasion: occasionInput("Nunta cu brand") });
    const household = await createHousehold(team.owner.ctx, { occasionId: occ.id, name: "Familia Popescu" });
    const link = await resolveGuestLink(makeCtx(t.db, { kind: "anonymous" }, { now: T0 }), household.token);
    const guest = makeCtx(t.db, link!.actor, { now: T0 });

    // before anything is set: the business's own name, the EventDesk accent
    expect(await getOccasionBranding(guest, occ.id)).toMatchObject({ name: team.business.name, accent: null, logoUrl: null });

    const logo = await uploadAsset(team.owner.ctx, { ownerType: "business", ownerId: team.business.id, file: { name: "logo.png", bytes: PNG } });
    expect(await code(saveBranding(team.staff.ctx, { businessId: team.business.id, accentColor: "#7A1F3D" }))).toBe("FORBIDDEN");
    await expect(saveBranding(team.owner.ctx, { businessId: team.business.id, accentColor: "rosu" })).rejects.toThrow();
    // any colour is accepted as chosen — no judgement on the business's choice
    await saveBranding(team.admin.ctx, { businessId: team.business.id, displayName: "Atelier Mara", accentColor: "#FFF3A0", logoAssetId: logo.id });
    const b = await getOccasionBranding(guest, occ.id);
    expect(b).toMatchObject({ name: "Atelier Mara", accent: "#fff3a0", onAccent: "#17161b" });
    expect(b!.logoUrl).toMatch(/\/api\/media\//);

    // only this occasion's guests and members
    const stranger = await mkAccount();
    expect(await getOccasionBranding(stranger.ctx, occ.id)).toBeNull();
    const otherOcc = await createBusinessOccasion(team.owner.ctx, { businessId: team.business.id, occasion: occasionInput("Alta") });
    expect(await getOccasionBranding(guest, otherOcc.id)).toBeNull();
    // the guest view itself carries no business data (branding is a separate, explicit lookup)
    expect(JSON.stringify(await getGuestView(guest))).not.toContain("Atelier Mara");
  });
});

describe("handover (P22, MCP7)", () => {
  it("previews what ends, needs a fresh sign-in, then ends branding and every business-side access", async () => {
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.staff.ctx, { businessId: team.business.id, occasion: occasionInput("Nunta de predat") });
    await saveBranding(team.owner.ctx, { businessId: team.business.id, accentColor: "#7a1f3d" });
    await ensureBusinessSeat(team.admin.ctx, occ.id);
    const client = await addClient(occ.id);
    const file = await uploadAsset(team.owner.ctx, { ownerType: "business", ownerId: team.business.id, file: { name: "plan.png", bytes: PNG } });
    const item = await createLibraryItem(team.owner.ctx, { businessId: team.business.id, item: { kind: "asset", title: "Planul sălii", assetId: file.id } });
    await shareLibraryFile(team.owner.ctx, { itemId: item.id, occasionId: occ.id });

    // business MCP tokens: one for this business, one personal token of a team member
    const [bizToken] = await t.db.insert(mcpTokens).values({ accountId: team.owner.id, name: "Asistent firmă", tokenHash: newId(), last4: "aaaa", scope: "read_propose", businessId: team.business.id }).returning();
    const [personalToken] = await t.db.insert(mcpTokens).values({ accountId: team.admin.id, name: "Personal", tokenHash: newId(), last4: "bbbb", scope: "read" }).returning();
    const bizMcp = makeCtx(t.db, { kind: "mcp", accountId: team.owner.id, tokenId: bizToken!.id, scope: "read_propose" }, { now: T0 });
    expect((await requireMember(bizMcp, occ.id)).role).toBe("pm");
    // a personal token of an owner is not a business token: no team path for it
    const [ownerPersonal] = await t.db.insert(mcpTokens).values({ accountId: team.owner.id, name: "P", tokenHash: newId(), last4: "cccc", scope: "read" }).returning();
    expect(await getMember(makeCtx(t.db, { kind: "mcp", accountId: team.owner.id, tokenId: ownerPersonal!.id, scope: "read" }, { now: T0 }), occ.id)).toBeNull();

    // who may: owner/admin of the business; to whom: a client-side member only
    expect(await code(proposeHandover(team.staff.ctx, { occasionId: occ.id, toMemberId: client.memberId }))).toBe("FORBIDDEN");
    expect(await code(proposeHandover(client.ctx, { occasionId: occ.id, toMemberId: client.memberId }))).toBe("NOT_FOUND");
    expect((await listHandoverCandidates(team.owner.ctx, { occasionId: occ.id })).map((c) => c.memberId)).toEqual([client.memberId]);
    const [adminSeat] = await t.db.select().from(businessOccasionSeats).where(eq(businessOccasionSeats.occasionId, occ.id));
    await expect(proposeHandover(team.owner.ctx, { occasionId: occ.id, toMemberId: adminSeat!.occasionMemberId })).rejects.toMatchObject({ code: "VALIDATION" });

    const preview = await proposeHandover(team.owner.ctx, { occasionId: occ.id, toMemberId: client.memberId });
    expect(preview.delta.map((d) => d.key)).toEqual(["owner", "team", "branding", "mcp", "plan"]);
    expect((await getOccasion(team.owner.ctx, occ.id)).businessId).toBe(team.business.id); // a preview changes nothing

    // S4: without a fresh sign-in the confirmation is refused and nothing changes
    const stale = await mkAccount(false);
    await t.db.insert(businessMembers).values({ businessId: team.business.id, accountId: stale.id, role: "admin" });
    await expect(confirmPreview(stale.ctx, preview.id)).rejects.toMatchObject({ code: "FORBIDDEN", messageKey: "account.errors.freshAuthRequired" });
    expect((await requireMember(team.admin.ctx, occ.id)).role).toBe("pm");

    const before = (await t.db.select().from(tasks).where(eq(tasks.occasionId, occ.id))).length;
    await confirmPreview(team.owner.ctx, preview.id);

    // the client owns it, with both grants
    expect(await requireMember(client.ctx, occ.id)).toMatchObject({ role: "owner", grants: { finance: true, privateRequests: true } });
    const [row] = await t.db.select().from(occasions).where(eq(occasions.id, occ.id));
    expect(row).toMatchObject({ businessId: null, ownerAccountId: client.id });
    // ALL business-side access ended: creator (was owner), seated admin, synthetic owner, the new admin
    for (const who of [team.staff, team.admin, team.owner, stale]) expect(await getMember(who.ctx, occ.id), who.email).toBeNull();
    expect(await t.db.select().from(businessOccasionSeats).where(eq(businessOccasionSeats.occasionId, occ.id))).toHaveLength(0);
    // branding ended
    const household = await createHousehold(client.ctx, { occasionId: occ.id, name: "Familia Ionescu" });
    const link = await resolveGuestLink(makeCtx(t.db, { kind: "anonymous" }, { now: T0 }), household.token);
    expect(await getOccasionBranding(makeCtx(t.db, link!.actor, { now: T0 }), occ.id)).toBeNull();
    // MCP7: the business's tokens are revoked; a personal token is not; and a business token
    // could not reach this occasion even if a member row existed for its account
    const tokens = await t.db.select().from(mcpTokens);
    expect(tokens.find((x) => x.id === bizToken!.id)).toMatchObject({ revokedReason: "handover" });
    expect(tokens.find((x) => x.id === bizToken!.id)!.revokedAt).not.toBeNull();
    expect(tokens.find((x) => x.id === personalToken!.id)!.revokedAt).toBeNull();
    expect(await getMember(bizMcp, occ.id)).toBeNull();
    const [planted] = await t.db.insert(occasionMembers).values({ occasionId: occ.id, accountId: team.owner.id, role: "pm" }).returning();
    expect(await getMember(team.owner.ctx, occ.id)).not.toBeNull(); // (a row planted by hand, to prove the next line)
    expect(await getMember(bizMcp, occ.id)).toBeNull();
    await t.db.delete(occasionMembers).where(eq(occasionMembers.id, planted!.id));

    // history is kept: the plan, the shared file, the record, the audit entry
    expect((await t.db.select().from(tasks).where(eq(tasks.occasionId, occ.id))).length).toBe(before);
    await queryTasks(client.ctx, occ.id, {});
    expect((await listOccasionLibraryFiles(client.ctx, occ.id)).map((f) => f.title)).toEqual(["Planul sălii"]);
    const [handover] = await t.db.select().from(occasionHandovers).where(eq(occasionHandovers.occasionId, occ.id));
    expect(handover).toMatchObject({ businessId: team.business.id, toAccountId: client.id, byAccountId: team.owner.id, occasionTitle: "Nunta de predat", mcpTokensRevoked: 1 });
    expect(handover!.teamAccessEnded).toBeGreaterThanOrEqual(2);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.objectId, occ.id));
    expect(audits.map((a) => a.action)).toContain("occasion.handed_over");
    const list = await listBusinessOccasions(team.owner.ctx, team.business.id);
    expect(list.running).toHaveLength(0);
    expect(list.handedOver.map((h) => h.title)).toEqual(["Nunta de predat"]);
    // it cannot be handed over twice, and the business can no longer propose anything on it
    expect(await code(proposeHandover(team.owner.ctx, { occasionId: occ.id, toMemberId: client.memberId }))).toBe("NOT_FOUND");
    expect(await code(shareLibraryFile(team.owner.ctx, { itemId: item.id, occasionId: occ.id }))).toBe("NOT_FOUND");
  });
});

describe("plan lapse (P23, invariant 8)", () => {
  it("the free tier and what a lapse stops are defined in code", () => {
    expect(PERMANENT_FREE_TIER).toEqual(expect.arrayContaining(["account", "listing", "enquiries", "assets", "ownStatistics", "existingOccasions"]));
    expect([...BUSINESS_PLAN_CAPABILITIES].sort()).toEqual(["brandingChanges", "libraryEdits", "newBusinessOccasions", "newListings"]);
    expect(PERMANENT_FREE_TIER.filter((c) => (BUSINESS_PLAN_CAPABILITIES as readonly string[]).includes(c))).toEqual([]);
  });

  it("existing occasions and in-use assets keep working; only NEW occasions, branding changes, library edits and new listings stop", async () => {
    const team = await mkTeam();
    const occ = await createBusinessOccasion(team.owner.ctx, { businessId: team.business.id, occasion: occasionInput("Nunta în desfășurare") });
    const client = await addClient(occ.id);
    await saveBranding(team.owner.ctx, { businessId: team.business.id, displayName: "Atelier", accentColor: "#224466" });
    const tpl = await createLibraryItem(team.owner.ctx, { businessId: team.business.id, item: { kind: "template", title: "Șablon", lines: "Un pas\nAlt pas" } });
    const file = await uploadAsset(team.owner.ctx, { ownerType: "business", ownerId: team.business.id, file: { name: "meniu.png", bytes: PNG } });
    const item = await createLibraryItem(team.owner.ctx, { businessId: team.business.id, item: { kind: "asset", title: "Meniu", assetId: file.id } });
    await shareLibraryFile(team.owner.ctx, { itemId: item.id, occasionId: occ.id });

    await t.db.update(businesses).set({ planLapsedAt: T0 }).where(eq(businesses.id, team.business.id)); // simulated lapse

    // stays FULLY usable: team access, edits, tasks, guests, the client, the branding already set
    expect((await requireMember(team.admin.ctx, occ.id, { manage: true })).role).toBe("pm");
    await updateOccasion(team.admin.ctx, { occasionId: occ.id, venueName: "Sala Mare" });
    await createTask(team.staff.ctx, { occasionId: occ.id, title: "Încă lucrăm" });
    const household = await createHousehold(team.owner.ctx, { occasionId: occ.id, name: "Familia Pop" });
    const link = await resolveGuestLink(makeCtx(t.db, { kind: "anonymous" }, { now: T0 }), household.token);
    expect(await getOccasionBranding(makeCtx(t.db, link!.actor, { now: T0 }), occ.id)).toMatchObject({ name: "Atelier", accent: "#224466" });
    // in-use assets stay readable, for the team and for the client
    for (const who of [team.staff.ctx, client.ctx]) {
      const files = await listOccasionLibraryFiles(who, occ.id);
      expect(files).toHaveLength(1);
      expect(files[0]!.url).toMatch(/\/api\/media\//);
    }
    // applying what is already in the library still works
    await confirmPreview(team.owner.ctx, (await proposeLibraryApply(team.owner.ctx, { itemId: tpl.id, occasionId: occ.id })).id);
    expect((await t.db.select().from(tasks).where(eq(tasks.occasionId, occ.id))).filter((x) => x.templateTaskKey?.startsWith("lib:"))).toHaveLength(2);
    // a handover is still possible
    expect((await proposeHandover(team.owner.ctx, { occasionId: occ.id, toMemberId: client.memberId })).state).toBe("pending");

    // only NEW things stop
    await expect(createBusinessOccasion(team.owner.ctx, { businessId: team.business.id, occasion: occasionInput("Nouă") })).rejects.toMatchObject({ code: "FORBIDDEN", messageKey: "business.errors.lapsed" });
    await expect(saveBranding(team.owner.ctx, { businessId: team.business.id, accentColor: "#000000" })).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });
    await expect(createLibraryItem(team.owner.ctx, { businessId: team.business.id, item: { kind: "checklist", title: "Nou", lines: "a" } })).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });
    await expect(archiveLibraryItem(team.owner.ctx, { itemId: tpl.id })).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });
    expect((await listLibrary(team.owner.ctx, team.business.id)).canEdit).toBe(false);
    const cats = await t.db.select().from((await import("@ed/db")).categories).limit(1);
    const locs = await t.db.select().from((await import("@ed/db")).localities).where(eq((await import("@ed/db")).localities.countyCode, "CJ")).limit(1);
    await expect(
      createListing(team.owner.ctx, { businessId: team.business.id, payload: { name: "Listare nouă", descriptionRo: "O descriere suficient de lungă pentru listare.", categoryIds: [cats[0]!.id], countyCodes: ["CJ"], localityIds: [locs[0]!.id] } }),
    ).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });
    expect(await t.db.select().from(businessLibraryLinks).where(eq(businessLibraryLinks.occasionId, occ.id))).toHaveLength(1);
    void systemCtx;
  });
});
