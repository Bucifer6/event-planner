'use server';

import { revalidatePath } from 'next/cache';
import { confirmPoll, createPoll } from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createPollAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createPoll(occasionId, user.accountId, String(formData.get('title') ?? ''));
  revalidatePath(`/occasions/${occasionId}/polls`);
}

export async function confirmPollAction(
  occasionId: string,
  pollId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const date = String(formData.get('decidedDate') ?? '');
  await confirmPoll(occasionId, user.accountId, pollId, new Date(`${date}T12:00:00Z`));
  revalidatePath(`/occasions/${occasionId}`);
  revalidatePath(`/occasions/${occasionId}/polls`);
}
