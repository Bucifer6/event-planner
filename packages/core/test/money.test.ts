import { accounts, auditLog, corrections, eq, expenses, ledgerEntries, ledgerShares, occasionMembers, sessions, sql } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId, type AppError } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getMember } from "../src/access";
import {
  addCategories,
  exportBudgetCsv,
  getBudget,
  getBudgetAlerts,
  listCategories,
  presetsForKind,
  registerBudgetSource,
  removeCategory,
  updateCategory,
} from "../src/budget";
import { accountCtx, type Ctx } from "../src/context";
import { listCorrections, recordCorrection } from "../src/corrections";
import {
  correctExpense,
  createExpense,
  deleteExpense,
  getExpense,
  getReceiptUrl,
  listExpenseCorrections,
  listExpenses,
  markExpensePaid,
  setExpenseApproval,
  updateExpense,
} from "../src/expenses";
import { listExports, runExport } from "../src/exports";
import {
  addLedgerEntry,
  addParticipant,
  computeShares,
  exportLedgerCsv,
  getLedger,
  getOwnBalance,
  listParticipantCandidates,
  listParticipants,
  recordSettlement,
  removeParticipant,
  settleUp,
  voidLedgerEntry,
  type SplitInput,
} from "../src/ledger";
import { createOccasion } from "../src/occasions";
import { inTx } from "../src/tx";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const NOW = new Date("2026-03-02T08:00:00.000Z");

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

async function makeAccount(): Promise<string> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `${id}@example.ro` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: NOW, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000), freshAuthAt: NOW });
  return id;
}
const as = (accountId: string): Ctx => accountCtx(t.db, accountId, { now: NOW });

async function addMember(occasionId: string, role: "pm" | "contributor", finance = false) {
  const accountId = await makeAccount();
  const [row] = await t.db.insert(occasionMembers).values({ occasionId, accountId, role, grantFinance: finance }).returning();
  return { accountId, memberId: row!.id };
}

async function wedding() {
  const owner = await makeAccount();
  const occasion = await createOccasion(as(owner), { title: "Nunta Ioanei", kind: "nunta", dateMode: "date", startsOn: "2027-06-12" });
  const me = (await getMember(as(owner), occasion.id))!;
  return { owner, occasion, ownerMemberId: me.id, ctx: as(owner) };
}

let keyN = 0;
const key = () => `test-key-${++keyN}-${newId()}`;

