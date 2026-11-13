"use server";

import { addCategories, budgetPresetSchema, removeCategory, updateCategory } from "@ed/core/budget";
import {
  correctExpense,
  createExpense,
  deleteExpense,
  markExpensePaid,
  setExpenseApproval,
  updateExpense,
} from "@ed/core/expenses";
import { expenseApprovalStateSchema } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zFormBoolean } from "@ed/shared/zod";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { optionalAmount, requireAmount } from "@/app/(app)/occasions/[id]/budget/_lib/money";
import { action } from "@/lib/action";

// Budget and expense actions (B1, B2). Rules and the finance-grant check live in @ed/core;
// these translate forms (typed amounts → minor units) into core calls.

const id = z.string().min(1).max(64);
const text = z.string().max(2000).optional();
const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");

/** One tap on the default chips: adds every chosen preset under its translated name. */
export const addPresetCategories = action(
  z.object({ occasionId: id, presets: z.union([z.string(), z.array(z.string())]).optional() }),
  async (ctx, input) => {
    const keys = (Array.isArray(input.presets) ? input.presets : input.presets ? [input.presets] : []).map((k) => budgetPresetSchema.parse(k));
    if (keys.length === 0) {
      throw new AppError("VALIDATION", "budget.categories.noneChosen", { fieldErrors: { presets: ["budget.categories.noneChosen"] } });
    }
    const t = await getTranslations("budget.presets");
    const created = await addCategories(ctx, {
      occasionId: input.occasionId,
      categories: keys.map((presetKey) => ({ name: t(presetKey), presetKey })),
    });
    refresh(input.occasionId);
    return { added: created.length };
  },
);

export const addCategory = action(z.object({ occasionId: id, name: z.string().max(500), estimate: text, forecast: text }), async (ctx, input) => {
  const [row] = await addCategories(ctx, {
    occasionId: input.occasionId,
    categories: [{ name: input.name, estimateMinor: optionalAmount(input.estimate, "estimate"), forecastMinor: optionalAmount(input.forecast, "forecast") }],
  });
  refresh(input.occasionId);
  return { id: row?.id ?? null };
});

/** Estimate and forecast are the two entered amounts; an empty field means "unknown". */
export const saveCategory = action(
  z.object({ occasionId: id, categoryId: id, name: z.string().max(500), estimate: text, forecast: text }),
  async (ctx, input) => {
    await updateCategory(ctx, {
      categoryId: input.categoryId,
      name: input.name,
      estimateMinor: optionalAmount(input.estimate, "estimate"),
      forecastMinor: optionalAmount(input.forecast, "forecast"),
    });
    refresh(input.occasionId);
    return { saved: true };
  },
);

export const deleteCategory = action(z.object({ occasionId: id, categoryId: id }), async (ctx, input) => {
  await removeCategory(ctx, { categoryId: input.categoryId });
  refresh(input.occasionId);
  return { removed: true };
});

const expenseFields = {
  description: z.string().max(500),
  amount: text,
  spentOn: z.string().max(10),
  categoryId: z.string().max(64).optional(),
  supplierLabel: text,
  receiptAssetId: z.string().max(64).optional(),
};

/** Idempotent on the form's key: a double tap creates one expense (Q4). */
export const addExpense = action(z.object({ occasionId: id, idempotencyKey: z.string().max(200), ...expenseFields }), async (ctx, input) => {
  const expense = await createExpense(ctx, {
    occasionId: input.occasionId,
    description: input.description,
    amountMinor: requireAmount(input.amount, "amount"),
    spentOn: input.spentOn,
    categoryId: input.categoryId,
    supplierLabel: input.supplierLabel,
    receiptAssetId: input.receiptAssetId,
    idempotencyKey: input.idempotencyKey,
  });
  refresh(input.occasionId);
  return { id: expense.id };
});

export const saveExpense = action(z.object({ occasionId: id, expenseId: id, ...expenseFields }), async (ctx, input) => {
  await updateExpense(ctx, {
    expenseId: input.expenseId,
    description: input.description,
    // a paid expense's form has no amount field: the amount is then left alone
    amountMinor: input.amount === undefined ? undefined : requireAmount(input.amount, "amount"),
    spentOn: input.spentOn,
    categoryId: input.categoryId,
    supplierLabel: input.supplierLabel,
    receiptAssetId: input.receiptAssetId,
  });
  refresh(input.occasionId);
  return { saved: true };
});

export const decideExpense = action(z.object({ occasionId: id, expenseId: id, state: expenseApprovalStateSchema }), async (ctx, input) => {
  await setExpenseApproval(ctx, { expenseId: input.expenseId, state: input.state });
  refresh(input.occasionId);
  return { state: input.state };
});

export const payExpense = action(z.object({ occasionId: id, expenseId: id, paidOn: z.string().max(10).optional() }), async (ctx, input) => {
  await markExpensePaid(ctx, { expenseId: input.expenseId, paidOn: input.paidOn });
  refresh(input.occasionId);
  return { paid: true };
});

/** Principle 4: the only way to change a paid expense — with a reason, kept for good. */
export const correctPaidExpense = action(
  z.object({ occasionId: id, expenseId: id, amount: text, markUnpaid: zFormBoolean.optional(), reason: z.string().max(2000) }),
  async (ctx, input) => {
    const amount = optionalAmount(input.amount, "amount");
    await correctExpense(ctx, {
      expenseId: input.expenseId,
      reason: input.reason,
      amountMinor: amount === null ? undefined : amount,
      markUnpaid: input.markUnpaid === true ? true : undefined,
    });
    refresh(input.occasionId);
    return { corrected: true };
  },
);

export const removeExpense = action(z.object({ occasionId: id, expenseId: id }), async (ctx, input) => {
  await deleteExpense(ctx, { expenseId: input.expenseId });
  refresh(input.occasionId);
  redirect(`/occasions/${input.occasionId}/budget`);
});
