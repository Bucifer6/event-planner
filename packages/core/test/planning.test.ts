import {
  accounts,
  and,
  delegations,
  emailOutbox,
  emailSuppressions,
  eq,
  OCCASION_KINDS,
  occasionMembers,
  occasions,
  reminderDigests,
  sessions,
  tasks,
  whatifPreviews,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { emailHash } from "@ed/email";
import { hashToken, isAppError, newId, type AppError } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getMember, requireMember } from "../src/access";
import { accountCtx, anonymousCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { acceptOffer, declineOffer, offerTask } from "../src/delegations";
import { getOpenDeletion } from "../src/deletion";
import { buildDigest, DIGEST_CORE_SECTIONS, planDigests, registerDigestSection, sendDigest } from "../src/digest";
import { exportPlanSummaryCsv, exportTasksCsv, listExports, registerExport, runExport } from "../src/exports";
import { acceptInvite, getInvite, inviteMember, listMembers, removeMember, transferOwnership, updateMember } from "../src/members";
import {
  createOccasion,
  getOccasion,
  getOccasionView,
  listOccasions,
  proposeMoveDate,
  purgeDueOccasions,
  requestOccasionDeletion,
  undoOccasionDeletion,
  updateOccasion,
} from "../src/occasions";
import { getOverview } from "../src/overview";
import {
  addCheckItem,
  addDependency,
  createTask,
  getTask,
  queryTasks,
  setTaskStatus,
  toBoardView,
  toCalendarView,
  toListView,
  updateTask,
} from "../src/tasks";
import { getTemplateDiff, instantToDay, listTemplates, proposeTemplate, shiftDay } from "../src/templates";
import { confirmPreview, discardPreview, listPending } from "../src/whatif";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["templates"]);
});
afterAll(async () => {
  await t.close();
});

const NOW = new Date("2026-03-02T08:00:00.000Z");
const TZ = "Europe/Bucharest";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return (e as AppError).code;
    if (e instanceof ZodError) return "VALIDATION"; // the action wrapper reports these as field errors
    throw e;
  }
  return "OK";
}

async function makeAccount(opts: { fresh?: boolean; email?: string } = {}): Promise<string> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: opts.email ?? `${id}@example.ro` });
  await t.db.insert(sessions).values({
    accountId: id,
    tokenHash: newId(),
    lastSeenAt: NOW,
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
    freshAuthAt: opts.fresh === false ? null : NOW,
  });
  return id;
}

const as = (accountId: string, now: Date = NOW): Ctx => accountCtx(t.db, accountId, { now });

/** Adds a joined member directly (the invitation flow has its own test). */
async function addMember(
  occasionId: string,
  role: "pm" | "workstream_lead" | "contributor" | "supplier" | "guest",
  grants: { finance?: boolean; privateRequests?: boolean } = {},
) {
  const accountId = await makeAccount();
  const [row] = await t.db
    .insert(occasionMembers)
    .values({
      occasionId,
      accountId,
      role,
      grantFinance: grants.finance ?? false,
      grantPrivateRequests: grants.privateRequests ?? false,
    })
    .returning();
  return { accountId, memberId: row!.id };
}

async function wedding(startsOn = "2027-06-12") {
  const owner = await makeAccount();
  const occasion = await createOccasion(as(owner), { title: "Nunta Ioanei", kind: "nunta", dateMode: "date", startsOn });
  const me = (await getMember(as(owner), occasion.id))!;
  return { owner, occasion, ownerMemberId: me.id };
}

/** A tiny finance-gated call, standing in for the budget reads of release B (D2). */
async function financeProbe(ctx: Ctx, occasionId: string): Promise<string> {
  await requireMember(ctx, occasionId, { grant: "finance" });
  return "finance data";
}