describe("budget by category (B1)", () => {
  it("keeps the five amounts separate; estimate and forecast are entered, the rest derived", async () => {
    const { ctx, occasion } = await wedding();
    const [venue, music] = await addCategories(ctx, {
      occasionId: occasion.id,
      categories: [
        { name: "Locație", presetKey: "venue", estimateMinor: 2_000_000, forecastMinor: 2_300_000 },
        { name: "Muzică", presetKey: "music" },
      ],
    });
    const a = await createExpense(ctx, { occasionId: occasion.id, categoryId: venue!.id, description: "Avans sală", amountMinor: 500_000, spentOn: "2026-03-01", idempotencyKey: key() });
    const b = await createExpense(ctx, { occasionId: occasion.id, categoryId: venue!.id, description: "Rată sală", amountMinor: 300_000, spentOn: "2026-03-02", idempotencyKey: key() });
    const c = await createExpense(ctx, { occasionId: occasion.id, categoryId: venue!.id, description: "Ofertă respinsă", amountMinor: 70_000, spentOn: "2026-03-02", idempotencyKey: key() });
    await createExpense(ctx, { occasionId: occasion.id, description: "Taxi", amountMinor: 4_550, spentOn: "2026-03-02", idempotencyKey: key() });
    await setExpenseApproval(ctx, { expenseId: a.id, state: "approved" });
    await markExpensePaid(ctx, { expenseId: a.id });
    await setExpenseApproval(ctx, { expenseId: b.id, state: "approved" });
    await setExpenseApproval(ctx, { expenseId: c.id, state: "rejected" });

    const budget = await getBudget(ctx, occasion.id);
    const v = budget.rows.find((r) => r.categoryId === venue!.id)!;
    expect(v).toMatchObject({ estimateMinor: 2_000_000, forecastMinor: 2_300_000, committedMinor: 800_000, invoicedMinor: 800_000, paidMinor: 500_000, overrunMinor: 300_000 });
    // unknown stays unknown: a category with no estimate is NULL, never 0 (principle 5)
    const m = budget.rows.find((r) => r.categoryId === music!.id)!;
    expect(m.estimateMinor).toBeNull();
    expect(m.forecastMinor).toBeNull();
    expect(m).toMatchObject({ committedMinor: 0, invoicedMinor: 0, paidMinor: 0 });
    const none = budget.rows.find((r) => r.categoryId === null)!;
    expect(none).toMatchObject({ committedMinor: 0, invoicedMinor: 4_550, paidMinor: 0, estimateMinor: null });

    const total = budget.totals[0]!;
    expect(total).toMatchObject({ currency: "RON", estimateMinor: 2_000_000, estimateUnknown: 1, forecastMinor: 2_300_000, forecastUnknown: 1, committedMinor: 800_000, invoicedMinor: 804_550, paidMinor: 500_000 });

    // clearing an estimate makes it unknown again, not zero
    await updateCategory(ctx, { categoryId: venue!.id, estimateMinor: null });
    expect((await getBudget(ctx, occasion.id)).totals[0]!.estimateMinor).toBeNull();

    const csv = await exportBudgetCsv(ctx, occasion.id);
    expect(csv).toContain("Estimat,Angajat,Facturat,Plătit,Prognoză");
    expect(csv).toContain("Muzică,RON,necunoscut,0.00,0.00,0.00,necunoscut");

    const alerts = await getBudgetAlerts(ctx, occasion.id);
    expect(alerts.unpaidApproved).toEqual({ count: 1, totals: [{ currency: "RON", amountMinor: 300_000 }] });
  });

  it("adds what registered budget sources report to the derived columns only", async () => {
    const { ctx, occasion } = await wedding();
    const [photo] = await addCategories(ctx, { occasionId: occasion.id, categories: [{ name: "Foto", estimateMinor: 100_000 }] });
    registerBudgetSource({
      key: "test-bookings",
      sums: async (_ctx, occasionId) =>
        occasionId === occasion.id
          ? [
              { categoryId: photo!.id, committedMinor: 90_000, invoicedMinor: 30_000, paidMinor: 30_000, currency: "RON" },
              { categoryId: "gone-category", committedMinor: 1_000, invoicedMinor: 0, paidMinor: 0, currency: "RON" },
              { categoryId: photo!.id, committedMinor: 5_000, invoicedMinor: 0, paidMinor: 0, currency: "EUR" },
            ]
          : [],
    });
    const budget = await getBudget(ctx, occasion.id);
    expect(budget.rows.find((r) => r.categoryId === photo!.id && r.currency === "RON")).toMatchObject({ estimateMinor: 100_000, committedMinor: 90_000, invoicedMinor: 30_000, paidMinor: 30_000 });
    expect(budget.rows.find((r) => r.categoryId === null && r.currency === "RON")).toMatchObject({ committedMinor: 1_000 });
    // another currency keeps its own row and its own total — no conversion
    expect(budget.rows.find((r) => r.categoryId === photo!.id && r.currency === "EUR")).toMatchObject({ committedMinor: 5_000, estimateMinor: null });
    expect(budget.totals.map((x) => x.currency)).toEqual(["RON", "EUR"]);
    registerBudgetSource({ key: "test-bookings", sums: async () => [] });
  });

  it("offers default categories per occasion kind; adding the same name twice adds nothing", async () => {
    const { ctx, occasion } = await wedding();
    expect(presetsForKind("nunta")).toContain("venue");
    expect(presetsForKind("voiaj_grup")).toContain("lodging");
    const cats = [{ name: "Locație", presetKey: "venue" as const }, { name: "Muzică", presetKey: "music" as const }];
    expect(await addCategories(ctx, { occasionId: occasion.id, categories: cats })).toHaveLength(2);
    expect(await addCategories(ctx, { occasionId: occasion.id, categories: cats })).toHaveLength(0); // double tap
    expect(await listCategories(ctx, occasion.id)).toHaveLength(2);
    expect(await code(addCategories(ctx, { occasionId: occasion.id, categories: [{ name: "locație" }] }))).toBe("VALIDATION");
  });

  it("removing a category keeps its expenses, uncategorised", async () => {
    const { ctx, occasion } = await wedding();
    const [cat] = await addCategories(ctx, { occasionId: occasion.id, categories: [{ name: "Flori" }] });
    const e = await createExpense(ctx, { occasionId: occasion.id, categoryId: cat!.id, description: "Buchet", amountMinor: 45_000, spentOn: "2026-03-01", idempotencyKey: key() });
    await markExpensePaid(ctx, { expenseId: e.id });
    await removeCategory(ctx, { categoryId: cat!.id });
    await removeCategory(ctx, { categoryId: cat!.id }); // idempotent
    const after = await getExpense(ctx, e.id);
    expect(after.categoryId).toBeNull();
    expect((await getBudget(ctx, occasion.id)).totals[0]!.paidMinor).toBe(45_000);
  });
});

