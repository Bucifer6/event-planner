import "server-only";
import { makeCtx, type Ctx, type Locale } from "@ed/core/context";
import { getDb } from "@ed/db";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { formDataToObject, runAction, type ActionResult, type Translator } from "@/lib/action-core";
import { clientIpFrom } from "@/lib/client-ip";
import { guestTranslator } from "@/lib/guest";

// The public event page (/e/<slug>) never depends on an account or a cookie: the visitor is
// always the anonymous actor — also when a signed-in planner opens the page — and the
// language is the ?lang= of the address (Romanian by default). Wording therefore comes from
// guestTranslator(locale), exactly like the guest link.

export const PUBLIC_LANG_PARAM = "lang";

export function publicLocale(requested: string | string[] | undefined): Locale {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return value === "en" ? "en" : "ro";
}

async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return clientIpFrom((name) => h.get(name));
}

export async function publicCtx(locale: Locale): Promise<Ctx> {
  return makeCtx(getDb(), { kind: "anonymous" }, { ip: await clientIp(), locale });
}

export function publicHref(slug: string, locale: Locale, extra: Record<string, string> = {}, hash = ""): string {
  const q = new URLSearchParams({ [PUBLIC_LANG_PARAM]: locale, ...extra });
  return `/e/${slug}?${q.toString()}${hash}`;
}

export function manageHref(slug: string, token: string, locale: Locale, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ [PUBLIC_LANG_PARAM]: locale, ...extra });
  return `/e/${slug}/r/${token}?${q.toString()}`;
}

/**
 * Runs an action posted from the public page: anonymous Ctx, errors translated in the PAGE's
 * language (the hidden `lang` field). The bot guard lives in the core function it calls.
 */
export async function runPublicAction<S extends z.ZodType, R>(
  args: unknown[],
  opts: { schema: S; handler: (ctx: Ctx, input: z.output<S>, locale: Locale) => Promise<R> },
): Promise<ActionResult<R>> {
  const rawInput = args.length >= 2 && args[1] instanceof FormData ? args[1] : args[0];
  const peek = (rawInput instanceof FormData ? formDataToObject(rawInput) : (rawInput ?? {})) as Record<string, unknown>;
  const locale = publicLocale(typeof peek.lang === "string" ? peek.lang : undefined);
  const t = guestTranslator(locale);
  const translator: Translator = { t: (key, params) => t(key, params), has: (key) => t.has(key) };
  return runAction({
    schema: opts.schema,
    rawInput,
    translator,
    options: { auth: "public" },
    rethrow: unstable_rethrow,
    getCtx: () => publicCtx(locale),
    handler: (ctx, input) => opts.handler(ctx, input, locale),
  });
}
