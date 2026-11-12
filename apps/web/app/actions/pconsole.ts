'use server';

import { revalidatePath } from 'next/cache';
import {
  approveDraft,
  decideRevision,
  handleObjection,
  setBusinessSuspension,
  setSourceEnabled,
} from '@eventdesk/core';
import { requireStaffUser } from './console';

// Release P console actions (W2/W3/W4/W5/W7). Every call is audit-logged in core
// (SEC10); the console session itself is checked by the layout (S5).

export async function decideRevisionAction(
  revisionId: string,
  decision: 'approved' | 'rejected' | 'changes_requested',
  formData: FormData
): Promise<void> {
  const { user } = await requireStaffUser();
  await decideRevision(
    revisionId,
    user.accountId,
    decision,
    String(formData.get('reason') ?? '') || undefined
  );
  revalidatePath('/console/moderation');
}

export async function approveDraftAction(draftId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await approveDraft(draftId, user.accountId);
  revalidatePath('/console/discovery');
}

export async function setSourceEnabledAction(sourceId: string, enabled: boolean): Promise<void> {
  const { user } = await requireStaffUser();
  await setSourceEnabled(sourceId, enabled, user.accountId);
  revalidatePath('/console/discovery');
}

export async function handleObjectionAction(objectionId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await handleObjection(objectionId, user.accountId);
  revalidatePath('/console/discovery');
}

export async function setBusinessSuspensionAction(
  businessId: string,
  suspend: boolean,
  formData: FormData
): Promise<void> {
  const { user } = await requireStaffUser();
  await setBusinessSuspension(
    businessId,
    user.accountId,
    suspend,
    String(formData.get('reason') ?? '') || undefined
  );
  revalidatePath('/console/businesses');
}