describe("finance grant (D2)", () => {
  it("a member without the finance grant gets FORBIDDEN on every budget, expense and ledger function", async () => {
    const { ctx, occasion } = await wedding();
    const [cat] = await addCategories(ctx, { occasionId: occasion.id, categories: [{ name: "Locație" }] });
    const exp = await createExpense(ctx, { occasionId: occasion.id, description: "Avans", amountMinor: 1000, spentOn: "2026-03-01", idempotencyKey: key() });
    const p1 = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Ana" });
    const p2 = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Dan" });
    const entry = await addLedgerEntry(ctx, { occasionId: occasion.id, description: "Cabană", amountMinor: 1000, paidByParticipantId: p1.id, occurredOn: "2026-03-01", split: { mode: "even", participantIds: [p1.id, p2.id] }, idempotencyKey: key() });

    // a project manager is a manager — and still has no finance access without the grant
    for (const role of ["contributor", "pm"] as const) {
      const m = await addMember(occasion.id, role);
      const x = as(m.accountId);
      const calls: Array<[string, () => Promise<unknown>]> = [
        ["getBudget", () => getBudget(x, occasion.id)],
        ["listCategories", () => listCategories(x, occasion.id)],
        ["addCategories", () => addCategories(x, { occasionId: occasion.id, categories: [{ name: "X" }] })],
        ["updateCategory", () => updateCategory(x, { categoryId: cat!.id, estimateMinor: 5 })],
        ["removeCategory", () => removeCategory(x, { categoryId: cat!.id })],
        ["getBudgetAlerts", () => getBudgetAlerts(x, occasion.id)],
        ["exportBudgetCsv", () => exportBudgetCsv(x, occasion.id)],
        ["listExpenses", () => listExpenses(x, occasion.id)],
        ["getExpense", () => getExpense(x, exp.id)],
        ["createExpense", () => createExpense(x, { occasionId: occasion.id, description: "Y", amountMinor: 1, spentOn: "2026-03-01", idempotencyKey: key() })],
        ["updateExpense", () => updateExpense(x, { expenseId: exp.id, description: "Z", spentOn: "2026-03-01" })],
        ["setExpenseApproval", () => setExpenseApproval(x, { expenseId: exp.id, state: "approved" })],
        ["markExpensePaid", () => markExpensePaid(x, { expenseId: exp.id })],
        ["correctExpense", () => correctExpense(x, { expenseId: exp.id, reason: "greșeală", amountMinor: 5 })],
        ["deleteExpense", () => deleteExpense(x, { expenseId: exp.id })],
        ["getReceiptUrl", () => getReceiptUrl(x, exp.id)],
        ["listExpenseCorrections", () => listExpenseCorrections(x, exp.id)],
        ["getLedger", () => getLedger(x, occasion.id)],
        ["listParticipants", () => listParticipants(x, occasion.id)],
        ["listParticipantCandidates", () => listParticipantCandidates(x, occasion.id)],
        ["addParticipant", () => addParticipant(x, { occasionId: occasion.id, kind: "other", name: "Q" })],
        ["removeParticipant", () => removeParticipant(x, { participantId: p2.id })],
        ["addLedgerEntry", () => addLedgerEntry(x, { occasionId: occasion.id, description: "c", amountMinor: 10, paidByParticipantId: p1.id, occurredOn: "2026-03-01", split: { mode: "even", participantIds: [p1.id] }, idempotencyKey: key() })],
        ["recordSettlement", () => recordSettlement(x, { occasionId: occasion.id, fromParticipantId: p2.id, toParticipantId: p1.id, amountMinor: 10, occurredOn: "2026-03-01", idempotencyKey: key() })],
        ["voidLedgerEntry", () => voidLedgerEntry(x, { entryId: entry.id, reason: "greșeală" })],
        ["exportLedgerCsv", () => exportLedgerCsv(x, occasion.id)],
        ["runExport budget", () => runExport(x, occasion.id, "budget-csv")],
        ["runExport ledger", () => runExport(x, occasion.id, "ledger-csv")],
      ];
      for (const [name, call] of calls) expect(`${name}:${await code(call())}`).toBe(`${name}:FORBIDDEN`);
      expect((await listExports(x, occasion.id)).map((e) => e.key)).not.toContain("budget-csv");
    }
    // nothing changed
    expect((await getExpense(ctx, exp.id)).approvalState).toBe("pending");
    // strangers never learn anything exists
    const stranger = await makeAccount();
    expect(await code(getBudget(as(stranger), occasion.id))).toBe("NOT_FOUND");
    expect(await code(getExpense(as(stranger), exp.id))).toBe("NOT_FOUND");

    // with the grant a contributor reads and records; approving stays with owner / PM
    const fin = await addMember(occasion.id, "contributor", true);
    expect((await getBudget(as(fin.accountId), occasion.id)).rows.length).toBeGreaterThan(0);
    expect(await code(setExpenseApproval(as(fin.accountId), { expenseId: exp.id, state: "approved" }))).toBe("FORBIDDEN");
    expect((await listExports(as(fin.accountId), occasion.id)).map((e) => e.key)).toEqual(expect.arrayContaining(["budget-csv", "ledger-csv"]));
  });

  it("a participant without the grant sees only their own balance", async () => {
    const { ctx, occasion, ownerMemberId } = await wedding();
    const c = await addMember(occasion.id, "contributor");
    const me = await addParticipant(ctx, { occasionId: occasion.id, kind: "member", memberId: ownerMemberId, name: "Ioana" });
    const them = await addParticipant(ctx, { occasionId: occasion.id, kind: "member", memberId: c.memberId, name: "Radu" });
    const other = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Mara" });
    await addLedgerEntry(ctx, { occasionId: occasion.id, description: "Cabană", amountMinor: 90_000, paidByParticipantId: me.id, occurredOn: "2026-03-01", split: { mode: "even", participantIds: [me.id, them.id, other.id] }, idempotencyKey: key() });
    const own = await getOwnBalance(as(c.accountId), occasion.id);
    expect(own).toEqual({
      participantId: them.id,
      name: "Radu",
      perCurrency: [{ currency: "RON", balanceMinor: -30_000, transfers: [{ direction: "pay", otherName: "Ioana", amountMinor: 30_000 }] }],
    });
    expect(await code(getLedger(as(c.accountId), occasion.id))).toBe("FORBIDDEN");
    const outsider = await addMember(occasion.id, "contributor");
    expect(await getOwnBalance(as(outsider.accountId), occasion.id)).toBeNull();
  });
});

