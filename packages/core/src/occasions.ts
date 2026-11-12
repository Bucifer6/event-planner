import { prisma, type Occasion, type OccasionMember } from '@eventdesk/db';
import { AppError, addMonthsUtc, now, startOfUtcDay } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole, canManage } from './access';
import { confirmPreview, createPreview, getPreview } from './whatif';

// A1: create an occasion — free activation, no payment step anywhere (MON1).
export async function createOccasion(input: {
  ownerId: string;
  title: string;
  kind: string;
  dateMode: 'date' | 'range' | 'poll';
  dateStart?: Date;
  dateEnd?: Date;
  capacityTotal?: number | null;
}): Promise<Occasion> {
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Title is required.');
  const occasion = await prisma.$transaction(async (tx) => {
    const occ = await tx.occasion.create({
      data: {
        ownerId: input.ownerId,
        title: input.title.trim(),
        kind: input.kind,
        dateMode: input.dateMode,
        dateStart: input.dateStart ?? null,
        dateEnd: input.dateEnd ?? null,
        capacityTotal: input.capacityTotal ?? null,
      },
    });
    await tx.occasionMember.create({
      data: { occasionId: occ.id, accountId: input.ownerId, role: 'owner' },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.ownerId,
        actorKind: 'account',
        action: 'occasion_created',
        objectType: 'Occasion',
        objectId: occ.id,
        after: { title: occ.title, kind: occ.kind },
      },
    });
    return occ;
  });
  return occasion;
}

export async function listOccasionsForAccount(accountId: string): Promise<Occasion[]> {
  const memberships = await prisma.occasionMember.findMany({
    where: { accountId },
    select: { occasionId: true },
  });
  return prisma.occasion.findMany({
    where: { id: { in: memberships.map((m) => m.occasionId) } },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getOccasionForMember(occasionId: string, accountId: string) {
  const member = await requireMember(occasionId, accountId);
  const occasion = await prisma.occasion.findUnique({ where: { id: occasionId } });
  if (!occasion) throw new AppError('NOT_FOUND', 'Occasion not found.');
  return { occasion, member };
}

// A11: event brief with purpose and 2-3 priorities.
export async function updateBrief(
  occasionId: string,
  accountId: string,
  input: { purpose?: string; priorities?: string[] }
): Promise<Occasion> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const priorities = (input.priorities ?? []).filter((p) => p.trim()).slice(0, 3);
  const updated = await prisma.occasion.update({
    where: { id: occasionId },
    data: { briefPurpose: input.purpose?.trim() || null, briefPriorities: priorities },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'brief_updated',
    objectType: 'Occasion',
    objectId: occasionId,
    after: { purpose: updated.briefPurpose, priorities: updated.briefPriorities },
  });
  return updated;
}

// A10: overview — next milestone, overdue work, unaccepted delegation, blockers.
export async function getOverview(occasionId: string, accountId: string) {
  const { member } = await getOccasionForMember(occasionId, accountId);
  const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const tasks = await prisma.task.findMany({
    where: { occasionId },
    include: { owner: true, delegations: true },
    orderBy: { dueAt: 'asc' },
  });
  const current = now();
  const upcoming = tasks.filter((t) => t.dueAt && t.dueAt >= current && t.status !== 'done');
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < current && t.status !== 'done');
  const unaccepted = tasks.flatMap((t) =>
    t.delegations.filter((d) => d.state === 'offered').map((d) => ({ task: t, delegation: d }))
  );
  const blockers = tasks.filter((t) => t.status === 'blocked');
  return {
    occasion,
    member,
    nextMilestone: upcoming[0] ?? null,
    overdue,
    unacceptedDelegations: unaccepted,
    blockers,
    brief: { purpose: occasion.briefPurpose, priorities: occasion.briefPriorities },
  };
}

// Worker-facing digest (A10): same four sections, as text.
export async function computeMemberDigest(
  occasionId: string,
  memberId: string
): Promise<{ subject: string; text: string }> {
  const member = await prisma.occasionMember.findUniqueOrThrow({ where: { id: memberId } });
  void member;
  const overview = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const tasks = await prisma.task.findMany({
    where: { occasionId },
    include: { delegations: true },
    orderBy: { dueAt: 'asc' },
  });
  const current = now();
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < current && t.status !== 'done');
  const upcoming = tasks.filter((t) => t.dueAt && t.dueAt >= current && t.status !== 'done');
  const unaccepted = tasks.flatMap((t) =>
    t.delegations.filter((d) => d.state === 'offered').map((d) => t.title)
  );
  const blockers = tasks.filter((t) => t.status === 'blocked').map((t) => t.title);
  const linesRo: string[] = [];
  linesRo.push(`Rezumatul zilei pentru „${overview.title}”`);
  linesRo.push(`Următorul milestone: ${upcoming[0]?.title ?? '—'}`);
  linesRo.push(`Întârziat: ${overdue.length ? overdue.map((t) => t.title).join(', ') : 'nimic'}`);
  linesRo.push(`Delegări neacceptate: ${unaccepted.length ? unaccepted.join(', ') : 'nimic'}`);
  linesRo.push(`Blocanți: ${blockers.length ? blockers.join(', ') : 'nimic'}`);
  const linesEn = [
    `Daily digest for "${overview.title}"`,
    `Next milestone: ${upcoming[0]?.title ?? '—'}`,
    `Overdue: ${overdue.length ? overdue.map((t) => t.title).join(', ') : 'none'}`,
    `Unaccepted delegations: ${unaccepted.length ? unaccepted.join(', ') : 'none'}`,
    `Blockers: ${blockers.length ? blockers.join(', ') : 'none'}`,
  ];
  return {
    subject: `Rezumatul zilei pentru „${overview.title}” / Daily digest for "${overview.title}"`,
    text: [...linesRo, '', '--- English ---', ...linesEn].join('\n'),
  };
}

// A2: moving the occasion date shifts the template schedule as a previewed change,
// never silently (principle 3).
export async function previewDateMove(
  occasionId: string,
  accountId: string,
  newStart: Date,
  idempotencyKey?: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  if (!occasion.dateStart)
    throw new AppError('INVALID_INPUT', 'Occasion has no single date to move.');
  const shiftMs = newStart.getTime() - occasion.dateStart.getTime();
  const tasks = await prisma.task.findMany({ where: { occasionId, dueAt: { not: null } } });
  const delta = tasks.map((t) => ({
    taskId: t.id,
    title: t.title,
    from: t.dueAt,
    to: new Date((t.dueAt as Date).getTime() + shiftMs),
  }));
  const preview = await createPreview({
    occasionId,
    subject: 'date_move',
    delta: { newStart, shiftMs, tasks: delta },
    proposedByAccountId: accountId,
    idempotencyKey,
  });
  return preview;
}

export async function confirmDateMove(previewId: string, accountId: string) {
  const preview = await getPreview(previewId);
  const delta = preview.delta as {
    newStart: string;
    shiftMs: number;
    tasks: { taskId: string; to: string }[];
  };
  const result = await confirmPreview(previewId, accountId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const t of delta.tasks) {
        await tx.task.update({ where: { id: t.taskId }, data: { dueAt: new Date(t.to) } });
      }
      await tx.occasion.update({
        where: { id: preview.occasionId as string },
        data: { dateStart: new Date(delta.newStart), revision: { increment: 1 } },
      });
    });
  });
  return result;
}

// A2: template tasks auto-schedule at month stages before the occasion date (12/9/6/3/1).
export function scheduledDueAt(dateStart: Date, offsetMonths: number): Date {
  return addMonthsUtc(dateStart, -offsetMonths);
}
