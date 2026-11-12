import { prisma, type Delivery } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';

// B6: deliveries, hired items and returns with received quantities. Facts stay
// facts (principle 4): receivedQty changes ONLY via a Correction row — the DB
// trigger blocks direct overwrites; the correction flow sets app.correction
// inside its transaction, writes the Correction, and feeds the audit log (SEC10).

export async function createDelivery(
  occasionId: string,
  accountId: string,
  input: {
    title: string;
    kind: 'delivery' | 'hired_item' | 'return';
    expectedQty: number;
    unitLabel?: string;
    bookingId?: string;
  }
): Promise<Delivery> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Title is required.');
  return prisma.delivery.create({
    data: {
      occasionId,
      bookingId: input.bookingId ?? null,
      title: input.title.trim(),
      kind: input.kind,
      expectedQty: input.expectedQty,
      unitLabel: input.unitLabel ?? null,
    },
  });
}

export async function listDeliveries(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.delivery.findMany({ where: { occasionId }, orderBy: { createdAt: 'asc' } });
}

// The only way to change a received quantity: an audited correction.
export async function recordReceivedCorrection(
  occasionId: string,
  accountId: string,
  deliveryId: string,
  newReceivedQty: number,
  reason: string
): Promise<Delivery> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (!reason.trim()) throw new AppError('INVALID_INPUT', 'A reason is required for a correction.');
  const delivery = await prisma.delivery.findFirst({ where: { id: deliveryId, occasionId } });
  if (!delivery) throw new AppError('NOT_FOUND', 'Delivery not found.');
  if (newReceivedQty < 0 || newReceivedQty > delivery.expectedQty) {
    throw new AppError(
      'INVALID_INPUT',
      `Received quantity must be between 0 and ${delivery.expectedQty}.`
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.correction = 'true'`;
    const updated = await tx.delivery.update({
      where: { id: deliveryId },
      data: { receivedQty: newReceivedQty },
    });
    await tx.correction.create({
      data: {
        targetType: 'Delivery',
        targetId: deliveryId,
        field: 'receivedQty',
        before: { receivedQty: delivery.receivedQty },
        after: { receivedQty: newReceivedQty },
        actorId: accountId,
        reason,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'correction_applied',
        objectType: 'Delivery',
        objectId: deliveryId,
        before: { receivedQty: delivery.receivedQty },
        after: { receivedQty: newReceivedQty },
      },
    });
    return updated;
  });
}

export async function listCorrections(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const deliveries = await prisma.delivery.findMany({
    where: { occasionId },
    select: { id: true },
  });
  const ids = deliveries.map((d) => d.id);
  return prisma.correction.findMany({
    where: { targetType: 'Delivery', targetId: { in: ids } },
    orderBy: { createdAt: 'desc' },
  });
}
