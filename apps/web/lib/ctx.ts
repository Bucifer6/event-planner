import "server-only";
import { signInPathFor } from "@ed/auth";
import { actorAccountId, makeCtx, type Actor, type Ctx } from "@ed/core/context";
import { getDb } from "@ed/db";
import { toLocale } from "@ed/i18n/config";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clientIpFrom } from "./client-ip";
import { resolveActor } from "./session";

export const SIGN_IN_PATH = "/sign-in";

/**
 * Client IP as reported by the reverse proxy. Which header is trustworthy depends on the
 * hosting vendor (operator decision, INF9): TRUSTED_IP_HEADER names it, default
 * x-forwarded-for — the entry our own ingress appended, never one the client sent
 * (see lib/client-ip.ts).
 */
async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return clientIpFrom((name) => h.get(name));
}

/**
 * The request's Ctx for calling @ed/core. Memoised per request, so Server Components,
 * layouts and actions in one request share the same actor and the same `now`.
 * When nobody is signed in the actor is { kind: "anonymous" }.
 */
export const getCtx = cache(async (): Promise<Ctx> => {
  const [actor, locale, ip] = await Promise.all([resolveActor(), getLocale(), clientIp()]);
  return makeCtx(getDb(), actor ?? { kind: "anonymous" }, { ip, locale: toLocale(locale) });
});

/** A Ctx whose actor is guaranteed to carry an account. */
export type AccountCtx = Ctx & { actor: Extract<Actor, { accountId: string }>; accountId: string };

/**
 * Like getCtx(), but redirects to /sign-in when there is no account actor.
 * Use it in every (app) page/layout; `ctx.accountId` is the signed-in account.
 * The page that was asked for (set by proxy.ts) rides along as `?next=` when it is one of
 * the allowlisted return paths (/occasions/…, /business/… — e.g. a business invitation), so
 * the person lands back on it after signing in.
 */
export async function requireCtx(): Promise<AccountCtx> {
  const ctx = await getCtx();
  const accountId = actorAccountId(ctx.actor);
  if (!accountId) redirect(signInPathFor((await headers()).get("x-ed-path"), SIGN_IN_PATH));
  return { ...ctx, accountId } as AccountCtx;
}
