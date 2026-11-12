'use server';

import { revalidatePath } from 'next/cache';
import {
  addCustomTable,
  addDrawing,
  addFixture,
  addPOI,
  addCatalogueItem,
  addTableInventory,
  answerEnquiry,
  attachSpaceModel,
  calibrateDrawing,
  claimListing,
  createBusiness,
  createCatalogue,
  createListing,
  resendEnquiry,
  setBusinessNudge,
  setEnquiryState,
  setParkingFacts,
  submitListingRevision,
} from '@eventdesk/core';
import { requireUser } from '../lib/session';

export async function createBusinessAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await createBusiness(user.accountId, { name: String(formData.get('name') ?? '') });
  revalidatePath('/business');
}

function pickMulti(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String).filter(Boolean);
}

export async function createListingAction(businessId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createListing(businessId, user.accountId, {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? '') || undefined,
    categoryIds: pickMulti(formData, 'categoryIds'),
    countyIds: pickMulti(formData, 'countyIds'),
    localityIds: pickMulti(formData, 'localityIds'),
  });
  revalidatePath('/business');
}

export async function submitRevisionAction(listingId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await submitListingRevision(listingId, user.accountId, {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? '') || undefined,
    categoryIds: pickMulti(formData, 'categoryIds'),
    countyIds: pickMulti(formData, 'countyIds'),
    localityIds: pickMulti(formData, 'localityIds'),
  });
  revalidatePath(`/business/listings/${listingId}`);
}

export async function claimListingAction(listingId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await claimListing(listingId, user.accountId, String(formData.get('code') ?? ''));
  revalidatePath('/business');
}

export async function answerEnquiryAction(enquiryId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await answerEnquiry(enquiryId, user.accountId, String(formData.get('body') ?? ''));
  revalidatePath('/business/enquiries');
}

export async function setEnquiryStateAction(
  enquiryId: string,
  state: 'closed' | 'awaiting'
): Promise<void> {
  const user = await requireUser();
  await setEnquiryState(enquiryId, user.accountId, state);
  revalidatePath('/business/enquiries');
}

export async function resendEnquiryAction(
  enquiryId: string,
  occasionId: string | null
): Promise<void> {
  const user = await requireUser();
  await resendEnquiry(enquiryId, user.accountId);
  revalidatePath(occasionId ? `/occasions/${occasionId}/enquiries` : '/business/enquiries');
}

export async function setNudgeAction(businessId: string, on: boolean): Promise<void> {
  const user = await requireUser();
  await setBusinessNudge(businessId, user.accountId, on);
  revalidatePath('/business');
}

export async function addDrawingAction(listingId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addDrawing(listingId, user.accountId, {
    assetId: String(formData.get('assetId') ?? ''),
    spaceName: String(formData.get('spaceName') ?? ''),
    realWidthM: formData.get('realWidthM') ? Number(formData.get('realWidthM')) : undefined,
    realHeightM: formData.get('realHeightM') ? Number(formData.get('realHeightM')) : undefined,
  });
  revalidatePath(`/business/listings/${listingId}`);
}

export async function calibrateDrawingAction(
  listingId: string,
  drawingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const num = (key: string) => Number(formData.get(key) ?? 0);
  await calibrateDrawing(
    drawingId,
    user.accountId,
    { x: num('p1x'), y: num('p1y') },
    { x: num('p2x'), y: num('p2y') },
    num('realDistanceM')
  );
  revalidatePath(`/business/listings/${listingId}`);
}

export async function addTableAction(
  listingId: string,
  drawingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await addTableInventory(drawingId, user.accountId, {
    tableType: String(formData.get('tableType') ?? ''),
    widthM: formData.get('widthM') ? Number(formData.get('widthM')) : undefined,
    heightM: formData.get('heightM') ? Number(formData.get('heightM')) : undefined,
    count: Number(formData.get('count') ?? 1),
  });
  revalidatePath(`/business/listings/${listingId}`);
}

export async function addFixtureAction(
  listingId: string,
  drawingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await addFixture(drawingId, user.accountId, {
    kind: String(formData.get('kind') ?? ''),
    widthM: formData.get('widthM') ? Number(formData.get('widthM')) : undefined,
    heightM: formData.get('heightM') ? Number(formData.get('heightM')) : undefined,
  });
  revalidatePath(`/business/listings/${listingId}`);
}

export async function addPoiAction(
  listingId: string,
  drawingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await addPOI(
    drawingId,
    user.accountId,
    String(formData.get('kind') ?? ''),
    String(formData.get('label') ?? '') || undefined
  );
  revalidatePath(`/business/listings/${listingId}`);
}

export async function parkingAction(
  listingId: string,
  drawingId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const tri = (key: string): boolean | null => {
    const v = formData.get(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  };
  const numOrNull = (key: string): number | null => {
    const v = formData.get(key);
    return v === null || v === '' ? null : Number(v);
  };
  await setParkingFacts(drawingId, user.accountId, {
    onSite: tri('onSite'),
    spaceCount: numOrNull('spaceCount'),
    onStreet: tri('onStreet'),
    paid: tri('paid'),
    accessibleSpaces: tri('accessibleSpaces'),
    walkingDistanceM: numOrNull('walkingDistanceM'),
    drawingSpaceCount: numOrNull('drawingSpaceCount'),
  });
  revalidatePath(`/business/listings/${listingId}`);
}

export async function createCatalogueAction(listingId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await createCatalogue(listingId, user.accountId, String(formData.get('name') ?? ''));
  revalidatePath(`/business/listings/${listingId}`);
}

export async function addCatalogueItemAction(
  listingId: string,
  catalogueId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await addCatalogueItem(catalogueId, user.accountId, {
    variety: String(formData.get('variety') ?? ''),
    imageAssetId: String(formData.get('imageAssetId') ?? '') || undefined,
    seasonality: String(formData.get('seasonality') ?? '') || undefined,
    pricePerStemBani: formData.get('pricePerStemBani')
      ? Number(formData.get('pricePerStemBani'))
      : undefined,
    colours: String(formData.get('colours') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  });
  revalidatePath(`/business/listings/${listingId}`);
}

export async function attachSpaceModelAction(occasionId: string, drawingId: string): Promise<void> {
  const user = await requireUser();
  await attachSpaceModel(occasionId, user.accountId, drawingId);
  revalidatePath(`/occasions/${occasionId}/space`);
}

export async function addCustomTableAction(occasionId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  await addCustomTable(occasionId, user.accountId, {
    name: String(formData.get('name') ?? ''),
    widthM: formData.get('widthM') ? Number(formData.get('widthM')) : undefined,
    heightM: formData.get('heightM') ? Number(formData.get('heightM')) : undefined,
  });
  revalidatePath(`/occasions/${occasionId}/space`);
}
