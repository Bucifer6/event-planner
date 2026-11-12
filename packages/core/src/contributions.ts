import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';

// A9: guest contributions — claim, change and release against a stated need;
// two claims cannot take the same last units (conditional UPDATE, rowCount 0 = taken).

export async function createNeed(
  occasionId: string,
  accountId: string,
  input: { title: string; unitLabel?: string; totalUnits?: number | null }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Need title is required.');
  return prisma.contributionNeed.create({
    data: {
      occasionId,
      title: input.title.trim(),
      unitLabel: input.unitLabel ?? null,
      totalUnits: input.totalUnits ?? null,
      createdById: accountId,
    },
  });
}

export async function listNeeds(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.contributionNeed.findMany({
    where: { occasionId },
    include: { claims: { where: { state: 'claimed' } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function claimUnits(
  occasionId: string,
  accountId: string,
  needId: string,
  units: number
) {
  const member = await requireMember(occasionId, accountId);
  if (units <= 0) throw new AppError('INVALID_INPUT', 'Units must be positive.');
  const need = await prisma.contributionNeed.findFirst({ where: { id: needId, occasionId } });
  if (!need) throw new AppError('NOT_FOUND', 'Need not found.');
  const claimed = await prisma.$executeRaw`
    UPDATE "ContributionNeed"
    SET "claimedUnits" = "claimedUnits" + ${units}
    WHERE id = ${needId}
      AND ("totalUnits" IS NULL OR "claimedUnits" + ${units} <= "totalUnits")
  `;
  if (claimed === 0) {
    throw new AppError('UNITS_TAKEN', 'The last units were just claimed by someone else.');
  }
  const claim = await prisma.contributionClaim.create({
    data: { needId, memberId: member.id, units, state: 'claimed' },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'contribution_claimed',
    objectType: 'ContributionNeed',
    objectId: needId,
    after: { units, claimId: claim.id },
  });
  return claim;
}

export async function releaseClaim(occasionId: string, accountId: string, claimId: string) {
  const member = await requireMember(occasionId, accountId);
  const claim = await prisma.contributionClaim.findUnique({
    where: { id: claimId },
    include: { need: true },
  });
  if (!claim || claim.need.occasionId !== occasionId)
    throw new AppError('NOT_FOUND', 'Claim not found.');
  if (claim.state !== 'claimed') throw new AppError('CONFLICT', 'Already released.');
  if (claim.memberId !== member.id) {
    await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  }
  return prisma.$transaction(async (tx) => {
    await tx.contributionClaim.update({
      where: { id: claimId },
      data: { state: 'released', releasedAt: new Date() },
    });
    await tx.contributionNeed.update({
      where: { id: claim.needId },
      data: { claimedUnits: { decrement: claim.units } },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'contribution_released',
        objectType: 'ContributionClaim',
        objectId: claimId,
        after: { units: claim.units },
      },
    });
  });
}
