import {
  accounts,
  and,
  assets,
  auditLog,
  emailOutbox,
  eq,
  expenses,
  jobs,
  lessons,
  occasionGuestSettings,
  occasionMembers,
  occasions,
  sessions,
  tasks,
  whatifPreviews,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { runOnce } from "@ed/jobs";
import { isAppError, newId, type AppError } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { addCategories, getBudget } from "../src/budget";
import {
  CANCEL_KIND,
  getCloseout,
  getClosedOccasionsOlderThan,
  getLesson,
  listLessons,
  NOTIFY_GUESTS_JOB,
  notifyGuestsOfChange,
  proposeCancel,
  proposeClose,
  proposePostpone,
  registerJobs,
  saveLesson,
} from "../src/closeout";
import { accountCtx, systemCtx, type Ctx } from "../src/context";
import { requestDeletion } from "../src/deletion";
import { createExpense, markExpensePaid, retainedOwnerId, setExpenseApproval } from "../src/expenses";
import { createHousehold } from "../src/guests";
import { addLedgerEntry, addParticipant, getLedger } from "../src/ledger";
import { assertOccasionWritable, registerCloseoutSection, registerLifecycleImpact } from "../src/lifecycle";
import { createOccasion, getOccasion, purgeDueOccasions } from "../src/occasions";
import { getOverview } from "../src/overview";
import { recordRsvp } from "../src/rsvp";
import { runRetention } from "../src/retention";
import { createTask, queryTasks, setTaskStatus } from "../src/tasks";
import { instantToDay } from "../src/templates";
import { confirmPreview, discardPreview, listPending } from "../src/whatif";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["templates"]);
  registerJobs();
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
    if (e instanceof ZodError) return "VALIDATION";
    throw e;
  }
  return "OK";
}

async function makeAccount(fresh = true): Promise<string> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `${id}@example.ro` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: NOW, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000), freshAuthAt: fresh ? NOW : null });
  return id;
}
const as = (accountId: string, now: Date = NOW): Ctx => accountCtx(t.db, accountId, { now });

async function addMember(occasionId: string, role: "pm" | "contributor", finance = false) {
  const accountId = await makeAccount();
  await t.db.insert(occasionMembers).values({ occasionId, accountId, role, grantFinance: finance });
  return accountId;
}

let keyN = 0;
const key = () => `lc-key-${++keyN}-${newId()}`;

/** A wedding with tasks, guests who answered, expenses and a shared cost. */
async function scene() {
  const owner = await makeAccount();
  const ctx = as(owner);
  const occasion = await createOccasion(ctx, { title: "Nunta Ioanei", kind: "blank", dateMode: "date", startsOn: "2027-06-12" });
  const open = await createTask(ctx, { occasionId: occasion.id, title: "Rezervă formația", dueOn: "2027-03-12" });
  const done = await createTask(ctx, { occasionId: occasion.id, title: "Alege data", dueOn: "2026-02-01" });
  await setTaskStatus(ctx, { taskId: done.id, status: "done" });
  const h1 = await createHousehold(ctx, { occasionId: occasion.id, name: "Familia Popescu", leadEmail: "popescu@example.ro" });
  const h2 = await createHousehold(ctx, { occasionId: occasion.id, name: "Familia Ionescu", leadEmail: "ionescu@example.ro" });
  const h3 = await createHousehold(ctx, { occasionId: occasion.id, name: "Fără e-mail" });
  await recordRsvp(ctx, { householdId: h1.householdId, attending: "yes", adultsCount: 2, childrenCount: 1 });
  await recordRsvp(ctx, { householdId: h2.householdId, attending: "no", adultsCount: 0, childrenCount: 0 });
  await recordRsvp(ctx, { householdId: h3.householdId, attending: "yes", adultsCount: 1, childrenCount: 0 });
  const paid = await createExpense(ctx, { occasionId: occasion.id, description: "Avans sală", amountMinor: 500_000, spentOn: "2026-03-01", idempotencyKey: key() });
  await markExpensePaid(ctx, { expenseId: paid.id });
  const unpaid = await createExpense(ctx, { occasionId: occasion.id, description: "Flori", supplierLabel: "Magnolia", amountMinor: 120_000, spentOn: "2026-03-01", idempotencyKey: key() });
  await setExpenseApproval(ctx, { expenseId: unpaid.id, state: "approved" });
  const ana = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Ana" });
  const dan = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Dan" });
  await addLedgerEntry(ctx, { occasionId: occasion.id, description: "Degustare", amountMinor: 60_000, paidByParticipantId: ana.id, occurredOn: "2026-03-01", split: { mode: "even", participantIds: [ana.id, dan.id] }, idempotencyKey: key() });
  return { owner, ctx, occasion, open, done, paid, unpaid, ana, dan };
}