describe("occasion access (A5, D2)", () => {
  it("non-members get NOT_FOUND and never learn the occasion exists", async () => {
    const { occasion } = await wedding();
    const stranger = await makeAccount();
    expect(await code(getOccasion(as(stranger), occasion.id))).toBe("NOT_FOUND");
    expect(await code(queryTasks(as(stranger), occasion.id))).toBe("NOT_FOUND");
    expect(await code(getOverview(as(stranger), occasion.id))).toBe("NOT_FOUND");
    expect(await code(getOccasion(as(stranger), "doesnotexist1"))).toBe("NOT_FOUND");
    expect(await code(requireMember(anonymousCtx(t.db), occasion.id))).toBe("NOT_FOUND");
    expect(await listOccasions(as(stranger))).toEqual([]);
  });

  it("staff, guest-link and system actors are never members; an MCP token acts as its account", async () => {
    const { owner, occasion } = await wedding();
    const staff = makeCtx(t.db, { kind: "staff", accountId: owner, staffId: "st1", roles: ["PlatformAdmin"] });
    const guest = makeCtx(t.db, { kind: "guest", invitationId: "i", householdId: "h", occasionId: occasion.id });
    expect(await getMember(staff, occasion.id)).toBeNull();
    expect(await getMember(guest, occasion.id)).toBeNull();
    expect(await getMember(systemCtx(t.db), occasion.id)).toBeNull();
    const mcp = makeCtx(t.db, { kind: "mcp", accountId: owner, tokenId: "tok", scope: "read_propose" }, { now: NOW });
    expect((await requireMember(mcp, occasion.id)).role).toBe("owner");
    // …but it can only read and propose, never write directly
    expect(await code(createTask(mcp, { occasionId: occasion.id, title: "x" }))).toBe("FORBIDDEN");
    expect(await code(updateOccasion(mcp, { occasionId: occasion.id, title: "y" }))).toBe("FORBIDDEN");
  });

  it("the owner holds both grants implicitly; everyone else only by explicit grant", async () => {
    const { owner, occasion } = await wedding();
    const contributor = await addMember(occasion.id, "contributor");
    const pm = await addMember(occasion.id, "pm");
    const treasurer = await addMember(occasion.id, "contributor", { finance: true });

    expect((await requireMember(as(owner), occasion.id)).grants).toEqual({ finance: true, privateRequests: true });
    expect(await financeProbe(as(owner), occasion.id)).toBe("finance data");
    // a contributor without the finance grant is refused server-side
    expect(await code(financeProbe(as(contributor.accountId), occasion.id))).toBe("FORBIDDEN");
    // being project manager does not imply finance or private requests
    expect(await code(financeProbe(as(pm.accountId), occasion.id))).toBe("FORBIDDEN");
    expect(await code(requireMember(as(pm.accountId), occasion.id, { grant: "privateRequests" }))).toBe("FORBIDDEN");
    // the grants are separate
    expect(await financeProbe(as(treasurer.accountId), occasion.id)).toBe("finance data");
    expect(await code(requireMember(as(treasurer.accountId), occasion.id, { grant: "privateRequests" }))).toBe("FORBIDDEN");
  });

  it("checks roles and manage", async () => {
    const { owner, occasion } = await wedding();
    const pm = await addMember(occasion.id, "pm");
    const supplier = await addMember(occasion.id, "supplier");
    expect((await requireMember(as(pm.accountId), occasion.id, { manage: true })).role).toBe("pm");
    expect(await code(requireMember(as(supplier.accountId), occasion.id, { manage: true }))).toBe("FORBIDDEN");
    expect(await code(requireMember(as(pm.accountId), occasion.id, { roles: ["owner"] }))).toBe("FORBIDDEN");
    expect(await code(updateOccasion(as(supplier.accountId), { occasionId: occasion.id, title: "Alt titlu" }))).toBe("FORBIDDEN");
    expect(await code(createTask(as(supplier.accountId), { occasionId: occasion.id, title: "x" }))).toBe("FORBIDDEN");
    expect((await updateOccasion(as(owner), { occasionId: occasion.id, purpose: "Să fim împreună", priorities: ["Muzică bună", "", "Mâncare bună"] })).priorities).toEqual(["Muzică bună", "Mâncare bună"]);
  });

  it("a removed member loses access at once", async () => {
    const { owner, occasion } = await wedding();
    const c = await addMember(occasion.id, "contributor");
    await removeMember(as(owner), { occasionId: occasion.id, memberId: c.memberId });
    expect(await code(getOccasion(as(c.accountId), occasion.id))).toBe("NOT_FOUND");
  });
});

describe("team: invitations, roles and grants (A5, S4)", () => {
  it("invites by emailed link; only the token hash is stored; accepting binds the account once", async () => {
    const { owner, occasion } = await wedding();
    const email = `${newId()}@example.ro`;
    const res = await inviteMember(as(owner), { occasionId: occasion.id, email, role: "contributor", customLabel: "nașă" });
    expect(res.emailStatus).toBe("sent");
    const [mail] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email));
    const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(mail!.bodyText ?? "")![1]!;
    const [row] = await t.db.select().from(occasionMembers).where(eq(occasionMembers.id, res.memberId));
    expect(row!.inviteTokenHash).toBe(hashToken(token));
    expect(row!.inviteTokenHash).not.toContain(token);
    expect(row!.accountId).toBeNull();

    const invitee = await makeAccount({ email });
    expect((await getInvite(as(invitee), token))?.occasionTitle).toBe("Nunta Ioanei");
    expect(await code(getOccasion(as(invitee), occasion.id))).toBe("NOT_FOUND");
    await acceptInvite(as(invitee), { token });
    const member = await requireMember(as(invitee), occasion.id);
    expect(member.role).toBe("contributor");
    expect(member.grants).toEqual({ finance: false, privateRequests: false });
    // the link works once
    expect(await getInvite(as(invitee), token)).toBeNull();
    const other = await makeAccount();
    expect(await code(acceptInvite(as(other), { token }))).toBe("NOT_FOUND");
    expect(await code(acceptInvite(as(other), { token: "x".repeat(43) }))).toBe("NOT_FOUND");
    const team = await listMembers(as(owner), occasion.id);
    expect(team.map((m) => m.role)).toEqual(["owner", "contributor"]);
    expect(team[1]!.customLabel).toBe("nașă");
  });

  it("an invitation expires after 14 days", async () => {
    const { owner, occasion } = await wedding();
    const email = `${newId()}@example.ro`;
    await inviteMember(as(owner), { occasionId: occasion.id, email });
    const [mail] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email));
    const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(mail!.bodyText ?? "")![1]!;
    const late = new Date(NOW.getTime() + 15 * 86_400_000);
    const invitee = await makeAccount();
    expect(await code(acceptInvite(as(invitee, late), { token }))).toBe("CONFLICT");
  });

  it("role and grant changes, removal and ownership transfer need a fresh confirmation (S4)", async () => {
    const stale = await makeAccount({ fresh: false });
    const occasion = await createOccasion(as(stale), { title: "Botez", kind: "botez", dateMode: "date", startsOn: "2026-09-20" });
    const c = await addMember(occasion.id, "contributor");
    const change = { occasionId: occasion.id, memberId: c.memberId, grantFinance: true };
    expect(await code(updateMember(as(stale), change))).toBe("FORBIDDEN");
    expect(await code(removeMember(as(stale), { occasionId: occasion.id, memberId: c.memberId }))).toBe("FORBIDDEN");
    expect(await code(transferOwnership(as(stale), { occasionId: occasion.id, toMemberId: c.memberId }))).toBe("FORBIDDEN");
    expect(await code(inviteMember(as(stale), { occasionId: occasion.id, email: "a@example.ro", grantFinance: true }))).toBe("FORBIDDEN");
    expect(await code(financeProbe(as(c.accountId), occasion.id))).toBe("FORBIDDEN");

    await t.db.update(sessions).set({ freshAuthAt: NOW }).where(eq(sessions.accountId, stale));
    await updateMember(as(stale), change);
    expect(await financeProbe(as(c.accountId), occasion.id)).toBe("finance data");
  });

  it("only the owner changes access; a project manager cannot grant or promote", async () => {
    const { owner, occasion } = await wedding();
    const pm = await addMember(occasion.id, "pm");
    const c = await addMember(occasion.id, "contributor");
    expect(await code(updateMember(as(pm.accountId), { occasionId: occasion.id, memberId: c.memberId, grantFinance: true }))).toBe("FORBIDDEN");
    expect(await code(updateMember(as(pm.accountId), { occasionId: occasion.id, memberId: c.memberId, role: "pm" }))).toBe("FORBIDDEN");
    expect(await code(inviteMember(as(pm.accountId), { occasionId: occasion.id, email: "b@example.ro", role: "pm" }))).toBe("FORBIDDEN");
    // a label alone is fine
    await updateMember(as(pm.accountId), { occasionId: occasion.id, memberId: c.memberId, customLabel: "cavaler de onoare" });
    expect(await code(updateMember(as(owner), { occasionId: occasion.id, memberId: c.memberId, role: "owner" }))).toBe("VALIDATION");

    await transferOwnership(as(owner), { occasionId: occasion.id, toMemberId: c.memberId });
    expect((await requireMember(as(c.accountId), occasion.id)).role).toBe("owner");
    const old = await requireMember(as(owner), occasion.id);
    expect(old.role).toBe("pm");
    expect(old.grants.finance).toBe(false);
    const [row] = await t.db.select().from(occasions).where(eq(occasions.id, occasion.id));
    expect(row!.ownerAccountId).toBe(c.accountId);
  });
});

