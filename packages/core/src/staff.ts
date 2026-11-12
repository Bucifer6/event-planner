import { prisma, type StaffMember } from '@eventdesk/db';
import { AppError, addDays, hashToken, newToken, now } from '@eventdesk/shared';
import { audit } from './audit';

// R0-13: staff console — six roles, staff 2FA mandatory (S5), console session 12h /
// 30min idle, approval queue with the second-person rule and single-operator
// restricted mode (W9: queued actions have no effect until a second staff member
// approves; live payments blocked until two staff exist). W6: monetization switch.

export const STAFF_ROLES = [
  'platform_admin',
  'content_editor',
  'listing_moderator',
  'commercial_manager',
  'privacy_owner',
  'security_administrator',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const STAFF_SESSION_TTL_H = 12; // S5
const STAFF_IDLE_MIN = 30; // S5

export async function getStaff(accountId: string): Promise<StaffMember | null> {
  return prisma.staffMember.findUnique({ where: { accountId } });
}

// S5: platform staff must use two-step sign-in — a confirmed TOTP secret.
export async function requireStaff(accountId: string, role?: StaffRole): Promise<StaffMember> {
  const staff = await getStaff(accountId);
  if (!staff) throw new AppError('FORBIDDEN', 'Not a staff member.');
  if (role && !staff.roles.includes(role))
    throw new AppError('FORBIDDEN', `Role ${role} required.`);
  const totp = await prisma.totpSecret.findUnique({ where: { accountId } });
  if (!totp?.confirmedAt) {
    throw new AppError('FORBIDDEN', 'Two-step sign-in is mandatory for staff (S5).');
  }
  return staff;
}

export async function createStaffSession(staffId: string): Promise<string> {
  const token = newToken();
  await prisma.staffSession.create({
    data: {
      id: hashToken(token),
      staffId,
      lastSeenAt: now(),
      expiresAt: addDays(now(), STAFF_SESSION_TTL_H / 24),
    },
  });
  return token;
}

export async function validateStaffSession(token: string): Promise<string | null> {
  const id = hashToken(token);
  const session = await prisma.staffSession.findUnique({ where: { id } });
  const current = now();
  if (!session || session.revokedAt || session.expiresAt < current) return null;
  if (current.getTime() - session.lastSeenAt.getTime() > STAFF_IDLE_MIN * 60_000) {
    await prisma.staffSession.update({ where: { id }, data: { revokedAt: current } });
    return null;
  }
  await prisma.staffSession.update({ where: { id }, data: { lastSeenAt: current } });
  return session.staffId;
}

// W9: approvals need a second person. In single-operator mode (one staff member),
// approval-requiring actions queue and have no effect until approved.
export async function staffCount(): Promise<number> {
  return prisma.staffMember.count();
}

export async function createApprovalRequest(
  action: string,
  payload: unknown,
  requesterId: string
): Promise<{ id: string; queued: boolean }> {
  const request = await prisma.approvalRequest.create({
    data: {
      action,
      payload: payload as object,
      requesterId,
      state: 'pending',
    },
  });
  const count = await staffCount();
  await audit({
    actorId: requesterId,
    actorKind: 'staff',
    action: count < 2 ? 'approval_queued_single_operator' : 'approval_requested',
    objectType: 'ApprovalRequest',
    objectId: request.id,
    after: { action, staffCount: count },
  });
  return { id: request.id, queued: count < 2 };
}

// Second-person approval: approver must differ from requester (W-group rule).
export async function approveRequest(requestId: string, approverId: string): Promise<void> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new AppError('NOT_FOUND', 'Approval request not found.');
  if (request.state !== 'pending') throw new AppError('CONFLICT', 'Already decided.');
  if (request.requesterId === approverId) {
    throw new AppError(
      'FORBIDDEN',
      'Approvals need a second person — the requester cannot approve their own action.'
    );
  }
  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { state: 'approved', approverId, decidedAt: now() },
  });
  await audit({
    actorId: approverId,
    actorKind: 'staff',
    action: 'approval_granted',
    objectType: 'ApprovalRequest',
    objectId: requestId,
    after: { action: request.action },
  });
}

export async function rejectRequest(
  requestId: string,
  approverId: string,
  reason?: string
): Promise<void> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new AppError('NOT_FOUND', 'Approval request not found.');
  if (request.state !== 'pending') throw new AppError('CONFLICT', 'Already decided.');
  if (request.requesterId === approverId)
    throw new AppError('FORBIDDEN', 'Self-approval is not allowed.');
  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: {
      state: 'rejected',
      approverId,
      decidedAt: now(),
      payload: { ...(request.payload as object), rejectionReason: reason ?? null },
    },
  });
  await audit({
    actorId: approverId,
    actorKind: 'staff',
    action: 'approval_rejected',
    objectType: 'ApprovalRequest',
    objectId: requestId,
  });
}

export async function listApprovalRequests(state = 'pending') {
  return prisma.approvalRequest.findMany({ where: { state }, orderBy: { createdAt: 'desc' } });
}

// W6/MON2: the monetization switch is a single platform-level console switch, OFF
// by default; turning it ON requires a second-person approval and is audit-logged.
// MON5: while OFF, Featured does not exist anywhere.
export async function getMonetizationSwitch() {
  return prisma.monetizationSwitch.findUniqueOrThrow({ where: { id: 'main' } });
}

export async function requestMonetizationEnable(
  requesterId: string
): Promise<{ id: string; queued: boolean }> {
  await requireStaff(requesterId, 'platform_admin');
  const current = await getMonetizationSwitch();
  if (current.state === 'ON') throw new AppError('CONFLICT', 'Monetization is already ON.');
  return createApprovalRequest(
    'monetization_enable',
    { noticeDays: 60, reminders: [30, 7] },
    requesterId
  );
}

export async function applyMonetizationEnable(
  requestId: string,
  approverId: string
): Promise<void> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (!request || request.action !== 'monetization_enable')
    throw new AppError('NOT_FOUND', 'Request not found.');
  await approveRequest(requestId, approverId);
  const current = await getMonetizationSwitch();
  const history = (current.history as unknown[]) ?? [];
  const entry = {
    at: now().toISOString(),
    action: 'ON',
    requester: request.requesterId,
    approver: approverId,
    noticeDays: 60,
  };
  await prisma.monetizationSwitch.update({
    where: { id: 'main' },
    data: { state: 'ON', history: [...history, entry] as never },
  });
  await audit({
    actorId: approverId,
    actorKind: 'staff',
    action: 'monetization_enabled',
    objectType: 'MonetizationSwitch',
    objectId: 'main',
    after: {
      state: 'ON',
      notice: '60-day public notice started; reminders at 30 and 7 days (P28)',
    },
  });
}
