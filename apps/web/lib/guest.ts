import "server-only";
import "@ed/core/polls"; // registers the "polls" guest section
import "@ed/core/contributions"; // registers the "contributions" guest section
import "@ed/core/seating"; // registers the "seat" and "spaceView" guest sections
import { makeCtx, type Ctx, type Locale } from "@ed/core/context";
import { resolveGuestLink, type GuestLink } from "@ed/core/invitations";
import { checkPublicForm, FORM_STAMP_FIELD, HONEYPOT_FIELD } from "@ed/core/ratelimit";
import { getDb } from "@ed/db";
import { AppError, isAppError } from "@ed/shared/errors";
import { DISPLAY_TIME_ZONE, loadMessages } from "@ed/i18n";
import { createTranslator } from "next-intl";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { formDataToObject, runAction, type ActionResult, type Translator } from "./action-core";

// Guest actor resolution for /g/[token] (S6, SEC2, L2).
//
// The guest page never depends on an account or on a cookie: who is asking is decided by the
// link token alone, and the language by the invitation (with ?lang=ro|en as the one-tap
// switch — it changes wording only, never data).
//
// Later releases that add guest sections (seating, programme, menu…) import their core module
// here for its registerGuestSection() side effect and add a renderer in g/[token]/sections.tsx.

export const GUEST_LANG_PARAM = "lang";

async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  const name = (process.env.TRUSTED_IP_HEADER ?? "x-forwarded-for").toLowerCase();
  return h.get(name)?.split(",")[0]?.trim() || undefined;
}

export type GuestRequest =
  | { status: "ok"; ctx: Ctx; link: GuestLink; locale: Locale }
  /** unknown, revoked and expired links are indistinguishable on purpose */
  | { status: "notFound" }
  | { status: "rateLimited"; retryAt: string | null };

export function guestLocale(link: Pick<GuestLink, "language">, requested: string | string[] | undefined): Locale {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return value === "ro" || value === "en" ? value : link.language;
}

/** Token -> the guest Ctx of exactly one household. Memoised per request and token. */
export const resolveGuestRequest = cache(async (token: string, requestedLang?: string): Promise<GuestRequest> => {
  const ip = await clientIp();
  const anonymous = makeCtx(getDb(), { kind: "anonymous" }, { ip });
  try {
    const link = await resolveGuestLink(anonymous, token);
    if (!link) return { status: "notFound" };
    const locale = guestLocale(link, requestedLang);
    return { status: "ok", link, locale, ctx: makeCtx(getDb(), link.actor, { ip, locale, now: anonymous.now }) };
  } catch (e) {
    if (isAppError(e) && e.code === "RATE_LIMITED") {
      return { status: "rateLimited", retryAt: typeof e.details?.retryAt === "string" ? e.details.retryAt : null };
    }
    throw e;
  }
});

export function guestHref(token: string, locale: Locale, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ [GUEST_LANG_PARAM]: locale, ...extra });
  return `/g/${token}?${q.toString()}`;
}

/* ── Server Actions called from the guest link ───────────────────────────── */


/** Fields every guest form posts: the link token, the page language and the SEC11 bot guard. */
export const guestFormFields = {
  token: z.string().min(22).max(128),
  lang: z.enum(["ro", "en"]).optional(),
  [HONEYPOT_FIELD]: z.string().max(500).optional(),
  [FORM_STAMP_FIELD]: z.string().max(200).optional(),
};

/**
 * Runs a guest-link action: resolves the token to the household's guest Ctx (same "not found"
 * for unknown / revoked / expired), applies the public-form guard (honeypot, time floor,
 * per-IP and per-link limits — SEC11) and translates errors in the PAGE's language, not the
 * cookie's. Results have the same shape as action() from lib/action.
 */
export async function runGuestAction<S extends z.ZodType, R>(
  args: unknown[],
  opts: { schema: S; formKey: string; minSeconds?: number; handler: (ctx: Ctx, input: z.output<S>) => Promise<R> },
): Promise<ActionResult<R>> {
  const rawInput = args.length >= 2 && args[1] instanceof FormData ? args[1] : args[0];
  const peek = (rawInput instanceof FormData ? formDataToObject(rawInput) : (rawInput ?? {})) as Record<string, unknown>;
  const token = typeof peek.token === "string" ? peek.token : "";
  const lang = typeof peek.lang === "string" ? peek.lang : undefined;

  let resolved: GuestRequest | null = null;
  let failure: unknown = null;
  try {
    resolved = await resolveGuestRequest(token, lang);
  } catch (e) {
    failure = e;
  }
  const locale: Locale = resolved?.status === "ok" ? resolved.locale : lang === "en" ? "en" : "ro";
  const t = guestTranslator(locale);
  const translator: Translator = {
    t: (key, params) => t(key as never, params as never),
    has: (key) => t.has(key as never),
  };
  return runAction({
    schema: opts.schema,
    rawInput,
    translator,
    options: { auth: "public" },
    rethrow: unstable_rethrow,
    getCtx: async () => {
      if (failure) throw failure;
      if (!resolved || resolved.status === "notFound") throw new AppError("NOT_FOUND", "rsvp.errors.linkGone");
      if (resolved.status === "rateLimited") {
        throw new AppError("RATE_LIMITED", "common.errors.RATE_LIMITED", resolved.retryAt ? { retryAt: resolved.retryAt } : undefined);
      }
      return resolved.ctx;
    },
    handler: async (ctx, input) => {
      if (resolved?.status !== "ok") throw new AppError("NOT_FOUND", "rsvp.errors.linkGone");
      await checkPublicForm(ctx, {
        formKey: opts.formKey,
        linkKey: resolved.link.linkKey,
        honeypot: typeof peek[HONEYPOT_FIELD] === "string" ? (peek[HONEYPOT_FIELD] as string) : "",
        renderedAt: typeof peek[FORM_STAMP_FIELD] === "string" ? (peek[FORM_STAMP_FIELD] as string) : null,
        minSeconds: opts.minSeconds,
      });
      return opts.handler(ctx, input);
    },
  });
}

/**
 * Which wording a number of children takes ("+1 copil", "+3 copii", "+20 de copii").
 * Message keys end in None / One / Few / Many; the count is the only thing ever said about
 * children (invariant 9).
 */
export function childrenForm(count: number): "None" | "One" | "Few" | "Many" {
  if (count <= 0) return "None";
  if (count === 1) return "One";
  const lastTwo = count % 100;
  return lastTwo === 0 || lastTwo >= 20 ? "Many" : "Few";
}

/**
 * Translator bound to the LINK's language. The app's request config reads the language from
 * the ed_lang cookie; the guest page must not depend on it (L2), so its wording is looked up
 * directly: `guestTranslator(locale, "rsvp")("form.send")`.
 */
export function guestTranslator(locale: Locale, namespace?: string) {
  return createTranslator({
    locale,
    messages: loadMessages(locale) as never,
    namespace: namespace as never,
    timeZone: DISPLAY_TIME_ZONE,
  }) as unknown as {
    (key: string, params?: Record<string, string | number>): string;
    has(key: string): boolean;
    raw(key: string): unknown;
  };
}