describe("templates and date-relative scheduling (A2)", () => {
  it("seeds the seven full templates, a starter template for every other kind, plus blank", async () => {
    const list = await listTemplates(as(await makeAccount()));
    const full = ["aniversare", "botez", "nunta", "picnic", "revelion", "voiaj_grup", "voiaj_solo"];
    expect(list.map((x) => x.kind).sort()).toEqual([...OCCASION_KINDS].sort());
    expect(list.find((x) => x.kind === "nunta")!.taskCount).toBeGreaterThanOrEqual(30);
    for (const tpl of list.filter((x) => full.includes(x.kind))) expect(tpl.taskCount).toBeGreaterThanOrEqual(10);
    for (const tpl of list.filter((x) => x.kind !== "blank" && !full.includes(x.kind))) expect(tpl.taskCount, tpl.kind).toBeGreaterThanOrEqual(5);
  });

  it("template tasks land on the right dates", async () => {
    const { owner, occasion } = await wedding("2027-06-12");
    const all = await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id));
    const due = (key: string) => {
      const row = all.find((x) => x.templateTaskKey === `nunta:${key}`)!;
      return instantToDay(row.dueAt!, TZ);
    };
    expect(due("buget")).toBe("2026-06-12"); // 12 months before
    expect(due("rochie")).toBe("2026-09-12"); // 9 months
    expect(due("verighete")).toBe("2026-12-12"); // 6 months
    expect(due("meniu")).toBe("2027-03-12"); // 3 months
    expect(due("asezare")).toBe("2027-05-12"); // 1 month
    expect(due("numar-final")).toBe("2027-06-07"); // week of
    expect(due("multumiri")).toBe("2027-06-19"); // after
    // month ends clamp: 31 May − 3 months = 28 Feb
    expect(shiftDay("2027-05-31", { months: -3 })).toBe("2027-02-28");
    expect((await queryTasks(as(owner), occasion.id, { limit: 500 })).total).toBe(all.length);
  });

  it("an occasion decided by poll has undated template tasks until a date is set", async () => {
    const owner = await makeAccount();
    const occasion = await createOccasion(as(owner), { title: "Picnic", kind: "picnic", dateMode: "poll" });
    const before = await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id));
    expect(before.length).toBeGreaterThan(5);
    expect(before.every((x) => x.dueAt === null)).toBe(true);
    const p = await proposeMoveDate(as(owner), { occasionId: occasion.id, dateMode: "date", startsOn: "2026-07-04" });
    await confirmPreview(as(owner), p.id);
    const after = await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id));
    expect(instantToDay(after.find((x) => x.templateTaskKey === "picnic:meteo")!.dueAt!, TZ)).toBe("2026-07-02");
  });

  it("moving the date is a preview: discard changes nothing, confirm applies, a second confirm applies nothing more", async () => {
    const { owner, occasion } = await wedding("2027-06-12");
    const manual = await createTask(as(owner), { occasionId: occasion.id, title: "Lecții de dans", dueOn: "2027-05-01" });
    const finished = await createTask(as(owner), { occasionId: occasion.id, title: "Am ales data", dueOn: "2026-04-01" });
    await setTaskStatus(as(owner), { taskId: finished.id, status: "done" });
    const snapshot = async () =>
      (await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id)))
        .map((x) => `${x.id}:${x.dueAt?.toISOString() ?? ""}`)
        .sort();
    const before = await snapshot();

    // discard: nothing changes
    const p1 = await proposeMoveDate(as(owner), { occasionId: occasion.id, dateMode: "date", startsOn: "2027-06-26" });
    const open = (await snapshot()).length - 1; // every open dated task shifts; the done one does not
    expect(p1.delta[0]).toMatchObject({ key: "_date", before: "12.06.2027", after: "26.06.2027" });
    expect(p1.delta.filter((d) => !d.key.startsWith("_"))).toHaveLength(open);
    const manualRow = p1.delta.find((d) => d.key === manual.id)!;
    expect(manualRow).toMatchObject({ what: "Lecții de dans", before: "01.05.2027", after: "15.05.2027" });
    expect(p1.delta.find((d) => d.key === finished.id)).toBeUndefined();
    expect(await snapshot()).toEqual(before);
    expect(await listPending(as(owner), occasion.id)).toHaveLength(1);
    await discardPreview(as(owner), p1.id);
    expect(await snapshot()).toEqual(before);
    expect(instantToDay((await getOccasion(as(owner), occasion.id)).startsAt!, TZ)).toBe("2027-06-12");

    // confirm: applies atomically, once
    const p2 = await proposeMoveDate(as(owner), { occasionId: occasion.id, dateMode: "date", startsOn: "2027-06-26" });
    const first = await confirmPreview(as(owner), p2.id);
    expect(first.appliedNow).toBe(true);
    const applied = await snapshot();
    expect(applied).not.toEqual(before);
    const rows = await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id));
    const day = (id: string) => instantToDay(rows.find((x) => x.id === id)!.dueAt!, TZ);
    expect(day(manual.id)).toBe("2027-05-15");
    expect(day(finished.id)).toBe("2026-04-01");
    expect(instantToDay(rows.find((x) => x.templateTaskKey === "nunta:meniu")!.dueAt!, TZ)).toBe("2027-03-26");
    expect(instantToDay((await getOccasion(as(owner), occasion.id)).startsAt!, TZ)).toBe("2027-06-26");

    const [again, parallel] = await Promise.all([confirmPreview(as(owner), p2.id), confirmPreview(as(owner), p2.id)]);
    expect(again.appliedNow).toBe(false);
    expect(parallel.appliedNow).toBe(false);
    expect(await snapshot()).toEqual(applied);
  });

  it("a stale date preview is refused instead of applied; only managers may propose", async () => {
    const { owner, occasion } = await wedding("2027-06-12");
    const c = await addMember(occasion.id, "contributor");
    expect(await code(proposeMoveDate(as(c.accountId), { occasionId: occasion.id, dateMode: "date", startsOn: "2027-07-01" }))).toBe("FORBIDDEN");
    expect(await code(proposeMoveDate(as(owner), { occasionId: occasion.id, dateMode: "date", startsOn: "2027-06-12" }))).toBe("VALIDATION");
    const a = await proposeMoveDate(as(owner), { occasionId: occasion.id, dateMode: "date", startsOn: "2027-07-03" });
    const b = await proposeMoveDate(as(owner), { occasionId: occasion.id, dateMode: "date", startsOn: "2027-08-07" });
    await confirmPreview(as(owner), b.id);
    expect(await code(confirmPreview(as(owner), a.id))).toBe("CONFLICT");
    expect(instantToDay((await getOccasion(as(owner), occasion.id)).startsAt!, TZ)).toBe("2027-08-07");
    const [stillPending] = await t.db.select().from(whatifPreviews).where(eq(whatifPreviews.id, a.id));
    expect(stillPending!.state).toBe("pending");
    // a contributor cannot confirm someone else's proposal either
    const p = await proposeMoveDate(as(owner), { occasionId: occasion.id, dateMode: "date", startsOn: "2027-09-04" });
    expect(await code(confirmPreview(as(c.accountId), p.id))).toBe("FORBIDDEN");
  });

  it("re-running a template shows a diff (create / change / skip) and never duplicates", async () => {
    const { owner, occasion } = await wedding("2027-06-12");
    const count = async () => (await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id))).length;
    const total = await count();

    // untouched: everything is skipped
    let diff = await getTemplateDiff(as(owner), { occasionId: occasion.id, kind: "nunta" });
    expect(diff.every((r) => r.action === "skip")).toBe(true);

    const all = await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id));
    const byKey = (key: string) => all.find((x) => x.templateTaskKey === `nunta:${key}`)!;
    await t.db.delete(tasks).where(eq(tasks.id, byKey("tort").id)); // → create
    await updateTask(as(owner), { taskId: byKey("meniu").id, dueOn: "2027-01-15" }); // → change
    await setTaskStatus(as(owner), { taskId: byKey("buget").id, status: "done" });
    await updateTask(as(owner), { taskId: byKey("buget").id, title: "Buget stabilit" }); // done → skip

    diff = await getTemplateDiff(as(owner), { occasionId: occasion.id, kind: "nunta" });
    const actions = (a: string) => diff.filter((r) => r.action === a).map((r) => r.templateTaskKey);
    expect(actions("create")).toEqual(["nunta:tort"]);
    expect(actions("change")).toEqual(["nunta:meniu"]);
    expect(diff.find((r) => r.templateTaskKey === "nunta:buget")).toMatchObject({ action: "skip", reason: "done" });

    const preview = await proposeTemplate(as(owner), { occasionId: occasion.id, kind: "nunta" });
    expect(preview.delta.find((d) => d.key === "nunta:tort")).toMatchObject({ kindLabelKey: "whatif.kinds.added" });
    expect(preview.delta.find((d) => d.key === "nunta:meniu")).toMatchObject({ before: "15.01.2027", after: "12.03.2027" });
    expect(preview.delta.find((d) => d.key === "_skipped")).toBeDefined();
    expect(await count()).toBe(total - 1); // nothing applied yet
    await confirmPreview(as(owner), preview.id);
    expect(await count()).toBe(total);
    await confirmPreview(as(owner), preview.id);
    const again = await proposeTemplate(as(owner), { occasionId: occasion.id, kind: "nunta" });
    await confirmPreview(as(owner), again.id);
    expect(await count()).toBe(total);
    const keys = (await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id))).map((x) => x.templateTaskKey);
    expect(new Set(keys).size).toBe(keys.length);
    const [budget] = await t.db.select().from(tasks).where(eq(tasks.id, byKey("buget").id));
    expect(budget!.title).toBe("Buget stabilit"); // done work is left alone
  });
});

