import {
  and,
  assets,
  budgetCategories,
  desc,
  eq,
  expenseApprovalStateSchema,
  expenses,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type ExpenseApprovalState,
} from "@ed/db";
import { getAssetUrl, registerUploadPurpose } from "@ed/storage";
import { AppError } from "@ed/shared/errors";
import { DEFAULT_CURRENCY } from "@ed/shared/money";
import { addDays } from "@ed/shared/time";
import { zCurrency, zIdempotencyKey, zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { audit } from "./audit";
import { plainMoney, requireFinance } from "./budget";
import { requireWriteCapable, type Ctx } from "./context";
import { listCorrections, recordCorrection, type Correction } from "./corrections";
import { assertOccasionWritable, registerCloseoutSection, registerLifecycleImpact, type DeltaRow } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { registerRetentionRule } from "./retention";
import { instantToDay, zDay } from "./templates";
import { inTx } from "./tx";

// Expenses with receipts (B2). Finance grant on every read and write (D2).
//
// TWO INDEPENDENT STATES: approvalState (pending | approved | rejected) and paymentState
// (unpaid | paid). An expense can be approved while unpaid and paid while unapproved.
//
// PAID IS A FACT (principle 4): once an expense is marked paid, its amount, currency and
// payment state change only through correctExpense(), which writes a `corrections` row with a
// reason in the same transaction. The database enforces it too (sql/020_finance_fact_guards).
//
// Linking to a supplier booking: pass `bookingId` to createExpense / updateExpense (a plain id
// owned by the suppliers domain); listExpenses(ctx, occasionId, { bookingId }) returns them and
// expenseTotalsByBooking() gives the invoiced/paid sums per booking.

export type Expense = typeof expenses.$inferSelect;
export const RECEIPT_UPLOAD_PURPOSE = "occasion.receipt";
/** Receipts and financial records are kept this long after closeout (INF6, bookkeeping). */
export const RECEIPT_RETENTION_YEARS = 7;

const idSchema = z.string().min(1).max(64);
const zAmount = z
  .number("budget.errors.amountRequired")
  .int("common.validation.invalid")
  .safe()
  .min(1, "budget.errors.amountRequired")
  .max(9_000_000_000_00, "common.validation.tooBig");
const zOptionalId = z.preprocess((v) => (v === "" || v === null ? undefined : v), idSchema.optional());

/** Every expense function goes through here: the row, if the actor holds the finance grant. */
async function loadForActor(ctx: Ctx, expenseId: string, opts: { manage?: boolean } = {}): Promise<Expense> {
  const id = idSchema.parse(expenseId);
  const [row] = await ctx.db.select().from(expenses).where(and(eq(expenses.id, id), isNull(expenses.retainedAt)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireFinance(ctx, row.occasionId, opts);
  return row;
}

async function checkCategory(ctx: Ctx, occasionId: string, categoryId: string | undefined): Promise<void> {
  if (!categoryId) return;
  const [c] = await ctx.db
    .select({ id: budgetCategories.id })
    .from(budgetCategories)
    .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.occasionId, occasionId)));
  if (!c) {
    throw new AppError("VALIDATION", "budget.errors.categoryMissing", {
      fieldErrors: { categoryId: ["budget.errors.categoryMissing"] },
    });
  }
}

/** A receipt must be a file uploaded to THIS occasion (never another owner's asset id). */
async function checkReceipt(ctx: Ctx, occasionId: string, assetId: string | undefined): Promise<void> {
  if (!assetId) return;
  const [a] = await ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(eq(assets.id, assetId), eq(assets.ownerType, "occasion"), eq(assets.ownerId, occasionId), isNull(assets.deletedAt)),
    );
  if (!a) {
    throw new AppError("VALIDATION", "budget.errors.receiptMissing", {
      fieldErrors: { receiptAssetId: ["budget.errors.receiptMissing"] },
    });
  }
}

/* ── Read ───────────────────────────────────────────────────────────────── */

export type ExpenseFilter = {
  categoryId?: string | null;
  bookingId?: string;
  approvalState?: ExpenseApprovalState;
  paymentState?: "unpaid" | "paid";
  limit?: number;
};

