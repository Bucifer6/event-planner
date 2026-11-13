import { accounts, and, auditLog, corrections, deliveryItems, eq, occasionMembers, occasions, paymentDeadlines, sql } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBookingState, updateBookingTerms } from "../src/bookings";
import { accountCtx, systemCtx, type Ctx } from "../src/context";
import {
  correctReceivedQty,
  createDelivery,
  getDelivery,
  listDeliveries,
  markDepositRecovered,
  recordReceipt,
  recordReturn,
} from "../src/deliveries";
import { buildDigest } from "../src/digest";
import { listExports, runExport } from "../src/exports";
import { closeoutSectionProviders, lifecycleImpactProviders } from "../src/lifecycle";
import { getOverview } from "../src/overview";
import {
  addPaymentDeadline,
  bookingMoneySums,
  correctPaymentPaid,
  listBookingPayments,
  listPaymentCorrections,
  listPaymentDeadlines,
  markPaymentPaid,
  proposeMovePayment,
} from "../src/payments";
import { createSupplier } from "../src/suppliers";
import { confirmPreview, discardPreview } from "../src/whatif";


let t: TestDb;
const OWNER = "acc_owner_d";
const TREASURER = "acc_treasurer_d"; // contributor WITH the finance grant
const HELPER = "acc_helper_d"; // contributor, no finance grant
const PM = "acc_pm_d"; // project manager without the finance grant
let seq = 0;
const NOW = new Date("2027-03-10T08:00:00Z");

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(accounts).values([
    { id: OWNER, kind: "email", email: "owner-d@example.test" },
    { id: TREASURER, kind: "email", email: "treasurer-d@example.test" },
    { id: HELPER, kind: "email", email: "helper-d@example.test" },
    { id: PM, kind: "email", email: "pm-d@example.test" },
  ]);
});
afterAll(async () => {
  await t.close();
});

const as = (accountId: string, now: Date = NOW): Ctx => accountCtx(t.db, accountId, { now });
const owner = (now?: Date) => as(OWNER, now);

async function newOccasion() {
  const id = `occd${++seq}aaaaaa`;
  await t.db.insert(occasions).values({ id, ownerAccountId: OWNER, title: "Botezul Mariei", kind: "botez", startsAt: new Date("2027-06-12T09:00:00Z") });
  const members = await t.db
    .insert(occasionMembers)
    .values([
      { occasionId: id, accountId: OWNER, role: "owner" },
      { occasionId: id, accountId: TREASURER, role: "contributor", grantFinance: true },
      { occasionId: id, accountId: HELPER, role: "contributor" },
      { occasionId: id, accountId: PM, role: "pm" },
    ])
    .returning();
  const memberId = (acc: string) => members.find((m) => m.accountId === acc)!.id;
  return { id, memberId };
}

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? e.code : `THROWN:${String(e)}`;
  }
  return "OK";
}