describe("tasks: one record, three views (A3, principle 2)", () => {
  it("List, Board and Calendar are groupings of the same rows", async () => {
    const owner = await makeAccount();
    const occasion = await createOccasion(as(owner), { title: "Aniversare", kind: "blank", dateMode: "date", startsOn: "2026-06-20" });
    const a = await createTask(as(owner), { occasionId: occasion.id, title: "Rezervă localul", dueOn: "2026-05-20", owner: "me" });
    const b = await createTask(as(owner), { occasionId: occasion.id, title: "Comandă tortul", dueOn: "2026-06-15" });
    const c = await createTask(as(owner), { occasionId: occasion.id, title: "Idei de cadouri" });
    const late = await createTask(as(owner), { occasionId: occasion.id, title: "Trimite invitațiile", dueOn: "2026-02-20" });

    const read = async () => (await queryTasks(as(owner), occasion.id)).rows;
    let rows = await read();
    const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).sort();
    const everything = ids([a, b, c, late]);
    expect(ids(toListView(rows).flatMap((g) => g.tasks))).toEqual(everything);
    expect(ids(toBoardView(rows).flatMap((col) => col.tasks))).toEqual(everything);
    expect(ids(toCalendarView(rows).flatMap((d) => d.tasks))).toEqual(ids([a, b, late])); // undated is not on a calendar
    expect(toListView(rows).map((g) => g.key)).toEqual(["overdue", "m1", "week", "undated"]);
    expect(toBoardView(rows).map((col) => [col.status, col.tasks.length])).toEqual([["todo", 4], ["doing", 0], ["waiting", 0], ["done", 0]]);

    // one change, seen from every view
    await setTaskStatus(as(owner), { taskId: b.id, status: "doing" });
    await updateTask(as(owner), { taskId: b.id, dueOn: "2026-06-18", title: "Comandă tortul și lumânările" });
    rows = await read();
    const inList = toListView(rows).flatMap((g) => g.tasks).find((x) => x.id === b.id)!;
    const inBoard = toBoardView(rows).find((col) => col.status === "doing")!.tasks[0]!;
    const inCalendar = toCalendarView(rows).find((d) => d.day === "2026-06-18")!.tasks[0]!;
    expect(inList).toBe(inBoard);
    expect(inBoard).toBe(inCalendar);
    expect(inCalendar).toMatchObject({ title: "Comandă tortul și lumânările", status: "doing", dueDay: "2026-06-18" });
    expect(toCalendarView(rows).find((d) => d.day === "2026-06-15")).toBeUndefined();

    // the same query narrows for each view (board column, calendar month) and pages
    expect((await queryTasks(as(owner), occasion.id, { statuses: ["doing"] })).rows.map((x) => x.id)).toEqual([b.id]);
    expect(ids((await queryTasks(as(owner), occasion.id, { dueFrom: "2026-06-01", dueTo: "2026-06-30" })).rows)).toEqual([b.id]);
    const page = await queryTasks(as(owner), occasion.id, { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page).toMatchObject({ total: 4, hasMore: true });
  });

  it("keeps owner, due date, checklist, child tasks and dependencies; surfaces violations without blocking", async () => {
    const owner = await makeAccount();
    const occasion = await createOccasion(as(owner), { title: "Revelion", kind: "blank", dateMode: "date", startsOn: "2026-12-31" });
    const book = await createTask(as(owner), { occasionId: occasion.id, title: "Rezervă cabana", dueOn: "2026-10-01", owner: "me", notes: "Sună după 18:00" });
    const pay = await createTask(as(owner), { occasionId: occasion.id, title: "Plătește avansul", dueOn: "2026-10-10" });
    const child = await createTask(as(owner), { occasionId: occasion.id, title: "Cere oferta", parentId: book.id });
    await addCheckItem(as(owner), { taskId: book.id, label: "Verifică parcarea" });
    await addDependency(as(owner), { taskId: pay.id, dependsOnTaskId: book.id });
    expect(await code(addDependency(as(owner), { taskId: book.id, dependsOnTaskId: pay.id }))).toBe("VALIDATION"); // loop
    expect(await code(addDependency(as(owner), { taskId: book.id, dependsOnTaskId: book.id }))).toBe("VALIDATION");
    expect(await code(updateTask(as(owner), { taskId: book.id, parentId: child.id }))).toBe("VALIDATION"); // parent loop

    const detail = await getTask(as(owner), book.id);
    expect(detail.task.ownerMemberId).not.toBeNull();
    expect(detail.task.dueDay).toBe("2026-10-01");
    expect(detail.notes).toBe("Sună după 18:00");
    expect(detail.checklist).toMatchObject([{ label: "Verifică parcarea", done: false }]);
    expect(detail.children.map((x) => x.id)).toEqual([child.id]);
    expect(detail.requiredBy.map((x) => x.id)).toEqual([pay.id]);
    expect((await getTask(as(owner), pay.id)).task.blockedBy).toBe(1);

    // done while what it depends on is not: allowed, and reported
    const res = await setTaskStatus(as(owner), { taskId: pay.id, status: "done" });
    expect(res.task.status).toBe("done");
    expect(res.violations).toEqual(["doneBeforeDependency"]);
    // done with an unfinished child: allowed, and reported
    expect((await setTaskStatus(as(owner), { taskId: book.id, status: "done" })).violations).toEqual(["doneWithOpenChildren"]);
    const overview = await getOverview(as(owner), occasion.id);
    expect(overview.blockers.items.map((x) => [x.task.id, x.reason])).toContainEqual([book.id, "outOfOrder"]);
    // finishing the child clears it
    await setTaskStatus(as(owner), { taskId: child.id, status: "done" });
    expect((await getTask(as(owner), book.id)).task.violations).toEqual([]);
    expect((await getTask(as(owner), pay.id)).task.violations).toEqual([]);
  });

  it("contributors edit their own tasks; suppliers only progress tasks they own", async () => {
    const { owner, occasion } = await wedding();
    const c = await addMember(occasion.id, "contributor");
    const s = await addMember(occasion.id, "supplier");
    const mine = await createTask(as(c.accountId), { occasionId: occasion.id, title: "Playlist" });
    const theirs = await createTask(as(owner), { occasionId: occasion.id, title: "Contract formație" });
    await updateTask(as(c.accountId), { taskId: mine.id, title: "Playlist de seară" });
    expect(await code(updateTask(as(c.accountId), { taskId: theirs.id, title: "x" }))).toBe("FORBIDDEN");
    expect(await code(setTaskStatus(as(s.accountId), { taskId: theirs.id, status: "done" }))).toBe("FORBIDDEN");
    const offer = await offerTask(as(owner), { taskId: theirs.id, toMemberId: s.memberId });
    await acceptOffer(as(s.accountId), { delegationId: offer.id });
    expect((await setTaskStatus(as(s.accountId), { taskId: theirs.id, status: "doing" })).task.status).toBe("doing");
    expect(await code(updateTask(as(s.accountId), { taskId: theirs.id, title: "x" }))).toBe("FORBIDDEN");
  });
});