/** Expenses of an occasion, newest receipt day first (finance grant). */
export async function listExpenses(ctx: Ctx, occasionId: string, filter: ExpenseFilter = {}): Promise<Expense[]> {
  const id = idSchema.parse(occasionId);
  await requireFinance(ctx, id);
  return ctx.db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.occasionId, id),
        isNull(expenses.retainedAt),
        filter.categoryId === undefined
          ? undefined
          : filter.categoryId === null
            ? isNull(expenses.categoryId)
            : eq(expenses.categoryId, filter.categoryId),
        filter.bookingId ? eq(expenses.bookingId, filter.bookingId) : undefined,
        filter.approvalState ? eq(expenses.approvalState, filter.approvalState) : undefined,
        filter.paymentState ? eq(expenses.paymentState, filter.paymentState) : undefined,
      ),
    )
    .orderBy(desc(expenses.spentOn), desc(expenses.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 500, 1), 1000));
}

export async function getExpense(ctx: Ctx, expenseId: string): Promise<Expense> {
  return loadForActor(ctx, expenseId);
}

/** The audited history of changes to a paid expense, oldest first (finance grant). */
export async function listExpenseCorrections(ctx: Ctx, expenseId: string): Promise<Correction[]> {
  const row = await loadForActor(ctx, expenseId);
  return listCorrections(ctx, { targetTable: "expenses", targetId: row.id });
}

/** Short-lived download link of the receipt, or null when there is none (finance grant). */
export async function getReceiptUrl(ctx: Ctx, expenseId: string): Promise<string | null> {
  const row = await loadForActor(ctx, expenseId);
  if (!row.receiptAssetId) return null;
  return getAssetUrl(ctx, row.receiptAssetId);
}

/**
 * Invoiced and paid sums of the expenses linked to each booking. NO access check — for the
 * suppliers domain's budget source, which runs after the finance check.
 */
export async function expenseTotalsByBooking(
  ctx: Ctx,
  occasionId: string,
): Promise<Map<string, Array<{ currency: string; invoicedMinor: number; paidMinor: number }>>> {
  const rows = await ctx.db
    .select({
      bookingId: expenses.bookingId,
      currency: expenses.currency,
      invoiced: sql<string>`coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.approvalState} <> 'rejected'), 0)`,
      paid: sql<string>`coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.paymentState} = 'paid'), 0)`,
    })
    .from(expenses)
    .where(and(eq(expenses.occasionId, occasionId), isNotNull(expenses.bookingId), isNull(expenses.retainedAt)))
    .groupBy(expenses.bookingId, expenses.currency);
  const out = new Map<string, Array<{ currency: string; invoicedMinor: number; paidMinor: number }>>();
  for (const r of rows) {
    const list = out.get(r.bookingId!) ?? [];
    list.push({ currency: r.currency, invoicedMinor: Number(r.invoiced), paidMinor: Number(r.paid) });
    out.set(r.bookingId!, list);
  }
  return out;
}

/* ── Create / edit ──────────────────────────────────────────────────────── */

const createInput = z.object({
  occasionId: idSchema,
  categoryId: zOptionalId,
  description: zText(200),
  amountMinor: zAmount,
  currency: zCurrency.optional(),
  spentOn: zDay,
  supplierLabel: zOptionalText(160),
  bookingId: zOptionalId,
  receiptAssetId: zOptionalId,
  idempotencyKey: zIdempotencyKey,
});
export type CreateExpenseInput = z.input<typeof createInput>;

/**
 * Records an expense (pending approval, unpaid). Idempotent per (occasion, idempotencyKey): a
 * double tap or a retried request returns the first expense and creates nothing new (Q4).
 */
