import { prisma, type Business, type BusinessMember, type Listing } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';

// P1: a business creates an account (email required — P29 claim verification) and
// up to five listings, each with 1-5 of the 21 fixed categories and 1-20 localities
// across up to 5 counties. Geography is fixed picklists — free text is rejected.

export async function createBusiness(
  accountId: string,
  input: { name: string }
): Promise<Business> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!account.email) {
    throw new AppError(
      'INVALID_INPUT',
      'Business accounts require an email address (P29). Anonymous accounts cannot own a business.'
    );
  }
  if (!input.name.trim()) throw new AppError('INVALID_INPUT', 'Business name is required.');
  const existing = await prisma.business.findUnique({ where: { accountId } });
  if (existing) throw new AppError('CONFLICT', 'This account already has a business.');
  const business = await prisma.business.create({
    data: { accountId, name: input.name.trim() },
  });
  await prisma.businessMember.create({
    data: { businessId: business.id, accountId, role: 'owner' },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'business_created',
    objectType: 'Business',
    objectId: business.id,
    after: { name: business.name },
  });
  return business;
}

export async function getBusinessForAccount(
  accountId: string
): Promise<(Business & { members: BusinessMember[]; listings: Listing[] }) | null> {
  return prisma.business.findUnique({
    where: { accountId },
    include: { members: true, listings: true },
  });
}

export async function requireBusinessMember(
  businessId: string,
  accountId: string,
  roles = ['owner', 'admin', 'staff']
) {
  const member = await prisma.businessMember.findUnique({
    where: { businessId_accountId: { businessId, accountId } },
  });
  if (!member || !roles.includes(member.role)) {
    throw new AppError('FORBIDDEN', 'Not a member of this business.');
  }
  return member;
}

// P18: an admin cannot create or remove other admins.
export async function addBusinessMember(
  businessId: string,
  actorAccountId: string,
  input: { accountId: string; role: 'admin' | 'staff' }
) {
  const actor = await requireBusinessMember(businessId, actorAccountId, ['owner', 'admin']);
  if (input.role === 'admin' && actor.role !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only the owner can create admins (P18).');
  }
  return prisma.businessMember.create({
    data: { businessId, accountId: input.accountId, role: input.role },
  });
}

export async function removeBusinessMember(
  businessId: string,
  actorAccountId: string,
  targetAccountId: string
) {
  const actor = await requireBusinessMember(businessId, actorAccountId, ['owner', 'admin']);
  const target = await prisma.businessMember.findUnique({
    where: { businessId_accountId: { businessId, accountId: targetAccountId } },
  });
  if (!target) throw new AppError('NOT_FOUND', 'Member not found.');
  if (target.role === 'admin' && actor.role !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only the owner can remove admins (P18).');
  }
  if (target.role === 'owner') throw new AppError('FORBIDDEN', 'The owner cannot be removed.');
  await prisma.businessMember.delete({ where: { id: target.id } });
  await audit({
    actorId: actorAccountId,
    actorKind: 'account',
    action: 'business_member_removed',
    objectType: 'BusinessMember',
    objectId: target.id,
  });
}

export interface ListingInput {
  name: string;
  description?: string;
  categoryIds: string[]; // 1-5 (P1)
  countyIds: string[]; // up to 5 (P1)
  localityIds: string[]; // 1-20 (P1)
}

async function validatePicklists(input: ListingInput) {
  if (input.categoryIds.length < 1 || input.categoryIds.length > 5) {
    throw new AppError('INVALID_INPUT', 'A listing needs 1-5 categories (P1).');
  }
  if (input.countyIds.length < 1 || input.countyIds.length > 5) {
    throw new AppError('INVALID_INPUT', 'A listing covers up to 5 counties (P1).');
  }
  if (input.localityIds.length < 1 || input.localityIds.length > 20) {
    throw new AppError('INVALID_INPUT', 'A listing covers 1-20 localities (P1).');
  }
  // fixed picklists: every id must exist; free text is impossible by construction
  const [cats, counties, localities] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: input.categoryIds }, published: true, retiredAt: null },
    }),
    prisma.county.findMany({ where: { id: { in: input.countyIds }, published: true } }),
    prisma.locality.findMany({ where: { id: { in: input.localityIds }, published: true } }),
  ]);
  if (cats.length !== input.categoryIds.length)
    throw new AppError('INVALID_INPUT', 'Unknown category — pick from the list.');
  if (counties.length !== input.countyIds.length)
    throw new AppError('INVALID_INPUT', 'Unknown county — pick from the list.');
  if (localities.length !== input.localityIds.length)
    throw new AppError('INVALID_INPUT', 'Unknown locality — pick from the list.');
  // localities must belong to the chosen counties
  const countyIdSet = new Set(input.countyIds);
  for (const loc of localities) {
    if (!countyIdSet.has(loc.countyId)) {
      throw new AppError('INVALID_INPUT', 'Locality does not belong to the chosen counties.');
    }
  }
}

// P1 + P3: creating a listing goes through moderation (draft -> pending -> live).
export async function createListing(
  businessId: string,
  accountId: string,
  input: ListingInput
): Promise<Listing> {
  await requireBusinessMember(businessId, accountId, ['owner', 'admin']);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const count = await prisma.listing.count({ where: { businessId } });
  if (count >= 5) throw new AppError('INVALID_INPUT', 'A business can have up to 5 listings (P1).');
  if (business.suspendedAt) throw new AppError('FORBIDDEN', 'This business is restricted (W3).');
  if (business.planLapsedAt)
    throw new AppError('FORBIDDEN', 'Plan lapsed: new listings are paused (P23).');
  await validatePicklists(input);
  return prisma.$transaction(async (tx) => {
    const listing = await tx.listing.create({
      data: {
        businessId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        status: 'pending', // P3: nothing goes live without moderation
        claimed: true,
        categories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) },
        counties: { create: input.countyIds.map((countyId) => ({ countyId })) },
        localities: { create: input.localityIds.map((localityId) => ({ localityId })) },
      },
    });
    await tx.listingRevision.create({
      data: { listingId: listing.id, payload: input as unknown as object, state: 'pending' },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'listing_submitted',
        objectType: 'Listing',
        objectId: listing.id,
      },
    });
    return listing;
  });
}

// P3: editing a live listing creates a pending revision; the live version stays up.
export async function submitListingRevision(
  listingId: string,
  accountId: string,
  input: ListingInput
): Promise<void> {
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  if (!listing.businessId) throw new AppError('FORBIDDEN', 'Unclaimed listings cannot be edited.');
  await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  await validatePicklists(input);
  await prisma.listingRevision.create({
    data: { listingId, payload: input as unknown as object, state: 'pending' },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'listing_revision_submitted',
    objectType: 'Listing',
    objectId: listingId,
  });
}

// P32: the single 48h nudge has a per-business off switch.
export async function setBusinessNudge(businessId: string, accountId: string, on: boolean) {
  await requireBusinessMember(businessId, accountId, ['owner', 'admin']);
  const business = await prisma.business.update({
    where: { id: businessId },
    data: { nudge48h: on },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: on ? 'nudge48h_on' : 'nudge48h_off',
    objectType: 'Business',
    objectId: businessId,
  });
  return business;
}

export async function listBusinessListings(businessId: string, accountId: string) {
  await requireBusinessMember(businessId, accountId);
  return prisma.listing.findMany({
    where: { businessId },
    include: {
      categories: { include: { category: true } },
      counties: { include: { county: true } },
      revisions: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'asc' },
  });
}
