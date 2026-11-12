import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';

export type RateAxis = 'email' | 'ip' | 'device' | 'link';

export interface RateCheck {
  allowed: boolean;
  retryAfterMs?: number;
}

// SEC16: three independent axes (per email, per IP, per device cookie), escalating
// backoff per address only, never a lockout; events logged without recording whether
// an account exists.
export async function consume(
  axis: RateAxis,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateCheck> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);

  const bucket = await prisma.rateLimitBucket.upsert({
    where: { axis_key_windowStart: { axis, key, windowStart } },
    update: { count: { increment: 1 } },
    create: { axis, key, windowStart, count: 1, expiresAt },
  });

  if (bucket.count <= limit) return { allowed: true };

  // Escalating backoff on the email axis only, per address, never a full lockout.
  let retryAfterMs = windowMs - (Date.now() - windowStart.getTime());
  if (axis === 'email') {
    const level = bucket.level + 1;
    const penaltyMs = Math.min(2 ** level * 60_000, 24 * 3_600_000);
    retryAfterMs = Math.max(retryAfterMs, penaltyMs);
    await prisma.rateLimitBucket.update({
      where: { id: bucket.id },
      data: { level, penaltyUntil: new Date(Date.now() + penaltyMs) },
    });
  }

  await prisma.securityLog.create({
    data: {
      event: 'rate_limit_tripped',
      axisKey: `${axis}:${key}`,
      meta: { axis, windowMs, count: bucket.count, limit },
    },
  });

  return { allowed: false, retryAfterMs };
}

// A bucket already in backoff denies until penaltyUntil passes.
export async function checkPenalty(axis: RateAxis, key: string): Promise<RateCheck> {
  const now = new Date();
  const bucket = await prisma.rateLimitBucket.findFirst({
    where: { axis, key, penaltyUntil: { gt: now } },
    orderBy: { penaltyUntil: 'desc' },
  });
  if (!bucket?.penaltyUntil) return { allowed: true };
  return { allowed: false, retryAfterMs: bucket.penaltyUntil.getTime() - now.getTime() };
}

export function rateLimited(retryAfterMs: number): AppError {
  return new AppError('RATE_LIMITED', 'Too many attempts. Try again later.', retryAfterMs);
}
