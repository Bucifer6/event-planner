import { NextResponse, type NextRequest } from "next/server";
import { generateNonce, isForbiddenOnMediaHost, securityHeaders } from "./lib/security";

// Next 16 "proxy" (formerly middleware): runs before every page and API request.
// - a fresh nonce per request and the strict Content-Security-Policy built from it (SEC5).
//   The policy is also put on the REQUEST headers: that is how Next learns the nonce and adds
//   it to its own <script> tags, so the app hydrates without any inline-script allowance.
// - HSTS (production), nosniff, same-origin referrer policy, no framing
// - the media host serves /api/media/* and nothing else (SEC4)
// Server Components can read the nonce with (await headers()).get("x-nonce") if they ever
// need to render a <script nonce>.

const production = process.env.NODE_ENV === "production";
const dev = process.env.NODE_ENV === "development";

function isLocal(host: string | null): boolean {
  const name = (host ?? "").replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

export function proxy(request: NextRequest): NextResponse {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))
    ?.split(",")[0]
    ?.trim() ?? null;
  const { pathname } = request.nextUrl;

  if (isForbiddenOnMediaHost(host, pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
    });
  }

  const nonce = generateNonce();
  const headersOut = securityHeaders({
    nonce,
    dev,
    production,
    upgradeInsecure: production && !isLocal(host),
  });

  // The media route sets its own, tighter policy (sandbox) — do not replace it.
  const isMedia = pathname.startsWith("/api/media/");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  if (!isMedia) requestHeaders.set("Content-Security-Policy", headersOut["Content-Security-Policy"]!);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headersOut)) {
    if (isMedia && name === "Content-Security-Policy") continue;
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except build assets, the static PWA files and the upload endpoint
      // (the proxy buffers request bodies; uploads must stream straight to the route —
      // that route does its own same-origin and size checks and returns JSON only).
      source: "/((?!_next/static|_next/image|api/uploads|icons/|sw\\.js|favicon\\.ico).*)",
    },
  ],
};
