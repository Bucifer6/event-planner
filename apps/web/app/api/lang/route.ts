import { NextResponse } from 'next/server';
import { assertSameOrigin } from '../../lib/csrf';

// L2: language toggle changes wording only, never data.
export async function POST(request: Request) {
  assertSameOrigin(request);
  const form = await request.formData();
  const lang = form.get('lang');
  const res = NextResponse.json({ ok: true });
  res.cookies.set('ed_lang', lang === 'en' ? 'en' : 'ro', {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  return res;
}
