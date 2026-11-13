// The cookies the app sets (LAU1). Client-safe: no imports.
// The in-app cookie notice lists EXACTLY these three and is shown again only when this set
// changes (the acknowledgement is stored under COOKIE_SET_SIGNATURE).
// Changing this list is a privacy change: update the public cookie notice at the same time.

export const APP_COOKIES = [
  { name: "ed_session", purpose: "session" },
  { name: "ed_device", purpose: "rateLimit" },
  { name: "ed_lang", purpose: "language" },
] as const;

export type AppCookiePurpose = (typeof APP_COOKIES)[number]["purpose"];

export function cookieSetSignature(names: readonly string[]): string {
  return `v1:${[...names].sort().join(",")}`;
}

/** "v1:ed_device,ed_lang,ed_session" — changes exactly when the cookie set changes. */
export const COOKIE_SET_SIGNATURE = cookieSetSignature(APP_COOKIES.map((c) => c.name));

/** localStorage key holding the acknowledged signature (nothing security-relevant, SEC12). */
export const COOKIE_NOTICE_STORAGE_KEY = "ed_cookie_notice";
