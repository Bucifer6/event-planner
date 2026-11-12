import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';
import { createEnquiry } from './enquiries';

// C-13 + F3-F6: the visual flower arrangement designer. Base form + catalogue items
// from one or more businesses, stem counts, running INDICATIVE cost from published
// prices — labelled indicative, never a quote (F3). From a design the planner sends a
// quote request through the enquiry flow carrying only the F5 fields (F5); an accepted
// quote links back to the design version (F6).

export interface ArrangementItem {
  catalogueItemId: string;
  stems: number;
}

export async function indicativeCost(items: ArrangementItem[]): Promise<number> {
  let total = 0;
  for (const it of items) {
    const item = await prisma.catalogueItem.findUnique({
      where: { id: it.catalogueItemId },
      select: { pricePerStemBani: true },
    });
    if (!item) throw new AppError('NOT_FOUND', `Catalogue item ${it.catalogueItemId} not found.`);
    if (item.pricePerStemBani != null) total += item.pricePerStemBani * it.stems;
  }
  return total;
}

export async function createArrangementDesign(
  occasionId: string,
  accountId: string,
  input: { baseForm: string; items: ArrangementItem[]; note?: string }
) {
  await requireRole(occasionId, accountId, [
    'owner',
    'project_manager',
    'workstream_lead',
    'contributor',
  ]);
  if (!input.baseForm.trim())
    throw new AppError('INVALID_INPUT', 'Base form required (e.g. hand-tied).');
  for (const it of input.items) {
    if (!Number.isInteger(it.stems) || it.stems <= 0)
      throw new AppError('INVALID_INPUT', 'Stem counts must be positive integers.');
  }
  const cost = await indicativeCost(input.items);
  const last = await prisma.arrangementDesign.findFirst({
    where: { occasionId, accountId },
    orderBy: { version: 'desc' },
  });
  const design = await prisma.arrangementDesign.create({
    data: {
      occasionId,
      accountId,
      baseForm: input.baseForm.trim(),
      items: input.items as unknown as object,
      indicativeCostBani: cost, // F3: indicative, never a quote
      version: (last?.version ?? 0) + 1,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'arrangement_design_created',
    objectType: 'ArrangementDesign',
    objectId: design.id,
    after: { version: design.version, indicativeCostBani: cost },
  });
  return design;
}

// F5: send a quote request from this design — carries the arrangement (design id +
// item ids), occasion date, ~guests and message, nothing else (P8 fields only).
export async function sendQuoteRequestFromDesign(
  designId: string,
  occasionId: string,
  accountId: string,
  input: { listingId: string; message: string; shareEmail?: boolean }
) {
  await requireMember(occasionId, accountId);
  const design = await prisma.arrangementDesign.findUniqueOrThrow({ where: { id: designId } });
  if (design.occasionId !== occasionId || design.accountId !== accountId) {
    throw new AppError('FORBIDDEN', 'Not your design.');
  }
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const items = design.items as unknown as ArrangementItem[];
  const enquiry = await createEnquiry(accountId, {
    occasionId,
    listingId: input.listingId,
    kind: 'quote_request', // F5: counts against both P11 limits
    occasionKind: occ.kind,
    date: occ.dateStart ? occ.dateStart.toISOString().slice(0, 10) : undefined,
    message: input.message,
    shareEmail: input.shareEmail ?? false,
    arrangement: {
      designId: design.id,
      designVersion: design.version,
      baseForm: design.baseForm,
      catalogueItemIds: items.map((i) => i.catalogueItemId),
    },
  });
  await prisma.arrangementDesign.update({
    where: { id: designId },
    data: { quoteEnquiryId: enquiry.id },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'quote_request_sent_from_design',
    objectType: 'ArrangementDesign',
    objectId: designId,
    after: { enquiryId: enquiry.id, listingId: input.listingId },
  });
  return enquiry;
}

// F6: link an accepted quote back to the design version; later changes show as deltas.
export async function linkAcceptedQuote(designId: string, accountId: string, quoteAssetId: string) {
  const design = await prisma.arrangementDesign.findUniqueOrThrow({ where: { id: designId } });
  if (design.accountId !== accountId) throw new AppError('FORBIDDEN', 'Not your design.');
  const updated = await prisma.arrangementDesign.update({
    where: { id: designId },
    data: { acceptedQuoteAssetId: quoteAssetId },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'design_quote_linked',
    objectType: 'ArrangementDesign',
    objectId: designId,
    after: { quoteAssetId, version: design.version },
  });
  return updated;
}

export async function listArrangementDesigns(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.arrangementDesign.findMany({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
}
