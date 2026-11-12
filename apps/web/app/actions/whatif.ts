'use server';

import { revalidatePath } from 'next/cache';
import { confirmTemplateReapply, confirmDateMove, discardPreview } from '@eventdesk/core';
import { prisma } from '@eventdesk/db';
import { requireUser } from '../lib/session';

// Principle 3: previews are confirmed explicitly; confirm is idempotent (Q4).
export async function confirmPreviewAction(occasionId: string, previewId: string): Promise<void> {
  const user = await requireUser();
  const preview = await prisma.whatIfPreview.findUniqueOrThrow({ where: { id: previewId } });
  if (preview.subject === 'date_move') {
    await confirmDateMove(previewId, user.accountId);
  } else if (preview.subject === 'template_reapply') {
    await confirmTemplateReapply(previewId, user.accountId);
  }
  revalidatePath(`/occasions/${occasionId}`);
}

export async function discardPreviewAction(occasionId: string, previewId: string): Promise<void> {
  const user = await requireUser();
  await discardPreview(previewId, user.accountId);
  revalidatePath(`/occasions/${occasionId}`);
}