export async function createExpense(ctx: Ctx, input: CreateExpenseInput): Promise<Expense> {
  requireWriteCapable(ctx);
  const data = createInput.parse(input);
  const member = await requireFinance(ctx, data.occasionId);
  await assertOccasionWritable(ctx, data.occasionId);
  await checkCategory(ctx, data.occasionId, data.categoryId);
  await checkReceipt(ctx, data.occasionId, data.receiptAssetId);
  return inTx(ctx, async (tx) => {
    const inserted = await tx.db
      .insert(expenses)
      .values({
        occasionId: data.occasionId,
        categoryId: data.categoryId ?? null,
        description: data.description,
        amountMinor: data.amountMinor,
        currency: data.currency ?? DEFAULT_CURRENCY,
        spentOn: data.spentOn,
        supplierLabel: data.supplierLabel ?? null,
        bookingId: data.bookingId ?? null,
        receiptAssetId: data.receiptAssetId ?? null,
        createdByMemberId: member.id,
        idempotencyKey: data.idempotencyKey,
        createdAt: tx.now,
      })
      .onConflictDoNothing({ target: [expenses.occasionId, expenses.idempotencyKey] })
      .returning();
    if (!inserted[0]) {
      const [existing] = await tx.db
        .select()
        .from(expenses)
        .where(and(eq(expenses.occasionId, data.occasionId), eq(expenses.idempotencyKey, data.idempotencyKey)));
      return existing!;
    }
    await audit(tx, {
      action: "expense.created",
      objectType: "expense",
      objectId: inserted[0].id,
      after: { description: data.description, amountMinor: data.amountMinor, currency: inserted[0].currency, categoryId: inserted[0].categoryId },
      meta: { occasionId: data.occasionId },
    });
    return inserted[0];
  });
}

const updateInput = z.object({
  expenseId: idSchema,
  categoryId: zOptionalId,
  description: zText(200),
  /** Changing the amount of a PAID expense is refused here: use correctExpense. */
  amountMinor: zAmount.optional(),
  spentOn: zDay,
  supplierLabel: zOptionalText(160),
  bookingId: zOptionalId,
  /** Omit to keep the current receipt. A receipt, once attached, is replaced but never removed. */
  receiptAssetId: zOptionalId,
});

/** Edits the descriptive fields. The amount can change here only while the expense is unpaid. */
export async function updateExpense(ctx: Ctx, input: z.input<typeof updateInput>): Promise<Expense> {
  requireWriteCapable(ctx);
  const data = updateInput.parse(input);
  const before = await loadForActor(ctx, data.expenseId);
  await assertOccasionWritable(ctx, before.occasionId);
  await checkCategory(ctx, before.occasionId, data.categoryId);
  await checkReceipt(ctx, before.occasionId, data.receiptAssetId);
  const amountChanges = data.amountMinor !== undefined && data.amountMinor !== before.amountMinor;
  return inTx(ctx, async (tx) => {
    const [after] = await tx.db
      .update(expenses)
      .set({
        categoryId: data.categoryId ?? null,
        description: data.description,
        ...(amountChanges ? { amountMinor: data.amountMinor } : {}),
        spentOn: data.spentOn,
        supplierLabel: data.supplierLabel ?? null,
        bookingId: data.bookingId ?? before.bookingId,
        receiptAssetId: data.receiptAssetId ?? before.receiptAssetId,
      })
      .where(
        and(
          eq(expenses.id, before.id),
          // conditional: a concurrent "mark paid" makes the amount a fact before we get here
          amountChanges ? eq(expenses.paymentState, "unpaid") : undefined,
        ),
      )
      .returning();
    if (!after) {
      throw new AppError("VALIDATION", "budget.errors.paidAmountLocked", {
        fieldErrors: { amount: ["budget.errors.paidAmountLocked"] },
      });
    }
    await audit(tx, {
      action: "expense.updated",
      objectType: "expense",
      objectId: before.id,
      before: { description: before.description, amountMinor: before.amountMinor, categoryId: before.categoryId, spentOn: before.spentOn },
      after: { description: after.description, amountMinor: after.amountMinor, categoryId: after.categoryId, spentOn: after.spentOn },
      meta: { occasionId: before.occasionId },
    });
    return after;
  });
}

