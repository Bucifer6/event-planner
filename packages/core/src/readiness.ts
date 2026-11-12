import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';

// B8: readiness decisions — Hold | Proceed | Proceed with conditions — each tied
// to at least one evidence reference, recorded with actor and time.

export async function recordReadinessDecision(
  occasionId: string,
  accountId: string,
  input: { decision: 'hold' | 'proceed' | 'proceed_with_conditions'; evidence: string[] }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  if (!['hold', 'proceed', 'proceed_with_conditions'].includes(input.decision)) {
    throw new AppError('INVALID_INPUT', 'Unknown decision.');
  }
  const evidence = input.evidence.filter((e) => e.trim());
  if (evidence.length === 0) {
    throw new AppError('INVALID_INPUT', 'A decision requires at least one evidence reference.');
  }
  const decision = await prisma.readinessDecision.create({
    data: { occasionId, decision: input.decision, evidence, actorId: accountId },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'readiness_decision_recorded',
    objectType: 'ReadinessDecision',
    objectId: decision.id,
    after: { decision: input.decision, evidence },
  });
  return decision;
}

export async function listReadinessDecisions(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.readinessDecision.findMany({
    where: { occasionId },
    orderBy: { createdAt: 'desc' },
  });
}
