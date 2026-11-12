'use server';

import { revalidatePath } from 'next/cache';
import {
  addBriefingVersion,
  addPaymentDeadline,
  createBooking,
  createSupplier,
  finalizeSnapshot,
  setBookingState,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createSupplierAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createSupplier(occasionId, user.accountId, {
    name: String(formData.get('name') ?? ''),
    contactEmail: String(formData.get('contactEmail') ?? ''),
    phone: String(formData.get('phone') ?? ''),
  });
  revalidatePath(`/occasions/${occasionId}/suppliers`);
}

export async function createBookingAction(
  occasionId: string,
  supplierId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await createBooking(occasionId, user.accountId, supplierId, String(formData.get('title') ?? ''));
  revalidatePath(`/occasions/${occasionId}/suppliers`);
}

export async function setBookingStateAction(
  occasionId: string,
  bookingId: string,
  state: 'enquired' | 'quoted' | 'booked' | 'completed' | 'cancelled'
): Promise<void> {
  const user = await requireUser();
  await setBookingState(occasionId, user.accountId, bookingId, state);
  revalidatePath(`/occasions/${occasionId}/suppliers`);
}

export async function addBriefingAction(
  occasionId: string,
  bookingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await addBriefingVersion(
    occasionId,
    user.accountId,
    bookingId,
    String(formData.get('content') ?? '')
  );
  revalidatePath(`/occasions/${occasionId}/suppliers`);
}

export async function finalizeSnapshotAction(
  occasionId: string,
  bookingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const items = String(formData.get('items') ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, qty] = line.split('|');
      return { title: title?.trim(), qty: Number(qty ?? 1) };
    });
  await finalizeSnapshot(occasionId, user.accountId, bookingId, items);
  revalidatePath(`/occasions/${occasionId}/suppliers`);
}

export async function addDeadlineAction(
  occasionId: string,
  bookingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const amount = String(formData.get('amount') ?? '');
  await addPaymentDeadline(occasionId, user.accountId, bookingId, {
    kind: String(formData.get('kind') ?? 'final') as 'advance' | 'instalment' | 'final',
    amountBani: amount ? Math.round(Number(amount) * 100) : 0,
    dueAt: new Date(`${String(formData.get('dueAt') ?? '')}T12:00:00Z`),
  });
  revalidatePath(`/occasions/${occasionId}/suppliers`);
}
