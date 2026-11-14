import { AppError } from "@ed/shared/errors";

// CSRF protection for Route Handlers (SEC6). Server Actions are covered by Next's own
// Origin check; EVERY state-changing route handler (POST/PUT/PATCH/DELETE) that relies on the
// session cookie must start with:
//
//   const denied = sameOriginOr403(request);
//   if (denied) return denied;
//
// (or call assertSameOrigin(request) inside a try/catch that maps AppError). Endpoints that
// authenticate with their own secret instead of the cookie (webhooks, MCP bearer tokens) do
// not use this — they must not read the session cookie at all.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(url: string | undefined | null): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** True when the request provably comes from the app's own pages. */
export function isSameOrigin(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const h = request.headers;
  const origin = h.get("origin");
  if (origin) {
    const sent = originOf(origin);
    if (!sent) return false; // "null" (sandboxed / cross-origin redirect) or garbage
    if (sent === originOf(env.APP_URL)) return true;
    // same host as the one this request was addressed to (covers previews and localhost)
    const host = (h.get("x-forwarded-host") ?? h.get("host"))?.split(",")[0]?.trim().toLowerCase();
    return Boolean(host) && new URL(sent).host.toLowerCase() === host;
  }
  // No Origin header: only trust the browser's own statement that it is same-origin.
  return h.get("sec-fetch-site") === "same-origin";
}

/** Throws AppError FORBIDDEN (platform.errors.csrf) unless the request is same-origin. */
export function assertSameOrigin(request: Request, env?: Record<string, string | undefined>): void {
  if (!isSameOrigin(request, env)) throw new AppError("FORBIDDEN", "platform.errors.csrf");
}

/** Returns a 403 response to send back, or null when the request may proceed. */
export function sameOriginOr403(request: Request, env?: Record<string, string | undefined>): Response | null {
  if (isSameOrigin(request, env)) return null;
  return Response.json(
    { ok: false, error: { code: "FORBIDDEN" } },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