describe("expenses (B2)", () => {
  it("approval and payment are independent states", async () => {
    const { ctx, occasion } = await wedding();
    const mk = (d: string) => createExpense(ctx, { occasionId: occasion.id, description: d, amountMinor: 10_000, spentOn: "2026-03-01", idempotencyKey: key() });
    const approvedUnpaid = await mk("aprobată, neplătită");
    const paidUnapproved = await mk("plătită, neaprobată");
    expect(approvedUnpaid).toMatchObject({ approvalState: "pending", paymentState: "unpaid" });

    expect(await setExpenseApproval(ctx, { expenseId: approvedUnpaid.id, state: "approved" })).toMatchObject({ approvalState: "approved", paymentState: "unpaid" });
    expect(await markExpensePaid(ctx, { expenseId: paidUnapproved.id, paidOn: "2026-02-27" })).toMatchObject({ approvalState: "pending", paymentState: "paid", paidOn: "2026-02-27" });
    // each state moves without touching the other
    expect(await setExpenseApproval(ctx, { expenseId: paidUnapproved.id, state: "rejected" })).toMatchObject({ approvalState: "rejected", paymentState: "paid" });
    expect(await markExpensePaid(ctx, { expenseId: approvedUnpaid.id })).toMatchObject({ approvalState: "approved", paymentState: "paid" });
    expect(await setExpenseApproval(ctx, { expenseId: approvedUnpaid.id, state: "pending" })).toMatchObject({ approvalState: "pending", paymentState: "paid" });
    // marking paid twice is applied once
    const paidAt = (await getExpense(ctx, approvedUnpaid.id)).paidAt;
    await markExpensePaid(ctx, { expenseId: approvedUnpaid.id, paidOn: "2020-01-01" });
    expect((await getExpense(ctx, approvedUnpaid.id)).paidAt).toEqual(paidAt);
    expect((await getExpense(ctx, approvedUnpaid.id)).paidOn).not.toBe("2020-01-01");
  });

  it("creating with the same idempotency key creates one expense", async () => {
    const { ctx, occasion } = await wedding();
    const k = key();
    const input = { occasionId: occasion.id, description: "Tort", amountMinor: 80_000, spentOn: "2026-03-01", idempotencyKey: k };
    const [a, b] = await Promise.all([createExpense(ctx, input), createExpense(ctx, input)]);
    const c = await createExpense(ctx, { ...input, amountMinor: 99_999 });
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(c.amountMinor).toBe(80_000);
    expect(await listExpenses(ctx, occasion.id)).toHaveLength(1);
    expect(await code(createExpense(ctx, { ...input, idempotencyKey: key(), amountMinor: 0 }))).toBe("VALIDATION");
  });

  it("a paid expense is a fact: the database rejects a direct UPDATE or DELETE", async () => {
    const { ctx, occasion } = await wedding();
    const e = await createExpense(ctx, { occasionId: occasion.id, description: "Formație", amountMinor: 300_000, spentOn: "2026-03-01", idempotencyKey: key() });
    // unpaid: free to edit
    await t.db.update(expenses).set({ amountMinor: 310_000 }).where(eq(expenses.id, e.id));
    await markExpensePaid(ctx, { expenseId: e.id });

    await expect(t.db.update(expenses).set({ amountMinor: 1 }).where(eq(expenses.id, e.id))).rejects.toThrow();
    await expect(t.db.update(expenses).set({ paymentState: "unpaid" }).where(eq(expenses.id, e.id))).rejects.toThrow();
    await expect(t.db.update(expenses).set({ currency: "EUR" }).where(eq(expenses.id, e.id))).rejects.toThrow();
    await expect(t.db.delete(expenses).where(eq(expenses.id, e.id))).rejects.toThrow();
    await expect(t.db.execute(sql`update expenses set amount_minor = 5 where id = ${e.id}`)).rejects.toMatchObject({
      cause: { message: expect.stringContaining("only through a correction") },
    });
    // other columns stay editable
    await t.db.update(expenses).set({ description: "Formația Zori" }).where(eq(expenses.id, e.id));
    expect(await getExpense(ctx, e.id)).toMatchObject({ amountMinor: 310_000, paymentState: "paid", description: "Formația Zori" });

    // API: editing the amount or deleting is refused, with the way out named
    expect(await code(updateExpense(ctx, { expenseId: e.id, description: "x", spentOn: "2026-03-01", amountMinor: 5 }))).toBe("VALIDATION");
    expect(await code(deleteExpense(ctx, { expenseId: e.id }))).toBe("CONFLICT");
    // the GUC does not leak out of the correction transaction
    await correctExpense(ctx, { expenseId: e.id, reason: "suma de pe chitanță era alta", amountMinor: 305_000 });
    await expect(t.db.update(expenses).set({ amountMinor: 1 }).where(eq(expenses.id, e.id))).rejects.toThrow();
  });

  it("the correction path changes a paid expense and leaves correction + audit rows", async () => {
    const { ctx, occasion } = await wedding();
    const e = await createExpense(ctx, { occasionId: occasion.id, description: "Flori", amountMinor: 120_000, spentOn: "2026-03-01", idempotencyKey: key() });
    expect(await code(correctExpense(ctx, { expenseId: e.id, reason: "nu e plătită", amountMinor: 5 }))).toBe("CONFLICT");
    await markExpensePaid(ctx, { expenseId: e.id, paidOn: "2026-03-01" });

    expect(await code(correctExpense(ctx, { expenseId: e.id, reason: "", amountMinor: 5 }))).toBe("VALIDATION"); // reason required
    expect(await code(correctExpense(ctx, { expenseId: e.id, reason: "fără schimbare" }))).toBe("VALIDATION");

    const after = await correctExpense(ctx, { expenseId: e.id, reason: "am tastat greșit suma", amountMinor: 125_000 });
    expect(after).toMatchObject({ amountMinor: 125_000, paymentState: "paid" });
    const unpaid = await correctExpense(ctx, { expenseId: e.id, reason: "plata nu a plecat din bancă", markUnpaid: true });
    expect(unpaid).toMatchObject({ paymentState: "unpaid", paidAt: null, paidOn: null, amountMinor: 125_000 });

    const history = await listExpenseCorrections(ctx, e.id);
    expect(history.map((h) => [h.field, h.before, h.after, h.reason])).toEqual([
      ["amountMinor", 120_000, 125_000, "am tastat greșit suma"],
      ["paymentState", { paymentState: "paid", paidOn: "2026-03-01" }, { paymentState: "unpaid" }, "plata nu a plecat din bancă"],
    ]);
    expect(history[0]).toMatchObject({ occasionId: occasion.id, actorKind: "account", targetTable: "expenses" });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.objectId, e.id));
    expect(audits.filter((a) => a.action === "correction.recorded")).toHaveLength(2);

    // a contributor with the finance grant cannot correct facts
    const fin = await addMember(occasion.id, "contributor", true);
    await markExpensePaid(ctx, { expenseId: e.id });
    expect(await code(correctExpense(as(fin.accountId), { expenseId: e.id, reason: "încerc", markUnpaid: true }))).toBe("FORBIDDEN");
  });

  it("corrections are append-only and need a reason", async () => {
    const { ctx, occasion } = await wedding();
    const id = await inTx(ctx, (tx) => recordCorrection(tx, { occasionId: occasion.id, targetTable: "things", targetId: "t1", field: "qty", before: 1, after: 2, reason: "numărat greșit" }));
    expect(await listCorrections(ctx, { targetTable: "things", targetId: "t1" })).toHaveLength(1);
    await expect(t.db.update(corrections).set({ reason: "altul" }).where(eq(corrections.id, id))).rejects.toThrow();
    await expect(t.db.delete(corrections).where(eq(corrections.id, id))).rejects.toThrow();
    expect(await code(recordCorrection(ctx, { targetTable: "things", targetId: "t1", field: "qty", before: 1, after: 2, reason: " " }))).toBe("VALIDATION");
  });

  it("links an expense to a booking id and refuses another occasion's category", async () => {
    const { ctx, occasion } = await wedding();
    const other = await wedding();
    const [foreign] = await addCategories(other.ctx, { occasionId: other.occasion.id, categories: [{ name: "Locație" }] });
    expect(await code(createExpense(ctx, { occasionId: occasion.id, categoryId: foreign!.id, description: "x", amountMinor: 5, spentOn: "2026-03-01", idempotencyKey: key() }))).toBe("VALIDATION");
    expect(await code(createExpense(ctx, { occasionId: occasion.id, receiptAssetId: "nosuchasset", description: "x", amountMinor: 5, spentOn: "2026-03-01", idempotencyKey: key() }))).toBe("VALIDATION");
    const e = await createExpense(ctx, { occasionId: occasion.id, bookingId: "booking123", description: "Avans foto", amountMinor: 50_000, spentOn: "2026-03-01", idempotencyKey: key() });
    expect((await listExpenses(ctx, occasion.id, { bookingId: "booking123" })).map((x) => x.id)).toEqual([e.id]);
    expect(await getReceiptUrl(ctx, e.id)).toBeNull();
  });
});

