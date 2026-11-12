import { NextResponse, type NextRequest } from 'next/server';
import { securityHeaders } from './app/lib/headers';

// Edge-safe randomness (WebCrypto is available in the edge runtime).
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Applies security headers (SEC5) to every response, ensures the disclosed device
// rate-limit cookie exists (SEC16 — a plain cookie, not a tracker, D1), and defaults
// the language cookie to ro-RO (L1).
export function middleware(request: NextRequest) {
  const nonce = randomHex(16);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(key, value);
  }

  if (!request.cookies.has('ed_device')) {
    response.cookies.set('ed_device', randomHex(16), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  if (!request.cookies.has('ed_lang')) {
    response.cookies.set('ed_lang', 'ro', {
      httpOnly: false, // language preference only; nothing security-relevant (SEC12)
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)'],
};
