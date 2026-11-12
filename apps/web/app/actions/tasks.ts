'use server';

import { revalidatePath } from 'next/cache';
import {
  createTask,
  updateTask,
  offerDelegation,
  respondDelegation,
  toggleCheckItem,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createTaskAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const dueRaw = String(formData.get('dueAt') ?? '');
  await createTask(occasionId, user.accountId, {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    dueAt: dueRaw ? new Date(`${dueRaw}T12:00:00Z`) : null,
    checkItems: String(formData.get('checkItems') ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  revalidatePath(`/occasions/${occasionId}/tasks`);
}

export async function setTaskStatusAction(
  occasionId: string,
  taskId: string,
  status: 'todo' | 'in_progress' | 'blocked' | 'done'
): Promise<void> {
  const user = await requireUser();
  await updateTask(occasionId, user.accountId, taskId, { status });
  revalidatePath(`/occasions/${occasionId}/tasks`);
}

export async function delegateTaskAction(
  occasionId: string,
  taskId: string,
  toAccountId: string
): Promise<void> {
  const user = await requireUser();
  const to = await (
    await import('@eventdesk/db')
  ).prisma.occasionMember.findUnique({
    where: { occasionId_accountId: { occasionId, accountId: toAccountId } },
  });
  if (!to) throw new Error('Member not found');
  await offerDelegation(occasionId, user.accountId, taskId, to.id);
  revalidatePath(`/occasions/${occasionId}/tasks`);
}

export async function respondDelegationAction(
  occasionId: string,
  delegationId: string,
  accept: boolean
): Promise<void> {
  const user = await requireUser();
  await respondDelegation(occasionId, user.accountId, delegationId, accept);
  revalidatePath(`/occasions/${occasionId}`);
  revalidatePath(`/occasions/${occasionId}/tasks`);
}

export async function toggleCheckAction(
  occasionId: string,
  itemId: string,
  done: boolean
): Promise<void> {
  const user = await requireUser();
  await toggleCheckItem(occasionId, user.accountId, itemId, done);
  revalidatePath(`/occasions/${occasionId}/tasks`);
}
