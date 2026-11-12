import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireStaff } from './staff';

// W8: access management + audit. Compliance access to RETAINED data needs THREE
// distinct people (19.12): the requester plus three approvers, all staff.

export async function manageStaffRoles(
  actorAccountId: string,
  targetAccountId: string,
  roles: string[]
) {
  await requireStaff(actorAccountId, 'platform_admin');
  const staff = await prisma.staffMember.upsert({
    where: { accountId: targetAccountId },
    update: { roles },
    create: { accountId: targetAccountId, roles },
  });
  await audit({
    actorId: actorAccountId,
    actorKind: 'staff',
    action: 'staff_roles_updated',
    objectType: 'StaffMember',
    objectId: staff.id,
    after: { targetAccountId, roles },
  });
  return staff;
}

export async function createComplianceAccessRequest(requesterId: string, purpose: string) {
  await requireStaff(requesterId, 'privacy_owner');
  if (!purpose.trim()) throw new AppError('INVALID_INPUT', 'Purpose required.');
  const req = await prisma.complianceAccessRequest.create({
    data: { requesterId, purpose: purpose.trim(), approvals: [] },
  });
  await audit({
    actorId: requesterId,
    actorKind: 'staff',
    action: 'compliance_access_requested',
    objectType: 'ComplianceAccessRequest',
    objectId: req.id,
    after: { purpose },
  });
  return req;
}

export async function approveComplianceAccess(requestId: string, approverId: string) {
  await requireStaff(approverId, 'privacy_owner');
  const req = await prisma.complianceAccessRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (req.state !== 'pending') throw new AppError('CONFLICT', 'Already decided.');
  if (req.requesterId === approverId)
    throw new AppError('FORBIDDEN', 'The requester cannot approve their own access.');
  if (req.approvals.includes(approverId))
    throw new AppError('CONFLICT', 'Already approved by this person.');
  const approvals = [...req.approvals, approverId];
  const state = approvals.length >= 3 ? 'approved' : 'pending'; // W8: three people
  const updated = await prisma.complianceAccessRequest.update({
    where: { id: requestId },
    data: { approvals, state },
  });
  await audit({
    actorId: approverId,
    actorKind: 'staff',
    action:
      state === 'approved' ? 'compliance_access_approved_3person' : 'compliance_access_approval',
    objectType: 'ComplianceAccessRequest',
    objectId: requestId,
    after: { approvals: approvals.length, state },
  });
  return updated;
}

export async function listComplianceAccessRequests(state?: string) {
  return prisma.complianceAccessRequest.findMany({
    where: state ? { state } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

// W8: audit log with filters by actor, action, object and date (SEC10 append-only).
export async function listAuditLog(filter: {
  actorId?: string;
  action?: string;
  objectType?: string;
  since?: Date;
  limit?: number;
}) {
  return prisma.auditLog.findMany({
    where: {
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.action ? { action: { contains: filter.action } } : {}),
      ...(filter.objectType ? { objectType: filter.objectType } : {}),
      ...(filter.since ? { at: { gte: filter.since } } : {}),
    },
    orderBy: { at: 'desc' },
    take: filter.limit ?? 200,
  });
}

// W8: compliance export of an audit extract (CSV), itself audit-logged.
export async function exportAuditExtract(
  staffAccountId: string,
  filter: Parameters<typeof listAuditLog>[0]
) {
  await requireStaff(staffAccountId, 'security_administrator');
  const rows = await listAuditLog({ ...filter, limit: 10_000 });
  const header = 'createdAt,actorId,actorKind,action,objectType,objectId';
  const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const body = rows
    .map((r) =>
      [r.at.toISOString(), r.actorId ?? '', r.actorKind, r.action, r.objectType, r.objectId ?? '']
        .map((v) => esc(String(v)))
        .join(',')
    )
    .join('\n');
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: 'audit_extract_exported',
    objectType: 'AuditLog',
    after: { rows: rows.length, filter },
  });
  return `${header}\n${body}\n`;
}
