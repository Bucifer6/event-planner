'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@eventdesk/db';
import {
  createAnonymousAccount,
  issueSensitiveCode,
  requestSignInCode,
  signInAnonymous,
  verifySignInCode,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
} from '@eventdesk/auth';
import { sendMail, templates } from '@eventdesk/email';
import { AppError, isAppError } from '@eventdesk/shared';
import { clientIp, deviceKey, setSessionCookie, clearSessionCookie } from '../lib/session';

function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

function errorRedirect(path: string, e: unknown): never {
  if (isAppError(e)) {
    const retry = e.retryAfterMs ? ` ${Math.ceil(e.retryAfterMs / 60000)}m` : '';
    const key = e.code === 'RATE_LIMITED' ? `auth.errors.rate_limited` : 'auth.errors.invalid_code';
    redirect(
      `${path}&error=${encodeURIComponent(key)}${retry ? `&retry=${encodeURIComponent(retry)}` : ''}`
    );
  }
  throw e;
}

export async function requestCodeAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const h = await headers();
  try {
    await requestSignInCode({
      identifier: email,
      ip: clientIp(h),
      deviceKey: await deviceKey(),
      magicBaseUrl: `${appUrl()}/api/auth/magic`,
      sendSignInEmail: async (identifier, code, magicUrl) => {
        const mail = templates.signInEmail({ code, magicUrl, appUrl: appUrl() });
        await sendMail({
          to: identifier,
          subject: mail.subject,
          text: mail.text,
          template: 'sign-in-code',
        });
      },
    });
  } catch (e) {
    errorRedirect(`/signin?sent=1`, e);
  }
  redirect(`/signin/code?identifier=${encodeURIComponent(email)}&sent=1`);
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get('identifier') ?? '');
  const code = String(formData.get('code') ?? '');
  const h = await headers();
  try {
    const result = await verifySignInCode({
      identifier,
      code,
      ip: clientIp(h),
      deviceKey: await deviceKey(),
    });
    await setSessionCookie(result.sessionToken);
  } catch (e) {
    errorRedirect(`/signin/code?identifier=${encodeURIComponent(identifier)}`, e);
  }
  redirect('/dashboard');
}

export async function anonymousSignInAction(formData: FormData): Promise<void> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  const h = await headers();
  try {
    const result = await signInAnonymous({
      username,
      password,
      ip: clientIp(h),
      deviceKey: await deviceKey(),
    });
    await setSessionCookie(result.sessionToken);
  } catch (e) {
    errorRedirect('/signin?', e);
  }
  redirect('/dashboard');
}

export async function createAnonymousAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const { accountId, username, recoveryCodes } = await createAnonymousAccount({ password });
  const { createSession } = await import('@eventdesk/auth');
  const sessionToken = await createSession(accountId);
  await setSessionCookie(sessionToken);
  const { cookies } = await import('next/headers');
  const store = await cookies();
  // Recovery codes are shown exactly once (S8): short-lived httpOnly cookie, cleared
  // by the account page after display.
  store.set('ed_recovery', JSON.stringify({ username, recoveryCodes }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  redirect('/account');
}

// Clears the one-time recovery-codes flash cookie (S8). Cookie mutation is only
// allowed in a Server Action — never during page render.
export async function dismissRecoveryAction(): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.delete('ed_recovery');
}

export async function signOutAction(): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  await clearSessionCookie();
  redirect('/signin');
}

export async function signOutEverywhereAction(accountId: string): Promise<void> {
  await revokeAllSessions(accountId); // SEC3: also revokes all MCP tokens
  await clearSessionCookie();
  redirect('/signin');
}

// S4: sensitive actions need a fresh emailed code within ten minutes.
export async function requestSensitiveCodeAction(accountId: string): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const identifier = account.email ?? account.username ?? '';
  const code = await issueSensitiveCode(identifier);
  if (account.email) {
    const mail = templates.signInEmail({ code, magicUrl: '', appUrl: appUrl() });
    await sendMail({
      to: account.email,
      subject: `Cod pentru acțiune sensibilă / Code for a sensitive action`,
      text: mail.text,
      template: 'sensitive-code',
    });
  }
  return code; // dev/test convenience; production sends by email only
}
