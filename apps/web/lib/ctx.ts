import "server-only";
import { actorAccountId, makeCtx, type Actor, type Ctx } from "@ed/core/context";
import { getDb } from "@ed/db";
import { toLocale } from "@ed/i18n/config";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveActor } from "./session";

export const SIGN_IN_PATH = "/sign-in";

/**
 * Client IP as reported by the reverse proxy. Which header is trustworthy depends on the
 * hosting vendor (operator decision, INF9): TRUSTED_IP_HEADER names it, default
 * x-forwarded-for (first hop).
 */
async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  const name = (process.env.TRUSTED_IP_HEADER ?? "x-forwarded-for").toLowerCase();
  const value = h.get(name)?.split(",")[0]?.trim();
  return value || undefined;
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
 */
export async function requireCtx(): Promise<AccountCtx> {
  const ctx = await getCtx();
  const accountId = actorAccountId(ctx.actor);
  if (!accountId) redirect(SIGN_IN_PATH);
  return { ...ctx, accountId } as AccountCtx;
}
