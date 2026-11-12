'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@eventdesk/db';
import {
  audit,
  createOccasion,
  applyTemplate,
  previewDateMove,
  updateBrief,
  confirmDateMove,
} from '@eventdesk/core';
import { newIdempotencyKey } from '@eventdesk/shared';
import { requireUser } from '../lib/session';

export async function createOccasionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '');
  const kind = String(formData.get('kind') ?? 'custom');
  const dateMode = String(formData.get('dateMode') ?? 'date') as 'date' | 'range' | 'poll';
  const dateStartRaw = String(formData.get('dateStart') ?? '');
  const dateEndRaw = String(formData.get('dateEnd') ?? '');
  const capacityRaw = String(formData.get('capacity') ?? '');
  const template = String(formData.get('template') ?? 'blank');
  const occasion = await createOccasion({
    ownerId: user.accountId,
    title,
    kind,
    dateMode,
    dateStart: dateStartRaw ? new Date(`${dateStartRaw}T12:00:00Z`) : undefined,
    dateEnd: dateEndRaw ? new Date(`${dateEndRaw}T12:00:00Z`) : undefined,
    capacityTotal: capacityRaw ? Number(capacityRaw) : null,
  });
  if (template && template !== 'blank') {
    await applyTemplate(occasion.id, user.accountId, template);
  }
  revalidatePath('/dashboard');
  redirect(`/occasions/${occasion.id}`);
}

export async function updateBriefAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const purpose = String(formData.get('purpose') ?? '');
  const priorities = String(formData.get('priorities') ?? '')
    .split('\n')
    .map((p) => p.trim());
  await updateBrief(occasionId, user.accountId, { purpose, priorities });
  revalidatePath(`/occasions/${occasionId}`);
}

export async function previewDateMoveAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const newDate = String(formData.get('newDate') ?? '');
  const preview = await previewDateMove(
    occasionId,
    user.accountId,
    new Date(`${newDate}T12:00:00Z`),
    newIdempotencyKey()
  );
  redirect(`/occasions/${occasionId}/previews/${preview.id}`);
}

export async function confirmDateMoveAction(occasionId: string, previewId: string): Promise<void> {
  const user = await requireUser();
  await confirmDateMove(previewId, user.accountId);
  revalidatePath(`/occasions/${occasionId}`);
  redirect(`/occasions/${occasionId}`);
}

// D6: deletion request with a 7-day undo window; the retention job completes it.
export async function deleteOccasionAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const member = await prisma.occasionMember.findUnique({
    where: { occasionId_accountId: { occasionId, accountId: user.accountId } },
  });
  if (!member || member.role !== 'owner') {
    redirect(`/occasions/${occasionId}?error=err.forbidden`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.deletionRequest.upsert({
      where: { targetType_targetId: { targetType: 'occasion', targetId: occasionId } },
      update: {},
      create: {
        targetType: 'occasion',
        targetId: occasionId,
        undoUntil: new Date(Date.now() + 7 * 86_400_000),
        retainedNote:
          'Receipts and financial records are kept 7 years after closeout (Romanian bookkeeping); audit log entries 2 years; objection records 3 years (INF6).',
      },
    });
    await tx.occasion.update({ where: { id: occasionId }, data: { status: 'archived' } });
    await tx.auditLog.create({
      data: {
        actorId: user.accountId,
        actorKind: 'account',
        action: 'occasion_delete_requested',
        objectType: 'Occasion',
        objectId: occasionId,
      },
    });
  });
  void formData;
  revalidatePath('/dashboard');
  redirect('/dashboard');
}
