import { prisma, type Task, type TaskStatus } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { canManage, requireMember, requireRole } from './access';

// A3: tasks with one accountable owner, due date, checklist, dependencies, child tasks.
// List, Board and Calendar are computed views over the same rows (principle 2) —
// apps/web renders them from these queries; nothing is stored per view.

export async function createTask(
  occasionId: string,
  accountId: string,
  input: {
    title: string;
    description?: string;
    ownerMemberId?: string | null;
    dueAt?: Date | null;
    parentId?: string | null;
    dependsOnIds?: string[];
    checkItems?: string[];
  }
): Promise<Task> {
  const member = await requireMember(occasionId, accountId);
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Title is required.');
  if (input.ownerMemberId) {
    const owner = await prisma.occasionMember.findUnique({
      where: { occasionId_accountId: { occasionId, accountId: input.ownerMemberId } },
    });
    if (!owner) throw new AppError('INVALID_INPUT', 'Owner is not a member of this occasion.');
  }
  if (input.parentId) {
    const parent = await prisma.task.findFirst({ where: { id: input.parentId, occasionId } });
    if (!parent) throw new AppError('INVALID_INPUT', 'Parent task not in this occasion.');
  }
  const task = await prisma.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        occasionId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        ownerMemberId: input.ownerMemberId ?? null,
        dueAt: input.dueAt ?? null,
        parentId: input.parentId ?? null,
        createdById: accountId,
        checkItems: input.checkItems?.length
          ? {
              create: input.checkItems.filter(Boolean).map((label, i) => ({ label, sortOrder: i })),
            }
          : undefined,
      },
    });
    for (const depId of input.dependsOnIds ?? []) {
      const dep = await tx.task.findFirst({ where: { id: depId, occasionId } });
      if (dep) await tx.taskDependency.create({ data: { taskId: t.id, dependsOnId: depId } });
    }
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'task_created',
        objectType: 'Task',
        objectId: t.id,
        after: { title: t.title, dueAt: t.dueAt },
      },
    });
    return t;
  });
  void member;
  return task;
}

export async function updateTask(
  occasionId: string,
  accountId: string,
  taskId: string,
  input: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    dueAt?: Date | null;
    ownerMemberId?: string | null;
  }
): Promise<Task> {
  await requireMember(occasionId, accountId);
  const before = await prisma.task.findFirst({ where: { id: taskId, occasionId } });
  if (!before) throw new AppError('NOT_FOUND', 'Task not found.');
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: input.title?.trim() || before.title,
      description: input.description ?? before.description,
      status: input.status ?? before.status,
      dueAt: input.dueAt === undefined ? before.dueAt : input.dueAt,
      ownerMemberId: input.ownerMemberId === undefined ? before.ownerMemberId : input.ownerMemberId,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'task_updated',
    objectType: 'Task',
    objectId: taskId,
    before: { status: before.status, dueAt: before.dueAt, title: before.title },
    after: { status: updated.status, dueAt: updated.dueAt, title: updated.title },
  });
  return updated;
}

export async function listTasks(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.task.findMany({
    where: { occasionId },
    include: {
      owner: true,
      checkItems: { orderBy: { sortOrder: 'asc' } },
      dependencies: true,
      children: true,
      delegations: true,
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
  });
}

// A4: delegation by offer and acceptance; declining returns the task to the delegator,
// never to a random person.
export async function offerDelegation(
  occasionId: string,
  accountId: string,
  taskId: string,
  toMemberId: string,
  reason?: string
) {
  const from = await requireRole(occasionId, accountId, [
    'owner',
    'project_manager',
    'workstream_lead',
  ]);
  const to = await prisma.occasionMember.findUnique({
    where: { occasionId_accountId: { occasionId, accountId: toMemberId } },
  });
  if (!to) throw new AppError('INVALID_INPUT', 'Delegate is not a member.');
  const task = await prisma.task.findFirst({ where: { id: taskId, occasionId } });
  if (!task) throw new AppError('NOT_FOUND', 'Task not found.');
  const delegation = await prisma.delegation.create({
    data: { taskId, fromMemberId: from.id, toMemberId: to.id, reason: reason ?? null },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'delegation_offered',
    objectType: 'Task',
    objectId: taskId,
    after: { toMemberId: to.id, delegationId: delegation.id },
  });
  return delegation;
}

export async function respondDelegation(
  occasionId: string,
  accountId: string,
  delegationId: string,
  accept: boolean,
  reason?: string
) {
  const member = await requireMember(occasionId, accountId);
  const delegation = await prisma.delegation.findUnique({
    where: { id: delegationId },
    include: { task: true },
  });
  if (!delegation || delegation.task.occasionId !== occasionId)
    throw new AppError('NOT_FOUND', 'Delegation not found.');
  if (delegation.toMemberId !== member.id && !canManage(member)) {
    throw new AppError('FORBIDDEN', 'Only the delegate or a manager can respond.');
  }
  if (delegation.state !== 'offered') throw new AppError('CONFLICT', 'Already responded.');
  return prisma.$transaction(async (tx) => {
    const state = accept ? 'accepted' : 'declined';
    const updated = await tx.delegation.update({
      where: { id: delegationId },
      data: { state, respondedAt: new Date(), reason: reason ?? delegation.reason },
    });
    // Accepted: the delegate becomes the accountable owner. Declined: the task returns
    // to the delegator (fromMemberId), never to a random person (A4).
    const newOwner = accept ? delegation.toMemberId : delegation.fromMemberId;
    await tx.task.update({ where: { id: delegation.taskId }, data: { ownerMemberId: newOwner } });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: accept ? 'delegation_accepted' : 'delegation_declined',
        objectType: 'Task',
        objectId: delegation.taskId,
        after: { delegationId, state, newOwnerMemberId: newOwner },
      },
    });
    return updated;
  });
}

export async function toggleCheckItem(
  occasionId: string,
  accountId: string,
  itemId: string,
  done: boolean
) {
  await requireMember(occasionId, accountId);
  const item = await prisma.taskCheckItem.findUnique({
    where: { id: itemId },
    include: { task: true },
  });
  if (!item || item.task.occasionId !== occasionId)
    throw new AppError('NOT_FOUND', 'Check item not found.');
  return prisma.taskCheckItem.update({ where: { id: itemId }, data: { done } });
}
