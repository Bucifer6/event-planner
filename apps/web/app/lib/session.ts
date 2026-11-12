import { cookies } from 'next/headers';
import { prisma } from '@eventdesk/db';
import { validateSession, SESSION_COOKIE, DEVICE_COOKIE } from '@eventdesk/auth';
import { AppError } from '@eventdesk/shared';

export interface CurrentUser {
  accountId: string;
  email: string | null;
  username: string | null;
  kind: 'email' | 'anonymous';
  locale: string;
}

export async function currentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await validateSession(token);
  if (!session) return null;
  const account = await prisma.account.findUnique({ where: { id: session.accountId } });
  if (!account) return null;
  return {
    accountId: account.id,
    email: account.email,
    username: account.username,
    kind: account.kind,
    locale: account.locale,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
  return user;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
}

export async function deviceKey(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(DEVICE_COOKIE)?.value;
}

export function clientIp(headersList: Headers): string {
  return headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}
