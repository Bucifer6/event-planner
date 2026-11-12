import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireStaff } from './staff';

// P3/W2: the moderation queue. Every listing revision (incl. drawings, catalogue
// items, discovery drafts) is approved by a staff member who is NOT a member of
// that business; the live version stays up while an edit is pending. Approvals
// needing a second person ride the W9 approval queue.

export async function listModerationQueue() {
  return prisma.listingRevision.findMany({
    where: { state: 'pending' },
    include: { listing: { include: { business: { include: { members: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function decideRevision(
  revisionId: string,
  staffAccountId: string,
  decision: 'approved' | 'rejected' | 'changes_requested',
  reason?: string
): Promise<void> {
  await requireStaff(staffAccountId, 'listing_moderator');
  const revision = await prisma.listingRevision.findUniqueOrThrow({
    where: { id: revisionId },
    include: { listing: { include: { business: { include: { members: true } } } } },
  });
  if (revision.state !== 'pending') throw new AppError('CONFLICT', 'Already decided.');
  // P3: the approver must not be a member of that business
  const businessId = revision.listing.businessId;
  if (businessId) {
    const isMember = revision.listing.business?.members.some((m) => m.accountId === staffAccountId);
    if (isMember) {
      throw new AppError('FORBIDDEN', 'You cannot moderate your own business listing (P3).');
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.listingRevision.update({
      where: { id: revisionId },
      data: {
        state: decision,
        moderatorId: staffAccountId,
        decidedAt: new Date(),
        reason: reason ?? null,
      },
    });
    if (decision === 'approved') {
      const payload = revision.payload as {
        name?: string;
        description?: string;
        categoryIds?: string[];
        countyIds?: string[];
        localityIds?: string[];
      };
      await tx.listing.update({
        where: { id: revision.listingId },
        data: {
          name: payload.name ?? revision.listing.name,
          description: payload.description ?? revision.listing.description,
          status: 'live', // the live version changes only on approval
        },
      });
      if (payload.categoryIds) {
        await tx.listingCategory.deleteMany({ where: { listingId: revision.listingId } });
        await tx.listingCategory.createMany({
          data: payload.categoryIds.map((categoryId) => ({
            listingId: revision.listingId,
            categoryId,
          })),
        });
      }
      if (payload.countyIds) {
        await tx.listingCounty.deleteMany({ where: { listingId: revision.listingId } });
        await tx.listingCounty.createMany({
          data: payload.countyIds.map((countyId) => ({ listingId: revision.listingId, countyId })),
        });
      }
      if (payload.localityIds) {
        await tx.listingLocality.deleteMany({ where: { listingId: revision.listingId } });
        await tx.listingLocality.createMany({
          data: payload.localityIds.map((localityId) => ({
            listingId: revision.listingId,
            localityId,
          })),
        });
      }
    }
    await tx.auditLog.create({
      data: {
        actorId: staffAccountId,
        actorKind: 'staff',
        action: `listing_revision_${decision}`,
        objectType: 'ListingRevision',
        objectId: revisionId,
        after: { listingId: revision.listingId, reason: reason ?? null },
      },
    });
  });
}

// W3: suspend/restrict a business with a recorded reason; survives staff session
// end (DB row), and the business is notified in-app (status visible on its pages).
export async function setBusinessSuspension(
  businessId: string,
  staffAccountId: string,
  suspend: boolean,
  reason?: string
): Promise<void> {
  await requireStaff(staffAccountId, 'platform_admin');
  await prisma.business.update({
    where: { id: businessId },
    data: suspend
      ? { suspendedAt: new Date(), suspensionReason: reason ?? null }
      : { suspendedAt: null, suspensionReason: null },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: suspend ? 'business_suspended' : 'business_restored',
    objectType: 'Business',
    objectId: businessId,
    after: { reason: reason ?? null },
  });
}
