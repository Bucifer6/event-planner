import { translate } from "@ed/i18n";
import {
  and,
  asc,
  bookings,
  eq,
  inArray,
  isNull,
  paymentDeadlines,
  paymentKindSchema,
  sql,
  suppliers,
  PAYMENT_KINDS,
  type PaymentKind,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { registerBudgetSource, type BudgetSourceSum } from "./budget";
import { requireWriteCapable, type Ctx } from "./context";
import { listCorrections, recordCorrection, type Correction } from "./corrections";
import { registerDigestSection, type DigestLine } from "./digest";
import { expenseTotalsByBooking } from "./expenses";
import { registerExport, toCsv } from "./exports";
import { registerCloseoutSection, registerLifecycleImpact } from "./lifecycle";
import { registerOverviewSection } from "./overview";
import { PLANNING_ROLES, todayKey, zMoneyText } from "./suppliers";
import { zDay } from "./templates";
import { inTx } from "./tx";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Supplier payment deadlines (B12): advances, instalments and final balances with due dates.
//
// FINANCE GRANT for every read and every write (D2): each function goes through finance().
// The digest and overview sections exist only for finance-grant holders.
//
// `paidAt` is a FACT (principle 4): marking a deadline paid is free; taking it back happens
// only through correctPaymentPaid() — a corrections row with a reason, same transaction (the
// database refuses anything else, 020_suppliers_guards.sql).
//
// Moving a due date is a What-if ("payment.move"): the preview shows the new date, whether the
// payment becomes / stops being overdue, and the total due per month before → after.

export { PAYMENT_KINDS };
export type { PaymentKind };
export type PaymentDeadline = typeof paymentDeadlines.$inferSelect;
export const PAYMENT_DEADLINES_TABLE = "payment_deadlines";
export const PAYMENT_MOVE_KIND = "payment.move";
/** "Upcoming" in the digest and on the overview = due within this many days. */
export const PAYMENT_SOON_DAYS = 7;

const idSchema = z.string().min(1).max(64);

async function finance(ctx: Ctx, occasionId: string) {
  return requireMember(ctx, occasionId, { roles: PLANNING_ROLES, grant: "finance" });
}

export type PaymentView = {
  id: string;
  bookingId: string;
  supplierId: string;
  supplierName: string;
  kind: PaymentKind;
  dueOn: string;
  /** null = unknown. */
  amountMinor: number | null;
  currency: string;
  paidAt: Date | null;
  note: string | null;
  /** Unpaid and due before today (Bucharest). */
  overdue: boolean;
  /** Unpaid and due today or within PAYMENT_SOON_DAYS. */
  soon: boolean;
};

function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toView(p: PaymentDeadline, supplier: { id: string; name: string }, today: string): PaymentView {
  const open = p.paidAt === null;
  return {
    id: p.id,
    bookingId: p.bookingId,
    supplierId: supplier.id,
    supplierName: supplier.name,
    kind: p.kind,
    dueOn: p.dueOn,
    amountMinor: p.amountMinor,
    currency: p.currency,
    paidAt: p.paidAt,
    note: p.note,
    overdue: open && p.dueOn < today,
    soon: open && p.dueOn >= today && p.dueOn <= plusDays(today, PAYMENT_SOON_DAYS),
  };
}

async function paymentRows(ctx: Ctx, occasionId: string, bookingId?: string): Promise<PaymentView[]> {
  const rows = await ctx.db
    .select({ p: paymentDeadlines, sId: suppliers.id, sName: suppliers.name })
    .from(paymentDeadlines)
    .innerJoin(bookings, eq(bookings.id, paymentDeadlines.bookingId))
    .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
    .where(and(eq(paymentDeadlines.occasionId, occasionId), bookingId ? eq(paymentDeadlines.bookingId, bookingId) : undefined))
    .orderBy(asc(paymentDeadlines.dueOn), asc(paymentDeadlines.createdAt), asc(paymentDeadlines.id));
  const today = todayKey(ctx.now);
  return rows.map((r) => toView(r.p, { id: r.sId, name: r.sName }, today));
}

/** Every payment deadline of the occasion, by due date. Finance grant. */
export async function listPaymentDeadlines(ctx: Ctx, occasionId: string): Promise<PaymentView[]> {
  await finance(ctx, occasionId);
  return paymentRows(ctx, occasionId);
}

async function bookingOccasion(ctx: Ctx, bookingId: string): Promise<{ id: string; occasionId: string; currency: string }> {
  const id = idSchema.safeParse(bookingId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [b] = await ctx.db
    .select({ id: bookings.id, occasionId: bookings.occasionId, currency: bookings.currency })
    .from(bookings)
    .where(eq(bookings.id, id.data));
  if (!b) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return b;
}

/** The payment deadlines of one booking. Finance grant. */
export async function listBookingPayments(ctx: Ctx, bookingId: string): Promise<PaymentView[]> {
  const b = await bookingOccasion(ctx, bookingId);
  await finance(ctx, b.occasionId);
  return paymentRows(ctx, b.occasionId, b.id);
}

async function loadDeadline(ctx: Ctx, deadlineId: string): Promise<PaymentDeadline> {
  const id = idSchema.safeParse(deadlineId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db.select().from(paymentDeadlines).where(eq(paymentDeadlines.id, id.data));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  // non-members get NOT_FOUND, members without the grant FORBIDDEN (requireMember decides)
  await finance(ctx, row.occasionId);
  return row;
}

const noteField = z
  .string()
  .max(300, "common.validation.tooLong")
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

const addInput = z.object({
  bookingId: idSchema,
  kind: paymentKindSchema,
  dueOn: zDay,
  amount: zMoneyText("suppliers.errors.amount"),
  note: noteField,
});

/** Adds an advance, an instalment or the final balance with its due date. Finance grant. */
export async function addPaymentDeadline(ctx: Ctx, input: z.input<typeof addInput>): Promise<{ deadlineId: string }> {
  requireWriteCapable(ctx);
  const data = addInput.parse(input);
  const b = await bookingOccasion(ctx, data.bookingId);
  await finance(ctx, b.occasionId);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(paymentDeadlines)
      .values({
        bookingId: b.id,
        occasionId: b.occasionId,
        kind: data.kind,
        dueOn: data.dueOn,
        amountMinor: data.amount,
        currency: b.currency,
        note: data.note,
      })
      .returning({ id: paymentDeadlines.id });
    await audit(tx, {
      action: "payment_deadline.added",
      objectType: "payment_deadline",
      objectId: row!.id,
      after: { kind: data.kind, dueOn: data.dueOn, amountMinor: data.amount },
      meta: { occasionId: b.occasionId, bookingId: b.id },
    });
    return { deadlineId: row!.id };
  });
}

const updateInput = z.object({ deadlineId: idSchema, kind: paymentKindSchema, amount: zMoneyText("suppliers.errors.amount"), note: noteField });

/**
 * Kind, amount and note of a deadline that is not paid yet (the due date moves through
 * proposeMovePayment). CONFLICT once it is paid: a paid amount is part of the fact.
 */
export async function updatePaymentDeadline(ctx: Ctx, input: z.input<typeof updateInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = updateInput.parse(input);
  const row = await loadDeadline(ctx, data.deadlineId);
  if (row.paidAt) throw new AppError("CONFLICT", "suppliers.errors.paidLocked");
  await inTx(ctx, async (tx) => {
    const done = await tx.db
      .update(paymentDeadlines)
      .set({ kind: data.kind, amountMinor: data.amount, note: data.note })
      .where(and(eq(paymentDeadlines.id, row.id), isNull(paymentDeadlines.paidAt)))
      .returning({ id: paymentDeadlines.id });
    if (!done[0]) throw new AppError("CONFLICT", "suppliers.errors.paidLocked");
    await audit(tx, {
      action: "payment_deadline.updated",
      objectType: "payment_deadline",
      objectId: row.id,
      before: { kind: row.kind, amountMinor: row.amountMinor },
      after: { kind: data.kind, amountMinor: data.amount },
      meta: { occasionId: row.occasionId },
    });
  });
}

/** Removes a deadline that is not paid. CONFLICT once paid. */
export async function removePaymentDeadline(ctx: Ctx, input: { deadlineId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const row = await loadDeadline(ctx, input.deadlineId);
  if (row.paidAt) throw new AppError("CONFLICT", "suppliers.errors.paidLocked");
  await inTx(ctx, async (tx) => {
    const done = await tx.db
      .delete(paymentDeadlines)
      .where(and(eq(paymentDeadlines.id, row.id), isNull(paymentDeadlines.paidAt)))
      .returning({ id: paymentDeadlines.id });
    if (!done[0]) throw new AppError("CONFLICT", "suppliers.errors.paidLocked");
    await audit(tx, {
      action: "payment_deadline.removed",
      objectType: "payment_deadline",
      objectId: row.id,
      before: { kind: row.kind, dueOn: row.dueOn, amountMinor: row.amountMinor },
      meta: { occasionId: row.occasionId },
    });
  });
}

/** Marks the deadline paid (now). Idempotent: a paid deadline stays as it was recorded. */
export async function markPaymentPaid(ctx: Ctx, input: { deadlineId: string }): Promise<{ paidAt: Date; changed: boolean }> {
  requireWriteCapable(ctx);
  const row = await loadDeadline(ctx, input.deadlineId);
  if (row.paidAt) return { paidAt: row.paidAt, changed: false };
  return inTx(ctx, async (tx) => {
    const done = await tx.db
      .update(paymentDeadlines)
      .set({ paidAt: tx.now })
      .where(and(eq(paymentDeadlines.id, row.id), isNull(paymentDeadlines.paidAt)))
      .returning({ paidAt: paymentDeadlines.paidAt });
    if (!done[0]) {
      const [again] = await tx.db.select().from(paymentDeadlines).where(eq(paymentDeadlines.id, row.id));
      return { paidAt: again!.paidAt ?? tx.now, changed: false };
    }
    await audit(tx, {
      action: "payment_deadline.paid",
      objectType: "payment_deadline",
      objectId: row.id,
      after: { paidAt: tx.now, amountMinor: row.amountMinor },
      meta: { occasionId: row.occasionId, bookingId: row.bookingId },
    });
    return { paidAt: tx.now, changed: true };
  });
}

/**
 * Takes "paid" back — only as a correction: the corrections row (before, after, actor, reason)
 * and the change commit together. A reason of at least 3 characters is required.
 */
export async function correctPaymentPaid(ctx: Ctx, input: { deadlineId: string; reason: string }): Promise<{ correctionId: string }> {
  requireWriteCapable(ctx);
  const row = await loadDeadline(ctx, input.deadlineId);
  if (!row.paidAt) throw new AppError("CONFLICT", "suppliers.errors.notPaid");
  return inTx(ctx, async (tx) => {
    const correctionId = await recordCorrection(tx, {
      occasionId: row.occasionId,
      targetTable: PAYMENT_DEADLINES_TABLE,
      targetId: row.id,
      field: "paidAt",
      before: row.paidAt,
      after: null,
      reason: input.reason,
    });
    await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
    await tx.db.update(paymentDeadlines).set({ paidAt: null }).where(eq(paymentDeadlines.id, row.id));
    await tx.db.execute(sql`select set_config('ed.correction', 'off', true)`);
    return { correctionId };
  });
}

/** Correction history of a deadline's "paid" fact. Finance grant. */
export async function listPaymentCorrections(ctx: Ctx, deadlineId: string): Promise<Correction[]> {
  const row = await loadDeadline(ctx, deadlineId);
  return listCorrections(ctx, { targetTable: PAYMENT_DEADLINES_TABLE, targetId: row.id });
}

/* ── What-if: moving a payment (principle 3) ─────────────────────────────────────── */

const moveInput = z.object({
  deadlineId: idSchema,
  dueOn: zDay,
  /** The due date the preview was computed against: stale if it changed meanwhile. */
  fromDueOn: zDay,
});
type MoveInput = z.infer<typeof moveInput>;

/** "1.990 RON" — amounts inside what-if rows (same shape as formatMoney, ro grouping). */
function moneyText(minor: number, currency: string): string {
  const whole = Math.trunc(Math.abs(minor) / 100);
  const cents = Math.abs(minor) % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${minor < 0 ? "-" : ""}${grouped}${cents ? `,${cents.toString().padStart(2, "0")}` : ""} ${currency}`;
}
const dayText = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
const monthOf = (day: string) => day.slice(0, 7);
const monthText = (month: string) => `${month.slice(5, 7)}.${month.slice(0, 4)}`;

registerWhatIf<MoveInput>(PAYMENT_MOVE_KIND, {
  input: moveInput,
  authorize: async (ctx, subject) => {
    await finance(ctx, subject.occasionId ?? "");
  },
  compute: async (ctx, input, subject) => {
    const occasionId = subject.occasionId ?? "";
    const all = await paymentRows(ctx, occasionId);
    const target = all.find((p) => p.id === input.deadlineId);
    if (!target) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const today = todayKey(ctx.now);
    const delta: Array<{
      key: string;
      what: string | { key: string; params?: Record<string, string | number> };
      kindLabelKey?: string;
      before?: string | { key: string; params?: Record<string, string | number> } | null;
      after?: string | { key: string; params?: Record<string, string | number> } | null;
      noteKey?: string;
    }> = [
      {
        key: "due",
        what: { key: `suppliers.whatif.what.${target.kind}`, params: { supplier: target.supplierName } },
        kindLabelKey: "suppliers.whatif.dueLabel",
        before: dayText(input.fromDueOn),
        after: dayText(input.dueOn),
        ...(target.amountMinor === null ? { noteKey: "suppliers.whatif.amountUnknown" } : {}),
      },
    ];
    const wasOverdue = input.fromDueOn < today;
    const willBeOverdue = input.dueOn < today;
    if (wasOverdue !== willBeOverdue) {
      delta.push({
        key: "overdue",
        what: { key: "suppliers.whatif.status" },
        before: { key: wasOverdue ? "suppliers.whatif.overdue" : "suppliers.whatif.onTime" },
        after: { key: willBeOverdue ? "suppliers.whatif.overdue" : "suppliers.whatif.onTime" },
      });
    }
    // total still due per month, in the payment's currency, before → after
    const months = [...new Set([monthOf(input.fromDueOn), monthOf(input.dueOn)])].sort();
    if (months.length > 1) {
      for (const month of months) {
        const open = all.filter((p) => p.paidAt === null && p.currency === target.currency);
        const sum = (rows: PaymentView[], dueOf: (p: PaymentView) => string) =>
          rows.filter((p) => monthOf(dueOf(p)) === month).reduce((acc, p) => acc + (p.amountMinor ?? 0), 0);
        const unknownIn = (dueOf: (p: PaymentView) => string) =>
          open.some((p) => monthOf(dueOf(p)) === month && p.amountMinor === null);
        const after = (p: PaymentView) => (p.id === target.id ? input.dueOn : p.dueOn);
        delta.push({
          key: `month:${month}`,
          what: { key: "suppliers.whatif.monthTotal", params: { month: monthText(month) } },
          kindLabelKey: "suppliers.whatif.monthLabel",
          before: moneyText(sum(open, (p) => p.dueOn), target.currency),
          after: moneyText(sum(open, after), target.currency),
          ...(unknownIn((p) => p.dueOn) || unknownIn(after) ? { noteKey: "suppliers.whatif.monthHasUnknown" } : {}),
        });
      }
    }
    return { title: { key: "suppliers.whatif.moveTitle", params: { supplier: target.supplierName } }, delta };
  },
  apply: async (tx, preview) => {
    const input = preview.input;
    const [row] = await tx.db.select().from(paymentDeadlines).where(eq(paymentDeadlines.id, input.deadlineId));
    if (!row || row.occasionId !== preview.occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (row.paidAt || row.dueOn !== input.fromDueOn) throw new AppError("CONFLICT", "whatif.errors.stale");
    await tx.db.update(paymentDeadlines).set({ dueOn: input.dueOn }).where(eq(paymentDeadlines.id, row.id));
    await audit(tx, {
      action: "payment_deadline.moved",
      objectType: "payment_deadline",
      objectId: row.id,
      before: { dueOn: row.dueOn },
      after: { dueOn: input.dueOn },
      meta: { occasionId: row.occasionId, previewId: preview.id },
    });
  },
});

/**
 * Preview of moving a payment to another day: nothing changes until the preview is confirmed
 * (confirmPreview). Finance grant. VALIDATION when the day is the same; CONFLICT when paid.
 */
export async function proposeMovePayment(ctx: Ctx, input: { deadlineId: string; dueOn: string }): Promise<WhatIfPreview> {
  requireWriteCapable(ctx);
  const day = zDay.safeParse(input.dueOn);
  if (!day.success) throw new AppError("VALIDATION", "suppliers.errors.dueOn", { fieldErrors: { dueOn: ["suppliers.errors.dueOn"] } });
  const row = await loadDeadline(ctx, input.deadlineId);
  if (row.paidAt) throw new AppError("CONFLICT", "suppliers.errors.paidLocked");
  if (row.dueOn === day.data) {
    throw new AppError("VALIDATION", "suppliers.errors.sameDay", { fieldErrors: { dueOn: ["suppliers.errors.sameDay"] } });
  }
  return createPreview(ctx, {
    kind: PAYMENT_MOVE_KIND,
    occasionId: row.occasionId,
    subjectType: "payment_deadline",
    subjectId: row.id,
    input: { deadlineId: row.id, dueOn: day.data, fromDueOn: row.dueOn },
  });
}

/* ── Budget source ───────────────────────────────────────────────────────────────── */

/**
 * What supplier bookings add to the budget's derived columns, per currency:
 * committed = agreed amounts of bookings that are booked / confirmed / delivered;
 * paid = payment deadlines marked paid, minus what is already recorded as a paid expense of the
 * same booking (never counted twice). NO access check — the budget calls it after its own
 * finance check; anyone else must check the finance grant first.
 */
export async function bookingMoneySums(ctx: Ctx, occasionId: string): Promise<BudgetSourceSum[]> {
  const [bookingRows, paidRows, expenseTotals] = await Promise.all([
    ctx.db
      .select({ id: bookings.id, agreedMinor: bookings.agreedMinor, currency: bookings.currency, state: bookings.state })
      .from(bookings)
      .where(eq(bookings.occasionId, occasionId)),
    ctx.db
      .select({
        bookingId: paymentDeadlines.bookingId,
        currency: paymentDeadlines.currency,
        paid: sql<string>`coalesce(sum(${paymentDeadlines.amountMinor}), 0)`,
      })
      .from(paymentDeadlines)
      .where(and(eq(paymentDeadlines.occasionId, occasionId), sql`${paymentDeadlines.paidAt} is not null`))
      .groupBy(paymentDeadlines.bookingId, paymentDeadlines.currency),
    expenseTotalsByBooking(ctx, occasionId),
  ]);
  const byCurrency = new Map<string, BudgetSourceSum>();
  const bucket = (currency: string) => {
    let b = byCurrency.get(currency);
    if (!b) {
      b = { categoryId: null, committedMinor: 0, invoicedMinor: 0, paidMinor: 0, currency };
      byCurrency.set(currency, b);
    }
    return b;
  };
  for (const b of bookingRows) {
    if (b.agreedMinor !== null && (b.state === "booked" || b.state === "confirmed" || b.state === "delivered")) {
      bucket(b.currency).committedMinor += b.agreedMinor;
    }
  }
  for (const p of paidRows) {
    const asExpense = expenseTotals.get(p.bookingId)?.find((e) => e.currency === p.currency)?.paidMinor ?? 0;
    bucket(p.currency).paidMinor += Math.max(0, Number(p.paid) - asExpense);
  }
  return [...byCurrency.values()].filter((b) => b.committedMinor !== 0 || b.paidMinor !== 0);
}

registerBudgetSource({ key: "suppliers.bookings", sums: bookingMoneySums });

/* ── Digest and overview: finance-grant holders only ─────────────────────────────── */

const ALERT_LIMIT = 6;

async function paymentAlerts(ctx: Ctx, occasionId: string): Promise<{ lines: DigestLine[]; overdue: number; soon: number }> {
  const rows = (await paymentRows(ctx, occasionId)).filter((p) => p.overdue || p.soon);
  const line = (p: PaymentView): DigestLine => ({
    key:
      p.amountMinor === null
        ? p.overdue
          ? "suppliers.alerts.overdueUnknown"
          : "suppliers.alerts.soonUnknown"
        : p.overdue
          ? "suppliers.alerts.overdue"
          : "suppliers.alerts.soon",
    params: {
      supplier: p.supplierName,
      date: dayText(p.dueOn),
      ...(p.amountMinor === null ? {} : { amount: moneyText(p.amountMinor, p.currency) }),
    },
  });
  // overdue first, then by date
  const ordered = [...rows.filter((p) => p.overdue), ...rows.filter((p) => p.soon)];
  const lines = ordered.slice(0, ALERT_LIMIT).map(line);
  if (ordered.length > ALERT_LIMIT) lines.push({ key: "suppliers.alerts.more", params: { count: ordered.length - ALERT_LIMIT } });
  return { lines, overdue: rows.filter((p) => p.overdue).length, soon: rows.filter((p) => p.soon).length };
}

registerDigestSection({
  key: "supplierPayments",
  titleKey: "suppliers.alerts.title",
  forMember: async (ctx, _member, occasionId) => {
    // FORBIDDEN (no finance grant) → the digest omits the section
    await finance(ctx, occasionId);
    return (await paymentAlerts(ctx, occasionId)).lines;
  },
});

registerOverviewSection({
  key: "supplierPayments",
  forMember: async (ctx, member, occasionId) => {
    if (!member.grants.finance || !PLANNING_ROLES.includes(member.role)) return null;
    const alerts = await paymentAlerts(ctx, occasionId);
    if (alerts.lines.length === 0) return null;
    return { titleKey: "suppliers.alerts.title", lines: alerts.lines, slug: "suppliers" };
  },
});

/* ── Lifecycle and closeout ──────────────────────────────────────────────────────── */

registerLifecycleImpact({
  key: "suppliers.bookings",
  async collect(ctx, occasionId, change) {
    if (change.kind === "close") return [];
    await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
    const rows = await ctx.db
      .select({ id: bookings.id, state: bookings.state, name: suppliers.name })
      .from(bookings)
      .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
      .where(and(eq(bookings.occasionId, occasionId), inArray(bookings.state, ["enquired", "quoted", "booked", "confirmed"])))
      .orderBy(asc(suppliers.name));
    return rows.map((b) => ({
      key: `booking:${b.id}`,
      what: b.name,
      kindLabelKey: "suppliers.lifecycle.bookingKind",
      before: { key: `suppliers.states.${b.state}` },
      after: { key: change.kind === "cancel" ? "suppliers.lifecycle.toCancel" : "suppliers.lifecycle.toNotify" },
    }));
  },
});

registerLifecycleImpact({
  key: "suppliers.payments",
  async collect(ctx, occasionId, change) {
    if (change.kind === "close") return [];
    // money: finance-grant holders only (others get no rows from this provider)
    await finance(ctx, occasionId);
    const rows = await paymentRows(ctx, occasionId);
    return rows.map((p) => ({
      key: `payment:${p.id}`,
      what: { key: `suppliers.whatif.what.${p.kind}`, params: { supplier: p.supplierName } },
      kindLabelKey: p.paidAt ? "suppliers.lifecycle.paidKind" : "suppliers.lifecycle.dueKind",
      before: p.amountMinor === null ? null : moneyText(p.amountMinor, p.currency),
      after: { key: p.paidAt ? "suppliers.lifecycle.alreadyPaid" : "suppliers.lifecycle.stillDue", params: { date: dayText(p.dueOn) } },
    }));
  },
});

registerCloseoutSection({
  key: "suppliers.unpaid",
  titleKey: "suppliers.closeout.unpaid",
  async collect(ctx, occasionId) {
    await finance(ctx, occasionId);
    const rows = (await paymentRows(ctx, occasionId)).filter((p) => p.paidAt === null);
    return rows.map((p) => ({
      key: `payment:${p.id}`,
      label: { key: `suppliers.closeout.line.${p.kind}`, params: { supplier: p.supplierName, date: dayText(p.dueOn) } },
      amountMinor: p.amountMinor,
      currency: p.currency,
    }));
  },
});

/* ── Export (finance grant) ──────────────────────────────────────────────────────── */

registerExport({
  key: "payments",
  titleKey: "suppliers.exports.payments.title",
  descriptionKey: "suppliers.exports.payments.description",
  grant: "finance",
  run: async (ctx, occasionId) => {
    const rows = await listPaymentDeadlines(ctx, occasionId);
    const csv = toCsv(
      (["supplier", "kind", "dueOn", "amount", "currency", "paidAt"] as const).map((c) => translate(ctx.locale, `suppliers.exports.payments.columns.${c}`)),
      rows.map((p) => [
        p.supplierName,
        translate(ctx.locale, `suppliers.payments.kinds.${p.kind}`),
        p.dueOn,
        p.amountMinor === null ? "" : (p.amountMinor / 100).toFixed(2),
        p.currency,
        p.paidAt ? p.paidAt.toISOString() : "",
      ]),
    );
    return { filename: "plati-furnizori.csv", mime: "text/csv; charset=utf-8", content: csv };
  },
});

/* ── Registration entry point ────────────────────────────────────────────────────── */

// Importing THIS module registers everything release B's supplier side adds to the shared
// registries (exports, digest and overview sections, lifecycle impacts, closeout sections, the
// budget source, the occasion purge hook, the quote upload purpose): the modules below
// register on import. The worker reaches it through registerJobs() in the jobs registry, the
// web app through one import in instrumentation-node.ts.
import "./bookings";
import "./briefingpdf";
import "./deliveries";
import "./readiness";

/** No jobs of its own (the digest job calls the section registered above). */
export function registerJobs(): void {}
