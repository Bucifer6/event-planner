import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { sendMail } from '@eventdesk/email';
import { audit } from './audit';
import { requireMember, requireRole } from './access';

// C-03/C-10: entertainment programme with versioned cue list and performer briefings
// (briefings live on bookings, BriefingVersion). Programme changes bump
// occasion.programmeRevision; guests are notified ONCE per revision (INF5), never as
// a stream.

export async function addProgrammeItem(
  occasionId: string,
  accountId: string,
  input: { title: string; startsAt?: Date; durationMin?: number }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Title required.');
  const item = await prisma.programmeItem.create({
    data: {
      occasionId,
      title: input.title.trim(),
      startsAt: input.startsAt ?? null,
      durationMin: input.durationMin ?? null,
    },
  });
  await prisma.occasion.update({
    where: { id: occasionId },
    data: { programmeRevision: { increment: 1 } },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'programme_item_added',
    objectType: 'ProgrammeItem',
    objectId: item.id,
  });
  return item;
}

export async function updateProgrammeItem(
  itemId: string,
  occasionId: string,
  accountId: string,
  input: { title?: string; startsAt?: Date | null; durationMin?: number | null }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const item = await prisma.programmeItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  const updated = await prisma.programmeItem.update({
    where: { id: itemId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
      version: { increment: 1 },
    },
  });
  await prisma.occasion.update({
    where: { id: occasionId },
    data: { programmeRevision: { increment: 1 } },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'programme_item_updated',
    objectType: 'ProgrammeItem',
    objectId: itemId,
    after: { version: updated.version },
  });
  return updated;
}

export async function addCue(
  itemId: string,
  occasionId: string,
  accountId: string,
  input: { atLabel: string; action: string; note?: string }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const item = await prisma.programmeItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  const cue = await prisma.cue.create({
    data: { itemId, atLabel: input.atLabel, action: input.action, note: input.note ?? null },
  });
  await prisma.programmeItem.update({ where: { id: itemId }, data: { version: { increment: 1 } } });
  await prisma.occasion.update({
    where: { id: occasionId },
    data: { programmeRevision: { increment: 1 } },
  });
  return cue;
}

export async function listProgramme(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.programmeItem.findMany({
    where: { occasionId },
    include: { cues: { orderBy: { atLabel: 'asc' } } },
    orderBy: { startsAt: 'asc' },
  });
}

// C-10: notify guests once per programme revision (INF5). Returns how many were
// notified; idempotent per revision (lastProgrammeNoticeRevision guard).
export async function notifyProgrammeChange(occasionId: string): Promise<number> {
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  if (occ.programmeRevision <= occ.lastProgrammeNoticeRevision) return 0; // already notified for this revision
  const invitations = await prisma.invitation.findMany({
    where: { occasionId: occ.id, revokedAt: null },
    include: { household: { select: { leadEmail: true } } },
  });
  let sent = 0;
  for (const inv of invitations) {
    const to = inv.household.leadEmail;
    if (!to) continue;
    await sendMail({
      to,
      subject: `${occ.title} — program actualizat / programme updated`,
      text: `Programul evenimentului „${occ.title}” a fost actualizat (revizia ${occ.programmeRevision}). Deschide linkul invitației pentru detalii. / The programme of "${occ.title}" was updated (revision ${occ.programmeRevision}). Open your invitation link for details.`,
      template: 'programme-change',
      occasionId: occ.id,
    }).catch(() => {});
    sent++;
  }
  await prisma.occasion.update({
    where: { id: occ.id },
    data: { lastProgrammeNoticeRevision: occ.programmeRevision },
  });
  await audit({
    actorKind: 'system',
    action: 'programme_change_notified_once',
    objectType: 'Occasion',
    objectId: occ.id,
    after: { revision: occ.programmeRevision, notified: sent },
  });
  return sent;
}