describe("deliveries, hired items and returns (B6, principle 4)", () => {
  async function scene() {
    const occ = await newOccasion();
    const sup = await createSupplier(owner(), { occasionId: occ.id, name: "Închirieri Scaune SRL", contactPhone: "0733 222 111" });
    const { deliveryId } = await createDelivery(owner(), {
      occasionId: occ.id,
      supplierId: sup.supplierId,
      title: "Scaune și mese",
      kind: "hire",
      expectedFrom: new Date("2027-06-12T06:00:00Z"),
      expectedTo: new Date("2027-06-12T07:00:00Z"),
      place: "Intrarea din spate",
      items: [
        { label: "Scaune", expectedQty: 120, unit: "buc", deposit: "500" },
        { label: "Mese rotunde", expectedQty: 12 },
      ],
    });
    const d = await getDelivery(owner(), deliveryId);
    return { occ, deliveryId, chairs: d.items[0]!, tables: d.items[1]! };
  }

  it("the first receipt is recorded freely; overwriting it is refused by the API and by the database", async () => {
    const { deliveryId, chairs, tables } = await scene();
    expect(chairs.receivedQty).toBeNull(); // nothing recorded is not zero
    // the person at the door (a contributor) records what arrived
    expect(await recordReceipt(as(HELPER), { itemId: chairs.id, receivedQty: 118 })).toMatchObject({ state: "partial", recorded: true });
    expect(await recordReceipt(as(HELPER), { itemId: chairs.id, receivedQty: 118 })).toMatchObject({ recorded: false }); // harmless repeat
    // API level: a different number is refused and nothing changes
    const err = await recordReceipt(as(HELPER), { itemId: chairs.id, receivedQty: 120 }).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("CONFLICT");
    expect(err.messageKey).toBe("deliveries.errors.useCorrection");
    expect(await code(() => recordReceipt(owner(), { itemId: chairs.id, receivedQty: 120 }))).toBe("CONFLICT");
    // DB level: a direct UPDATE of the fact fails, whatever does it
    await expect(t.db.update(deliveryItems).set({ receivedQty: 120 }).where(eq(deliveryItems.id, chairs.id))).rejects.toThrow();
    await expect(t.db.execute(sql`update delivery_items set received_qty = null where id = ${chairs.id}`)).rejects.toThrow();
    const [row] = await t.db.select().from(deliveryItems).where(eq(deliveryItems.id, chairs.id));
    expect(row!.receivedQty).toBe(118);
    // plan data of the same row can still change
    await t.db.update(deliveryItems).set({ label: "Scaune albe" }).where(eq(deliveryItems.id, chairs.id));

    await recordReceipt(as(HELPER), { itemId: tables.id, receivedQty: 12 });
    expect((await getDelivery(owner(), deliveryId)).state).toBe("partial"); // 118 of 120 chairs
  });

  it("a correction changes the quantity and leaves the corrections row and the audit entry", async () => {
    const { deliveryId, chairs, tables } = await scene();
    await recordReceipt(as(HELPER), { itemId: chairs.id, receivedQty: 118 });
    await recordReceipt(as(HELPER), { itemId: tables.id, receivedQty: 12 });

    expect(await code(() => correctReceivedQty(as(HELPER), { itemId: chairs.id, receivedQty: 120, reason: "am numărat din nou" }))).toBe("FORBIDDEN");
    const noReason = await correctReceivedQty(owner(), { itemId: chairs.id, receivedQty: 120, reason: " " }).catch((e) => e);
    expect(isAppError(noReason) && noReason.code).toBe("VALIDATION");
    expect(noReason.details?.fieldErrors?.reason).toBeTruthy();
    expect(await code(() => correctReceivedQty(owner(), { itemId: chairs.id, receivedQty: 118, reason: "aceeași valoare" }))).toBe("VALIDATION");

    const res = await correctReceivedQty(owner(), { itemId: chairs.id, receivedQty: 120, reason: "Două scaune erau în al doilea camion" });
    expect(res.state).toBe("received");
    const [row] = await t.db.select().from(deliveryItems).where(eq(deliveryItems.id, chairs.id));
    expect(row!.receivedQty).toBe(120);
    const rows = await t.db.select().from(corrections).where(and(eq(corrections.targetTable, "delivery_items"), eq(corrections.targetId, chairs.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "receivedQty", before: 118, after: 120, reason: "Două scaune erau în al doilea camion", actorKind: "account", actorId: OWNER });
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "correction.recorded"), eq(auditLog.objectId, chairs.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.before).toEqual({ receivedQty: 118 });
    expect(audits[0]!.after).toEqual({ receivedQty: 120 });
    // the history is on the item, and the guard is closed again after the correction
    const view = await getDelivery(owner(), deliveryId);
    expect(view.items[0]!.corrections.map((c) => c.reason)).toEqual(["Două scaune erau în al doilea camion"]);
    await expect(t.db.update(deliveryItems).set({ receivedQty: 1 }).where(eq(deliveryItems.id, chairs.id))).rejects.toThrow();
  });

  it("hired items: returns and deposits are tracked; deposits only for finance-grant holders", async () => {
    const { occ, deliveryId, chairs, tables } = await scene();
    expect(await code(() => recordReturn(owner(), { itemId: chairs.id, returnedQty: 10 }))).toBe("CONFLICT"); // nothing received yet
    await recordReceipt(owner(), { itemId: chairs.id, receivedQty: 120 });
    await recordReceipt(owner(), { itemId: tables.id, receivedQty: 12 });
    await recordReturn(as(HELPER), { itemId: chairs.id, returnedQty: 119 });
    expect(await code(() => recordReturn(as(HELPER), { itemId: chairs.id, returnedQty: 120 }))).toBe("CONFLICT");
    await expect(t.db.update(deliveryItems).set({ returnedQty: 120 }).where(eq(deliveryItems.id, chairs.id))).rejects.toThrow();

    const forOwner = await listDeliveries(owner(), occ.id);
    expect(forOwner.items[0]!.items[0]!.depositMinor).toBe(50000);
    const forHelper = await listDeliveries(as(HELPER), occ.id);
    expect(forHelper.items[0]!.items[0]!.depositMinor).toBeUndefined();
    expect(JSON.stringify(forHelper)).not.toContain("50000");

    // closeout: one chair not returned, the deposit not recovered (money only with the grant)
    const sections = closeoutSectionProviders();
    const notReturned = await sections.find((s) => s.key === "deliveries.notReturned")!.collect(owner(), occ.id);
    expect(notReturned).toHaveLength(2); // 1 chair + 12 tables still out
    const deposits = sections.find((s) => s.key === "deliveries.deposits")!;
    expect(await deposits.collect(owner(), occ.id)).toMatchObject([{ amountMinor: 50000, currency: "RON" }]);
    expect(await deposits.collect(as(HELPER), occ.id)).toEqual([]);
    expect(await code(() => markDepositRecovered(as(HELPER), { itemId: chairs.id }))).toBe("FORBIDDEN");
    await markDepositRecovered(as(TREASURER), { itemId: chairs.id });
    expect(await deposits.collect(owner(), occ.id)).toEqual([]);
    await expect(t.db.update(deliveryItems).set({ depositRecoveredAt: null }).where(eq(deliveryItems.id, chairs.id))).rejects.toThrow();
    expect((await getDelivery(owner(), deliveryId)).state).toBe("received");
  });

  it("cancel / postpone previews list the deliveries still expected", async () => {
    const { occ } = await scene();
    const provider = lifecycleImpactProviders().find((p) => p.key === "deliveries.scheduled")!;
    const rows = await provider.collect(owner(), occ.id, { kind: "cancel" });
    expect(rows.map((r) => r.what)).toEqual(["Scaune și mese"]);
  });
});