describe("delegation by offer and acceptance (A4)", () => {
  it("accepting makes the member accountable; applies once", async () => {
    const { owner, occasion, ownerMemberId } = await wedding();
    const c = await addMember(occasion.id, "contributor");
    const task = await createTask(as(owner), { occasionId: occasion.id, title: "Mărturii", owner: "me" });
    const offer = await offerTask(as(owner), { taskId: task.id, toMemberId: c.memberId });
    // nothing changes hands until the answer
    let detail = await getTask(as(owner), task.id);
    expect(detail.task.ownerMemberId).toBe(ownerMemberId);
    expect(detail.task.offer).toMatchObject({ id: offer.id, toMemberId: c.memberId });
    expect((await getOverview(as(owner), occasion.id)).offers.items.map((o) => o.id)).toEqual([offer.id]);
    // only the person asked can answer
    expect(await code(acceptOffer(as(owner), { delegationId: offer.id }))).toBe("FORBIDDEN");
    await Promise.all([acceptOffer(as(c.accountId), { delegationId: offer.id }), acceptOffer(as(c.accountId), { delegationId: offer.id })]);
    detail = await getTask(as(owner), task.id);
    expect(detail.task.ownerMemberId).toBe(c.memberId);
    expect(detail.task.offer).toBeNull();
    expect((await getOverview(as(owner), occasion.id)).offers.total).toBe(0);
  });

  it("declining needs a reason and returns the task to the delegator — never to anyone else", async () => {
    const { owner, occasion } = await wedding();
    const lead = await addMember(occasion.id, "workstream_lead");
    const c = await addMember(occasion.id, "contributor");
    await addMember(occasion.id, "contributor"); // a bystander who must never receive it
    // the task belongs to the owner; the LEAD offers it on
    const task = await createTask(as(owner), { occasionId: occasion.id, title: "Flori biserică", owner: "me" });
    const offer = await offerTask(as(lead.accountId), { taskId: task.id, toMemberId: c.memberId });
    expect(await code(declineOffer(as(c.accountId), { delegationId: offer.id, reason: " " }))).toBe("VALIDATION");
    expect(await code(declineOffer(as(lead.accountId), { delegationId: offer.id, reason: "nu pot" }))).toBe("FORBIDDEN");
    await declineOffer(as(c.accountId), { delegationId: offer.id, reason: "Sunt plecat din țară" });
    const detail = await getTask(as(owner), task.id);
    expect(detail.task.ownerMemberId).toBe(lead.memberId); // the delegator
    expect(detail.task.offer).toBeNull();
    expect(detail.delegations[0]).toMatchObject({ state: "declined", declineReason: "Sunt plecat din țară" });
    // answering twice changes nothing; an answered offer cannot be accepted afterwards
    await declineOffer(as(c.accountId), { delegationId: offer.id, reason: "Sunt plecat din țară" });
    expect(await code(acceptOffer(as(c.accountId), { delegationId: offer.id }))).toBe("CONFLICT");
    expect((await getTask(as(owner), task.id)).task.ownerMemberId).toBe(lead.memberId);
  });

  it("a contributor cannot hand out other people's tasks; a new offer replaces the open one", async () => {
    const { owner, occasion } = await wedding();
    const a = await addMember(occasion.id, "contributor");
    const b = await addMember(occasion.id, "contributor");
    const task = await createTask(as(owner), { occasionId: occasion.id, title: "Transport invitați" });
    expect(await code(offerTask(as(a.accountId), { taskId: task.id, toMemberId: b.memberId }))).toBe("FORBIDDEN");
    const first = await offerTask(as(owner), { taskId: task.id, toMemberId: a.memberId });
    const second = await offerTask(as(owner), { taskId: task.id, toMemberId: b.memberId });
    const states = await t.db.select().from(delegations).where(eq(delegations.taskId, task.id));
    expect(states.find((d) => d.id === first.id)!.state).toBe("withdrawn");
    expect(states.find((d) => d.id === second.id)!.state).toBe("offered");
    expect(await code(acceptOffer(as(a.accountId), { delegationId: first.id }))).toBe("CONFLICT");
  });
});

