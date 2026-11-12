import { prisma, type OccasionMember, type Role } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';

// D2: access grants are checked server-side here on every read and write — private
// requests, finance and guest contacts only to holders of that specific grant.
export async function getMember(
  occasionId: string,
  accountId: string
): Promise<OccasionMember | null> {
  return prisma.occasionMember.findUnique({
    where: { occasionId_accountId: { occasionId, accountId } },
  });
}

export async function requireMember(
  occasionId: string,
  accountId: string
): Promise<OccasionMember> {
  const member = await getMember(occasionId, accountId);
  if (!member) throw new AppError('FORBIDDEN', 'No access to this occasion.');
  return member;
}

export async function requireRole(
  occasionId: string,
  accountId: string,
  roles: Role[]
): Promise<OccasionMember> {
  const member = await requireMember(occasionId, accountId);
  if (!roles.includes(member.role)) throw new AppError('FORBIDDEN', 'Role not allowed.');
  return member;
}

export function requireGrant(member: OccasionMember, grant: 'finance' | 'privateRequests'): void {
  if (grant === 'finance' && !member.finance) {
    throw new AppError('FORBIDDEN', 'Finance access required.');
  }
  if (grant === 'privateRequests' && !member.privateRequests) {
    throw new AppError('FORBIDDEN', 'Private-request access required.');
  }
}

export function canManage(member: OccasionMember): boolean {
  return (
    member.role === 'owner' ||
    member.role === 'project_manager' ||
    member.role === 'workstream_lead'
  );
}
