// R0-02/SEC13: boot-time env validation. Production refuses to boot with missing
// required env; only the NAMES are ever reported, never a value. Self-contained on
// purpose: this file is compiled into a webpack bundle, so it must not import
// @eventdesk/shared (which pulls node:crypto). The canonical, unit-tested
// implementation lives in packages/shared/src/env.ts (assertBootEnv).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.APP_ENV !== 'production') return;
  const required = ['DATABASE_URL', 'APP_URL'];
  const missing = required.filter((k) => !process.env[k] || process.env[k] === '');
  if (missing.length > 0) {
    throw new Error(`Refusing to boot in production: missing required env: ${missing.join(', ')}`);
  }
}
