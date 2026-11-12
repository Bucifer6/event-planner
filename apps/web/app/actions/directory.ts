'use server';

import { redirect } from 'next/navigation';
import { createEnquiry } from '@eventdesk/core';
import { requireUser } from '../lib/session';

// P8-P11/P33: the public listing page's enquiry form. Free, pre-filled fields only;
// the planner's email is shared only if ticked (P9). Limits enforced server-side.
export async function sendEnquiryAction(
  listingId: string,
  occasionId: string | null,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await createEnquiry(user.accountId, {
    listingId,
    occasionId: occasionId || undefined,
    kind: formData.get('kind') === 'quote_request' ? 'quote_request' : 'enquiry',
    occasionKind: String(formData.get('occasionKind') ?? ''),
    date: String(formData.get('date') ?? '') || undefined,
    approxGuests: formData.get('approxGuests') ? Number(formData.get('approxGuests')) : undefined,
    countyCode: String(formData.get('countyCode') ?? '') || undefined,
    locality: String(formData.get('locality') ?? '') || undefined,
    budgetBand: String(formData.get('budgetBand') ?? '') || undefined,
    message: String(formData.get('message') ?? ''),
    shareEmail: formData.get('shareEmail') === 'on',
  });
  redirect(occasionId ? `/occasions/${occasionId}/enquiries` : '/business/enquiries');
}