describe("overview and daily digest (A10)", () => {
  async function scene() {
    const email = `${newId()}@example.ro`;
    const owner = await makeAccount({ email });
    const occasion = await createOccasion(as(owner), { title: "Botezul Mariei", kind: "blank", dateMode: "date", startsOn: "2026-04-10" });
    const c = await addMember(occasion.id, "contributor");
    const late = await createTask(as(owner), { occasionId: occasion.id, title: "Rezervă biserica", dueOn: "2026-02-20", owner: "me" });
    const next = await createTask(as(owner), { occasionId: occasion.id, title: "Trimite invitațiile", dueOn: "2026-03-05" });
    const waiting = await createTask(as(owner), { occasionId: occasion.id, title: "Așteptăm oferta de la restaurant", dueOn: "2026-03-20" });
    await setTaskStatus(as(owner), { taskId: waiting.id, status: "waiting" });
    const offer = await offerTask(as(owner), { taskId: next.id, toMemberId: c.memberId });
    const [me] = await t.db.select().from(occasionMembers).where(and(eq(occasionMembers.occasionId, occasion.id), eq(occasionMembers.accountId, owner)));
    return { email, owner, occasion, c, late, next, waiting, offer, ownerMemberId: me!.id };
  }

  it("the overview has days left and the four sections", async () => {
    const s = await scene();
    const o = await getOverview(as(s.owner), s.occasion.id);
    expect(o.daysLeft).toBe(39);
    expect(o.nextMilestone?.id).toBe(s.next.id);
    expect(o.overdue.items.map((x) => x.id)).toEqual([s.late.id]);
    expect(o.offers.items.map((x) => x.id)).toEqual([s.offer.id]);
    expect(o.blockers.items.map((x) => [x.task.id, x.reason])).toEqual([[s.waiting.id, "waiting"]]);
    expect(o.progress).toEqual({ total: 3, done: 0 });
    const p = await proposeMoveDate(as(s.owner), { occasionId: s.occasion.id, dateMode: "date", startsOn: "2026-04-17" });
    expect((await getOverview(as(s.owner), s.occasion.id)).pendingProposals).toBe(1);
    await discardPreview(as(s.owner), p.id);
  });

  it("the digest contains the four sections and is sent once per day per member", async () => {
    const s = await scene();
    const sys = systemCtx(t.db, { now: NOW });
    const content = (await buildDigest(sys, { occasionId: s.occasion.id, memberId: s.ownerMemberId }))!;
    expect(content.sections.map((x) => x.key)).toEqual([...DIGEST_CORE_SECTIONS]);
    expect(content.sections.every((x) => x.lines.length === 1)).toBe(true);
    expect(content.worthSending).toBe(true);

    expect(await sendDigest(sys, { occasionId: s.occasion.id, memberId: s.ownerMemberId })).toBe("sent");
    expect(await sendDigest(sys, { occasionId: s.occasion.id, memberId: s.ownerMemberId })).toBe("already");
    const later = systemCtx(t.db, { now: new Date(NOW.getTime() + 6 * 3_600_000) }); // same Bucharest day
    expect(await sendDigest(later, { occasionId: s.occasion.id, memberId: s.ownerMemberId })).toBe("already");
    const mails = await t.db.select().from(emailOutbox).where(and(eq(emailOutbox.toEmail, s.email), eq(emailOutbox.template, "digest.daily")));
    expect(mails).toHaveLength(1);
    const body = mails[0]!.bodyText!;
    for (const title of ["Rezervă biserica", "Trimite invitațiile", "Așteptăm oferta de la restaurant"]) expect(body).toContain(title);
    // bilingual, Romanian first
    expect(body.indexOf("Următorul termen")).toBeGreaterThan(-1);
    expect(body.indexOf("Next milestone")).toBeGreaterThan(body.indexOf("Următorul termen"));
    for (const heading of ["Sarcini întârziate", "Delegări neacceptate", "Blocaje", "Overdue", "Unaccepted delegations", "Blockers"]) expect(body).toContain(heading);
    expect(mails[0]!.occasionId).toBe(s.occasion.id); // counts against the Q6 cap

    // the next day it goes out again — once
    const tomorrow = systemCtx(t.db, { now: new Date(NOW.getTime() + 24 * 3_600_000) });
    expect(await sendDigest(tomorrow, { occasionId: s.occasion.id, memberId: s.ownerMemberId })).toBe("sent");
    expect(await sendDigest(tomorrow, { occasionId: s.occasion.id, memberId: s.ownerMemberId })).toBe("already");
  });

  it("a member's digest holds only their own work; nothing to report means no email; suppression is respected", async () => {
    const s = await scene();
    const sys = systemCtx(t.db, { now: NOW });
    const mine = (await buildDigest(sys, { occasionId: s.occasion.id, memberId: s.c.memberId }))!;
    const lines = (key: string) => mine.sections.find((x) => x.key === key)!.lines;
    expect(lines("overdue")).toEqual([]); // the overdue task is the owner's
    expect(lines("blockers")).toEqual([]);
    expect(lines("delegations")).toHaveLength(1); // the offer waiting for them
    expect(JSON.stringify(lines("delegations"))).toContain("offerToYou");

    const quiet = await addMember(s.occasion.id, "guest");
    await t.db.update(tasks).set({ dueAt: new Date("2026-03-25T10:00:00Z") }).where(eq(tasks.id, s.next.id)); // milestone > 7 days away
    expect(await sendDigest(sys, { occasionId: s.occasion.id, memberId: quiet.memberId })).toBe("empty");
    const [log] = await t.db.select().from(reminderDigests).where(eq(reminderDigests.memberId, quiet.memberId));
    expect(log!.outcome).toBe("empty");

    await t.db.insert(emailSuppressions).values({ emailHash: emailHash(s.email), reason: "hard_bounce" as never });
    expect(await sendDigest(sys, { occasionId: s.occasion.id, memberId: s.ownerMemberId })).toBe("suppressed");
  });

  it("extension sections reach grant holders only", async () => {
    const s = await scene();
    registerDigestSection({
      key: "test-finance",
      titleKey: "digest.sections.blockers",
      forMember: async (ctx, _member, occasionId) => {
        await requireMember(ctx, occasionId, { grant: "finance" });
        return ["Avans restaurant: 500 RON, scadent mâine"];
      },
    });
    const sys = systemCtx(t.db, { now: NOW });
    const owner = (await buildDigest(sys, { occasionId: s.occasion.id, memberId: s.ownerMemberId }))!;
    const contributor = (await buildDigest(sys, { occasionId: s.occasion.id, memberId: s.c.memberId }))!;
    expect(owner.sections.map((x) => x.key)).toContain("test-finance");
    expect(contributor.sections.map((x) => x.key)).not.toContain("test-finance");
    registerDigestSection({ key: "test-finance", titleKey: "digest.sections.blockers", forMember: async () => [] });
  });

  it("planning enqueues one job per joined member per day", async () => {
    const s = await scene();
    const sys = systemCtx(t.db, { now: new Date("2026-03-09T05:30:00Z") });
    const first = await planDigests(sys);
    expect(first).toBeGreaterThanOrEqual(2);
    expect(await planDigests(sys)).toBe(0); // same day: deduplicated by the job's unique key
    expect(s.occasion.id).toBeTruthy();
  });
});

