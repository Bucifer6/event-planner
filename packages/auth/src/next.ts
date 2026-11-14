// The sign-in return path: where a person goes after signing in when they came from an
// invitation, a claim or an enquiry button. It travels as `?next=` through the email-code
// flow, the one-tap link and the anonymous sign-in.
//
// OPEN-REDIRECT SAFETY: only a same-origin, relative path under one of the allowlisted
// prefixes is ever accepted; anything else is dropped (the person lands on /occasions as
// before). Validate with safeNextPath at EVERY hop — never trust a value because an earlier
// page validated it.

export const NEXT_PARAM = "next";
export const NEXT_PATH_PREFIXES = ["/invite/", "/claim/", "/directory/", "/occasions/", "/business/"] as const;
const MAX_NEXT_LENGTH = 500;
const BASE = "https://next.invalid";

/** The path to return to (pathname + query), or null when `value` is not a safe one. */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NEXT_LENGTH) return null;
  // one leading slash, never "//" or "/\" (protocol-relative), no backslashes, no control
  // characters or whitespace anywhere (browsers strip tabs/newlines inside URLs)
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f)) return null;
  }
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.username || url.password) return null;
  // the parser's own view of the path decides — after it resolved any "." / ".." segments
  const path = url.pathname;
  if (path.includes("//") || /%2f|%5c/i.test(path)) return null;
  if (!NEXT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix) && path.length > prefix.length)) return null;
  return `${path}${url.search}`;
}

/** `path` with `?next=` added when `next` is a safe return path; `path` unchanged otherwise. */
export function withNext(path: string, next: unknown): string {
  const safe = safeNextPath(next);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${NEXT_PARAM}=${encodeURIComponent(safe)}`;
}

/** Where to send someone who must sign in first and should come back to `path` afterwards. */
export function signInPathFor(path: unknown, signInPath = "/sign-in"): string {
  return withNext(signInPath, path);
}