async function snapshot(occasionId: string) {
  const [o] = await t.db.select().from(occasions).where(eq(occasions.id, occasionId));
  const ts = await t.db.select({ id: tasks.id, dueAt: tasks.dueAt, status: tasks.status }).from(tasks).where(eq(tasks.occasionId, occasionId));
  const [g] = await t.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, occasionId));
  const js = await t.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.name, NOTIFY_GUESTS_JOB));
  const mail = await t.db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.occasionId, occasionId));
  return JSON.stringify({ status: o!.status, startsAt: o!.startsAt, closedAt: o!.closedAt, ts: ts.sort((a, b) => a.id.localeCompare(b.id)), rev: g?.guestRevision ?? 0, jobs: js.length, mail: mail.length });
}

const what = (row: { what: unknown }) => (typeof row.what === "string" ? row.what : (row.what as { key: string }).key);

describe("cancel with preview (B9)", () => {
  it("the preview lists everything affected; discarding it changes nothing", async () => {
    const s = await scene();
    registerLifecycleImpact({
      key: "test-suppliers",
      collect: async (_ctx, occasionId, change) =>
        occasionId === s.occasion.id ? [{ key: "booking-1", what: "Formația Zori", kindLabelKey: "whatif.kinds.affected", before: `rezervat (${change.kind})` }] : [],
    });
    const before = await snapshot(s.occasion.id);
    const preview = await proposeCancel(s.ctx, { occasionId: s.occasion.id });
    expect(preview.kind).toBe(CANCEL_KIND);
    expect(preview.titleKey).toBe("lifecycle.whatif.cancelTitle");

    const rows = new Map(preview.delta.map((r) => [r.key, r]));
    expect(rows.get("_status")).toMatchObject({ before: { key: "lifecycle.status.planning" }, after: { key: "lifecycle.status.cancelled" } });
    // tasks not done (1 of 2), guests who said yes — counts only, never names
    expect(rows.get("tasks:open")!.what).toEqual({ key: "lifecycle.impact.tasksOpen", params: { count: 1 } });
    expect(rows.get("guests:yes")!.what).toEqual({ key: "lifecycle.impact.guestsYes", params: { people: 4, households: 2 } });
    expect(JSON.stringify(preview.delta)).not.toContain("Popescu");
    // money: paid and unpaid expenses, ledger balance
    expect(rows.get("expenses:expenses:paid:RON")).toMatchObject({ what: { params: { count: 1, amount: "5.000 RON" } } });
    expect(rows.get("expenses:expenses:unpaid:RON")).toMatchObject({ what: { params: { amount: "1.200 RON" } } });
    expect(rows.get(`ledger:ledger:RON:${s.dan.id}:${s.ana.id}`)).toMatchObject({ what: { key: "lifecycle.impact.ledgerOwes", params: { from: "Dan", to: "Ana", amount: "300 RON" } } });
    // another domain's provider is included
    expect(rows.get("test-suppliers:booking-1")).toMatchObject({ what: "Formația Zori", before: "rezervat (cancel)" });
    // who will be told: two households left an email
    expect(rows.get("_notify")!.what).toEqual({ key: "lifecycle.whatif.notifyRow", params: { count: 2 } });

    // creating the preview changed nothing…
    expect(await snapshot(s.occasion.id)).toBe(before);
    // …and neither does discarding it
    await discardPreview(s.ctx, preview.id);
    expect(await snapshot(s.occasion.id)).toBe(before);
    expect(await code(confirmPreview(s.ctx, preview.id))).toBe("CONFLICT");
    expect(await snapshot(s.occasion.id)).toBe(before);
    registerLifecycleImpact({ key: "test-suppliers", collect: async () => [] });
  });

  it("confirming applies once under a double tap, bumps the guest revision and emails each lead once", async () => {
    const s = await scene();
    const applied: string[] = [];
    registerLifecycleImpact({
      key: "test-apply",
      collect: async () => [],
      apply: async (_tx, occasionId, change) => {
        if (occasionId === s.occasion.id) applied.push(change.kind);
      },
    });
    const preview = await proposeCancel(s.ctx, { occasionId: s.occasion.id });
    const [a, b] = await Promise.all([confirmPreview(s.ctx, preview.id), confirmPreview(s.ctx, preview.id)]);
    expect([a.appliedNow, b.appliedNow].sort()).toEqual([false, true]);
    expect((await confirmPreview(s.ctx, preview.id)).appliedNow).toBe(false);
    expect(applied).toEqual(["cancel"]);

    expect((await getOccasion(s.ctx, s.occasion.id)).status).toBe("cancelled");
    const [g] = await t.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, s.occasion.id));
    expect(g).toMatchObject({ guestRevision: 1, guestRevisionReasonKey: "lifecycle.guest.cancelled" });
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.objectId, s.occasion.id), eq(auditLog.action, "occasion.cancelled")));
    expect(audits).toHaveLength(1);

    // exactly one notification job; running it emails the two households with an address
    const queued = await t.db.select().from(jobs).where(and(eq(jobs.name, NOTIFY_GUESTS_JOB), eq(jobs.uniqueKey, `lifecycle:${preview.id}`)));
    expect(queued).toHaveLength(1);
    await runOnce(systemCtx(t.db, { now: NOW }), { names: [NOTIFY_GUESTS_JOB] });
    const sent = () => t.db.select().from(emailOutbox).where(and(eq(emailOutbox.occasionId, s.occasion.id), eq(emailOutbox.template, "lifecycle.changed")));
    expect((await sent()).map((m) => m.toEmail).sort()).toEqual(["ionescu@example.ro", "popescu@example.ro"]);
    expect((await sent())[0]!.subject).toContain("Nunta Ioanei");
    // a retried job sends nothing a second time
    await notifyGuestsOfChange(systemCtx(t.db, { now: NOW }), { occasionId: s.occasion.id, change: "cancelled", previewId: preview.id });
    expect(await sent()).toHaveLength(2);

    // a cancelled occasion cannot be cancelled or postponed again, but stays writable
    expect(await code(proposeCancel(s.ctx, { occasionId: s.occasion.id }))).toBe("CONFLICT");
    expect(await code(proposePostpone(s.ctx, { occasionId: s.occasion.id, startsOn: "2027-09-01" }))).toBe("CONFLICT");
    await assertOccasionWritable(s.ctx, s.occasion.id);
    registerLifecycleImpact({ key: "test-apply", collect: async () => [] });
  });

  it("managers only, with a fresh confirmation; finance rows only for finance holders", async () => {
    const s = await scene();
    const contributor = await addMember(s.occasion.id, "contributor", true);
    expect(await code(proposeCancel(as(contributor), { occasionId: s.occasion.id }))).toBe("FORBIDDEN");
    const stranger = await makeAccount();
    expect(await code(proposeCancel(as(stranger), { occasionId: s.occasion.id }))).toBe("NOT_FOUND");

    // a project manager WITHOUT the finance grant can cancel, but the preview shows no money
    const pm = await addMember(s.occasion.id, "pm");
    const preview = await proposeCancel(as(pm), { occasionId: s.occasion.id });
    const keys = preview.delta.map((r) => r.key);
    expect(keys).toContain("tasks:open");
    expect(keys.some((k) => k.startsWith("expenses:") || k.startsWith("ledger:"))).toBe(false);
    expect(JSON.stringify(preview.delta)).not.toContain("RON");
    // members can read it; a contributor cannot confirm or discard
    expect((await listPending(as(contributor), s.occasion.id)).map((p) => p.id)).toContain(preview.id);
    expect(await code(confirmPreview(as(contributor), preview.id))).toBe("FORBIDDEN");
    expect(await code(discardPreview(as(contributor), preview.id))).toBe("FORBIDDEN");

    // stale confirmation (S4): refused until confirmed again
    await t.db.update(sessions).set({ freshAuthAt: null }).where(eq(sessions.accountId, s.owner));
    expect(await code(proposeCancel(s.ctx, { occasionId: s.occasion.id }))).toBe("FORBIDDEN");
    expect(await code(confirmPreview(s.ctx, preview.id))).toBe("FORBIDDEN");
    expect((await getOccasion(s.ctx, s.occasion.id)).status).toBe("planning");
  });
});

