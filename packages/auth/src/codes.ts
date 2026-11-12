import { prisma } from '@eventdesk/db';
import {
  AppError,
  addMinutes,
  hashCode,
  hashIdentifier,
  hashToken,
  newNumericCode,
  newToken,
  now,
  safeEqual,
} from '@eventdesk/shared';
import { checkPenalty, consume, rateLimited, type RateAxis } from './ratelimit';
import { createSession } from './session';

export const CODE_TTL_MINUTES = 15; // INF4
export const CODE_MAX_ATTEMPTS = 5; // INF4
export const SENSITIVE_TTL_MINUTES = 10; // S4

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SignInRequestInput {
  identifier: string; // email address (email accounts)
  ip: string;
  deviceKey?: string;
  sendSignInEmail: (identifier: string, code: string, magicUrl: string) => Promise<void>;
  magicBaseUrl: string;
}

export interface RateContext {
  ip: string;
  deviceKey?: string;
}

async function checkRequestLimits(identifier: string, ctx: RateContext): Promise<void> {
  const idHash = hashIdentifier(identifier);
  const penalty = await checkPenalty('email', idHash);
  if (!penalty.allowed) throw rateLimited(penalty.retryAfterMs ?? 60_000);
  // INF4: max 3 per account per hour, 10 per day. SEC16: max 10 per IP per hour,
  // plus the device-cookie axis. All limits return the same generic message.
  const checks: [RateAxis, string, number, number][] = [
    ['email', idHash, 3, HOUR],
    ['email', idHash, 10, DAY],
    ['ip', ctx.ip, 10, HOUR],
  ];
  if (ctx.deviceKey) checks.push(['device', ctx.deviceKey, 10, HOUR]);
  for (const [axis, key, limit, window] of checks) {
    const r = await consume(axis, key, limit, window);
    if (!r.allowed) throw rateLimited(r.retryAfterMs ?? window);
  }
}

// SEC1: behaves identically whether the account exists or not — same row shape, same
// email template, same timing band. A newer code invalidates older ones; codes are
// single-use (SEC1) and stored hashed (SEC8).
export async function requestSignInCode(input: SignInRequestInput): Promise<{ ok: true }> {
  const identifier = input.identifier.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identifier)) {
    throw new AppError('INVALID_INPUT', 'Invalid email address.');
  }
  await checkRequestLimits(identifier, input);

  const identifierHash = hashIdentifier(identifier);
  await prisma.signInCode.updateMany({
    where: { identifierHash, usedAt: null },
    data: { usedAt: now() }, // newer code invalidates older ones (SEC1)
  });

  const code = newNumericCode();
  const expiresAt = addMinutes(now(), CODE_TTL_MINUTES);
  const row = await prisma.signInCode.create({
    data: { identifierHash, codeHash: hashCode(code), expiresAt },
  });
  const magicToken = newToken();
  await prisma.magicLink.create({
    data: {
      tokenHash: hashToken(magicToken),
      codeId: row.id,
      identifier,
      expiresAt, // link and code expire together (SEC14)
    },
  });

  await input.sendSignInEmail(identifier, code, `${input.magicBaseUrl}/${magicToken}`);
  return { ok: true };
}

export interface VerifyInput extends RateContext {
  identifier: string;
  code: string;
}

export interface VerifyResult {
  sessionToken: string;
  accountId: string;
  created: boolean;
}

// SEC1: one identical generic failure whether the account, the code, or the attempt
// limit is wrong. INF4: at most 5 attempts per code, 20 entries per IP per hour.
export async function verifySignInCode(input: VerifyInput): Promise<VerifyResult> {
  const identifier = input.identifier.trim().toLowerCase();
  const identifierHash = hashIdentifier(identifier);

  const ipEntry = await consume('ip', `codeentry:${input.ip}`, 20, HOUR);
  if (!ipEntry.allowed) throw rateLimited(ipEntry.retryAfterMs ?? HOUR);
  if (input.deviceKey) {
    const devEntry = await consume('device', input.deviceKey, 20, HOUR);
    if (!devEntry.allowed) throw rateLimited(devEntry.retryAfterMs ?? HOUR);
  }

  const codeRow = await prisma.signInCode.findFirst({
    where: { identifierHash, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!codeRow || codeRow.expiresAt < now() || codeRow.attempts >= CODE_MAX_ATTEMPTS) {
    throw new AppError('INVALID_CODE', 'Invalid or expired code.');
  }
  if (!safeEqual(codeRow.codeHash, hashCode(input.code))) {
    await prisma.signInCode.update({
      where: { id: codeRow.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError('INVALID_CODE', 'Invalid or expired code.');
  }

  await prisma.signInCode.update({ where: { id: codeRow.id }, data: { usedAt: now() } });
  await prisma.signInCode.updateMany({
    where: { identifierHash, usedAt: null },
    data: { usedAt: now() },
  });

  let account = await prisma.account.findUnique({ where: { email: identifier } });
  let created = false;
  if (!account) {
    account = await prisma.account.create({
      data: { kind: 'email', email: identifier, emailVerifiedAt: now() },
    });
    created = true;
  }
  const sessionToken = await createSession(account.id);
  return { sessionToken, accountId: account.id, created };
}

export type MagicLinkResult =
  | { status: 'ok'; sessionToken: string; accountId: string }
  | { status: 'consumed' } // SEC14: code in the same email still works
  | { status: 'expired' };

export async function consumeMagicLink(token: string, ip: string): Promise<MagicLinkResult> {
  const ipEntry = await consume('ip', `magic:${ip}`, 20, HOUR);
  if (!ipEntry.allowed) throw rateLimited(ipEntry.retryAfterMs ?? HOUR);

  const link = await prisma.magicLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link) return { status: 'expired' };
  if (link.usedAt) return { status: 'consumed' }; // single-use (SEC14)
  if (link.expiresAt < now()) return { status: 'expired' };

  const codeRow = await prisma.signInCode.findUnique({ where: { id: link.codeId } });
  if (!codeRow || codeRow.usedAt || codeRow.expiresAt < now()) return { status: 'expired' };

  await prisma.magicLink.update({ where: { id: link.id }, data: { usedAt: now() } });
  await prisma.signInCode.update({ where: { id: codeRow.id }, data: { usedAt: now() } });

  const identifier = link.identifier;
  let account = await prisma.account.findUnique({ where: { email: identifier } });
  if (!account) {
    // First use of this email: create the email account (enumeration-safe passwordless signup).
    account = await prisma.account.create({
      data: { kind: 'email', email: identifier, emailVerifiedAt: now() },
    });
  }
  const sessionToken = await createSession(account.id);
  return { status: 'ok', sessionToken, accountId: account.id };
}
