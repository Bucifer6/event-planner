'use server';

import { revalidatePath } from 'next/cache';
import {
  addItineraryLeg,
  addPackingItem,
  addTransportLeg,
  assignRoom,
  createRoom,
  createSubgroup,
  togglePacking,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function itineraryLegAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addItineraryLeg(occasionId, user.accountId, {
    title: String(formData.get('title') ?? ''),
    kind: String(formData.get('kind') ?? 'other'),
    startsAtUtc: new Date(String(formData.get('startsAtUtc') ?? '')),
    endsAtUtc: formData.get('endsAtUtc') ? new Date(String(formData.get('endsAtUtc'))) : undefined,
    zone: String(formData.get('zone') ?? 'Europe/Bucharest'),
  });
  revalidatePath(`/occasions/${occasionId}/travel`);
}

export async function subgroupAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createSubgroup(
    occasionId,
    user.accountId,
    String(formData.get('name') ?? ''),
    formData.getAll('householdIds').map(String)
  );
  revalidatePath(`/occasions/${occasionId}/travel`);
}

export async function packingAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addPackingItem(occasionId, user.accountId, { label: String(formData.get('label') ?? '') });
  revalidatePath(`/occasions/${occasionId}/travel`);
}

export async function packingToggleAction(
  occasionId: string,
  itemId: string,
  packed: boolean
): Promise<void> {
  const user = await requireUser();
  await togglePacking(occasionId, user.accountId, itemId, packed);
  revalidatePath(`/occasions/${occasionId}/travel`);
}

export async function transportAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addTransportLeg(occasionId, user.accountId, {
    label: String(formData.get('label') ?? ''),
    fromPlace: String(formData.get('fromPlace') ?? ''),
    toPlace: String(formData.get('toPlace') ?? ''),
    departsAtUtc: new Date(String(formData.get('departsAtUtc') ?? '')),
    seats: Number(formData.get('seats') ?? 0),
    zone: String(formData.get('zone') ?? 'Europe/Bucharest'),
  });
  revalidatePath(`/occasions/${occasionId}/travel`);
}

export async function roomAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createRoom(
    occasionId,
    user.accountId,
    String(formData.get('name') ?? ''),
    Number(formData.get('capacity') ?? 2)
  );
  revalidatePath(`/occasions/${occasionId}/travel`);
}

export async function roomAssignAction(
  occasionId: string,
  roomId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await assignRoom(occasionId, user.accountId, roomId, String(formData.get('householdId') ?? ''));
  revalidatePath(`/occasions/${occasionId}/travel`);
}
