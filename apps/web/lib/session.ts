import "server-only";
import { DEVICE_COOKIE, resolveSession, safeNextPath, SESSION_COOKIE, withNext, type SessionInfo } from "@ed/auth";
import { makeCtx, type AccountActor, type Actor } from "@ed/core/context";
import { getDb } from "@ed/db";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, toLocale } from "@ed/i18n/config";
import { randomToken } from "@ed/shared/ids";
import { cookies, headers } from "next/headers";
import { cache } from "react";

// The auth seam of the web app (S3, SEC12). Cookies used by the whole application — exactly
// the three the cookie notice lists (LAU1):
//   ed_session  the session: Secure (production), HttpOnly, SameSite=Lax; value stored hashed
//   ed_device   SEC16 rate-limit device id: a plain random id, disclosed on the sign-in page
//   ed_lang     language preference
// Nothing security-relevant is kept in localStorage.

/** Where a person lands after signing in. */
export const AFTER_SIGN_IN_PATH = "/occasions";
export const SIGN_IN_PATH = "/sign-in";
export const TWO_STEP_PATH = "/sign-in/two-step";

/** The account actor as this app builds it: the session id rides along for S4 checks. */
export type SessionActor = AccountActor & { sessionId: string };

function secureCookies(): boolean {
  // Secure in production. A production build smoke-tested on http://localhost keeps working.
  return process.env.NODE_ENV === "production" && !(process.env.APP_URL ?? "").startsWith("http://");
}

/** Raw cookie value, or undefined. */
export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * The session behind the cookie, including one still waiting for its second factor
 * (`secondFactorPending`). Never throws: any problem reads as "no session". Memoised per
 * request; refreshes last-seen at most once every five minutes.
 */
export const getCurrentSession = cache(async (): Promise<SessionInfo | null> => {
  try {
    const token = await getSessionToken();
    if (!token) return null;
    const ctx = makeCtx(getDb(), { kind: "anonymous" });
    return await resolveSession(ctx, token, { allowPending: true });
  } catch (e) {
    console.error("[session] could not resolve the session", e instanceof Error ? e.message : e);
    return null;
  }
});

/**
 * Who is making this request: the signed-in account, or null. Never throws and never
 * redirects (requireCtx() in lib/ctx.ts redirects). Guest links and MCP build their own actors.
 */
export async function resolveActor(): Promise<Actor | null> {
  const session = await getCurrentSession();
  if (!session || session.secondFactorPending) return null;
  const actor: SessionActor = { kind: "account", accountId: session.accountId, sessionId: session.id };
  return actor;
}

/** Server Actions and Route Handlers only (cookies cannot be set while rendering a page). */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** The SEC16 device id, if this browser already has one. */
export async function getDeviceId(): Promise<string | undefined> {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value;
  return value && value.length >= 16 && value.length <= 100 ? value : undefined;
}

/** Reads the device id, creating the cookie when missing (Server Actions / Route Handlers). */
export async function ensureDeviceId(): Promise<string> {
  const existing = await getDeviceId();
  if (existing) return existing;
  const id = randomToken(16);
  (await cookies()).set(DEVICE_COOKIE, id, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}

export async function requestUserAgent(): Promise<string | undefined> {
  return (await headers()).get("user-agent")?.slice(0, 1000) ?? undefined;
}

/** Language cookie (L2). Server Actions / Route Handlers only. */
export async function setLanguageCookie(locale: string): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, toLocale(locale), {
    httpOnly: false,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Where a signed-in person goes: the return path they came with (`?next=`, an invitation,
 * a claim, an enquiry button) when it is a safe same-origin path — see safeNextPath in
 * @ed/auth — and /occasions otherwise. Never redirect to a `next` value without this.
 */
export function afterSignInPath(next?: unknown): string {
  return safeNextPath(next) ?? AFTER_SIGN_IN_PATH;
}

/**
 * After a successful first factor: store the session cookie and, when this browser has no
 * language chosen yet, adopt the account's saved language. Returns where to go next (the
 * safe return path, if one was carried through the flow).
 */
export async function applySignIn(
  result: {
    token: string;
    expiresAt: Date;
    secondFactorRequired?: boolean;
    locale?: string;
  },
  next?: unknown,
): Promise<string> {
  await setSessionCookie(result.token, result.expiresAt);
  if (result.locale && !(await cookies()).get(LOCALE_COOKIE)) await setLanguageCookie(result.locale);
  return result.secondFactorRequired ? withNext(TWO_STEP_PATH, next) : afterSignInPath(next);
}
