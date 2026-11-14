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

/**
 * A one-line description of an unexpected error that is safe to write to a log or to store
 * (SEC13, D-series): what failed and where, never the VALUES involved.
 *
 * Why not `error.message`: the database layer's errors carry the failed statement together
 * with its parameter values ("Failed query: … params: ana@example.ro,…"), and PostgreSQL
 * quotes offending input in its own messages — so a plain message can put an email address,
 * a guest's name or a private request into the logs. Here a failed query is reported as its
 * SQL text (placeholders only) plus the PostgreSQL error code / constraint / table.
 * `frames: true` appends the call sites (stack lines only — never the message line).
 */
export function describeError(e: unknown, opts: { frames?: boolean; maxLength?: number } = {}): string {
  const max = opts.maxLength ?? 500;
  if (isAppError(e)) return `AppError: ${e.code} ${e.messageKey}`.slice(0, max);
  if (typeof e !== "object" || e === null) return `Error: ${typeof e}`;
  const x = e as { name?: unknown; message?: unknown; query?: unknown; params?: unknown; cause?: unknown; stack?: unknown };
  const name = typeof x.name === "string" && /^[\w$.-]{1,60}$/.test(x.name) ? x.name : "Error";
  const parts: string[] = [];
  const pg = pgFacts(e) ?? pgFacts(x.cause);
  if (typeof x.query === "string") {
    parts.push(`${name === "Error" ? "QueryError" : name}: failed query ${x.query.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  } else if (pg) {
    parts.push(`${name}: database error`);
  } else {
    const message = typeof x.message === "string" ? x.message : "";
    // a wrapped database error keeps its "params: …" tail in the message: cut it off
    const cut = message.search(/\bparams:/);
    parts.push(`${name}: ${(cut >= 0 ? message.slice(0, cut) : message).replace(/\s+/g, " ").trim().slice(0, 300)}`);
  }
  if (pg) parts.push(pg);
  let text = parts.join(" — ").slice(0, max);
  if (opts.frames && typeof x.stack === "string") {
    const frames = x.stack
      .split("\n")
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 8)
      .map((line) => line.trim());
    if (frames.length > 0) text += `\n  ${frames.join("\n  ")}`;
  }
  return text;
}

/** SQLSTATE and object names of a PostgreSQL error — identifiers only, no row values. */
function pgFacts(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const x = e as { code?: unknown; severity?: unknown; constraint?: unknown; table?: unknown; column?: unknown };
  if (typeof x.code !== "string" || !/^[0-9A-Z]{5}$/.test(x.code) || typeof x.severity !== "string") return null;
  const ident = (v: unknown) => (typeof v === "string" && /^[\w$.]{1,80}$/.test(v) ? v : null);
  const bits = [`pg ${x.code}`];
  for (const [label, value] of [["constraint", x.constraint], ["table", x.table], ["column", x.column]] as const) {
    const id = ident(value);
    if (id) bits.push(`${label}=${id}`);
  }
  return bits.join(" ");
}
