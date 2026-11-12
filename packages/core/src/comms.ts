import { prisma } from '@eventdesk/db';
import { AppError, hashIdentifier, now } from '@eventdesk/shared';
import { sendMail } from '@eventdesk/email';
import { audit } from './audit';
import { requireStaff } from './staff';

// W7: platform communications go to BUSINESSES only — never to planner-entered
// contacts (19.11/BD6). Recipients are the business accounts' own emails.

export async function createNoticeDraft(
  staffAccountId: string,
  input: { subject: string; body: string }
) {
  await requireStaff(staffAccountId, 'content_editor');
  if (!input.subject.trim() || !input.body.trim())
    throw new AppError('INVALID_INPUT', 'Subject and body required.');
  const notice = await prisma.platformNotice.create({
    data: { subject: input.subject.trim(), body: input.body.trim(), sentById: staffAccountId },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: 'notice_drafted',
    objectType: 'PlatformNotice',
    objectId: notice.id,
  });
  return notice;
}

export async function sendNoticeToBusinesses(noticeId: string, staffAccountId: string) {
  await requireStaff(staffAccountId, 'content_editor');
  const notice = await prisma.platformNotice.findUniqueOrThrow({ where: { id: noticeId } });
  if (notice.sentAt) throw new AppError('CONFLICT', 'Already sent.');
  const businessAccounts = await prisma.business.findMany({
    include: { account: { select: { email: true } } },
  });
  let count = 0;
  for (const b of businessAccounts) {
    const email = b.account.email;
    if (!email) continue;
    await sendMail({
      to: email,
      subject: notice.subject,
      text: notice.body,
      template: 'platform-notice',
    }).catch(() => {});
    count++;
  }
  const updated = await prisma.platformNotice.update({
    where: { id: noticeId },
    data: { sentAt: now(), recipientCount: count },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: 'notice_sent_to_businesses',
    objectType: 'PlatformNotice',
    objectId: noticeId,
    after: { recipients: count, recipientClass: 'business_accounts_only' },
  });
  void hashIdentifier;
  return updated;
}

export async function listNotices() {
  return prisma.platformNotice.findMany({ orderBy: { createdAt: 'desc' } });
}

// LAU8 (DSA notice-and-action): anyone can report illegal content or an unlawful
// listing; every report and decision is logged with the reason (SEC10) and reuses
// the W3 restriction flow for takedowns.
export async function fileContentReport(input: {
  reporterContact: string;
  listingId?: string;
  kind: 'illegal_content' | 'unlawful_listing' | 'other';
  detail: string;
}) {
  const report = await prisma.contentReport.create({
    data: {
      reporterContactHash: hashIdentifier(input.reporterContact),
      listingId: input.listingId ?? null,
      kind: input.kind,
      detail: input.detail.slice(0, 4000),
    },
  });
  await audit({
    actorKind: 'system',
    action: 'content_report_received',
    objectType: 'ContentReport',
    objectId: report.id,
    after: { kind: report.kind, listingId: report.listingId },
  });
  return report;
}

export async function decideContentReport(
  reportId: string,
  staffAccountId: string,
  decision: 'actioned' | 'dismissed',
  reason: string
) {
  await requireStaff(staffAccountId, 'listing_moderator');
  const report = await prisma.contentReport.findUniqueOrThrow({ where: { id: reportId } });
  if (report.state !== 'open') throw new AppError('CONFLICT', 'Already decided.');
  await prisma.$transaction(async (tx) => {
    if (decision === 'actioned' && report.listingId) {
      // reuse the W3 restriction flow: suspend the listing, reason recorded
      await tx.listing.update({
        where: { id: report.listingId },
        data: { status: 'suspended' },
      });
    }
    await tx.contentReport.update({
      where: { id: reportId },
      data: { state: decision, decidedBy: staffAccountId, decidedAt: now(), reason },
    });
    await tx.auditLog.create({
      data: {
        actorId: staffAccountId,
        actorKind: 'staff',
        action: `content_report_${decision}`,
        objectType: 'ContentReport',
        objectId: reportId,
        after: { reason, listingId: report.listingId },
      },
    });
  });
}

export async function listContentReports(state = 'open') {
  return prisma.contentReport.findMany({ where: { state }, orderBy: { receivedAt: 'desc' } });
}