describe("exports (A12, P16)", () => {
  it("contain the occasion's own fields only — nothing from the directory, nothing Featured", async () => {
    const { owner, occasion } = await wedding();
    const other = await wedding();
    await createTask(as(other.owner), { occasionId: other.occasion.id, title: "SECRET-ALT-EVENIMENT" });
    await createTask(as(owner), { occasionId: occasion.id, title: '=HYPERLINK("http://x")', dueOn: "2027-01-10" });
    await updateOccasion(as(owner), { occasionId: occasion.id, venueName: "Conacul Vechi", purpose: "Familie", priorities: ["Muzică"] });

    const csv = await exportTasksCsv(as(owner), occasion.id);
    const header = csv.content.replace(/^﻿/, "").split("\r\n")[0]!;
    expect(header.split(",")).toEqual(["Sarcină", "Stare", "Termen", "Etapă", "Responsabil", "Listă de verificare", "Subsarcini", "Așteaptă după", "Prioritate"]);
    const summary = await exportPlanSummaryCsv(as(owner), occasion.id);
    const en = await exportTasksCsv(accountCtx(t.db, owner, { now: NOW, locale: "en" }), occasion.id);
    for (const file of [csv, summary, en]) {
      expect(file.content).not.toMatch(/featured|promovat|promoted|plasare|sponsor|listing|directory|director|firm[ăa]\b|business|rating/i);
      expect(file.content).not.toContain("SECRET-ALT-EVENIMENT");
      expect(file.mime).toContain("text/csv");
    }
    expect(csv.content).toContain("Stabilește bugetul și cine contribuie");
    expect(csv.content).toContain("'=HYPERLINK"); // formula defused
    expect(summary.content).toContain("Conacul Vechi");
    expect(csv.filename).toBe("nunta-ioanei-sarcini.csv");

    // members only; unknown exports do not exist; gated exports need their grant
    const stranger = await makeAccount();
    expect(await code(exportTasksCsv(as(stranger), occasion.id))).toBe("NOT_FOUND");
    expect(await code(runExport(as(owner), occasion.id, "nope"))).toBe("NOT_FOUND");
    registerExport({ key: "test-budget", titleKey: "x.y", grant: "finance", run: async () => ({ filename: "b.csv", mime: "text/csv", content: "x" }) });
    const c = await addMember(occasion.id, "contributor");
    expect(await code(runExport(as(c.accountId), occasion.id, "test-budget"))).toBe("FORBIDDEN");
    expect((await listExports(as(c.accountId), occasion.id)).map((e) => e.key)).toEqual(["tasks", "summary"]);
    expect((await listExports(as(owner), occasion.id)).map((e) => e.key)).toContain("test-budget");
    expect((await runExport(as(c.accountId), occasion.id, "tasks")).content).toContain("Sarcină");
  });
});

