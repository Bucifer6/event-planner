'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@eventdesk/db';
import {
  approveRequest,
  applyMonetizationEnable,
  createApprovalRequest,
  createStaffSession,
  getMonetizationSwitch,
  listApprovalRequests,
  rejectRequest,
  requireStaff,
  requestMonetizationEnable,
  validateStaffSession,
} from '@eventdesk/core';
import { generateTotpSecret, verifyTotp } from '@eventdesk/auth';
import { requireUser } from '../lib/session';

const STAFF_COOKIE = 'ed_staff_session';

export async function currentStaff(): Promise<{ staffId: string; accountId: string } | null> {
  const store = await cookies();
  const token = store.get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const staffId = await validateStaffSession(token);
  if (!staffId) return null;
  const staff = await prisma.staffMember.findUnique({ where: { id: staffId } });
  if (!staff) return null;
  return { staffId, accountId: staff.accountId };
}

export async function requireStaffUser() {
  const user = await requireUser();
  const staff = await requireStaff(user.accountId); // S5: throws without confirmed TOTP
  return { user, staff };
}

// Staff sign-in: passwordless code verified earlier; here the staff member must
// present a fresh TOTP (S5) to open the console session (12h / 30min idle).
export async function staffSignInAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get('totp') ?? '');
  const totp = await prisma.totpSecret.findUnique({ where: { accountId: user.accountId } });
  if (!totp?.confirmedAt || !verifyTotp(totp.secret, token)) {
    redirect('/console/signin?error=auth.errors.invalid_code');
  }
  const staff = await getStaffOrThrow(user.accountId);
  const sessionToken = await createStaffSession(staff.id);
  const store = await cookies();
  store.set(STAFF_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60,
    path: '/console',
  });
  redirect('/console');
}

async function getStaffOrThrow(accountId: string) {
  const staff = await prisma.staffMember.findUnique({ where: { accountId } });
  if (!staff) redirect('/console/signin?error=err.forbidden');
  return staff!;
}

export async function enrolTotpAction(): Promise<{ otpauthUrl: string }> {
  const user = await requireUser();
  const existing = await prisma.totpSecret.findUnique({ where: { accountId: user.accountId } });
  if (existing?.confirmedAt) redirect('/console');
  const { secret, otpauthUrl } = generateTotpSecret();
  await prisma.totpSecret.upsert({
    where: { accountId: user.accountId },
    update: { secret, confirmedAt: null },
    create: { accountId: user.accountId, secret },
  });
  return { otpauthUrl };
}

export async function confirmTotpAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get('totp') ?? '');
  const totp = await prisma.totpSecret.findUnique({ where: { accountId: user.accountId } });
  if (!totp || !verifyTotp(totp.secret, token))
    redirect('/console/enrol?error=auth.errors.invalid_code');
  await prisma.totpSecret.update({
    where: { accountId: user.accountId },
    data: { confirmedAt: new Date() },
  });
  redirect('/console/signin');
}

export async function approveAction(requestId: string): Promise<void> {
  const { user } = await requireStaffUser();
  const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
  await approveRequest(requestId, user.accountId);
  if (request.action === 'monetization_enable') {
    await applyMonetizationEnable(requestId, user.accountId);
  }
  redirect('/console/approvals');
}

export async function rejectAction(requestId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await rejectRequest(requestId, user.accountId);
  redirect('/console/approvals');
}

export async function requestMonetizationAction(): Promise<void> {
  const { user } = await requireStaffUser();
  await requestMonetizationEnable(user.accountId); // W9: queues until a second person approves
  redirect('/console/monetization');
}

export async function consoleData() {
  const { user } = await requireStaffUser();
  const [accounts, occasions, businesses0, jobs, queue, mon, audits] = await Promise.all([
    prisma.account.count(),
    prisma.occasion.count(),
    prisma.staffMember.count(),
    prisma.job.count({ where: { completedAt: null } }),
    listApprovalRequests('pending'),
    getMonetizationSwitch(),
    prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take: 100 }),
  ]);
  return {
    user,
    accounts,
    occasions,
    staffCount: businesses0,
    pendingJobs: jobs,
    queue,
    mon,
    audits,
  };
}
