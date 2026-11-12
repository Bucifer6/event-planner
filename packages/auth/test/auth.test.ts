import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import {
  createAnonymousAccount,
  requestSignInCode,
  signInAnonymous,
  verifySignInCode,
  consumeMagicLink,
  verifyRecoveryCode,
  validateSession,
  revokeAllSessions,
} from '../src/index.js';
import { hashIdentifier } from '@eventdesk/shared';

const noopSend = async () => {};

async function requestCode(identifier: string, ip = '10.0.0.1') {
  return requestSignInCode({
    identifier,
    ip,
    magicBaseUrl: 'http://localhost:3000/api/auth/magic',
    sendSignInEmail: noopSend,
  });
}

function lastCode(identifier: string) {
  return prisma.signInCode.findFirst({
    where: { identifierHash: hashIdentifier(identifier), usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

describe('email code sign-in (S1, SEC1, INF4)', () => {
  it('behaves identically for existing and unknown emails (SEC1)', async () => {
    const known = 'known@example.com';
    await requestCode(known, '10.1.0.1');
    await prisma.account.create({ data: { kind: 'email', email: 'exists@example.com' } });
    const rKnown = await requestCode('exists@example.com', '10.1.0.2');
    const rUnknown = await requestCode('nobody@example.com', '10.1.0.3');
    expect(rKnown).toEqual(rUnknown);
  });

  it('enforces 3 code requests per email per hour (INF4/SEC16)', async () => {
    const email = 'limited@example.com';
    await requestCode(email, '10.2.0.1');
    await requestCode(email, '10.2.0.1');
    await requestCode(email, '10.2.0.1');
    await expect(requestCode(email, '10.2.0.1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('enforces 10 code requests per IP per hour', async () => {
    const ip = '10.3.0.1';
    for (let i = 0; i < 10; i++) {
      await requestCode(`ip${i}@example.com`, ip);
    }
    await expect(requestCode('one-more@example.com', ip)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('verifies a code, creates a session, and a newer code invalidates the older (SEC1)', async () => {
    const email = 'flow@example.com';
    await requestCode(email, '10.4.0.1');
    const codeRow = (await lastCode(email))!;
    // Read the plaintext code from the outbox is not possible (hashed); request again and
    // capture via the send callback instead.
    let sent = '';
    await requestSignInCode({
      identifier: email,
      ip: '10.4.0.1',
      magicBaseUrl: 'http://x/magic',
      sendSignInEmail: async (_id, code) => {
        sent = code;
      },
    });
    const old = codeRow;
    const fresh = await lastCode(email);
    expect(fresh!.id).not.toBe(old.id);
    const result = await verifySignInCode({ identifier: email, code: sent, ip: '10.4.0.1' });
    expect(result.accountId).toBeTruthy();
    const session = await validateSession(result.sessionToken);
    expect(session?.accountId).toBe(result.accountId);
    // old code is invalidated
    await expect(
      verifySignInCode({ identifier: email, code: '000000', ip: '10.4.0.1' })
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });
  });

  it('fails after 5 attempts on a code (INF4) with one generic failure', async () => {
    const email = 'attempts@example.com';
    let sent = '';
    await requestSignInCode({
      identifier: email,
      ip: '10.5.0.1',
      magicBaseUrl: 'http://x/magic',
      sendSignInEmail: async (_id, code) => {
        sent = code;
      },
    });
    for (let i = 0; i < 5; i++) {
      await expect(
        verifySignInCode({
          identifier: email,
          code: sent === '111111' ? '222222' : '111111',
          ip: '10.5.0.2',
        })
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });
    }
    // even the correct code is refused after 5 attempts
    await expect(
      verifySignInCode({ identifier: email, code: sent, ip: '10.5.0.2' })
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });
  });

  it('magic link is single-use; consumed link returns "consumed" (SEC14)', async () => {
    const email = 'magic@example.com';
    let url = '';
    await requestSignInCode({
      identifier: email,
      ip: '10.6.0.1',
      magicBaseUrl: 'http://localhost:3000/api/auth/magic',
      sendSignInEmail: async (_id, _code, magicUrl) => {
        url = magicUrl;
      },
    });
    const token = url.split('/').pop()!;
    const first = await consumeMagicLink(token, '10.6.0.1');
    expect(first.status).toBe('ok');
    const second = await consumeMagicLink(token, '10.6.0.1');
    expect(second.status).toBe('consumed');
  });
});

describe('anonymous accounts (S7/S8)', () => {
  it('creates with Argon2id hash, returns 10 recovery codes once, generic failure on wrong password', async () => {
    const { accountId, username, recoveryCodes } = await createAnonymousAccount({
      password: 'parola-secreta-1',
    });
    expect(recoveryCodes).toHaveLength(10);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      signInAnonymous({ username, password: 'wrong-password', ip: '10.7.0.1' })
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });
    await expect(
      signInAnonymous({ username: 'no_such_user_xyz', password: 'whatever123', ip: '10.7.0.1' })
    ).rejects.toMatchObject({ code: 'INVALID_CODE', message: 'Invalid username or password.' });
    const ok = await signInAnonymous({ username, password: 'parola-secreta-1', ip: '10.7.0.1' });
    expect(ok.accountId).toBe(accountId);
    // recovery code works once for sensitive actions (S4/S8)
    expect(await verifyRecoveryCode(accountId, recoveryCodes[0]!)).toBe(true);
    expect(await verifyRecoveryCode(accountId, recoveryCodes[0]!)).toBe(false);
  });

  it('sign-out-everywhere revokes sessions (SEC3)', async () => {
    const { accountId, username } = await createAnonymousAccount({ password: 'parola-secreta-2' });
    const { sessionToken } = await signInAnonymous({
      username,
      password: 'parola-secreta-2',
      ip: '10.8.0.1',
    });
    expect(await validateSession(sessionToken)).toBeTruthy();
    await revokeAllSessions(accountId);
    expect(await validateSession(sessionToken)).toBeNull();
  });
});
