import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireBusinessActive } from './bizoccasions';

// P19: shared libraries of templates, checklists and supplier contacts, visible to
// the whole business team (and reusable on the business's occasions). Edits stop on
// plan lapse (P23); existing items stay readable.

const KINDS = ['template', 'checklist', 'supplier_contact'] as const;
export type LibraryKind = (typeof KINDS)[number];

export async function addLibraryItem(
  businessId: string,
  accountId: string,
  input: { kind: LibraryKind; title: string; payload: unknown }
) {
  await requireBusinessActive(businessId, accountId);
  if (!KINDS.includes(input.kind)) throw new AppError('INVALID_INPUT', 'Unknown library kind.');
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Title is required.');
  const item = await prisma.businessLibraryItem.create({
    data: {
      businessId,
      kind: input.kind,
      title: input.title.trim(),
      payload: input.payload as object,
      createdById: accountId,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'library_item_added',
    objectType: 'BusinessLibraryItem',
    objectId: item.id,
    after: { kind: item.kind, title: item.title },
  });
  return item;
}

export async function listLibrary(businessId: string, accountId: string, kind?: LibraryKind) {
  await requireBusinessActive(businessId, accountId);
  return prisma.businessLibraryItem.findMany({
    where: { businessId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function removeLibraryItem(itemId: string, businessId: string, accountId: string) {
  await requireBusinessActive(businessId, accountId);
  const item = await prisma.businessLibraryItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.businessId !== businessId) throw new AppError('FORBIDDEN', 'Not your library.');
  await prisma.businessLibraryItem.delete({ where: { id: itemId } });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'library_item_removed',
    objectType: 'BusinessLibraryItem',
    objectId: itemId,
  });
}