describe("postpone with preview (B9)", () => {
  it("lists the date shift of every open task and applies status + date + shifts atomically", async () => {
    const s = await scene();
    expect(await code(proposePostpone(s.ctx, { occasionId: s.occasion.id, startsOn: "2027-06-12" }))).toBe("VALIDATION");
    expect(await code(proposePostpone(s.ctx, { occasionId: s.occasion.id, startsOn: "2027-05-01" }))).toBe("VALIDATION");
    expect(await code(proposePostpone(s.ctx, { occasionId: s.occasion.id, startsOn: "" }))).toBe("VALIDATION");

    const before = await snapshot(s.occasion.id);
    const preview = await proposePostpone(s.ctx, { occasionId: s.occasion.id, startsOn: "2027-09-18" });
    const rows = new Map(preview.delta.map((r) => [r.key, r]));
    expect(preview.titleParams).toMatchObject({ date: "18.09.2027" });
    expect(rows.get("_status")).toMatchObject({ after: { key: "lifecycle.status.postponed" } });
    expect(rows.get("_date")).toMatchObject({ before: "12.06.2027", after: "18.09.2027" });
    // the open task moves by the same 98 days; the done one is not listed
    expect(rows.get(s.open.id)).toMatchObject({ what: "Rezervă formația", before: "12.03.2027", after: "18.06.2027" });
    expect(rows.has(s.done.id)).toBe(false);
    expect(rows.get("guests:yes")).toMatchObject({ noteKey: "lifecycle.impact.guestsPostponeNote" });
    expect(rows.has("tasks:open")).toBe(false);
    expect(await snapshot(s.occasion.id)).toBe(before);

    const [a, b] = await Promise.all([confirmPreview(s.ctx, preview.id), confirmPreview(s.ctx, preview.id)]);
    expect([a.appliedNow, b.appliedNow].sort()).toEqual([false, true]);
    const after = await getOccasion(s.ctx, s.occasion.id);
    expect(after.status).toBe("postponed");
    expect(instantToDay(after.startsAt!, TZ)).toBe("2027-09-18");
    const list = await queryTasks(s.ctx, s.occasion.id, {});
    expect(instantToDay(list.rows.find((r) => r.id === s.open.id)!.dueAt!, TZ)).toBe("2027-06-18");
    expect(instantToDay(list.rows.find((r) => r.id === s.done.id)!.dueAt!, TZ)).toBe("2026-02-01");
    const [g] = await t.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, s.occasion.id));
    expect(g).toMatchObject({ guestRevision: 1, guestRevisionReasonKey: "lifecycle.guest.postponed" });

    await runOnce(systemCtx(t.db, { now: NOW }), { names: [NOTIFY_GUESTS_JOB] });
    const mail = await t.db.select().from(emailOutbox).where(and(eq(emailOutbox.occasionId, s.occasion.id), eq(emailOutbox.template, "lifecycle.changed")));
    expect(mail).toHaveLength(2);
    expect(mail[0]!.bodyText).toContain("18.09.2027");

    // postponed again later: allowed; a preview made before another change is stale
    const p2 = await proposePostpone(s.ctx, { occasionId: s.occasion.id, startsOn: "2027-10-02" });
    const p3 = await proposePostpone(s.ctx, { occasionId: s.occasion.id, startsOn: "2027-11-06" });
    await confirmPreview(s.ctx, p2.id);
    expect(await code(confirmPreview(s.ctx, p3.id))).toBe("CONFLICT");
    expect(instantToDay((await getOccasion(s.ctx, s.occasion.id)).startsAt!, TZ)).toBe("2027-10-02");
  });
});

