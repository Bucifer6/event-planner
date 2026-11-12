'use server';

import { revalidatePath } from 'next/cache';
import {
  addCue,
  addMenuItem,
  addPrivateRequest,
  addProgrammeItem,
  approveInvitationProof,
  checkMealStage,
  createArrangementDesign,
  createInvitationDesign,
  createMenu,
  estimateGift,
  notifyProgrammeChange,
  publishSeating,
  registerPublic,
  saveAssignments,
  sendQuoteRequestFromDesign,
  setMealChoice,
  setPublicPage,
  setVenue,
  updateProgrammeItem,
} from '@eventdesk/core';
import { prisma } from '@eventdesk/db';
import { requireUser } from '../lib/session';

export async function saveSeatingAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const householdIds = formData.getAll('householdId').map(String);
  const tableRefs = formData.getAll('tableRef').map(String);
  const seats = formData.getAll('seat').map(String);
  await saveAssignments(
    occasionId,
    user.accountId,
    householdIds.map((householdId, i) => ({
      householdId,
      tableRef: tableRefs[i] ?? '',
      seat: seats[i] || undefined,
    }))
  );
  revalidatePath(`/occasions/${occasionId}/seating`);
}

export async function publishSeatingAction(occasionId: string): Promise<void> {
  const user = await requireUser();
  await publishSeating(occasionId, user.accountId);
  revalidatePath(`/occasions/${occasionId}/seating`);
}

export async function mealStageAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await checkMealStage(occasionId, user.accountId, {
    label: String(formData.get('label') ?? ''),
    guestCount: Number(formData.get('guestCount') ?? 0),
  });
  revalidatePath(`/occasions/${occasionId}/seating`);
}

export async function programmeItemAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addProgrammeItem(occasionId, user.accountId, {
    title: String(formData.get('title') ?? ''),
    durationMin: formData.get('durationMin') ? Number(formData.get('durationMin')) : undefined,
  });
  revalidatePath(`/occasions/${occasionId}/programme`);
}

export async function programmeUpdateAction(
  occasionId: string,
  itemId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await updateProgrammeItem(itemId, occasionId, user.accountId, {
    title: String(formData.get('title') ?? ''),
  });
  revalidatePath(`/occasions/${occasionId}/programme`);
}

export async function cueAction(
  occasionId: string,
  itemId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await addCue(itemId, occasionId, user.accountId, {
    atLabel: String(formData.get('atLabel') ?? ''),
    action: String(formData.get('action') ?? ''),
  });
  revalidatePath(`/occasions/${occasionId}/programme`);
}

export async function notifyProgrammeAction(occasionId: string): Promise<void> {
  const user = await requireUser();
  void user;
  await notifyProgrammeChange(occasionId);
  revalidatePath(`/occasions/${occasionId}/programme`);
}

export async function menuAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createMenu(occasionId, user.accountId, String(formData.get('name') ?? ''));
  revalidatePath(`/occasions/${occasionId}/menus`);
}

export async function menuItemAction(
  occasionId: string,
  menuId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await addMenuItem(menuId, occasionId, user.accountId, {
    name: String(formData.get('name') ?? ''),
    dietTags: String(formData.get('dietTags') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  revalidatePath(`/occasions/${occasionId}/menus`);
}

export async function mealChoiceAction(
  occasionId: string,
  householdId: string,
  itemId: string
): Promise<void> {
  const user = await requireUser();
  await setMealChoice(occasionId, user.accountId, householdId, itemId);
  revalidatePath(`/occasions/${occasionId}/menus`);
}

export async function publicPageAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await setPublicPage(occasionId, user.accountId, {
    slug: String(formData.get('slug') ?? ''),
    on: formData.get('on') === 'on',
    questions: formData.get('questions')
      ? JSON.parse(String(formData.get('questions')))
      : undefined,
  });
  revalidatePath(`/occasions/${occasionId}/public`);
}

export async function venueAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await setVenue(occasionId, user.accountId, {
    address: String(formData.get('address') ?? ''),
    mapsUrl: String(formData.get('mapsUrl') ?? ''),
  });
  revalidatePath(`/occasions/${occasionId}/public`);
}

export async function invitationDesignAction(
  occasionId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await createInvitationDesign(occasionId, user.accountId, {
    text: String(formData.get('text') ?? ''),
    layout: String(formData.get('layout') ?? 'classic'),
  });
  revalidatePath(`/occasions/${occasionId}/invitations`);
}

export async function invitationProofAction(occasionId: string, designId: string): Promise<void> {
  const user = await requireUser();
  await approveInvitationProof(designId, occasionId, user.accountId);
  revalidatePath(`/occasions/${occasionId}/invitations`);
}

export async function privateRequestAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addPrivateRequest(occasionId, user.accountId, {
    householdId: String(formData.get('householdId') ?? '') || undefined,
    kind: String(formData.get('kind') ?? 'diet') as 'diet' | 'access',
    detail: String(formData.get('detail') ?? ''),
  });
  revalidatePath(`/occasions/${occasionId}/guests`);
}

export async function giftAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await estimateGift(user.accountId, {
    relationship: String(formData.get('relationship') ?? 'friend'),
    distance: String(formData.get('distance') ?? 'local'),
    venueType: String(formData.get('venueType') ?? 'other'),
    guestCount: Number(formData.get('guestCount') ?? 1),
  });
  revalidatePath('/gift');
}

export async function arrangementAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const itemIds = formData.getAll('itemId').map(String);
  const stems = formData.getAll('stems').map(Number);
  await createArrangementDesign(occasionId, user.accountId, {
    baseForm: String(formData.get('baseForm') ?? 'hand-tied'),
    items: itemIds.map((catalogueItemId, i) => ({ catalogueItemId, stems: stems[i] ?? 1 })),
  });
  revalidatePath(`/occasions/${occasionId}/arrangements`);
}

export async function quoteFromDesignAction(
  occasionId: string,
  designId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await sendQuoteRequestFromDesign(designId, occasionId, user.accountId, {
    listingId: String(formData.get('listingId') ?? ''),
    message: String(formData.get('message') ?? ''),
    shareEmail: formData.get('shareEmail') === 'on',
  });
  revalidatePath(`/occasions/${occasionId}/arrangements`);
}

// Public registration POST (C-06) — bot-guarded at the route (SEC11), not here.
export async function registerPublicAction(input: {
  slug: string;
  name: string;
  contact: string;
  answers: unknown;
}) {
  const occ = await prisma.occasion.findFirstOrThrow({
    where: { publicSlug: input.slug, publicPageOn: true },
  });
  return registerPublic({
    occasionId: occ.id,
    name: input.name,
    contact: input.contact,
    answers: input.answers,
  });
}
