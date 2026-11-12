import { prisma } from '@eventdesk/db';
import { hashIdentifier, now, startOfUtcDay } from '@eventdesk/shared';
import { AppError } from '@eventdesk/shared';
import { digestEmail, invitationEmail, signInEmail } from './templates';

// INF2: transactional email provider is operator-configurable (EU delivery preferred).
// In dev (EMAIL_PROVIDER=dev) messages are written to EmailOutbox and never leave the box.
// Bounce/complaint webhooks feed EmailSuppression; hard-bounced addresses are never
// emailed again. Q6: 500 emails/day/occasion enforced server-side before any send.

export const EMAILS_PER_OCCASION_PER_DAY = 500; // Q6

export interface SendInput {
  to: string;
  subject: string;
  text: string;
  template: string;
  occasionId?: string;
}

export async function isSuppressed(to: string): Promise<boolean> {
  const row = await prisma.emailSuppression.findUnique({
    where: { identifierHash: hashIdentifier(to) },
  });
  return !!row;
}

export async function suppress(to: string, reason: string): Promise<void> {
  await prisma.emailSuppression.upsert({
    where: { identifierHash: hashIdentifier(to) },
    update: { reason },
    create: { identifierHash: hashIdentifier(to), reason },
  });
}

export async function sendMail(input: SendInput): Promise<void> {
  const to = input.to.trim().toLowerCase();
  if (await isSuppressed(to)) return; // hard-bounced addresses are never emailed again

  if (input.occasionId) {
    const day = startOfUtcDay(now());
    const count = await prisma.emailLog.count({
      where: { occasionId: input.occasionId, sentAt: { gte: day } },
    });
    if (count >= EMAILS_PER_OCCASION_PER_DAY) {
      throw new AppError('RATE_LIMITED', 'Daily email limit reached for this occasion.');
    }
  }

  const provider = process.env.EMAIL_PROVIDER ?? 'dev';
  if (provider === 'dev') {
    await prisma.emailOutbox.create({
      data: { to, subject: input.subject, bodyText: input.text, template: input.template },
    });
  } else {
    // Operator-configurable provider goes here; never called in dev/tests.
    throw new AppError(
      'INVALID_INPUT',
      `Email provider "${provider}" is not configured in this environment.`
    );
  }

  await prisma.emailLog.create({
    data: {
      occasionId: input.occasionId ?? null,
      toIdentifierHash: hashIdentifier(to),
      template: input.template,
    },
  });
}

export const templates = { signInEmail, invitationEmail, digestEmail };