describe("closeout (B10)", () => {
  it("lists what is still open from every registered section, gated by grant", async () => {
    const s = await scene();
    registerCloseoutSection({
      key: "test-returns",
      titleKey: "suppliers.closeout.returns",
      collect: async (_ctx, occasionId) => (occasionId === s.occasion.id ? [{ key: "r1", label: "Scaune de returnat", amountMinor: null }] : []),
    });
    const closeout = await getCloseout(s.ctx, s.occasion.id);
    const section = (k: string) => closeout.sections.find((x) => x.key === k)!;
    expect(section("expenses.unpaid").items).toEqual([
      { key: s.unpaid.id, label: "Flori · Magnolia", amountMinor: 120_000, currency: "RON", noteKey: "lifecycle.closeout.notes.approvedUnpaid" },
    ]);
    expect(section("ledger.unsettled").items).toEqual([
      { key: `RON:${s.dan.id}:${s.ana.id}`, label: { key: "lifecycle.closeout.ledgerOwes", params: { from: "Dan", to: "Ana" } }, amountMinor: 30_000, currency: "RON" },
    ]);
    expect(section("test-returns").items).toHaveLength(1);
    expect(closeout.openItems).toBe(3);

    // without the finance grant the money sections are empty; the other domain's still shows
    const pm = await addMember(s.occasion.id, "pm");
    const forPm = await getCloseout(as(pm), s.occasion.id);
    expect(forPm.sections.find((x) => x.key === "expenses.unpaid")!.items).toEqual([]);
    expect(forPm.sections.find((x) => x.key === "ledger.unsettled")!.items).toEqual([]);
    expect(forPm.openItems).toBe(1);
    expect(await code(getCloseout(as(await makeAccount()), s.occasion.id))).toBe("NOT_FOUND");
    registerCloseoutSection({ key: "test-returns", titleKey: "x.y", collect: async () => [] });
  });

  it("closing sets closed_at (the retention clock) and makes the money domain read-only", async () => {
    const s = await scene();
    const [cat] = await addCategories(s.ctx, { occasionId: s.occasion.id, categories: [{ name: "Locație", estimateMinor: 100 }] });
    const before = await snapshot(s.occasion.id);
    const preview = await proposeClose(s.ctx, { occasionId: s.occasion.id });
    const keys = preview.delta.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["_status", "_readonly", "_retention", "_open", "tasks:open"]));
    expect(preview.delta.find((r) => r.key === "_open")!.what).toMatchObject({ params: { count: 2 } });
    expect(await snapshot(s.occasion.id)).toBe(before);

    const later = new Date("2026-03-03T09:00:00.000Z");
    await t.db.update(sessions).set({ freshAuthAt: later }).where(eq(sessions.accountId, s.owner));
    const [a, b] = await Promise.all([confirmPreview(as(s.owner, later), preview.id), confirmPreview(as(s.owner, later), preview.id)]);
    expect([a.appliedNow, b.appliedNow].sort()).toEqual([false, true]);
    const closed = await getOccasion(s.ctx, s.occasion.id);
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toEqual(later);
    // no guest email for a close
    expect(await t.db.select().from(jobs).where(eq(jobs.uniqueKey, `lifecycle:${preview.id}`))).toHaveLength(0);

    // every write in the money domain is refused with CONFLICT; reads still work
    const refused: Array<[string, () => Promise<unknown>]> = [
      ["addCategories", () => addCategories(s.ctx, { occasionId: s.occasion.id, categories: [{ name: "Nou" }] })],
      ["createExpense", () => createExpense(s.ctx, { occasionId: s.occasion.id, description: "x", amountMinor: 5, spentOn: "2026-03-01", idempotencyKey: key() })],
      ["markExpensePaid", () => markExpensePaid(s.ctx, { expenseId: s.unpaid.id })],
      ["setExpenseApproval", () => setExpenseApproval(s.ctx, { expenseId: s.unpaid.id, state: "rejected" })],
      ["addParticipant", () => addParticipant(s.ctx, { occasionId: s.occasion.id, kind: "other", name: "Nou" })],
      ["addLedgerEntry", () => addLedgerEntry(s.ctx, { occasionId: s.occasion.id, description: "x", amountMinor: 5, paidByParticipantId: s.ana.id, occurredOn: "2026-03-01", split: { mode: "even", participantIds: [s.ana.id] }, idempotencyKey: key() })],
    ];
    for (const [name, call] of refused) {
      const err = (await call().catch((e: unknown) => e)) as AppError;
      expect(`${name}:${err.code}:${err.messageKey}`).toBe(`${name}:CONFLICT:lifecycle.errors.closed`);
    }
    expect(cat).toBeDefined();
    expect((await getBudget(s.ctx, s.occasion.id)).totals[0]!.paidMinor).toBe(500_000);
    expect((await getLedger(s.ctx, s.occasion.id)).entries).toHaveLength(1);
    expect(await code(proposeClose(s.ctx, { occasionId: s.occasion.id }))).toBe("CONFLICT");
    expect(await code(proposeCancel(s.ctx, { occasionId: s.occasion.id }))).toBe("CONFLICT");

    // the retention clock: found once the closeout is old enough
    const sys = (now: Date) => systemCtx(t.db, { now });
    expect(await getClosedOccasionsOlderThan(sys(new Date("2026-03-20T00:00:00Z")), 30)).not.toContain(s.occasion.id);
    expect(await getClosedOccasionsOlderThan(sys(new Date("2026-04-03T00:00:00Z")), 30)).toContain(s.occasion.id);
    expect(await code(getClosedOccasionsOlderThan(s.ctx, 30))).toBe("FORBIDDEN");
  });

  it("lessons are saved to the account and offered on the next occasion", async () => {
    const s = await scene();
    const helper = await addMember(s.occasion.id, "contributor");
    await saveLesson(s.ctx, { occasionId: s.occasion.id, body: "Rezervă formația cu 9 luni înainte." });
    await saveLesson(s.ctx, { occasionId: s.occasion.id, body: "Rezervă formația cu 9 luni înainte. Mai puține feluri la meniu." }); // replaces
    await saveLesson(as(helper), { occasionId: s.occasion.id, body: "Notița mea" });
    expect((await getLesson(s.ctx, s.occasion.id))!.body).toContain("Mai puține feluri");
    expect(await t.db.select().from(lessons).where(eq(lessons.occasionId, s.occasion.id))).toHaveLength(2);
    expect(await code(saveLesson(as(await makeAccount()), { occasionId: s.occasion.id, body: "x" }))).toBe("NOT_FOUND");

    // the same person's next occasion: their own lessons, same kind first — never someone else's
    const trip = await createOccasion(s.ctx, { title: "Excursie", kind: "voiaj_grup", dateMode: "date", startsOn: "2027-08-01" });
    await saveLesson(s.ctx, { occasionId: trip.id, body: "Cumpără biletele din timp." });
    const next = await createOccasion(s.ctx, { title: "Botezul Mariei", kind: "blank", dateMode: "date", startsOn: "2028-05-01" });
    const mine = await listLessons(s.ctx, "blank", { exceptOccasionId: next.id });
    expect(mine.map((l) => l.occasionTitle)).toEqual(["Nunta Ioanei", "Excursie"]);
    expect(JSON.stringify(mine)).not.toContain("Notița mea");
    const overview = await getOverview(s.ctx, next.id);
    const block = overview.extra.find((x) => x.key === "lessons")!;
    expect(block.titleKey).toBe("lifecycle.lessons.overviewTitle");
    expect(block.lines[0]).toContain("Nunta Ioanei: Rezervă formația");
    // someone with no lessons gets no block
    const other = await makeAccount();
    const theirs = await createOccasion(as(other), { title: "Altă ocazie", kind: "blank", dateMode: "date", startsOn: "2028-05-01" });
    expect((await getOverview(as(other), theirs.id)).extra.find((x) => x.key === "lessons")).toBeUndefined();

    // an empty note removes it; lessons survive closing the occasion
    await saveLesson(as(helper), { occasionId: s.occasion.id, body: "  " });
    expect(await getLesson(as(helper), s.occasion.id)).toBeNull();
  });

  it("finance alerts reach the overview of finance holders only", async () => {
    const s = await scene();
    await addCategories(s.ctx, { occasionId: s.occasion.id, categories: [{ name: "Muzică", estimateMinor: 100_000, forecastMinor: 150_000 }] });
    const fin = (await getOverview(s.ctx, s.occasion.id)).extra.find((x) => x.key === "finance")!;
    expect(fin.lines).toEqual([
      { key: "budget.alerts.overrun", params: { category: "Muzică", amount: "500 RON" } },
      { key: "budget.alerts.unpaidApproved", params: { amount: "1.200 RON" } },
    ]);
    const pm = await addMember(s.occasion.id, "pm");
    expect((await getOverview(as(pm), s.occasion.id)).extra.find((x) => x.key === "finance")).toBeUndefined();
  });
});

