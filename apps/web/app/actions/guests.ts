'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addRsvpQuestion,
  applyGuestImport,
  computeImportDiff,
  createHousehold,
  createInvitation,
  parseGuestFile,
  revokeInvitation,
  listHouseholds,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createHouseholdAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const members = String(formData.get('members') ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  await createHousehold(occasionId, user.accountId, {
    name: String(formData.get('name') ?? ''),
    leadEmail: String(formData.get('leadEmail') ?? ''),
    guests: members,
  });
  revalidatePath(`/occasions/${occasionId}/guests`);
}

export async function createInvitationAction(
  occasionId: string,
  householdId: string
): Promise<void> {
  const user = await requireUser();
  const locale = (await import('../lib/i18n')).getLocale;
  const loc = await locale();
  const { token } = await createInvitation(occasionId, user.accountId, householdId, loc);
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  redirect(`/occasions/${occasionId}/guests?newlink=${encodeURIComponent(`${base}/g/${token}`)}`);
}

export async function revokeInvitationAction(
  occasionId: string,
  invitationId: string
): Promise<void> {
  const user = await requireUser();
  await revokeInvitation(occasionId, user.accountId, invitationId);
  revalidatePath(`/occasions/${occasionId}/guests`);
}

export async function addQuestionAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addRsvpQuestion(occasionId, user.accountId, {
    kind: String(formData.get('kind') ?? 'free_text'),
    promptKey: String(formData.get('promptKey') ?? 'custom'),
    required: formData.get('required') === 'on',
  });
  revalidatePath(`/occasions/${occasionId}/guests`);
}

// A13: two-step import — parse + mapping preview (rows travel in a hidden field),
// then a confirmed diff application.
export async function importPreviewAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const file = formData.get('file');
  if (!(file instanceof File)) redirect(`/occasions/${occasionId}/guests?error=err.generic`);
  const data = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = parseGuestFile(file.name, data);
  const households = await listHouseholds(occasionId, user.accountId);
  const mapping = {
    name: String(formData.get('mapName') ?? headers[0] ?? ''),
    household: String(formData.get('mapHousehold') ?? headers[1] ?? ''),
  };
  const diff = computeImportDiff(
    {
      households: households.map((h) => ({
        id: h.id,
        name: h.name,
        guests: h.guests.map((g) => ({ name: g.name })),
      })),
    },
    rows,
    mapping
  );
  const payload = Buffer.from(JSON.stringify({ diff })).toString('base64');
  redirect(
    `/occasions/${occasionId}/guests/import?payload=${encodeURIComponent(payload)}&headers=${encodeURIComponent(headers.join(','))}`
  );
}

export async function applyImportAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const payload = String(formData.get('payload') ?? '');
  const { diff } = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
    diff: Parameters<typeof applyGuestImport>[2];
  };
  await applyGuestImport(occasionId, user.accountId, diff);
  revalidatePath(`/occasions/${occasionId}/guests`);
  redirect(`/occasions/${occasionId}/guests`);
}
