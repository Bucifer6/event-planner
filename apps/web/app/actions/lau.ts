'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { consume } from '@eventdesk/auth';
import {
  createIncident,
  fileContentReport,
  recordAccessibilityStatement,
  updateIncident,
} from '@eventdesk/core';
import { AppError, hashIdentifier } from '@eventdesk/shared';
import { requireStaffUser } from './console';

// LAU8 (DSA notice-and-action): anyone can report illegal content or an unlawful
// listing. Per-IP rate limit (SEC16), reporter contact stored hashed only (SEC8).
export async function reportContentAction(formData: FormData): Promise<void> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? 'unknown';
  const check = await consume('ip', hashIdentifier(`report:${ip}`), 5, 3_600_000);
  if (!check.allowed) {
    throw new AppError(
      'RATE_LIMITED',
      'Prea multe raportări; încearcă mai târziu.',
      check.retryAfterMs
    );
  }
  await fileContentReport({
    reporterContact: String(formData.get('contact') ?? ''),
    listingId: String(formData.get('listingId') ?? '') || undefined,
    kind: String(formData.get('kind') ?? 'other') as
      'illegal_content' | 'unlawful_listing' | 'other',
    detail: String(formData.get('detail') ?? ''),
  });
  revalidatePath('/report');
}

export async function createIncidentAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  await createIncident(user.accountId, {
    title: String(formData.get('title') ?? ''),
    impact: String(formData.get('impact') ?? ''),
  });
  revalidatePath('/console/incidents');
}

export async function updateIncidentAction(
  incidentId: string,
  status: 'investigating' | 'monitoring' | 'resolved',
  formData: FormData
): Promise<void> {
  const { user } = await requireStaffUser();
  await updateIncident(user.accountId, incidentId, {
    status,
    impact: String(formData.get('impact') ?? ''),
  });
  revalidatePath('/console/incidents');
}

export async function recordAccessibilityAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  await recordAccessibilityStatement(user.accountId, {
    statementDate: String(formData.get('statementDate') ?? ''),
    evaluationMethod: String(formData.get('evaluationMethod') ?? ''),
  });
  revalidatePath('/console/launch');
}
