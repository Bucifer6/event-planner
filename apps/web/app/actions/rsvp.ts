'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { submitRsvp, votePoll, markGuestSeen } from '@eventdesk/core';
import { clientIp } from '../lib/session';

// Guest-link RSVP (public, unauthenticated): SEC11 bot checks run inside submitRsvp.
// The multi-step form carries earlier answers in hidden fields; the final step submits.
export async function submitRsvpAction(formData: FormData): Promise<void> {
  const h = await headers();
  const token = String(formData.get('token') ?? '');
  const attendance: Record<string, boolean> = {};
  for (const key of formData.keys()) {
    if (key.startsWith('attend_')) {
      const values = formData.getAll(key).map(String);
      attendance[key.slice('attend_'.length)] = values.includes('on');
    }
  }
  const answers: { questionId: string; value: string }[] = [];
  for (const key of formData.keys()) {
    if (key.startsWith('q_'))
      answers.push({ questionId: key.slice(2), value: String(formData.get(key)) });
  }
  await submitRsvp({
    token,
    adults: Number(formData.get('adults') ?? 0),
    childrenCount: Number(formData.get('children') ?? 0),
    attendance,
    answers,
    leadEmail: String(formData.get('leadEmail') ?? '') || undefined,
    ip: clientIp(h),
    honeypot: formData.get('website') ? String(formData.get('website')) : null,
    formShownAt: Number(formData.get('shownAt') ?? 0) || undefined,
  });
  await markGuestSeen(token);
  revalidatePath(`/g/${token}`);
  redirect(`/g/${token}?done=1`);
}

// Advance the one-question-per-screen flow, carrying all previous answers forward.
export async function rsvpNextAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const step = Number(formData.get('step') ?? 0);
  const lang = String(formData.get('lang') ?? 'ro');
  const params = new URLSearchParams();
  for (const key of new Set(formData.keys())) {
    if (
      key === 'step' ||
      key === 'token' ||
      key === 'lang' ||
      key === 'answer' ||
      key === 'website' ||
      key === 'qindex'
    )
      continue;
    params.set(key, String(formData.get(key)));
  }
  const qindex = String(formData.get('qindex') ?? '');
  const answer = String(formData.get('answer') ?? '');
  if (qindex) params.set(`q_${qindex}`, answer);
  redirect(`/g/${token}/rsvp?step=${step + 1}&lang=${lang}&${params.toString()}`);
}

export async function votePollAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const pollId = String(formData.get('pollId') ?? '');
  const choice = String(formData.get('choice') ?? 'maybe') as 'yes' | 'maybe' | 'no';
  await votePoll(token, pollId, choice);
  revalidatePath(`/g/${token}`);
}
