'use server';

import { revalidatePath } from 'next/cache';
import {
  approveDraft,
  decideRevision,
  handleObjection,
  setBusinessSuspension,
  setSourceEnabled,
} from '@eventdesk/core';
import { requireStaffUser } from './console';

// Release P console actions (W2/W3/W4/W5/W7). Every call is audit-logged in core
// (SEC10); the console session itself is checked by the layout (S5).

export async function decideRevisionAction(
  revisionId: string,
  decision: 'approved' | 'rejected' | 'changes_requested',
  formData: FormData
): Promise<void> {
  const { user } = await requireStaffUser();
  await decideRevision(
    revisionId,
    user.accountId,
    decision,
    String(formData.get('reason') ?? '') || undefined
  );
  revalidatePath('/console/moderation');
}

export async function approveDraftAction(draftId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await approveDraft(draftId, user.accountId);
  revalidatePath('/console/discovery');
}

export async function setSourceEnabledAction(sourceId: string, enabled: boolean): Promise<void> {
  const { user } = await requireStaffUser();
  await setSourceEnabled(sourceId, enabled, user.accountId);
  revalidatePath('/console/discovery');
}

export async function handleObjectionAction(objectionId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await handleObjection(objectionId, user.accountId);
  revalidatePath('/console/discovery');
}

export async function setBusinessSuspensionAction(
  businessId: string,
  suspend: boolean,
  formData: FormData
): Promise<void> {
  const { user } = await requireStaffUser();
  await setBusinessSuspension(
    businessId,
    user.accountId,
    suspend,
    String(formData.get('reason') ?? '') || undefined
  );
  revalidatePath('/console/businesses');
}

// --- v0.4.0 console actions: W4 directory, W6 commercial, W7 comms, W8 access, W10 deploys ---

import {
  approveComplianceAccess,
  createComplianceAccessRequest,
  createDirectoryCategory,
  createNoticeDraft,
  decideContentReport,
  directoryDailyStats,
  exportAuditExtract,
  fileContentReport,
  freePhaseCostDashboard,
  listAuditLog,
  listContentReports,
  listDeploys,
  listGithubReleases,
  manageStaffRoles,
  recordBillingAcceptance,
  requestDeploy,
  retireDirectoryCategory,
  sendNoticeToBusinesses,
  setDirectoryCategoryPublished,
  applyDeploy,
  canEnableMonetization,
  requestRefund,
} from '@eventdesk/core';
import { prisma } from '@eventdesk/db';

export async function createDirectoryCategoryAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  await createDirectoryCategory(user.accountId, {
    slug: String(formData.get('slug') ?? ''),
    nameRo: String(formData.get('nameRo') ?? ''),
    nameEn: String(formData.get('nameEn') ?? ''),
  });
  revalidatePath('/console/directory');
}

export async function retireDirectoryCategoryAction(
  categoryId: string,
  retired: boolean
): Promise<void> {
  const { user } = await requireStaffUser();
  await retireDirectoryCategory(user.accountId, categoryId, retired);
  revalidatePath('/console/directory');
}

export async function setDirectoryCategoryPublishedAction(
  categoryId: string,
  published: boolean
): Promise<void> {
  const { user } = await requireStaffUser();
  await setDirectoryCategoryPublished(user.accountId, categoryId, published);
  revalidatePath('/console/directory');
}

export async function recordBillingAcceptanceAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  await recordBillingAcceptance(user.accountId, String(formData.get('notes') ?? ''));
  revalidatePath('/console/commercial');
}

export async function createNoticeAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  await createNoticeDraft(user.accountId, {
    subject: String(formData.get('subject') ?? ''),
    body: String(formData.get('body') ?? ''),
  });
  revalidatePath('/console/comms');
}

export async function sendNoticeAction(noticeId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await sendNoticeToBusinesses(noticeId, user.accountId);
  revalidatePath('/console/comms');
}

export async function manageStaffRolesAction(
  targetAccountId: string,
  roles: string[]
): Promise<void> {
  const { user } = await requireStaffUser();
  await manageStaffRoles(user.accountId, targetAccountId, roles);
  revalidatePath('/console/access');
}

export async function createComplianceAccessAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  await createComplianceAccessRequest(user.accountId, String(formData.get('purpose') ?? ''));
  revalidatePath('/console/access');
}

export async function approveComplianceAccessAction(requestId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await approveComplianceAccess(requestId, user.accountId);
  revalidatePath('/console/access');
}

export async function requestDeployAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  const emergency = formData.get('emergency') === 'on';
  await requestDeploy(
    String(formData.get('tag') ?? ''),
    String(formData.get('commitHash') ?? ''),
    String(formData.get('ciStatus') ?? '') || null,
    user.accountId,
    { emergency, reason: String(formData.get('reason') ?? '') || undefined }
  );
  revalidatePath('/console/deploys');
}

export async function applyDeployAction(requestId: string): Promise<void> {
  const { user } = await requireStaffUser();
  await applyDeploy(requestId, user.accountId);
  revalidatePath('/console/deploys');
}

export async function requestRefundAction(formData: FormData): Promise<void> {
  const { user } = await requireStaffUser();
  await requestRefund(
    String(formData.get('subscriptionId') ?? ''),
    Number(formData.get('amountBani') ?? 0),
    String(formData.get('reason') ?? ''),
    user.accountId
  );
  revalidatePath('/console/commercial');
}

export async function fileContentReportAction(formData: FormData): Promise<void> {
  await fileContentReport({
    reporterContact: String(formData.get('contact') ?? 'anonymous'),
    listingId: String(formData.get('listingId') ?? '') || undefined,
    kind: String(formData.get('kind') ?? 'other') as
      'illegal_content' | 'unlawful_listing' | 'other',
    detail: String(formData.get('detail') ?? ''),
  });
}

export async function decideContentReportAction(
  reportId: string,
  decision: 'actioned' | 'dismissed',
  formData: FormData
): Promise<void> {
  const { user } = await requireStaffUser();
  await decideContentReport(
    reportId,
    user.accountId,
    decision,
    String(formData.get('reason') ?? '')
  );
  revalidatePath('/console/discovery');
}

// Read-only data helpers for console pages (server components call these directly
// from @eventdesk/core; these wrappers keep the 'use server' file self-contained).
export async function consolePData() {
  const [cost, stats, notices, reports, deploys, releases, mon, acceptance, auditTail] =
    await Promise.all([
      freePhaseCostDashboard(),
      directoryDailyStats(30),
      prisma.platformNotice.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      listContentReports('open'),
      listDeploys(20),
      listGithubReleases(),
      prisma.monetizationSwitch.findUniqueOrThrow({ where: { id: 'main' } }),
      prisma.billingAcceptance.findUnique({ where: { id: 'main' } }),
      listAuditLog({ limit: 50 }),
    ]);
  const monGate = await canEnableMonetization();
  return { cost, stats, notices, reports, deploys, releases, mon, acceptance, auditTail, monGate };
}

export { exportAuditExtract };
