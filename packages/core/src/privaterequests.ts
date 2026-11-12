import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireGrant } from './access';

// C-07: private dietary/access requests — visible ONLY with the privateRequests
// grant (D2). The published accessible guest journey is a static ro+en page.

export async function addPrivateRequest(
  occasionId: string,
  accountId: string,
  input: { householdId?: string; kind: 'diet' | 'access'; detail: string }
) {
  await requireMember(occasionId, accountId);
  if (!['diet', 'access'].includes(input.kind))
    throw new AppError('INVALID_INPUT', 'Kind must be diet or access.');
  if (!input.detail.trim()) throw new AppError('INVALID_INPUT', 'Detail required.');
  if (input.householdId) {
    const h = await prisma.household.findUniqueOrThrow({ where: { id: input.householdId } });
    if (h.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  }
  const req = await prisma.privateRequest.create({
    data: {
      occasionId,
      householdId: input.householdId ?? null,
      kind: input.kind,
      detail: input.detail.trim().slice(0, 2000),
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'private_request_added',
    objectType: 'PrivateRequest',
    objectId: req.id,
    after: { kind: req.kind },
  });
  return req;
}

export async function listPrivateRequests(occasionId: string, accountId: string) {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'privateRequests'); // D2: grant-gated
  return prisma.privateRequest.findMany({ where: { occasionId }, orderBy: { createdAt: 'desc' } });
}