describe("occasion purge keeps the bookkeeping records (INF6)", () => {
  it("paid expenses and receipts are detached and kept; the rest goes with the occasion", async () => {
    const s = await scene();
    const receiptId = newId();
    await t.db.insert(assets).values({ id: receiptId, ownerType: "occasion", ownerId: s.occasion.id, kind: "pdf", mime: "application/pdf", name: "chitanta.pdf", bytes: 10, sha256: "x", storageKey: "k", scanState: "clean", visibleAt: NOW });
    const withReceipt = await createExpense(s.ctx, { occasionId: s.occasion.id, description: "Tort", amountMinor: 80_000, spentOn: "2026-03-01", receiptAssetId: receiptId, idempotencyKey: key() });
    const plain = await createExpense(s.ctx, { occasionId: s.occasion.id, description: "Notă fără chitanță", amountMinor: 1_000, spentOn: "2026-03-01", idempotencyKey: key() });

    await requestDeletion(s.ctx, { targetType: "occasion", targetId: s.occasion.id });
    const sys = systemCtx(t.db, { now: new Date("2026-03-20T00:00:00Z") });
    expect(await purgeDueOccasions(sys)).toContain(s.occasion.id);
    expect(await t.db.select().from(occasions).where(eq(occasions.id, s.occasion.id))).toHaveLength(0);

    const kept = await t.db.select().from(expenses).where(eq(expenses.occasionId, s.occasion.id));
    expect(kept.map((e) => e.id).sort()).toEqual([s.paid.id, withReceipt.id].sort());
    expect(kept.every((e) => e.retainedAt !== null && e.categoryId === null)).toBe(true);
    expect(kept.map((e) => e.id)).not.toContain(plain.id);
    // the receipt file left the occasion's asset set, so the occasion's file purge did not delete it
    const [asset] = await t.db.select().from(assets).where(eq(assets.id, receiptId));
    expect(asset).toMatchObject({ ownerId: retainedOwnerId(s.occasion.id), deletedAt: null });
    // whatif previews, ledger, lessons: ledger cascades, lessons stay with the account
    expect(await t.db.select().from(whatifPreviews).where(eq(whatifPreviews.occasionId, s.occasion.id))).toHaveLength(0);

    // seven years later the retention job removes the retained rows and soft-deletes the receipt
    const early = await runRetention(systemCtx(t.db, { now: new Date("2032-03-01T00:00:00Z") }));
    expect(early.find((r) => r.name === "finance-records-retained")).toMatchObject({ deleted: 0 });
    const late = await runRetention(systemCtx(t.db, { now: new Date("2033-04-01T00:00:00Z") }));
    expect(late.find((r) => r.name === "finance-records-retained")).toMatchObject({ deleted: 2 });
    expect(await t.db.select().from(expenses).where(eq(expenses.occasionId, s.occasion.id))).toHaveLength(0);
    expect((await t.db.select().from(assets).where(eq(assets.id, receiptId)))[0]!.deletedAt).not.toBeNull();
  });
});
