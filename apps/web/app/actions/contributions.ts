'use server';

import { revalidatePath } from 'next/cache';
import { claimUnits, createNeed, releaseClaim } from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createNeedAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const unitsRaw = String(formData.get('totalUnits') ?? '');
  await createNeed(occasionId, user.accountId, {
    title: String(formData.get('title') ?? ''),
    unitLabel: String(formData.get('unitLabel') ?? '') || undefined,
    totalUnits: unitsRaw ? Number(unitsRaw) : null,
  });
  revalidatePath(`/occasions/${occasionId}/contributions`);
}

export async function claimAction(
  occasionId: string,
  needId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  try {
    await claimUnits(occasionId, user.accountId, needId, Number(formData.get('units') ?? 1));
  } catch {
    revalidatePath(`/occasions/${occasionId}/contributions?error=contrib.taken`);
    return;
  }
  revalidatePath(`/occasions/${occasionId}/contributions`);
}

export async function releaseAction(occasionId: string, claimId: string): Promise<void> {
  const user = await requireUser();
  await releaseClaim(occasionId, user.accountId, claimId);
  revalidatePath(`/occasions/${occasionId}/contributions`);
}
