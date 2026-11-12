import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireBusinessMember } from './business';
import { createOccasion } from './occasions';

// P-08 (P17-P23): business-owned occasions, team access, branding, handover, lapse.
// P23: on plan lapse, existing occasions stay fully usable — only NEW business
// occasions, branding and library edits stop. Reads (incl. drawings/catalogues in
// live plans) are never blocked.

export async function requireBusinessActive(businessId: string, accountId: string) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  if (business.suspendedAt) throw new AppError('FORBIDDEN', 'This business is restricted (W3).');
  if (business.planLapsedAt) {
    throw new AppError(
      'FORBIDDEN',
      'Plan lapsed: new business occasions, branding and library edits are paused; existing occasions stay fully usable (P23).'
    );
  }
  return requireBusinessMember(businessId, accountId);
}

// P17: any active business member can create a business-owned occasion with the
// same planning features.
export async function createBusinessOccasion(
  businessId: string,
  accountId: string,
  input: Parameters<typeof createOccasion>[0]
) {
  await requireBusinessActive(businessId, accountId);
  const occasion = await createOccasion({ ...input, ownerId: accountId });
  await prisma.occasion.update({ where: { id: occasion.id }, data: { businessId } });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'business_occasion_created',
    objectType: 'Occasion',
    objectId: occasion.id,
    after: { businessId },
  });
  return prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
}

export async function listBusinessOccasions(businessId: string, accountId: string) {
  await requireBusinessMember(businessId, accountId);
  return prisma.occasion.findMany({
    where: { businessId },
    include: { members: true, _count: { select: { tasks: true, households: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

// P22: hand the occasion over to the client — branding and business access end,
// history is kept. After handover, business members (and their MCP tokens, MCP7)
// no longer pass getMember for this occasion.
export async function handoverOccasion(
  occasionId: string,
  businessAccountId: string,
  clientAccountId: string
) {
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  if (!occ.businessId) throw new AppError('INVALID_INPUT', 'Not a business occasion.');
  if (occ.handedOverAt) throw new AppError('CONFLICT', 'Already handed over.');
  await requireBusinessMember(occ.businessId, businessAccountId, ['owner', 'admin']);
  const client = await prisma.account.findUniqueOrThrow({ where: { id: clientAccountId } });
  await prisma.$transaction(async (tx) => {
    await tx.occasion.update({
      where: { id: occasionId },
      data: { handedOverAt: now(), handedOverToId: client.id, handoverById: businessAccountId },
    });
    // P22: business-side access ends — direct member rows belonging to business
    // members are removed (the client is upserted as owner below)
    const bizMembers = await tx.businessMember.findMany({ where: { businessId: occ.businessId! } });
    const bizAccountIds = bizMembers.map((m) => m.accountId);
    await tx.occasionMember.deleteMany({
      where: { occasionId, accountId: { in: bizAccountIds } },
    });
    await tx.occasionMember.upsert({
      where: { occasionId_accountId: { occasionId, accountId: client.id } },
      update: { role: 'owner', finance: true, privateRequests: true },
      create: {
        occasionId,
        accountId: client.id,
        role: 'owner',
        finance: true,
        privateRequests: true,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: businessAccountId,
        actorKind: 'account',
        action: 'occasion_handed_over',
        objectType: 'Occasion',
        objectId: occasionId,
        after: { handedOverTo: client.id, note: 'business access ended; history kept (P22, MCP7)' },
      },
    });
  });
}

// P20: logo, name and one accent colour on guest pages of business occasions.
// Blocked when the plan lapsed (P23) — guest pages of existing occasions keep
// rendering the branding already set.
export async function setBranding(
  businessId: string,
  accountId: string,
  input: { name?: string; logoAssetId?: string | null; accentColor?: string | null }
) {
  await requireBusinessActive(businessId, accountId);
  if (input.accentColor != null && !/^#[0-9a-fA-F]{6}$/.test(input.accentColor)) {
    throw new AppError('INVALID_INPUT', 'Accent colour must be a #rrggbb hex value.');
  }
  const business = await prisma.business.update({
    where: { id: businessId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      logoAssetId: input.logoAssetId ?? undefined,
      accentColor: input.accentColor ?? undefined,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'branding_updated',
    objectType: 'Business',
    objectId: businessId,
    after: { name: business.name, accentColor: business.accentColor },
  });
  return business;
}

// P23: lapse is set from a verified billing webhook (MON), never from the browser.
export async function setPlanLapsed(businessId: string, lapsed: boolean, actorId = 'system') {
  const business = await prisma.business.update({
    where: { id: businessId },
    data: { planLapsedAt: lapsed ? now() : null },
  });
  await audit({
    actorId,
    actorKind: actorId === 'system' ? 'system' : 'staff',
    action: lapsed ? 'plan_lapsed' : 'plan_restored',
    objectType: 'Business',
    objectId: businessId,
  });
  return business;
}

// P7: the "Vezi firme de <categorie> în <zona>" task link can be switched off per
// account or per occasion member.
export async function setHideDirectoryLinks(
  accountId: string,
  scope: { occasionId?: string },
  hidden: boolean
) {
  if (scope.occasionId) {
    const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: scope.occasionId } });
    const member = await prisma.occasionMember.findUnique({
      where: { occasionId_accountId: { occasionId: occ.id, accountId } },
    });
    if (!member) throw new AppError('FORBIDDEN', 'No access to this occasion.');
    return prisma.occasionMember.update({
      where: { id: member.id },
      data: { hideDirectoryLinks: hidden },
    });
  }
  return prisma.account.update({ where: { id: accountId }, data: { hideDirectoryLinks: hidden } });
}