describe("occasion deletion with a seven-day undo (D6, R0-18)", () => {
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

  it("owner only, fresh confirmation, restorable for seven days, gone afterwards", async () => {
    const { owner, occasion } = await wedding();
    const pm = await addMember(occasion.id, "pm");
    expect(await code(requestOccasionDeletion(as(pm.accountId), { occasionId: occasion.id }))).toBe("FORBIDDEN");
    await t.db.update(sessions).set({ freshAuthAt: null }).where(eq(sessions.accountId, owner));
    expect(await code(requestOccasionDeletion(as(owner), { occasionId: occasion.id }))).toBe("FORBIDDEN");
    await t.db.update(sessions).set({ freshAuthAt: NOW }).where(eq(sessions.accountId, owner));

    const res = await requestOccasionDeletion(as(owner), { occasionId: occasion.id });
    expect(res.undoUntil.toISOString()).toBe(day(7).toISOString());
    expect(res.retained).toEqual({ receiptsYears: 7, objectionRecordsYears: 3, auditYears: 2 });
    // still there, flagged, during the window
    expect((await getOccasionView(as(owner), occasion.id)).deletion?.undoUntil.toISOString()).toBe(day(7).toISOString());
    expect((await listOccasions(as(owner)))[0]!.pendingDeletion).toBe(true);
    expect(await purgeDueOccasions(systemCtx(t.db, { now: day(6) }))).toEqual([]);

    // undo restores it completely
    await undoOccasionDeletion(as(owner, day(6)), { occasionId: occasion.id });
    expect(await getOpenDeletion(as(owner), { targetType: "occasion", targetId: occasion.id })).toBeNull();
    expect(await purgeDueOccasions(systemCtx(t.db, { now: day(30) }))).not.toContain(occasion.id);
    expect((await queryTasks(as(owner), occasion.id)).total).toBeGreaterThan(30);

    // delete again and let the window close
    await t.db.update(sessions).set({ freshAuthAt: day(30), expiresAt: day(60) }).where(eq(sessions.accountId, owner));
    await requestOccasionDeletion(as(owner, day(30)), { occasionId: occasion.id });
    expect(await code(undoOccasionDeletion(as(owner, day(37.1)), { occasionId: occasion.id }))).toBe("CONFLICT");
    expect(await code(purgeDueOccasions(as(owner, day(38))))).toBe("FORBIDDEN");
    expect(await purgeDueOccasions(systemCtx(t.db, { now: day(38) }))).toContain(occasion.id);
    expect(await code(getOccasion(as(owner, day(38)), occasion.id))).toBe("NOT_FOUND");
    expect(await t.db.select().from(tasks).where(eq(tasks.occasionId, occasion.id))).toHaveLength(0);
    expect(await t.db.select().from(occasionMembers).where(eq(occasionMembers.occasionId, occasion.id))).toHaveLength(0);
  });
});
