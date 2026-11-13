// Security headers for the web app (SEC5, R0-09). Pure functions: used by proxy.ts on every
// request and asserted by test/headers.test.ts at each release.

export type CspOptions = {
  nonce: string;
  /** next dev needs eval (React refresh) and injects <style> tags. Never true in production. */
  dev?: boolean;
  /** Adds upgrade-insecure-requests (real production over https). */
  upgradeInsecure?: boolean;
};

/**
 * Strict, nonce-based Content-Security-Policy: no inline scripts, no third-party origins.
 * - scripts: only ones carrying this request's nonce (Next adds it to its own tags) and what
 *   they load ('strict-dynamic'); 'self' is the fallback for browsers without it
 * - styles: own stylesheets; `style-src-attr` allows React style={{…}} attributes only
 *   (used by @ed/ui meters/skeletons) — an attribute cannot run script
 * - images: own origin, data: and blob: (local preview of a file being uploaded)
 * - nothing may frame the app; forms post only to the app
 */
export function buildCsp({ nonce, dev = false, upgradeInsecure = false }: CspOptions): string {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce)) throw new Error("CSP nonce missing or malformed");
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", dev ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`]],
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (upgradeInsecure) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

export type SecurityHeaderOptions = CspOptions & {
  /** HSTS is sent in production only (never on a developer's http://localhost). */
  production?: boolean;
};

/** The full response header set for an app page. */
export function securityHeaders(opts: SecurityHeaderOptions): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(opts),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(opts.production ? { "Strict-Transport-Security": HSTS_VALUE } : {}),
  };
}

/** 128 bits of randomness, base64. Works in the proxy runtime (Web Crypto). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Splits a CSP string into { directive: [values] } (tests, debugging). */
export function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = values;
  }
  return out;
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * SEC4: the media origin serves uploaded files and nothing else. True when this request
 * arrived on the media host (and that host is not also the app host) for any other path.
 */
export function isForbiddenOnMediaHost(
  requestHost: string | null,
  pathname: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const media = hostOf(env.MEDIA_URL);
  const app = hostOf(env.APP_URL);
  if (!media || !requestHost || media === app) return false;
  if (requestHost.toLowerCase() !== media) return false;
  return !pathname.startsWith("/api/media/");
}
