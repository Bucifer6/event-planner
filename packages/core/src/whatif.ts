import { prisma, type WhatIfPreview } from '@eventdesk/db';
import { AppError, newIdempotencyKey } from '@eventdesk/shared';
import { audit } from './audit';

// R0-16 / principle 3: changes show their knock-on effects as a "What if?" delta and
// are applied only on explicit confirmation. Confirm is idempotent (Q4): a double-tap
// applies once because the state transition is guarded in one transaction.

export async function createPreview(input: {
  occasionId?: string;
  subject: string;
  delta: unknown;
  proposedByAccountId?: string;
  proposedByTokenId?: string;
  idempotencyKey?: string;
}): Promise<WhatIfPreview> {
  const key = input.idempotencyKey ?? newIdempotencyKey();
  const existing = await prisma.whatIfPreview.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existing;
  return prisma.whatIfPreview.create({
    data: {
      occasionId: input.occasionId ?? null,
      subject: input.subject,
      delta: input.delta as object,
      proposedByAccountId: input.proposedByAccountId ?? null,
      proposedByTokenId: input.proposedByTokenId ?? null,
      idempotencyKey: key,
    },
  });
}

export async function getPreview(id: string): Promise<WhatIfPreview> {
  const row = await prisma.whatIfPreview.findUnique({ where: { id } });
  if (!row) throw new AppError('NOT_FOUND', 'Preview not found.');
  return row;
}

export interface ConfirmResult {
  preview: WhatIfPreview;
  alreadyDecided: boolean;
}

// apply is only ever called when the preview transitions pending -> applied, exactly once.
export async function confirmPreview(
  id: string,
  actorId: string,
  apply: () => Promise<void>
): Promise<ConfirmResult> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.whatIfPreview.findUnique({ where: { id } });
    if (!row) throw new AppError('NOT_FOUND', 'Preview not found.');
    if (row.state !== 'pending') return { preview: row, alreadyDecided: true };
    await apply();
    const updated = await tx.whatIfPreview.update({
      where: { id },
      data: { state: 'applied', decidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorKind: 'account',
        action: 'preview_applied',
        objectType: 'WhatIfPreview',
        objectId: id,
        after: { subject: row.subject, delta: row.delta },
      },
    });
    return { preview: updated, alreadyDecided: false };
  });
}

export async function discardPreview(id: string, actorId: string): Promise<WhatIfPreview> {
  const row = await getPreview(id);
  if (row.state !== 'pending') return row;
  const updated = await prisma.whatIfPreview.update({
    where: { id },
    data: { state: 'discarded', decidedAt: new Date() },
  });
  await audit({
    actorId,
    actorKind: 'account',
    action: 'preview_discarded',
    objectType: 'WhatIfPreview',
    objectId: id,
  });
  return updated;
}
