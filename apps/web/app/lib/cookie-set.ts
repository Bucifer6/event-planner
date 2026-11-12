// LAU1: the in-app cookie notice lists exactly these three cookies (session, device
// rate-limit per SEC16, language preference) — none for tracking (D1). Kept in sync
// with packages/core/src/launch.ts (asserted by test/a11y-320.test.ts). Pure module —
// no node:crypto — so it is safe in the client bundle.
export const COOKIE_NAMES = ['ed_session', 'ed_device', 'ed_lang'] as const;
export const COOKIE_SET_SIGNATURE = 'lau1-v1:' + COOKIE_NAMES.join('|');
