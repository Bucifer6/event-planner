'use server';

import { revalidatePath } from 'next/cache';
import {
  checkInByQr,
  queueOfflineItem,
  recordMeasurement,
  reconcileOfflineQueue,
  setSustainabilityGoal,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function checkInAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await checkInByQr(String(formData.get('qrId') ?? '').trim(), user.accountId);
  revalidatePath(`/occasions/${occasionId}/operate`);
}

export async function queueOfflineAction(
  occasionId: string,
  clientKey: string,
  kind: string,
  payload: unknown
): Promise<void> {
  const user = await requireUser();
  await queueOfflineItem(occasionId, user.accountId, { clientKey, kind, payload });
  revalidatePath(`/occasions/${occasionId}/operate`);
}

export async function reconcileOfflineAction(occasionId: string): Promise<void> {
  const user = await requireUser();
  await reconcileOfflineQueue(occasionId, user.accountId);
  revalidatePath(`/occasions/${occasionId}/operate`);
}

export async function sustainabilityGoalAction(
  occasionId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const targetRaw = String(formData.get('target') ?? '').trim();
  await setSustainabilityGoal(occasionId, user.accountId, {
    metric: String(formData.get('metric') ?? ''),
    unit: String(formData.get('unit') ?? ''),
    target: targetRaw ? Number(targetRaw) : null,
  });
  revalidatePath(`/occasions/${occasionId}/operate`);
}

export async function measurementAction(
  occasionId: string,
  metric: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const raw = String(formData.get('value') ?? '').trim();
  // empty = unknown; unknown stays unknown (principle 5)
  await recordMeasurement(occasionId, user.accountId, {
    metric,
    value: raw ? Number(raw) : null,
  });
  revalidatePath(`/occasions/${occasionId}/operate`);
}