/** Removes an UNPAID expense entered by mistake. A paid expense is a fact and stays. */
export async function deleteExpense(ctx: Ctx, input: { expenseId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const before = await loadForActor(ctx, input.expenseId);
  await assertOccasionWritable(ctx, before.occasionId);
  await inTx(ctx, async (tx) => {
    const gone = await tx.db
      .delete(expenses)
      .where(and(eq(expenses.id, before.id), eq(expenses.paymentState, "unpaid")))
      .returning({ id: expenses.id });
    if (gone.length === 0) throw new AppError("CONFLICT", "budget.errors.paidCannotDelete");
    await audit(tx, {
      action: "expense.deleted",
      objectType: "expense",
      objectId: before.id,
      before: { description: before.description, amountMinor: before.amountMinor, currency: before.currency },
      meta: { occasionId: before.occasionId },
    });
  });
}

/* ── The two independent states ─────────────────────────────────────────── */

/**
 * Approves, rejects or re-opens an expense. Owner or project manager holding the finance
 * grant. Says nothing about payment: an approved expense can stay unpaid and a paid one
 * unapproved. Repeating the same decision changes nothing.
 */
export async function setExpenseApproval(
  ctx: Ctx,
  input: { expenseId: string; state: ExpenseApprovalState },
): Promise<Expense> {
  requireWriteCapable(ctx);
  const state = expenseApprovalStateSchema.parse(input.state);
  const before = await loadForActor(ctx, input.expenseId, { manage: true });
  await assertOccasionWritable(ctx, before.occasionId);
  if (before.approvalState === state) return before;
  const member = await requireFinance(ctx, before.occasionId, { manage: true });
  return inTx(ctx, async (tx) => {
    const [after] = await tx.db
      .update(expenses)
      .set({
        approvalState: state,
        approvalDecidedAt: state === "pending" ? null : tx.now,
        approvalDecidedBy: state === "pending" ? null : member.id,
      })
      .where(and(eq(expenses.id, before.id), eq(expenses.approvalState, before.approvalState)))
      .returning();
    if (!after) return (await loadForActor(tx, before.id))!;
    await audit(tx, {
      action: `expense.${state === "pending" ? "approval_reopened" : state}`,
      objectType: "expense",
      objectId: before.id,
      before: { approvalState: before.approvalState },
      after: { approvalState: state },
      meta: { occasionId: before.occasionId },
    });
    return after;
  });
}

const paidInput = z.object({
  expenseId: idSchema,
  /** Day the money left (yyyy-mm-dd). Default: today in Bucharest. */
  paidOn: z.preprocess((v) => (v === "" ? undefined : v), zDay.optional()),
});

/**
 * Marks an expense paid — recording a FACT. Applied once: a double tap or two people tapping
 * together mark it one time. From here on the amount and the payment change only through
 * correctExpense().
 */
export async function markExpensePaid(ctx: Ctx, input: z.input<typeof paidInput>): Promise<Expense> {
  requireWriteCapable(ctx);
  const data = paidInput.parse(input);
  const before = await loadForActor(ctx, data.expenseId);
  await assertOccasionWritable(ctx, before.occasionId);
  if (before.paymentState === "paid") return before;
  return inTx(ctx, async (tx) => {
    const [after] = await tx.db
      .update(expenses)
      .set({ paymentState: "paid", paidAt: tx.now, paidOn: data.paidOn ?? instantToDay(tx.now, "Europe/Bucharest") })
      .where(and(eq(expenses.id, before.id), eq(expenses.paymentState, "unpaid")))
      .returning();
    if (!after) return loadForActor(tx, before.id);
    await audit(tx, {
      action: "expense.paid",
      objectType: "expense",
      objectId: before.id,
      before: { paymentState: "unpaid" },
      after: { paymentState: "paid", paidOn: after.paidOn, amountMinor: after.amountMinor, currency: after.currency },
      meta: { occasionId: before.occasionId },
    });
    return after;
  });
}

const correctInput = z
  .object({
    expenseId: idSchema,
    /** Why the recorded fact was wrong. Required. */
    reason: z.string().trim().min(3, "corrections.errors.reasonRequired").max(1000, "common.validation.tooLong"),
    /** The right amount, when the recorded one was wrong. */
    amountMinor: zAmount.optional(),
    /** true = it was not actually paid (back to unpaid). */
    markUnpaid: z.boolean().optional(),
  })
  .refine((v) => v.amountMinor !== undefined || v.markUnpaid === true, {
    message: "budget.errors.correctionNothing",
    path: ["amount"],
  });

/**
 * The ONLY way to change the amount of a paid expense or to un-mark it as paid. Writes one
 * `corrections` row per changed field (before, after, reason, who) and the audit entries in
 * the same transaction as the change. Owner or project manager holding the finance grant.
 */
export async function correctExpense(ctx: Ctx, input: z.input<typeof correctInput>): Promise<Expense> {
  requireWriteCapable(ctx);
  const data = correctInput.parse(input);
  const seen = await loadForActor(ctx, data.expenseId, { manage: true });
  await assertOccasionWritable(ctx, seen.occasionId);
  return inTx(ctx, async (tx) => {
    // lock the row: the before-values written to the correction are the ones being replaced
    const locked = await tx.db.execute(sql`select id from expenses where id = ${seen.id} for update`);
    if (locked.rows.length === 0) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [before] = await tx.db.select().from(expenses).where(eq(expenses.id, seen.id));
    if (!before || before.paymentState !== "paid") {
      throw new AppError("CONFLICT", "budget.errors.correctionNotPaid");
    }
    const amountChanges = data.amountMinor !== undefined && data.amountMinor !== before.amountMinor;
    const unpay = data.markUnpaid === true;
    if (!amountChanges && !unpay) {
      throw new AppError("VALIDATION", "budget.errors.correctionNothing", {
        fieldErrors: { amount: ["budget.errors.correctionNothing"] },
      });
    }
    if (amountChanges) {
      await recordCorrection(tx, {
        occasionId: before.occasionId,
        targetTable: "expenses",
        targetId: before.id,
        field: "amountMinor",
        before: before.amountMinor,
        after: data.amountMinor,
        reason: data.reason,
      });
    }
    if (unpay) {
      await recordCorrection(tx, {
        occasionId: before.occasionId,
        targetTable: "expenses",
        targetId: before.id,
        field: "paymentState",
        before: { paymentState: "paid", paidOn: before.paidOn },
        after: { paymentState: "unpaid" },
        reason: data.reason,
      });
    }
    // open the database guard for this one statement, then close it again (transaction-local)
    await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
    const [after] = await tx.db
      .update(expenses)
      .set({
        ...(amountChanges ? { amountMinor: data.amountMinor } : {}),
        ...(unpay ? { paymentState: "unpaid" as const, paidAt: null, paidOn: null } : {}),
      })
      .where(eq(expenses.id, before.id))
      .returning();
    await tx.db.execute(sql`select set_config('ed.correction', '', true)`);
    return after!;
  });
}

/* ── Lifecycle: what a cancel / postpone / close touches, and what is still open ── */

type MoneySum = { currency: string; amountMinor: number; count: number };

async function sumsByPayment(ctx: Ctx, occasionId: string, state: "paid" | "unpaid"): Promise<MoneySum[]> {
  const rows = await ctx.db
    .select({
      currency: expenses.currency,
      amount: sql<string>`coalesce(sum(${expenses.amountMinor}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.occasionId, occasionId),
        isNull(expenses.retainedAt),
        eq(expenses.paymentState, state),
        state === "unpaid" ? sql`${expenses.approvalState} <> 'rejected'` : undefined,
      ),
    )
    .groupBy(expenses.currency);
  return rows.map((r) => ({ currency: r.currency, amountMinor: Number(r.amount), count: r.count }));
}

function register(): void {
  registerUploadPurpose(RECEIPT_UPLOAD_PURPOSE, { ownerType: "occasion", allowPdf: true });

  registerLifecycleImpact({
    key: "expenses",
    collect: async (ctx, occasionId, change) => {
      // money: only for finance-grant holders; everyone else sees no expense rows at all
      try {
        await requireFinance(ctx, occasionId);
      } catch {
        return [];
      }
      const [paid, unpaid] = await Promise.all([
        sumsByPayment(ctx, occasionId, "paid"),
        sumsByPayment(ctx, occasionId, "unpaid"),
      ]);
      const rows: DeltaRow[] = [];
      for (const p of paid) {
        rows.push({
          key: `expenses:paid:${p.currency}`,
          // informational row: the amount is part of the sentence (nothing is struck out)
          what: { key: "lifecycle.impact.expensesPaid", params: { count: p.count, amount: plainMoney(p.amountMinor, p.currency) } },
          kindLabelKey: "lifecycle.impact.moneyLabel",
          noteKey: change.kind === "cancel" ? "lifecycle.impact.expensesPaidCancelNote" : "lifecycle.impact.expensesPaidNote",
        });
      }
      for (const u of unpaid) {
        rows.push({
          key: `expenses:unpaid:${u.currency}`,
          what: { key: "lifecycle.impact.expensesUnpaid", params: { count: u.count, amount: plainMoney(u.amountMinor, u.currency) } },
          kindLabelKey: "lifecycle.impact.moneyLabel",
          noteKey: "lifecycle.impact.expensesUnpaidNote",
        });
      }
      return rows;
    },
  });

  registerCloseoutSection({
    key: "expenses.unpaid",
    titleKey: "lifecycle.closeout.sections.expensesUnpaid",
    collect: async (ctx, occasionId) => {
      try {
        await requireFinance(ctx, occasionId);
      } catch {
        return [];
      }
      const rows = await ctx.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.occasionId, occasionId),
            isNull(expenses.retainedAt),
            eq(expenses.paymentState, "unpaid"),
            sql`${expenses.approvalState} <> 'rejected'`,
          ),
        )
        .orderBy(desc(expenses.amountMinor))
        .limit(200);
      return rows.map((e) => ({
        key: e.id,
        label: e.supplierLabel ? `${e.description} · ${e.supplierLabel}` : e.description,
        amountMinor: e.amountMinor,
        currency: e.currency,
        noteKey: e.approvalState === "approved" ? "lifecycle.closeout.notes.approvedUnpaid" : "lifecycle.closeout.notes.pendingUnpaid",
      }));
    },
  });

  // Occasion purge (D6 + INF6). Bookkeeping rule: receipts and financial records are kept 7
  // years. So paid expenses and expenses with a receipt are NOT deleted with the occasion:
  // they are detached (retained_at set, category dropped) and their receipt files are moved
  // out of the occasion's asset set (owner_id "retained:<occasionId>") so the occasion's file
  // purge does not remove them and no member can open them any more. Unpaid expenses without
  // a receipt are deleted. The retention rule below removes retained rows after 7 years.
  onOccasionPurge(async (tx, occasionId) => {
    await tx.db
      .delete(expenses)
      .where(and(eq(expenses.occasionId, occasionId), eq(expenses.paymentState, "unpaid"), isNull(expenses.receiptAssetId)));
    const kept = await tx.db
      .update(expenses)
      .set({ retainedAt: tx.now, categoryId: null })
      .where(and(eq(expenses.occasionId, occasionId), isNull(expenses.retainedAt)))
      .returning({ receiptAssetId: expenses.receiptAssetId });
    const receiptIds = kept.map((k) => k.receiptAssetId).filter((v): v is string => !!v);
    if (receiptIds.length > 0) {
      await tx.db
        .update(assets)
        .set({ ownerId: retainedOwnerId(occasionId) })
        .where(and(inArray(assets.id, receiptIds), eq(assets.ownerType, "occasion"), eq(assets.ownerId, occasionId)));
    }
  });

  registerRetentionRule({
    name: "finance-records-retained",
    run: async (ctx) => {
      const cutoff = addDays(ctx.now, -365 * RECEIPT_RETENTION_YEARS - 2);
      return inTx(ctx, async (tx) => {
        const due = await tx.db
          .select({ id: expenses.id, receiptAssetId: expenses.receiptAssetId })
          .from(expenses)
          .where(and(isNotNull(expenses.retainedAt), lt(expenses.retainedAt, cutoff)))
          .limit(500);
        if (due.length === 0) return 0;
        const receiptIds = due.map((d) => d.receiptAssetId).filter((v): v is string => !!v);
        if (receiptIds.length > 0) {
          // soft-delete: @ed/storage's own rule removes the stored objects 30 days later
          await tx.db
            .update(assets)
            .set({ deletedAt: tx.now })
            .where(and(inArray(assets.id, receiptIds), isNull(assets.deletedAt)));
        }
        await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
        await tx.db.delete(expenses).where(
          inArray(
            expenses.id,
            due.map((d) => d.id),
          ),
        );
        await tx.db.execute(sql`select set_config('ed.correction', '', true)`);
        return due.length;
      });
    },
  });
}
register();

/** Owner id given to receipt files kept after their occasion was purged. */
export function retainedOwnerId(occasionId: string): string {
  return `retained:${occasionId}`;
}


export function registerJobs(): void {
  register();
}
