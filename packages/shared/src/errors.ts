export const APP_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "TAKEN",
  "LIMIT",
  "UNAUTHENTICATED",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/**
 * Optional, well-known detail fields. Anything else is allowed too, but details must be
 * JSON-serialisable and must never contain secrets (they can reach the browser).
 */
export type AppErrorDetails = {
  /** field name -> i18n message keys (or already-translated text) */
  fieldErrors?: Record<string, string[]>;
  /** ISO timestamp after which a RATE_LIMITED action may be retried */
  retryAt?: string;
  /** values interpolated into the translated message */
  params?: Record<string, string | number>;
  [key: string]: unknown;
};

/**
 * The only error type domain code throws on purpose.
 * `messageKey` is a full i18n key, e.g. "common.errors.NOT_FOUND" or "tasks.errors.alreadyDone".
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly messageKey: string;
  readonly details?: AppErrorDetails;

  constructor(code: AppErrorCode, messageKey?: string, details?: AppErrorDetails) {
    const key = messageKey ?? defaultMessageKey(code);
    super(`${code}: ${key}`);
    this.name = "AppError";
    this.code = code;
    this.messageKey = key;
    this.details = details;
  }
}

export function defaultMessageKey(code: AppErrorCode): string {
  return `common.errors.${code}`;
}

/** Structural check, so it also works across duplicated module instances (bundlers). */
export function isAppError(e: unknown): e is AppError {
  if (e instanceof AppError) return true;
  if (typeof e !== "object" || e === null) return false;
  const x = e as { name?: unknown; code?: unknown; messageKey?: unknown };
  return (
    x.name === "AppError" &&
    typeof x.messageKey === "string" &&
    typeof x.code === "string" &&
    (APP_ERROR_CODES as readonly string[]).includes(x.code)
  );
}