describe("shared-cost ledger (B3)", () => {
  /** Small deterministic PRNG so a failure can be reproduced. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("balances sum to zero per currency for any split (random splits)", async () => {
    const { ctx, occasion } = await wedding();
    const people = [];
    for (const name of ["Ana", "Bogdan", "Corina", "Dan", "Elena", "Florin", "Gina"]) {
      people.push(await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name }));
    }
    const rand = rng(20260302);
    const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;
    const currencies = ["RON", "RON", "EUR", "HUF"];
    for (let i = 0; i < 60; i++) {
      const amountMinor = 1 + Math.floor(rand() * 500_000);
      const currency = pick(currencies);
      const chosen = people.filter(() => rand() < 0.6);
      const some = chosen.length ? chosen : [pick(people)];
      const mode = pick(["even", "shares", "exact", "settlement"] as const);
      if (mode === "settlement") {
        const from = pick(people);
        const to = pick(people.filter((p) => p.id !== from.id));
        await recordSettlement(ctx, { occasionId: occasion.id, fromParticipantId: from.id, toParticipantId: to.id, amountMinor, currency, occurredOn: "2026-03-01", idempotencyKey: key() });
        continue;
      }
      let split: SplitInput;
      if (mode === "even") split = { mode, participantIds: some.map((p) => p.id) };
      else if (mode === "shares") split = { mode, shares: some.map((p, n) => ({ participantId: p.id, weight: n === 0 ? 1 + Math.floor(rand() * 7) : Math.floor(rand() * 7) })) };
      else {
        // random cut points that add up exactly
        let left = amountMinor;
        const amounts = some.map((p, n) => {
          const part = n === some.length - 1 ? left : Math.floor(rand() * (left + 1));
          left -= part;
          return { participantId: p.id, amountMinor: part };
        });
        split = { mode, amounts };
      }
      const entry = await addLedgerEntry(ctx, { occasionId: occasion.id, description: `cost ${i}`, amountMinor, currency, paidByParticipantId: pick(people).id, occurredOn: "2026-03-01", split, idempotencyKey: key() });
      if (rand() < 0.1) await voidLedgerEntry(ctx, { entryId: entry.id, reason: "înregistrat de două ori" });
    }
    const ledger = await getLedger(ctx, occasion.id);
    expect(ledger.settlements.map((s) => s.currency).sort()).toEqual(["EUR", "HUF", "RON"]);
    for (const s of ledger.settlements) {
      expect(s.balances.reduce((n, b) => n + b.balanceMinor, 0)).toBe(0);
      // applying the suggested transfers brings everyone to exactly zero
      const after = new Map(s.balances.map((b) => [b.participantId, b.balanceMinor]));
      for (const tr of s.transfers) {
        expect(tr.amountMinor).toBeGreaterThan(0);
        after.set(tr.fromParticipantId, after.get(tr.fromParticipantId)! + tr.amountMinor);
        after.set(tr.toParticipantId, after.get(tr.toParticipantId)! - tr.amountMinor);
      }
      expect([...after.values()].every((v) => v === 0)).toBe(true);
      expect(s.transfers.length).toBeLessThanOrEqual(Math.max(0, s.balances.filter((b) => b.balanceMinor !== 0).length - 1));
    }
    // every entry's shares sum exactly to its amount
    const sums = await t.db
      .select({ id: ledgerEntries.id, amount: ledgerEntries.amountMinor, shares: sql<string>`sum(${ledgerShares.shareMinor})` })
      .from(ledgerEntries)
      .innerJoin(ledgerShares, eq(ledgerShares.entryId, ledgerEntries.id))
      .where(eq(ledgerEntries.occasionId, occasion.id))
      .groupBy(ledgerEntries.id);
    expect(sums.length).toBeGreaterThan(40);
    for (const s of sums) expect(Number(s.shares)).toBe(s.amount);
  });

  it("pure split maths: remainders are spread, never lost", () => {
    expect(computeShares(100, "RON", { mode: "even", participantIds: ["a", "b", "c"] }).map((s) => s.shareMinor)).toEqual([34, 33, 33]);
    expect(computeShares(1000, "RON", { mode: "shares", shares: [{ participantId: "a", weight: 2 }, { participantId: "b", weight: 1 }, { participantId: "c", weight: 0 }] })).toEqual([
      { participantId: "a", shareMinor: 667, weight: 2 },
      { participantId: "b", shareMinor: 333, weight: 1 },
    ]);
    const rand = rng(7);
    for (let i = 0; i < 300; i++) {
      const total = 1 + Math.floor(rand() * 1_000_000);
      const n = 1 + Math.floor(rand() * 9);
      const ids = Array.from({ length: n }, (_, k) => `p${k}`);
      expect(computeShares(total, "RON", { mode: "even", participantIds: ids }).reduce((s, x) => s + x.shareMinor, 0)).toBe(total);
      const shares = ids.map((participantId, k) => ({ participantId, weight: k === 0 ? 1 : Math.floor(rand() * 5) }));
      expect(computeShares(total, "RON", { mode: "shares", shares }).reduce((s, x) => s + x.shareMinor, 0)).toBe(total);
    }
  });

  it("rejects an unbalanced exact split with a field error that says the difference", async () => {
    const { ctx, occasion } = await wedding();
    const a = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Ana" });
    const b = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Dan" });
    const attempt = (x: number, y: number) =>
      addLedgerEntry(ctx, { occasionId: occasion.id, description: "Cină", amountMinor: 30_000, paidByParticipantId: a.id, occurredOn: "2026-03-01", split: { mode: "exact", amounts: [{ participantId: a.id, amountMinor: x }, { participantId: b.id, amountMinor: y }] }, idempotencyKey: key() });
    const short = (await attempt(10_000, 15_000).catch((e: unknown) => e)) as AppError;
    expect(short.code).toBe("VALIDATION");
    expect(short.messageKey).toBe("ledger.errors.exactShort");
    expect(short.details).toMatchObject({ fieldErrors: { split: ["ledger.errors.exactShort"] }, params: { difference: "50 RON", total: "300 RON", entered: "250 RON" } });
    const over = (await attempt(20_000, 10_050).catch((e: unknown) => e)) as AppError;
    expect(over.messageKey).toBe("ledger.errors.exactOver");
    expect(over.details).toMatchObject({ params: { difference: "0,50 RON" } });
    expect((await getLedger(ctx, occasion.id)).entries).toHaveLength(0);
    await attempt(10_000, 20_000);
    expect(await code(addLedgerEntry(ctx, { occasionId: occasion.id, description: "x", amountMinor: 10, paidByParticipantId: a.id, occurredOn: "2026-03-01", split: { mode: "even", participantIds: [] }, idempotencyKey: key() }))).toBe("VALIDATION");
  });

  it("settlement: minimal transfers on a known example; a recorded settle-up is an entry too", async () => {
    const { ctx, occasion } = await wedding();
    const [ana, bogdan, corina, dan] = await Promise.all(["Ana", "Bogdan", "Corina", "Dan"].map((name) => addParticipant(ctx, { occasionId: occasion.id, kind: "other", name })));
    const all = [ana!.id, bogdan!.id, corina!.id, dan!.id];
    const add = (description: string, amountMinor: number, payer: string, currency = "RON") =>
      addLedgerEntry(ctx, { occasionId: occasion.id, description, amountMinor, currency, paidByParticipantId: payer, occurredOn: "2026-03-01", split: { mode: "even", participantIds: all }, idempotencyKey: key() });
    await add("Cabană", 120_000, ana!.id); // each owes 300
    await add("Mâncare", 40_000, bogdan!.id); // each owes 100
    await add("Benzină", 80, corina!.id, "EUR"); // each owes 0,20 EUR

    let ledger = await getLedger(ctx, occasion.id);
    const ron = ledger.settlements.find((s) => s.currency === "RON")!;
    const bal = (id: string) => ron.balances.find((b) => b.participantId === id)!.balanceMinor;
    expect([bal(ana!.id), bal(bogdan!.id), bal(corina!.id), bal(dan!.id)]).toEqual([80_000, 0, -40_000, -40_000]);
    // Bogdan is square: only two payments are needed, both to Ana
    expect(ron.transfers).toHaveLength(2);
    expect(ron.transfers.every((x) => x.toParticipantId === ana!.id && x.amountMinor === 40_000)).toBe(true);
    expect(ron.transfers.map((x) => x.fromParticipantId).sort()).toEqual([corina!.id, dan!.id].sort());
    expect(ron.totalCostMinor).toBe(160_000);
    // the EUR row keeps its own currency and its own settlement
    const eur = ledger.settlements.find((s) => s.currency === "EUR")!;
    expect(eur.balances.reduce((n, b) => n + b.balanceMinor, 0)).toBe(0);
    expect(eur.transfers).toHaveLength(3);

    // Corina pays Ana back: a fact, recorded once even on a double tap
    const k = key();
    const pay = { occasionId: occasion.id, fromParticipantId: corina!.id, toParticipantId: ana!.id, amountMinor: 40_000, occurredOn: "2026-03-02", idempotencyKey: k };
    const [s1, s2] = await Promise.all([recordSettlement(ctx, pay), recordSettlement(ctx, pay)]);
    expect(s1.id).toBe(s2.id);
    expect(s1.kind).toBe("settlement");
    ledger = await getLedger(ctx, occasion.id);
    const ron2 = ledger.settlements.find((s) => s.currency === "RON")!;
    expect(ron2.transfers).toEqual([{ fromParticipantId: dan!.id, toParticipantId: ana!.id, amountMinor: 40_000 }]);
    expect(ron2.totalCostMinor).toBe(160_000); // settlements are not costs
    expect(ledger.entries.filter((e) => e.kind === "settlement")).toHaveLength(1);

    // entries are facts: no direct edit; voiding goes through a correction
    await expect(t.db.update(ledgerEntries).set({ amountMinor: 1 }).where(eq(ledgerEntries.id, s1.id))).rejects.toThrow();
    await expect(t.db.update(ledgerShares).set({ shareMinor: 1 }).where(eq(ledgerShares.entryId, s1.id))).rejects.toThrow();
    expect(await code(voidLedgerEntry(ctx, { entryId: s1.id, reason: "" }))).toBe("VALIDATION");
    await voidLedgerEntry(ctx, { entryId: s1.id, reason: "plata nu s-a făcut" });
    await voidLedgerEntry(ctx, { entryId: s1.id, reason: "plata nu s-a făcut" }); // idempotent
    expect(await listCorrections(ctx, { targetTable: "ledger_entries", targetId: s1.id })).toHaveLength(1);
    expect((await getLedger(ctx, occasion.id)).settlements.find((s) => s.currency === "RON")!.transfers).toHaveLength(2);

    expect(await code(removeParticipant(ctx, { participantId: dan!.id }))).toBe("CONFLICT");
    const csv = await exportLedgerCsv(ctx, occasion.id);
    expect(csv).toContain("Cabană");
    expect(csv).toContain("anulat");
  });

  it("settleUp is deterministic and refuses balances that do not sum to zero", () => {
    expect(settleUp([{ participantId: "a", balanceMinor: 500 }, { participantId: "b", balanceMinor: -200 }, { participantId: "c", balanceMinor: -300 }])).toEqual([
      { fromParticipantId: "c", toParticipantId: "a", amountMinor: 300 },
      { fromParticipantId: "b", toParticipantId: "a", amountMinor: 200 },
    ]);
    expect(settleUp([])).toEqual([]);
    expect(() => settleUp([{ participantId: "a", balanceMinor: 1 }])).toThrow();
  });

  it("members and households are added once as participants", async () => {
    const { ctx, occasion, ownerMemberId } = await wedding();
    const a = await addParticipant(ctx, { occasionId: occasion.id, kind: "member", memberId: ownerMemberId });
    const b = await addParticipant(ctx, { occasionId: occasion.id, kind: "member", memberId: ownerMemberId });
    expect(a.id).toBe(b.id);
    expect(a.name).toContain("@example.ro");
    expect((await listParticipantCandidates(ctx, occasion.id)).members).toHaveLength(0);
    expect(await code(addParticipant(ctx, { occasionId: occasion.id, kind: "member", memberId: "nosuchmember" }))).toBe("VALIDATION");
    const free = await addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "Bunica" });
    expect(await code(addParticipant(ctx, { occasionId: occasion.id, kind: "other", name: "bunica" }))).toBe("VALIDATION");
    await removeParticipant(ctx, { participantId: free.id });
    expect(await listParticipants(ctx, occasion.id)).toHaveLength(1);
  });
});
