import "server-only";
import { getSupplierLinkView, type SupplierLinkView } from "@ed/core/briefings";
import { makeCtx, type Ctx, type Locale } from "@ed/core/context";
import { checkPublicForm, FORM_STAMP_FIELD, HONEYPOT_FIELD } from "@ed/core/ratelimit";
import { getDb } from "@ed/db";
import { AppError, isAppError } from "@ed/shared/errors";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { formDataToObject, runAction, type ActionResult, type Translator } from "./action-core";
import { clientIpFrom } from "./client-ip";
import { guestTranslator } from "./guest";

// The scoped supplier link /s/[token] (S6, SEC2): no account, no cookie. The token alone
// decides which ONE booking is shown; the link's language decides the wording, with ?lang=ro|en
// as the one-tap switch. Unknown and revoked tokens get the same "not found" answer.

export const SUPPLIER_LANG_PARAM = "lang";

async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return clientIpFrom((name) => h.get(name));
}

export type SupplierRequest =
  | { status: "ok"; ctx: Ctx; view: SupplierLinkView; locale: Locale }
  | { status: "notFound" }
  | { status: "rateLimited"; retryAt: string | null };

/** Token → the view of exactly one booking. Memoised per request, token and language. */
export const resolveSupplierRequest = cache(async (token: string, requestedLang?: string, markViewed = false): Promise<SupplierRequest> => {
  const ip = await clientIp();
  const ctx = makeCtx(getDb(), { kind: "anonymous" }, { ip });
  try {
    const view = await getSupplierLinkView(ctx, token, { markViewed });
    if (!view) return { status: "notFound" };
    const locale: Locale = requestedLang === "ro" || requestedLang === "en" ? requestedLang : view.link.language;
    return { status: "ok", view, locale, ctx: makeCtx(getDb(), { kind: "anonymous" }, { ip, locale, now: ctx.now }) };
  } catch (e) {
    if (isAppError(e) && e.code === "RATE_LIMITED") {
      return { status: "rateLimited", retryAt: typeof e.details?.retryAt === "string" ? e.details.retryAt : null };
    }
    throw e;
  }
});

export function supplierHref(token: string, locale: Locale): string {
  return `/s/${token}?${SUPPLIER_LANG_PARAM}=${locale}`;
}

/** Fields every supplier-link form posts: the token, the page language and the bot guard. */
export const supplierFormFields = {
  token: z.string().min(22).max(128),
  lang: z.enum(["ro", "en"]).optional(),
  [HONEYPOT_FIELD]: z.string().max(500).optional(),
  [FORM_STAMP_FIELD]: z.string().max(200).optional(),
};

/**
 * Runs an action posted from the supplier link: applies the public-form guard (honeypot, time
 * floor, per-IP and per-link limits — SEC11) BEFORE the handler, and translates errors in the
 * page's language. The handler receives the anonymous request ctx; the core function it calls
 * resolves the token again itself (the token is the only credential).
 */
export async function runSupplierAction<S extends z.ZodType, R>(
  args: unknown[],
  opts: { schema: S; formKey: string; handler: (ctx: Ctx, input: z.output<S>) => Promise<R> },
): Promise<ActionResult<R>> {
  const rawInput = args.length >= 2 && args[1] instanceof FormData ? args[1] : args[0];
  const peek = (rawInput instanceof FormData ? formDataToObject(rawInput) : (rawInput ?? {})) as Record<string, unknown>;
  const token = typeof peek.token === "string" ? peek.token : "";
  const lang = typeof peek.lang === "string" ? peek.lang : undefined;

  let resolved: SupplierRequest | null = null;
  let failure: unknown = null;
  try {
    resolved = await resolveSupplierRequest(token, lang);
  } catch (e) {
    failure = e;
  }
  const locale: Locale = resolved?.status === "ok" ? resolved.locale : lang === "en" ? "en" : "ro";
  const t = guestTranslator(locale);
  const translator: Translator = { t: (key, params) => t(key as never, params as never), has: (key) => t.has(key as never) };
  return runAction({
    schema: opts.schema,
    rawInput,
    translator,
    options: { auth: "public" },
    rethrow: unstable_rethrow,
    getCtx: async () => {
      if (failure) throw failure;
      if (!resolved || resolved.status === "notFound") throw new AppError("NOT_FOUND", "briefing.errors.linkGone");
      if (resolved.status === "rateLimited") {
        throw new AppError("RATE_LIMITED", "common.errors.RATE_LIMITED", resolved.retryAt ? { retryAt: resolved.retryAt } : undefined);
      }
      return resolved.ctx;
    },
    handler: async (ctx, input) => {
      if (resolved?.status !== "ok") throw new AppError("NOT_FOUND", "briefing.errors.linkGone");
      await checkPublicForm(ctx, {
        formKey: opts.formKey,
        linkKey: resolved.view.link.linkKey,
        honeypot: typeof peek[HONEYPOT_FIELD] === "string" ? (peek[HONEYPOT_FIELD] as string) : "",
        renderedAt: typeof peek[FORM_STAMP_FIELD] === "string" ? (peek[FORM_STAMP_FIELD] as string) : null,
      });
      return opts.handler(ctx, input);
    },
  });
}
