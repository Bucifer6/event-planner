import { areLegalDocsPublished, LEGAL_PUBLISHED_SETTING } from "@ed/core/compliance";
import type { Ctx } from "@ed/core/context";
import { readSetting } from "@ed/core/staff";
import { AppError } from "@ed/shared/errors";

// LAU1: no account can be CREATED before the terms, the privacy policy and the cookie notice
// are published (recorded in the console under Launch → legal documents). Existing accounts
// keep signing in — only the two places that insert a new account ask this gate:
// the first confirmation of an email address (completeEmailSignIn) and anonymous sign-up.
//
// Local first run: while NOTHING has been recorded yet and APP_URL points at this machine
// (localhost / 127.0.0.1 / [::1], or APP_URL is unset), sign-up is allowed so a fresh
// development setup is not blocked. Any real host, or any recorded setting, uses the gate.

export const SIGNUPS_CLOSED_KEY = "auth.errors.signupsClosed";

type Env = Record<string, string | undefined>;

function isLocalAppUrl(env: Env): boolean {
  const raw = env.APP_URL;
  if (!raw) return env.NODE_ENV !== "production";
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/** Whether a new account may be created right now. Reveals only that — safe to show anyone. */
export async function isSignupOpen(ctx: Pick<Ctx, "db" | "now">, env: Env = process.env): Promise<boolean> {
  if (await areLegalDocsPublished(ctx)) return true;
  if (!isLocalAppUrl(env)) return false;
  return (await readSetting(ctx, LEGAL_PUBLISHED_SETTING)) === null;
}

/** Throws FORBIDDEN `auth.errors.signupsClosed` while sign-up is closed (LAU1). */
export async function assertSignupOpen(ctx: Pick<Ctx, "db" | "now">, env: Env = process.env): Promise<void> {
  if (!(await isSignupOpen(ctx, env))) throw new AppError("FORBIDDEN", SIGNUPS_CLOSED_KEY);
}
