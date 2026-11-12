import { prisma } from '@eventdesk/db';
import {
  AppError,
  addMinutes,
  hashCode,
  hashIdentifier,
  newNumericCode,
  newToken,
  now,
  randomUsername,
  safeEqual,
} from '@eventdesk/shared';
import { hashPassword, verifyPassword } from './password';
import { checkPenalty, consume, rateLimited, type RateAxis } from './ratelimit';
import { CODE_MAX_ATTEMPTS, type RateContext } from './codes';
import { createSession } from './session';

const HOUR = 3_600_000;

// S7/S8: fully anonymous account — random username plus user-chosen password, no email,
// no phone, no real name. Ten single-use recovery codes are returned once; losing both
// password and codes means the account is unrecoverable (stated in the UI).
export async function createAnonymousAccount(input: {
  username?: string;
  password: string;
}): Promise<{ accountId: string; username: string; recoveryCodes: string[] }> {
  const username = (input.username ?? randomUsername()).toLowerCase();
  if (!/^[a-z0-9_-]{4,32}$/.test(username)) {
    throw new AppError('INVALID_INPUT', 'Username must be 4-32 chars: a-z, 0-9, _ or -.');
  }
  if (input.password.length < 8) {
    throw new AppError('INVALID_INPUT', 'Password must be at least 8 characters.');
  }
  const existing = await prisma.account.findUnique({ where: { username } });
  if (existing) throw new AppError('CONFLICT', 'Username already taken.');

  const passwordHash = await hashPassword(input.password);
  const account = await prisma.account.create({
    data: { kind: 'anonymous', username, passwordHash },
  });
  const recoveryCodes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = newToken().slice(0, 12);
    recoveryCodes.push(code);
    await prisma.recoveryCode.create({
      data: { accountId: account.id, codeHash: hashCode(code) },
    });
  }
  return { accountId: account.id, username, recoveryCodes };
}

// S8: wrong username or wrong password returns one identical generic failure (SEC1);
// SEC16 rate limits apply unchanged (per username, per IP, per device cookie).
export async function signInAnonymous(
  input: {
    username: string;
    password: string;
  } & RateContext
): Promise<{ sessionToken: string; accountId: string }> {
  const username = input.username.trim().toLowerCase();
  const idHash = hashIdentifier(username);
  const penalty = await checkPenalty('email', idHash);
  if (!penalty.allowed) throw rateLimited(penalty.retryAfterMs ?? 60_000);
  const checks: [RateAxis, string, number, number][] = [
    ['email', idHash, 3, HOUR],
    ['ip', input.ip, 10, HOUR],
  ];
  if (input.deviceKey) checks.push(['device', input.deviceKey, 10, HOUR]);
  for (const [axis, key, limit, window] of checks) {
    const r = await consume(axis, key, limit, window);
    if (!r.allowed) throw rateLimited(r.retryAfterMs ?? window);
  }

  const account = await prisma.account.findUnique({ where: { username } });
  if (!account || !account.passwordHash || account.kind !== 'anonymous') {
    throw new AppError('INVALID_CODE', 'Invalid username or password.');
  }
  const ok = await verifyPassword(account.passwordHash, input.password);
  if (!ok) throw new AppError('INVALID_CODE', 'Invalid username or password.');

  const sessionToken = await createSession(account.id);
  return { sessionToken, accountId: account.id };
}

// S8: sensitive actions for anonymous accounts use a single-use recovery code
// instead of an emailed code (S4).
export async function verifyRecoveryCode(accountId: string, code: string): Promise<boolean> {
  const rows = await prisma.recoveryCode.findMany({ where: { accountId, usedAt: null } });
  for (const r of rows) {
    if (safeEqual(r.codeHash, hashCode(code))) {
      await prisma.recoveryCode.update({ where: { id: r.id }, data: { usedAt: now() } });
      return true;
    }
  }
  return false;
}

// S4: fresh emailed code within ten minutes for sensitive actions (email accounts).
export async function issueSensitiveCode(identifier: string): Promise<string> {
  const identifierHash = hashIdentifier(identifier);
  await prisma.signInCode.updateMany({
    where: { identifierHash, usedAt: null },
    data: { usedAt: now() },
  });
  const code = newNumericCode();
  await prisma.signInCode.create({
    data: {
      identifierHash,
      codeHash: hashCode(code),
      expiresAt: addMinutes(now(), 10),
    },
  });
  return code;
}

export async function verifySensitiveCode(identifier: string, code: string): Promise<boolean> {
  const identifierHash = hashIdentifier(identifier);
  const row = await prisma.signInCode.findFirst({
    where: { identifierHash, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt < now() || row.attempts >= CODE_MAX_ATTEMPTS) return false;
  if (safeEqual(row.codeHash, hashCode(code))) {
    await prisma.signInCode.update({ where: { id: row.id }, data: { usedAt: now() } });
    return true;
  }
  await prisma.signInCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  return false;
}
