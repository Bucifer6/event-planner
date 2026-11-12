import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeSession, SESSION_COOKIE } from '@eventdesk/auth';
import { assertSameOrigin } from '../../../lib/csrf';

// SEC6: state-changing route handlers verify the Origin header.
export async function POST(request: Request) {
  assertSameOrigin(request);
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
  return res;
}
