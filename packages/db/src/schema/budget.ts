import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, currency, id, moneyMinorBig, ref, timestamptz, updatedAt } from "./_helpers";
import { occasions } from "./occasions";

// Budget (B1) and expenses (B2). Finance data: every read and write needs the `finance` grant
// (D2) — enforced in @ed/core/budget and @ed/core/expenses.

export const EXPENSE_APPROVAL_STATES = ["pending", "approved", "rejected"] as const;
export type ExpenseApprovalState = (typeof EXPENSE_APPROVAL_STATES)[number];
export const expenseApprovalStateSchema = z.enum(EXPENSE_APPROVAL_STATES);

export const EXPENSE_PAYMENT_STATES = ["unpaid", "paid"] as const;
export type ExpensePaymentState = (typeof EXPENSE_PAYMENT_STATES)[number];
export const expensePaymentStateSchema = z.enum(EXPENSE_PAYMENT_STATES);

/**
 * One budget line per category. ONLY estimate and forecast are stored here (entered by a
 * person; NULL = unknown, never 0). Committed, invoiced and paid are derived from expenses and
 * registered budget sources at read time — the five amounts are never merged (B1).
 */
export const budgetCategories = pgTable(
  "budget_categories",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Set when the category came from a one-tap default ("venue", "food"…). */
    presetKey: text("preset_key"),
    estimateMinor: moneyMinorBig("estimate_minor"),
    forecastMinor: moneyMinorBig("forecast_minor"),
    currency: currency(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("budget_categories_occasion_name_uq").on(t.occasionId, sql`lower(${t.name})`),
    check(
      "budget_categories_amounts_ck",
      sql`(${t.estimateMinor} IS NULL OR ${t.estimateMinor} >= 0) AND (${t.forecastMinor} IS NULL OR ${t.forecastMinor} >= 0)`,
    ),
  ],
);

/**
 * An expense (B2). Approval and payment are two independent states. Once payment_state is
 * 'paid' the amount, currency and payment state are FACTS: the trigger in
 * src/sql/020_expenses_paid_guard.sql rejects changing them unless the change comes through
 * the correction path (principle 4).
 *
 * occasion_id deliberately has no foreign key: paid expenses and expenses with a receipt are
 * kept for 7 years after the occasion is purged (INF6, bookkeeping) with retained_at set.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    occasionId: ref("occasion_id").notNull(),
    categoryId: ref("category_id").references(() => budgetCategories.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    amountMinor: moneyMinorBig("amount_minor").notNull(),
    currency: currency(),
    /** Day on the receipt, yyyy-mm-dd. */
    spentOn: text("spent_on").notNull(),
    /** Free-text supplier name. */
    supplierLabel: text("supplier_label"),
    /** Supplier booking this expense pays for (owned by the suppliers domain; no FK). */
    bookingId: ref("booking_id"),
    receiptAssetId: ref("receipt_asset_id"),
    approvalState: text("approval_state").$type<ExpenseApprovalState>().notNull().default("pending"),
    approvalDecidedAt: timestamptz("approval_decided_at"),
    approvalDecidedBy: ref("approval_decided_by"),
    paymentState: text("payment_state").$type<ExpensePaymentState>().notNull().default("unpaid"),
    paidAt: timestamptz("paid_at"),
    /** Day the money left, yyyy-mm-dd. */
    paidOn: text("paid_on"),
    createdByMemberId: ref("created_by_member_id"),
    idempotencyKey: text("idempotency_key"),
    /** Set when the occasion was purged and this row is kept for the bookkeeping period. */
    retainedAt: timestamptz("retained_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expenses_occasion_idx").on(t.occasionId, t.spentOn),
    index("expenses_category_idx").on(t.categoryId),
    index("expenses_booking_idx").on(t.bookingId),
    index("expenses_retained_idx").on(t.retainedAt),
    uniqueIndex("expenses_idempotency_uq").on(t.occasionId, t.idempotencyKey),
    check("expenses_amount_ck", sql`${t.amountMinor} > 0`),
  ],
);
