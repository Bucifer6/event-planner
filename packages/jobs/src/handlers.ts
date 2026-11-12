import { prisma } from '@eventdesk/db';
import { sendMail } from '@eventdesk/email';
import { startOfUtcDay, now } from '@eventdesk/shared';
import { computeMemberDigest } from '@eventdesk/core';

// Job registry (R0-12). Handlers must be idempotent (at-least-once delivery, Q4).

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export const handlers: Record<string, JobHandler> = {
  'send-email': async (payload) => {
    await sendMail({
      to: String(payload.to),
      subject: String(payload.subject),
      text: String(payload.text),
      template: String(payload.template),
      occasionId: payload.occasionId ? String(payload.occasionId) : undefined,
    });
  },

  // A10: daily reminder digest per member, once per day, respecting suppression + Q6.
  'daily-digest': async () => {
    const day = startOfUtcDay(now());
    const occasions = await prisma.occasion.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        title: true,
        members: { select: { id: true, accountId: true, inviteEmail: true } },
      },
    });
    for (const occ of occasions) {
      for (const member of occ.members) {
        const already = await prisma.reminderDigest.findUnique({
          where: {
            occasionId_memberId_digestDate: {
              occasionId: occ.id,
              memberId: member.id,
              digestDate: day,
            },
          },
        });
        if (already) continue;
        const to =
          member.inviteEmail ?? (member.accountId ? await accountEmail(member.accountId) : null);
        if (!to) continue; // anonymous members see notifications in-app only (S7)
        const digest = await computeMemberDigest(occ.id, member.id);
        await sendMail({
          to,
          subject: digest.subject,
          text: digest.text,
          template: 'daily-digest',
          occasionId: occ.id,
        });
        await prisma.reminderDigest.create({
          data: { occasionId: occ.id, memberId: member.id, digestDate: day },
        });
      }
    }
  },

  // INF6 retention: sign-in/sensitive codes deleted 24h after expiry or use;
  // expired rate-limit buckets and old security-log-adjacent rows purged.
  'retention-purge': async () => {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);
    await prisma.signInCode.deleteMany({
      where: { OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
    });
    await prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now() } } });
    await prisma.job.deleteMany({
      where: { completedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
    });
  },

  // INF11/D4: nightly server-side aggregates; no visitor identifier anywhere.
  'nightly-stats': async () => {
    const day = startOfUtcDay(now());
    const [accounts, occasions, tasks, invitations] = await Promise.all([
      prisma.account.count(),
      prisma.occasion.count(),
      prisma.task.count(),
      prisma.invitation.count(),
    ]);
    const metrics: [string, number][] = [
      ['accounts', accounts],
      ['occasions', occasions],
      ['tasks', tasks],
      ['invitations', invitations],
    ];
    for (const [metric, value] of metrics) {
      await prisma.statsAggregate.upsert({
        where: { day_metric: { day, metric } },
        update: { value },
        create: { day, metric, value },
      });
    }
  },
};

async function accountEmail(accountId: string): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { email: true },
  });
  return account?.email ?? null;
}
