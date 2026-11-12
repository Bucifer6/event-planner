'use server';

import { revalidatePath } from 'next/cache';
import {
  createDelivery,
  recordReceivedCorrection,
  recordReadinessDecision,
  runCloseout,
  previewStatusChange,
  confirmStatusChange,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createDeliveryAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createDelivery(occasionId, user.accountId, {
    title: String(formData.get('title') ?? ''),
    kind: String(formData.get('kind') ?? 'delivery') as 'delivery' | 'hired_item' | 'return',
    expectedQty: Number(formData.get('expectedQty') ?? 0),
    unitLabel: String(formData.get('unitLabel') ?? '') || undefined,
  });
  revalidatePath(`/occasions/${occasionId}/deliveries`);
}

export async function correctReceivedAction(
  occasionId: string,
  deliveryId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await recordReceivedCorrection(
    occasionId,
    user.accountId,
    deliveryId,
    Number(formData.get('receivedQty') ?? 0),
    String(formData.get('reason') ?? '')
  );
  revalidatePath(`/occasions/${occasionId}/deliveries`);
}

export async function readinessAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const evidence = String(formData.get('evidence') ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  await recordReadinessDecision(occasionId, user.accountId, {
    decision: String(formData.get('decision') ?? 'hold') as
      'hold' | 'proceed' | 'proceed_with_conditions',
    evidence,
  });
  revalidatePath(`/occasions/${occasionId}/readiness`);
}

export async function closeoutAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await runCloseout(occasionId, user.accountId, String(formData.get('lessons') ?? ''));
  revalidatePath(`/occasions/${occasionId}`);
}

export async function previewStatusAction(
  occasionId: string,
  newStatus: 'cancelled' | 'postponed' | 'closed'
): Promise<string> {
  const user = await requireUser();
  const preview = await previewStatusChange(occasionId, user.accountId, newStatus);
  return preview.id;
}

export async function confirmStatusAction(occasionId: string, previewId: string): Promise<void> {
  const user = await requireUser();
  await confirmStatusChange(previewId, user.accountId);
  revalidatePath(`/occasions/${occasionId}`);
}
