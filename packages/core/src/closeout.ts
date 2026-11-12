import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';
import { settlementView } from './ledger';
import { confirmPreview, createPreview, getPreview } from './whatif';

// B9: cancel or postpone with a What-if preview of everything affected (guests,
// suppliers, payments, deliveries) — never applied silently (principle 3).
// B10: closeout list of unpaid balances, returns, deposits; lessons carried to the
// next occasion; starts the retention clock (private requests purged at
// closeout+30d per INF6 — the retention job reads Closeout.completedAt).

export async function previewStatusChange(
  occasionId: string,
  accountId: string,
  newStatus: 'cancelled' | 'postponed' | 'closed',
  idempotencyKey?: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const [guests, suppliers, bookings, deadlines, deliveries, invitations] = await Promise.all([
    prisma.household.count({ where: { occasionId } }),
    prisma.supplier.count({ where: { occasionId } }),
    prisma.booking.findMany({
      where: { occasionId },
      select: { id: true, title: true, state: true },
    }),
    prisma.paymentDeadline.findMany({
      where: { booking: { occasionId }, paidAt: null },
      select: { id: true, kind: true, amountBani: true, dueAt: true },
    }),
    prisma.delivery.findMany({
      where: { occasionId },
      select: { id: true, title: true, kind: true, receivedQty: true, expectedQty: true },
    }),
    prisma.invitation.count({ where: { occasionId, revokedAt: null } }),
  ]);
  return createPreview({
    occasionId,
    subject: `status_${newStatus}`,
    delta: {
      from: occasion.status,
      to: newStatus,
      affected: {
        households: guests,
        suppliers,
        bookings,
        unpaidDeadlines: deadlines,
        deliveries: deliveries.filter((d) => d.receivedQty < d.expectedQty),
        activeInvitations: invitations,
      },
    },
    proposedByAccountId: accountId,
    idempotencyKey,
  });
}

export async function confirmStatusChange(previewId: string, accountId: string) {
  const preview = await getPreview(previewId);
  const delta = preview.delta as { to: 'cancelled' | 'postponed' | 'closed' };
  return confirmPreview(previewId, accountId, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.occasion.update({
        where: { id: preview.occasionId as string },
        data: { status: delta.to, revision: { increment: 1 } },
      });
      if (delta.to !== 'postponed') {
        await tx.invitation.updateMany({
          where: { occasionId: preview.occasionId as string, revokedAt: null },
          data: { revokedAt: new Date(), expiryMode: 'closeout' as const },
        });
      }
    });
  });
}

export async function runCloseout(occasionId: string, accountId: string, lessons?: string) {
  const member = await requireMember(occasionId, accountId);
  requireRoleCheck(member);
  const settlement = await settlementView(occasionId, accountId).catch(() => null);
  const deliveries = await prisma.delivery.findMany({ where: { occasionId } });
  const unpaidDeadlines = await prisma.paymentDeadline.findMany({
    where: { booking: { occasionId }, paidAt: null },
  });
  const closeout = await prisma.$transaction(async (tx) => {
    const c = await tx.closeout.upsert({
      where: { occasionId },
      update: { lessons: lessons ?? null, completedAt: new Date() },
      create: {
        occasionId,
        unpaidBalances: unpaidDeadlines.map((d) => ({
          kind: d.kind,
          amountBani: d.amountBani,
          currency: d.currency,
          dueAt: d.dueAt,
        })),
        returns: deliveries
          .filter((d) => d.kind === 'return')
          .map((d) => ({ title: d.title, expected: d.expectedQty, received: d.receivedQty })),
        deposits: [],
        lessons: lessons ?? null,
        completedAt: new Date(),
      },
    });
    await tx.occasion.update({
      where: { id: occasionId },
      data: { status: 'closed', revision: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'closeout_completed',
        objectType: 'Closeout',
        objectId: c.id,
        after: {
          unpaid: unpaidDeadlines.length,
          lessons: lessons ?? null,
          settlement: settlement?.settlements ?? null,
        },
      },
    });
    return c;
  });
  return closeout;
}

function requireRoleCheck(member: { role: string }) {
  if (member.role !== 'owner' && member.role !== 'project_manager') {
    throw new AppError('FORBIDDEN', 'Only owner or project manager can close out.');
  }
}
