import { actorAccountId, type Ctx } from "@ed/core/context";
import { describeError, isAppError, type AppErrorCode } from "@ed/shared/errors";
import { z } from "zod";

// Framework-free core of action() so it can be unit-tested (test/action.test.ts).

export type ActionErrorCode = AppErrorCode | "UNEXPECTED";

export type ActionError = {
  code: ActionErrorCode;
  /** Already translated; safe to show. */
  message: string;
  /** field path ("email", "items.0.name") -> translated messages; "_form" = whole form */
  fieldErrors?: Record<string, string[]>;
  /** ISO time after which a RATE_LIMITED action may be retried */
  retryAt?: string;
  /** Submitted text fields echoed back on failure so a form never loses typed input. */
  values?: Record<string, string>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export type Translator = {
  t: (key: string, params?: Record<string, string | number>) => string;
  has: (key: string) => boolean;
};

export type ActionOptions = {
  /**
   * "account" (default): the caller must be signed in, otherwise the result is
   * UNAUTHENTICATED and the handler does not run. "public": anyone (sign-in, RSVP, enquiry).
   * Either way the handler still does its own access checks through @ed/core.
   */
  auth?: "account" | "public";
};

const KEY_RE = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;
const SENSITIVE_FIELD_RE = /pass|secret|token|code|otp/i;

/** FormData -> plain object. Repeated names become arrays; React's $ACTION_* fields are dropped. */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = fd.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

function echoValues(raw: unknown): Record<string, string> | undefined {
  if (!(raw instanceof FormData)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of raw.entries()) {
    if (typeof v !== "string" || k.startsWith("$ACTION") || SENSITIVE_FIELD_RE.test(k)) continue;
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function issueMessageKey(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return /received (undefined|null)$/.test(issue.message)
        ? "common.validation.required"
        : "common.validation.invalid";
    case "too_small":
      if (issue.origin === "string") {
        return Number(issue.minimum) <= 1
          ? "common.validation.required"
          : "common.validation.tooShort";
      }
      return "common.validation.tooSmall";
    case "too_big":
      return issue.origin === "string" ? "common.validation.tooLong" : "common.validation.tooBig";
    case "invalid_format":
      return issue.format === "email"
        ? "common.validation.invalidEmail"
        : "common.validation.invalid";
    default:
      return "common.validation.invalid";
  }
}

export function zodFieldErrors(error: z.ZodError, tr: Translator): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    // A custom message that is an existing i18n key wins; otherwise map by issue kind.
    const key =
      KEY_RE.test(issue.message) && tr.has(issue.message) ? issue.message : issueMessageKey(issue);
    const text = tr.t(key);
    const list = (out[field] ??= []);
    if (!list.includes(text)) list.push(text);
  }
  return out;
}

function translateFieldErrors(
  fieldErrors: Record<string, string[]> | undefined,
  tr: Translator,
): Record<string, string[]> | undefined {
  if (!fieldErrors) return undefined;
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    out[field] = messages.map((m) => (KEY_RE.test(m) && tr.has(m) ? tr.t(m) : m));
  }
  return out;
}

function fail(
  code: ActionErrorCode,
  tr: Translator,
  extra: Partial<ActionError> = {},
): { ok: false; error: ActionError } {
  return { ok: false, error: { code, message: tr.t(`common.errors.${code}`), ...extra } };
}

export async function runAction<S extends z.ZodType, R>(args: {
  schema: S;
  handler: (ctx: Ctx, input: z.output<S>) => Promise<R>;
  rawInput: unknown;
  getCtx: () => Promise<Ctx>;
  translator: Translator;
  options?: ActionOptions;
  /** Framework control-flow errors (Next redirect/notFound) must pass through untouched. */
  rethrow?: (e: unknown) => void;
  log?: (message: string, error: unknown) => void;
}): Promise<ActionResult<R>> {
  const { schema, handler, rawInput, translator: tr } = args;
  const values = echoValues(rawInput);
  try {
    const ctx = await args.getCtx();
    if ((args.options?.auth ?? "account") === "account" && !actorAccountId(ctx.actor)) {
      return fail("UNAUTHENTICATED", tr, { values });
    }
    const input = rawInput instanceof FormData ? formDataToObject(rawInput) : rawInput;
    const parsed = await schema.safeParseAsync(input);
    if (!parsed.success) {
      return fail("VALIDATION", tr, { fieldErrors: zodFieldErrors(parsed.error, tr), values });
    }
    const data = await handler(ctx, parsed.data);
    return { ok: true, data };
  } catch (e) {
    args.rethrow?.(e);
    if (isAppError(e)) {
      const key = tr.has(e.messageKey) ? e.messageKey : `common.errors.${e.code}`;
      const retryAt = typeof e.details?.retryAt === "string" ? e.details.retryAt : undefined;
      return {
        ok: false,
        error: {
          code: e.code,
          message: tr.t(key, e.details?.params),
          fieldErrors: translateFieldErrors(e.details?.fieldErrors, tr),
          retryAt,
          values,
        },
      };
    }
    if (e instanceof z.ZodError) {
      // core validates its own input too; surface it as field errors, not as a crash
      return fail("VALIDATION", tr, { fieldErrors: zodFieldErrors(e, tr), values });
    }
    // Unexpected: log server-side with a reference, tell the user nothing internal.
    const ref = Math.random().toString(36).slice(2, 10);
    // describeError: what failed and where, never the values (a database error's own message
    // carries the statement's parameters — addresses, names, typed text).
    (args.log ?? ((m, err) => console.error(m, describeError(err, { frames: true }))))(`[action] unexpected error ref=${ref}`, e);
    return fail("UNEXPECTED", tr, { values });
  }
}
