import { prisma, type BudgetCategory, type Expense } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireGrant } from './access';

// B1: budget by category with estimate, committed, invoiced, paid and forecast as
// separate columns — never merged. Finance grant required server-side (D2).

export async function listCategories(occasionId: string, accountId: string) {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  return prisma.budgetCategory.findMany({ where: { occasionId }, orderBy: { createdAt: 'asc' } });
}

export async function createCategory(
  occasionId: string,
  accountId: string,
  input: { name: string; estimateBani?: number; currency?: string }
): Promise<BudgetCategory> {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  if (!input.name.trim()) throw new AppError('INVALID_INPUT', 'Category name is required.');
  const cat = await prisma.budgetCategory.create({
    data: {
      occasionId,
      name: input.name.trim(),
      currency: input.currency ?? 'RON',
      estimateBani: input.estimateBani ?? 0,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'budget_category_created',
    objectType: 'BudgetCategory',
    objectId: cat.id,
    after: { name: cat.name, estimateBani: cat.estimateBani },
  });
  return cat;
}

export async function updateCategoryStates(
  occasionId: string,
  accountId: string,
  categoryId: string,
  states: Partial<
    Pick<
      BudgetCategory,
      'estimateBani' | 'committedBani' | 'invoicedBani' | 'paidBani' | 'forecastBani'
    >
  >
): Promise<BudgetCategory> {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  const before = await prisma.budgetCategory.findFirst({ where: { id: categoryId, occasionId } });
  if (!before) throw new AppError('NOT_FOUND', 'Category not found.');
  const updated = await prisma.budgetCategory.update({ where: { id: categoryId }, data: states });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'budget_category_updated',
    objectType: 'BudgetCategory',
    objectId: categoryId,
    before: {
      estimateBani: before.estimateBani,
      committedBani: before.committedBani,
      invoicedBani: before.invoicedBani,
      paidBani: before.paidBani,
      forecastBani: before.forecastBani,
    },
    after: {
      estimateBani: updated.estimateBani,
      committedBani: updated.committedBani,
      invoicedBani: updated.invoicedBani,
      paidBani: updated.paidBani,
      forecastBani: updated.forecastBani,
    },
  });
  return updated;
}

// B2: expenses with receipts; approval and payment are separate, independent states.
export async function createExpense(
  occasionId: string,
  accountId: string,
  input: {
    categoryId: string;
    title: string;
    amountBani: number;
    currency?: string;
    receiptAssetId?: string;
  }
): Promise<Expense> {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Expense title is required.');
  if (input.amountBani <= 0) throw new AppError('INVALID_INPUT', 'Amount must be positive.');
  const category = await prisma.budgetCategory.findFirst({
    where: { id: input.categoryId, occasionId },
  });
  if (!category) throw new AppError('NOT_FOUND', 'Category not found.');
  const expense = await prisma.expense.create({
    data: {
      occasionId,
      categoryId: input.categoryId,
      title: input.title.trim(),
      amountBani: input.amountBani,
      currency: input.currency ?? 'RON',
      receiptAssetId: input.receiptAssetId ?? null,
      createdById: accountId,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'expense_created',
    objectType: 'Expense',
    objectId: expense.id,
    after: {
      title: expense.title,
      amountBani: expense.amountBani,
      approvalState: 'pending',
      paymentState: 'unpaid',
    },
  });
  return expense;
}

export async function listExpenses(occasionId: string, accountId: string) {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  return prisma.expense.findMany({
    where: { occasionId },
    include: { category: true, receipt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function setExpenseApproval(
  occasionId: string,
  accountId: string,
  expenseId: string,
  state: 'approved' | 'rejected'
): Promise<Expense> {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  const before = await prisma.expense.findFirst({ where: { id: expenseId, occasionId } });
  if (!before) throw new AppError('NOT_FOUND', 'Expense not found.');
  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: {
      approvalState: state,
      approvedById: state === 'approved' ? accountId : before.approvedById,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: `expense_${state}`,
    objectType: 'Expense',
    objectId: expenseId,
    before: { approvalState: before.approvalState, paymentState: before.paymentState },
    after: { approvalState: updated.approvalState, paymentState: updated.paymentState },
  });
  return updated;
}

export async function setExpensePayment(
  occasionId: string,
  accountId: string,
  expenseId: string,
  paid: boolean
): Promise<Expense> {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  const before = await prisma.expense.findFirst({ where: { id: expenseId, occasionId } });
  if (!before) throw new AppError('NOT_FOUND', 'Expense not found.');
  // payment changes the paid state only — via an audited correction of the fact (principle 4)
  const updated = await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: paid ? 'payment_recorded' : 'payment_reversed',
        objectType: 'Expense',
        objectId: expenseId,
        before: { paymentState: before.paymentState, paidAt: before.paidAt },
        after: { paymentState: paid ? 'paid' : 'unpaid', paidAt: paid ? new Date() : null },
      },
    });
    return tx.expense.update({
      where: { id: expenseId },
      data: { paymentState: paid ? 'paid' : 'unpaid', paidAt: paid ? new Date() : null },
    });
  });
  return updated;
}
