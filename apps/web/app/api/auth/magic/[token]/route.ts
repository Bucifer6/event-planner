import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { consumeMagicLink, SESSION_COOKIE } from '@eventdesk/auth';
import { clientIp } from '../../../../lib/session';

// S1/SEC14: single-use one-tap sign-in link. If a mail scanner already consumed it,
// the code in the same email still works and this page offers one rate-limited new
// code request.
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const h = await headers();
  const result = await consumeMagicLink(token, clientIp(h));
  const base = process.env.APP_URL ?? new URL(request.url).origin;
  if (result.status === 'ok') {
    const res = NextResponse.redirect(`${base}/dashboard`);
    res.cookies.set(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });
    return res;
  }
  return NextResponse.redirect(`${base}/signin?magic=${result.status}`);
}
