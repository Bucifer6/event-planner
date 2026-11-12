import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';
import { resolveInvitation } from './rsvp';

// A7: date polls with Yes/Maybe/No; the host confirms; votes never reserve places.

export async function createPoll(occasionId: string, accountId: string, title?: string) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const poll = await prisma.datePoll.create({ data: { occasionId, title: title?.trim() || null } });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'poll_created',
    objectType: 'DatePoll',
    objectId: poll.id,
  });
  return poll;
}

export async function listPolls(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.datePoll.findMany({
    where: { occasionId },
    include: { votes: true },
    orderBy: { createdAt: 'desc' },
  });
}

// Vote from a guest link (scoped invitation) — never touches capacity (A8).
export async function votePoll(token: string, pollId: string, choice: 'yes' | 'maybe' | 'no') {
  const invitation = await resolveInvitation(token);
  const poll = await prisma.datePoll.findUnique({ where: { id: pollId } });
  if (!poll || poll.occasionId !== invitation.occasionId)
    throw new AppError('NOT_FOUND', 'Poll not found.');
  return prisma.pollVote.upsert({
    where: { pollId_invitationId: { pollId, invitationId: invitation.id } },
    update: { choice },
    create: { pollId, invitationId: invitation.id, choice },
  });
}

// Host confirms the winning date; capacity is unchanged by votes (A7).
export async function confirmPoll(
  occasionId: string,
  accountId: string,
  pollId: string,
  decidedDate: Date
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const poll = await prisma.datePoll.findUnique({ where: { id: pollId } });
  if (!poll || poll.occasionId !== occasionId) throw new AppError('NOT_FOUND', 'Poll not found.');
  return prisma.$transaction(async (tx) => {
    await tx.datePoll.update({
      where: { id: pollId },
      data: { decidedDate, confirmedAt: now() },
    });
    await tx.occasion.update({
      where: { id: occasionId },
      data: { dateStart: decidedDate, dateMode: 'date', revision: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'poll_confirmed',
        objectType: 'DatePoll',
        objectId: pollId,
        after: { decidedDate },
      },
    });
  });
}