describe("supplier payment deadlines (B12, D2)", () => {
  async function scene() {
    const occ = await newOccasion();
    const sup = await createSupplier(owner(), { occasionId: occ.id, name: "Restaurant Select" });
    await updateBookingTerms(owner(), { bookingId: sup.bookingId, agreedAmount: "20.000", notes: "" });
    await setBookingState(owner(), { bookingId: sup.bookingId, state: "booked" });
    const advance = await addPaymentDeadline(owner(), { bookingId: sup.bookingId, kind: "advance", dueOn: "2027-02-15", amount: "5.000" });
    const instalment = await addPaymentDeadline(as(TREASURER), { bookingId: sup.bookingId, kind: "instalment", dueOn: "2027-03-05", amount: "7.000" }); // overdue on NOW
    const soon = await addPaymentDeadline(owner(), { bookingId: sup.bookingId, kind: "instalment", dueOn: "2027-03-14", amount: "" }); // amount unknown
    const final = await addPaymentDeadline(owner(), { bookingId: sup.bookingId, kind: "final", dueOn: "2027-06-01", amount: "8.000" });
    await markPaymentPaid(owner(), { deadlineId: advance.deadlineId });
    return { occ, sup, advance, instalment, soon, final };
  }

  it("every read and write needs the finance grant — a project manager without it gets nothing", async () => {
    const { occ, sup, instalment } = await scene();
    expect((await listPaymentDeadlines(as(TREASURER), occ.id)).length).toBe(4);
    for (const who of [HELPER, PM]) {
      expect(await code(() => listPaymentDeadlines(as(who), occ.id))).toBe("FORBIDDEN");
      expect(await code(() => listBookingPayments(as(who), sup.bookingId))).toBe("FORBIDDEN");
      expect(await code(() => addPaymentDeadline(as(who), { bookingId: sup.bookingId, kind: "final", dueOn: "2027-07-01", amount: "1" }))).toBe("FORBIDDEN");
      expect(await code(() => markPaymentPaid(as(who), { deadlineId: instalment.deadlineId }))).toBe("FORBIDDEN");
      expect(await code(() => proposeMovePayment(as(who), { deadlineId: instalment.deadlineId, dueOn: "2027-04-01" }))).toBe("FORBIDDEN");
      expect(await code(() => runExport(as(who), occ.id, "payments"))).toBe("FORBIDDEN");
      expect((await listExports(as(who), occ.id)).map((e) => e.key)).not.toContain("payments");
    }
    const csv = await runExport(as(TREASURER), occ.id, "payments");
    expect(csv.content).toContain("Restaurant Select");
    expect(csv.content).toContain("7000.00");
    expect((await listExports(as(PM), occ.id)).map((e) => e.key)).toContain("suppliers");
    const suppliersCsv = await runExport(as(PM), occ.id, "suppliers");
    expect(suppliersCsv.content).toContain("Restaurant Select");
    expect(suppliersCsv.content).not.toContain("20000"); // no finance grant: no amount column
  });

  it("the overdue instalment is in the finance holder's digest and overview, and not in a finance-less member's", async () => {
    const { occ } = await scene();
    const sys = systemCtx(t.db, { now: NOW });
    const forTreasurer = (await buildDigest(sys, { occasionId: occ.id, memberId: occ.memberId(TREASURER) }))!;
    const section = forTreasurer.sections.find((s) => s.key === "supplierPayments")!;
    expect(section).toBeTruthy();
    const text = JSON.stringify(section.lines);
    expect(text).toContain("suppliers.alerts.overdue");
    expect(text).toContain("05.03.2027");
    expect(text).toContain("7.000 RON");
    expect(text).toContain("suppliers.alerts.soonUnknown"); // due in 4 days, amount unknown — never "0"
    expect(text).not.toContain("01.06.2027"); // not within 7 days
    expect(text).not.toContain("15.02.2027"); // paid
    expect(forTreasurer.worthSending).toBe(true);

    for (const who of [HELPER, PM]) {
      const d = (await buildDigest(sys, { occasionId: occ.id, memberId: occ.memberId(who) }))!;
      expect(d.sections.map((s) => s.key)).not.toContain("supplierPayments");
      expect(JSON.stringify(d)).not.toContain("7.000 RON");
      const o = await getOverview(as(who), occ.id);
      expect(o.extra.map((e) => e.key)).not.toContain("supplierPayments");
    }
    const mine = await getOverview(as(TREASURER), occ.id);
    expect(mine.extra.find((e) => e.key === "supplierPayments")?.lines.length).toBe(2);
  });

  it("moving a payment is a What-if: the preview shows the money effect and nothing changes until confirmed", async () => {
    const { occ, instalment } = await scene();
    const preview = await proposeMovePayment(as(TREASURER), { deadlineId: instalment.deadlineId, dueOn: "2027-04-20" });
    const rows = preview.delta;
    const byKey = (k: string) => rows.find((r) => r.key === k)!;
    expect(byKey("due")).toMatchObject({ before: "05.03.2027", after: "20.04.2027" });
    expect(byKey("overdue")).toMatchObject({ before: { key: "suppliers.whatif.overdue" }, after: { key: "suppliers.whatif.onTime" } });
    // March loses 7.000 (and still holds a payment of unknown amount), April gains it
    expect(byKey("month:2027-03")).toMatchObject({ before: "7.000 RON", after: "0 RON", noteKey: "suppliers.whatif.monthHasUnknown" });
    expect(byKey("month:2027-04")).toMatchObject({ before: "0 RON", after: "7.000 RON" });
    const [still] = await t.db.select().from(paymentDeadlines).where(eq(paymentDeadlines.id, instalment.deadlineId));
    expect(still!.dueOn).toBe("2027-03-05"); // a preview applies nothing

    const discarded = await proposeMovePayment(as(TREASURER), { deadlineId: instalment.deadlineId, dueOn: "2027-05-01" });
    await discardPreview(as(TREASURER), discarded.id);
    expect(await code(() => confirmPreview(as(HELPER), preview.id))).toBe("FORBIDDEN");
    await confirmPreview(as(TREASURER), preview.id);
    const [moved] = await t.db.select().from(paymentDeadlines).where(eq(paymentDeadlines.id, instalment.deadlineId));
    expect(moved!.dueOn).toBe("2027-04-20");
    expect(await code(() => proposeMovePayment(owner(), { deadlineId: instalment.deadlineId, dueOn: "2027-04-20" }))).toBe("VALIDATION");
    expect(occ.id).toBeTruthy();
  });

  it("'paid' is a fact: unmarking needs a correction (API and database)", async () => {
    const { advance } = await scene();
    expect((await markPaymentPaid(owner(), { deadlineId: advance.deadlineId })).changed).toBe(false); // idempotent
    await expect(t.db.update(paymentDeadlines).set({ paidAt: null }).where(eq(paymentDeadlines.id, advance.deadlineId))).rejects.toThrow();
    expect(await code(() => correctPaymentPaid(owner(), { deadlineId: advance.deadlineId, reason: "" }))).toBe("VALIDATION");
    await correctPaymentPaid(as(TREASURER), { deadlineId: advance.deadlineId, reason: "Plata a fost returnată de bancă" });
    const [row] = await t.db.select().from(paymentDeadlines).where(eq(paymentDeadlines.id, advance.deadlineId));
    expect(row!.paidAt).toBeNull();
    const history = await listPaymentCorrections(owner(), advance.deadlineId);
    expect(history.map((c) => [c.field, c.after, c.reason])).toEqual([["paidAt", null, "Plata a fost returnată de bancă"]]);
  });

  it("budget source: committed = agreed amounts of booked bookings, paid = paid deadlines", async () => {
    const { occ } = await scene();
    const other = await createSupplier(owner(), { occasionId: occ.id, name: "Doar ofertă" });
    await updateBookingTerms(owner(), { bookingId: other.bookingId, agreedAmount: "900", notes: "" }); // still "enquired": not committed
    expect(await bookingMoneySums(owner(), occ.id)).toEqual([
      { categoryId: null, committedMinor: 2000000, invoicedMinor: 0, paidMinor: 500000, currency: "RON" },
    ]);
  });

  it("lifecycle preview: bookings to notify for everyone planning, money rows only with the finance grant", async () => {
    const { occ } = await scene();
    const providers = lifecycleImpactProviders();
    const bookingsRows = await providers.find((p) => p.key === "suppliers.bookings")!.collect(as(HELPER), occ.id, { kind: "cancel" });
    expect(bookingsRows.map((r) => r.what)).toEqual(["Restaurant Select"]);
    const money = providers.find((p) => p.key === "suppliers.payments")!;
    expect(await money.collect(as(TREASURER), occ.id, { kind: "postpone", startsOn: "2027-09-01" })).toHaveLength(4);
    expect(await code(() => money.collect(as(HELPER), occ.id, { kind: "cancel" }))).toBe("FORBIDDEN"); // skipped by the lifecycle
    const unpaid = closeoutSectionProviders().find((s) => s.key === "suppliers.unpaid")!;
    const items = await unpaid.collect(owner(), occ.id);
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.amountMinor === null)).toBeTruthy(); // unknown stays unknown
  });
});
