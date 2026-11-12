'use server';

import { revalidatePath } from 'next/cache';
import {
  createCategory,
  createExpense,
  listCategories,
  listExpenses,
  setExpenseApproval,
  setExpensePayment,
  updateCategoryStates,
  addLedgerEntry,
  settlementView,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createCategoryAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const estimate = String(formData.get('estimate') ?? '');
  await createCategory(occasionId, user.accountId, {
    name: String(formData.get('name') ?? ''),
    estimateBani: estimate ? Math.round(Number(estimate) * 100) : 0,
  });
  revalidatePath(`/occasions/${occasionId}/budget`);
}

export async function updateCategoryAction(
  occasionId: string,
  categoryId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const num = (v: FormDataEntryValue | null) =>
    String(v ?? '').trim() === '' ? undefined : Math.round(Number(v) * 100);
  await updateCategoryStates(occasionId, user.accountId, categoryId, {
    estimateBani: num(formData.get('estimate')),
    committedBani: num(formData.get('committed')),
    invoicedBani: num(formData.get('invoiced')),
    paidBani: num(formData.get('paid')),
    forecastBani: num(formData.get('forecast')),
  });
  revalidatePath(`/occasions/${occasionId}/budget`);
}

export async function createExpenseAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const amount = String(formData.get('amount') ?? '');
  await createExpense(occasionId, user.accountId, {
    categoryId: String(formData.get('categoryId') ?? ''),
    title: String(formData.get('title') ?? ''),
    amountBani: amount ? Math.round(Number(amount) * 100) : 0,
    receiptAssetId: formData.get('receiptAssetId')
      ? String(formData.get('receiptAssetId'))
      : undefined,
  });
  revalidatePath(`/occasions/${occasionId}/budget`);
}

export async function approveExpenseAction(
  occasionId: string,
  expenseId: string,
  state: 'approved' | 'rejected'
): Promise<void> {
  const user = await requireUser();
  await setExpenseApproval(occasionId, user.accountId, expenseId, state);
  revalidatePath(`/occasions/${occasionId}/budget`);
}

export async function payExpenseAction(
  occasionId: string,
  expenseId: string,
  paid: boolean
): Promise<void> {
  const user = await requireUser();
  await setExpensePayment(occasionId, user.accountId, expenseId, paid);
  revalidatePath(`/occasions/${occasionId}/budget`);
}

export async function addLedgerEntryAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const payerMemberId = String(formData.get('payerMemberId') ?? '');
  const amount = String(formData.get('amount') ?? '');
  const splitMembers = String(formData.get('splitMembers') ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const amountBani = Math.round(Number(amount) * 100);
  const share = Math.floor(amountBani / Math.max(1, splitMembers.length));
  const splits = splitMembers.map((m) => ({ memberId: m, shareBani: share }));
  const remainder = amountBani - share * splits.length;
  if (splits.length && remainder) splits[0]!.shareBani += remainder;
  await addLedgerEntry(occasionId, user.accountId, {
    payerMemberId,
    amountBani,
    note: String(formData.get('note') ?? ''),
    splits,
  });
  revalidatePath(`/occasions/${occasionId}/ledger`);
}

export async function ledgerData(occasionId: string) {
  const user = await requireUser();
  const [entries, settlement, categories, expenses] = await Promise.all([
    import('@eventdesk/core').then((m) => m.listLedger(occasionId, user.accountId)),
    settlementView(occasionId, user.accountId),
    listCategories(occasionId, user.accountId),
    listExpenses(occasionId, user.accountId),
  ]);
  return { entries, settlement, categories, expenses };
}
