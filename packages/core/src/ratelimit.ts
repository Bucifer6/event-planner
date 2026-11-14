import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  and,
  eq,
  lt,
  platformSettings,
  rateLimitBackoffs,
  rateLimitBuckets,
  securityLog,
  sql,
  type RateLimitAxis,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken } from "@ed/shared/ids";
import { z } from "zod";
import { requireSystem, type Ctx } from "./context";
import { registerRetentionRule } from "./retention";

// Rate limiting and public-form bot protection (R0-05; SEC11, SEC16).
//
// Three independent axes — email address, IP address, disclosed device cookie (`ed_device`) —
// plus a free "key" axis (a guest link, a form). Every limit that trips throws the SAME
// generic AppError("RATE_LIMITED") with a `retryAt` time, whether or not an account exists,
// and writes a security-log row that never says whether one does.
//
// IMPORTANT: call these BEFORE opening a transaction (pass the request ctx, not an inTx ctx),
// otherwise the counters roll back together with the rejected request.

export const RATE_LIMIT_MESSAGE_KEY = "common.errors.RATE_LIMITED";
export const DEVICE_COOKIE = "ed_device";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** SEC16 / INF4 defaults; the console may override them (platform setting below). */
export const SIGN_IN_LIMIT_DEFAULTS = {
  codeRequestPerEmailPerHour: 3,
  codeRequestPerEmailPerDay: 10,
  codeRequestPerIpPerHour: 10,
  codeRequestPerDevicePerHour: 10,
  codeAttemptsPerCode: 5,
  codeEntryPerIpPerHour: 20,
  codeEntryPerDevicePerHour: 20,
  /** password entry for anonymous accounts (S8): per username, per IP, per device */
  passwordEntryPerUsernamePerHour: 10,
} as const;

export type SignInLimits = { -readonly [K in keyof typeof SIGN_IN_LIMIT_DEFAULTS]: number };

/** platform_settings key holding a partial SignInLimits object (W1). */
export const SIGN_IN_LIMITS_SETTING = "security.signInLimits";

const limitsOverride = z
  .object(
    Object.fromEntries(
      Object.keys(SIGN_IN_LIMIT_DEFAULTS).map((k) => [k, z.number().int().min(1).max(100_000)]),
    ) as Record<keyof SignInLimits, z.ZodNumber>,
  )
  .partial();

export async function getSignInLimits(ctx: Ctx): Promise<SignInLimits> {
  const [row] = await ctx.db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, SIGN_IN_LIMITS_SETTING));
  const parsed = limitsOverride.safeParse(row?.value ?? {});
  return { ...SIGN_IN_LIMIT_DEFAULTS, ...(parsed.success ? parsed.data : {}) };
}

export type RateLimitRule = {
  axis: RateLimitAxis;
  /** The address / IP / device id / link key. A rule without a key is skipped. */
  key: string | null | undefined;
  limit: number;
  windowSeconds: number;
  /** Escalating backoff for this key when it keeps tripping (use on the address axis only). */
  backoff?: boolean;
};

export type RateLimitInput = { scope: string; rules: RateLimitRule[] };

const BACKOFF_MEMORY_MS = DAY * 1000;
const BACKOFF_STEP_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = HOUR * 1000;

/** Extra wait after the window ends: 0, 5, 10, 20, 40, 60, 60… minutes. Capped: never a lockout. */
export function backoffExtraMs(strikes: number): number {
  if (strikes <= 1) return 0;
  return Math.min(BACKOFF_CAP_MS, BACKOFF_STEP_MS * 2 ** (strikes - 2));
}

/**
 * The unit one visitor is counted under on the IP axis. An IPv4 address is itself; an IPv6
 * address is its /64 — the block a single subscriber is handed, inside which they can pick
 * 2^64 different addresses at will. Counting each one separately would make every per-IP
 * limit (SEC11, SEC16) free to step around. IPv4-mapped IPv6 counts as the IPv4 address.
 */
export function ipRateLimitKey(ip: string): string {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (isIP(v) !== 6) return v;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped) return mapped[1]!;
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  const hex = dotted
    ? `${dotted[1]}${((Number(dotted[2]) << 8) | Number(dotted[3])).toString(16)}:${((Number(dotted[4]) << 8) | Number(dotted[5])).toString(16)}`
    : v;
  const [head = "", tail] = hex.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const fill = tail === undefined ? 0 : Math.max(0, 8 - left.length - right.length);
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return v;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

function normaliseKey(axis: RateLimitAxis, key: string): string {
  if (axis === "email") return key.trim().toLowerCase();
  if (axis === "ip") return ipRateLimitKey(key);
  return key.trim();
}

function rateLimited(retryAt: Date): AppError {
  return new AppError("RATE_LIMITED", RATE_LIMIT_MESSAGE_KEY, { retryAt: retryAt.toISOString() });
}

export type SecurityEvent = {
  event: string;
  scope?: string;
  axis?: RateLimitAxis;
  /** Raw axis value; only its hash is stored. */
  key?: string;
  /** Never put account ids, "exists" flags, codes or tokens in here. */
  meta?: Record<string, string | number | boolean | null>;
};

/** Appends a security-log row (SEC10). Stores hashed keys only. */
export async function logSecurityEvent(ctx: Ctx, input: SecurityEvent): Promise<void> {
  await ctx.db.insert(securityLog).values({
    at: ctx.now,
    event: input.event,
    scope: input.scope ?? null,
    axis: input.axis ?? null,
    keyHash:
      input.key && input.axis ? hashToken(normaliseKey(input.axis, input.key)) : null,
    ip: ctx.ip ?? null,
    meta: input.meta ?? null,
  });
}

/**
 * Counts this attempt on every rule and throws RATE_LIMITED (generic message + retryAt) when
 * any of them is over its limit. Each axis is counted and tripped independently.
 */
export async function enforceRateLimit(ctx: Ctx, input: RateLimitInput): Promise<void> {
  const nowMs = ctx.now.getTime();
  const rules = input.rules
    .filter((r): r is RateLimitRule & { key: string } => !!r.key && r.key.trim() !== "")
    .map((r) => ({ ...r, keyHash: hashToken(normaliseKey(r.axis, r.key)) }));

  // 1. An address still inside its backoff waits; the attempt is not counted and does not
  //    extend the wait (so flooding cannot stretch it into a lockout).
  for (const r of rules) {
    if (!r.backoff) continue;
    const [b] = await ctx.db
      .select()
      .from(rateLimitBackoffs)
      .where(and(eq(rateLimitBackoffs.scope, input.scope), eq(rateLimitBackoffs.keyHash, r.keyHash)));
    if (b && b.blockedUntil.getTime() > nowMs) {
      await logSecurityEvent(ctx, {
        event: "rate_limit.blocked",
        scope: input.scope,
        axis: r.axis,
        key: r.key,
      });
      throw rateLimited(b.blockedUntil);
    }
  }

  // 2. Count the attempt on every axis (atomic upsert), then see which ones are over.
  let retryAtMs = 0;
  const tripped: typeof rules = [];
  for (const r of rules) {
    const windowMs = r.windowSeconds * 1000;
    const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
    const [row] = await ctx.db
      .insert(rateLimitBuckets)
      .values({
        scope: input.scope,
        axis: r.axis,
        keyHash: r.keyHash,
        windowSeconds: r.windowSeconds,
        windowStart,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [
          rateLimitBuckets.scope,
          rateLimitBuckets.axis,
          rateLimitBuckets.keyHash,
          rateLimitBuckets.windowSeconds,
          rateLimitBuckets.windowStart,
        ],
        set: { count: sql`${rateLimitBuckets.count} + 1` },
      })
      .returning({ count: rateLimitBuckets.count });
    if ((row?.count ?? 0) > r.limit) {
      tripped.push(r);
      retryAtMs = Math.max(retryAtMs, windowStart.getTime() + windowMs);
    }
  }
  if (tripped.length === 0) return;

  // 3. Escalate the wait for a repeatedly abused address — that address only.
  for (const r of tripped) {
    await logSecurityEvent(ctx, {
      event: "rate_limit.tripped",
      scope: input.scope,
      axis: r.axis,
      key: r.key,
      meta: { limit: r.limit, windowSeconds: r.windowSeconds },
    });
    if (!r.backoff) continue;
    const windowMs = r.windowSeconds * 1000;
    const windowEnd = Math.floor(nowMs / windowMs) * windowMs + windowMs;
    const [prev] = await ctx.db
      .select()
      .from(rateLimitBackoffs)
      .where(and(eq(rateLimitBackoffs.scope, input.scope), eq(rateLimitBackoffs.keyHash, r.keyHash)));
    const remembered = prev && nowMs - prev.lastStrikeAt.getTime() < BACKOFF_MEMORY_MS;
    const strikes = remembered ? prev.strikes + 1 : 1;
    const blockedUntil = new Date(windowEnd + backoffExtraMs(strikes));
    await ctx.db
      .insert(rateLimitBackoffs)
      .values({ scope: input.scope, keyHash: r.keyHash, strikes, lastStrikeAt: ctx.now, blockedUntil })
      .onConflictDoUpdate({
        target: [rateLimitBackoffs.scope, rateLimitBackoffs.keyHash],
        set: { strikes, lastStrikeAt: ctx.now, blockedUntil },
      });
    retryAtMs = Math.max(retryAtMs, blockedUntil.getTime());
  }
  throw rateLimited(new Date(retryAtMs));
}

/** SEC16: asking for a sign-in code. Axes: email (3/h, 10/day, with backoff), IP, device. */
export async function limitCodeRequest(
  ctx: Ctx,
  input: { email: string; deviceId?: string | null; scope?: string },
): Promise<void> {
  const l = await getSignInLimits(ctx);
  await enforceRateLimit(ctx, {
    scope: input.scope ?? "signin.code_request",
    rules: [
      { axis: "ip", key: ctx.ip, limit: l.codeRequestPerIpPerHour, windowSeconds: HOUR },
      { axis: "device", key: input.deviceId, limit: l.codeRequestPerDevicePerHour, windowSeconds: HOUR },
      { axis: "email", key: input.email, limit: l.codeRequestPerEmailPerHour, windowSeconds: HOUR, backoff: true },
      { axis: "email", key: input.email, limit: l.codeRequestPerEmailPerDay, windowSeconds: DAY, backoff: true },
    ],
  });
}

/** SEC16: entering a code (the 5-per-code cap lives on the code itself). Axes: IP, device. */
export async function limitCodeEntry(
  ctx: Ctx,
  input: { deviceId?: string | null; scope?: string },
): Promise<void> {
  const l = await getSignInLimits(ctx);
  await enforceRateLimit(ctx, {
    scope: input.scope ?? "signin.code_entry",
    rules: [
      { axis: "ip", key: ctx.ip, limit: l.codeEntryPerIpPerHour, windowSeconds: HOUR },
      { axis: "device", key: input.deviceId, limit: l.codeEntryPerDevicePerHour, windowSeconds: HOUR },
    ],
  });
}

/** S8: username + password entry. Axes: username (with backoff), IP, device. */
export async function limitPasswordEntry(
  ctx: Ctx,
  input: { username: string; deviceId?: string | null },
): Promise<void> {
  const l = await getSignInLimits(ctx);
  await enforceRateLimit(ctx, {
    scope: "signin.password_entry",
    rules: [
      { axis: "ip", key: ctx.ip, limit: l.codeEntryPerIpPerHour, windowSeconds: HOUR },
      { axis: "device", key: input.deviceId, limit: l.codeEntryPerDevicePerHour, windowSeconds: HOUR },
      { axis: "email", key: input.username, limit: l.passwordEntryPerUsernamePerHour, windowSeconds: HOUR, backoff: true },
    ],
  });
}

/* ── Public forms (SEC11): honeypot + time-to-submit floor + per-IP / per-link limits ──── */

export const PUBLIC_FORM_DEFAULTS = {
  minSeconds: 3,
  perIpPerHour: 30,
  perLinkPerHour: 120,
} as const;

/** Name to give the hidden honeypot input and the hidden stamp input. */
export const HONEYPOT_FIELD = "website";
export const FORM_STAMP_FIELD = "ed_rendered";

function stampSecret(): string {
  return process.env.SESSION_SECRET || "ed-dev-form-stamp-secret-not-for-production";
}

function signStamp(ms: number): string {
  return createHmac("sha256", stampSecret()).update(`form-stamp:${ms}`).digest("base64url");
}

/** Render this into a hidden input when the form is drawn; pass it back as `renderedAt`. */
export function issueFormStamp(now: Date = new Date()): string {
  const ms = now.getTime();
  return `${ms}.${signStamp(ms)}`;
}

function readStamp(value: string | number | Date | null | undefined): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const [msText, sig] = value.split(".");
  const ms = Number(msText);
  if (!Number.isFinite(ms) || !sig) return null;
  const expected = Buffer.from(signStamp(ms));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got) ? ms : null;
}

export type PublicFormInput = {
  /** Stable name of the form: "rsvp", "enquiry", "claim", "anonymous_signup", … */
  formKey: string;
  /** The guest link / listing the form belongs to, when there is one (per-link limit). */
  linkKey?: string | null;
  /** Value of the hidden honeypot input; a human leaves it empty. */
  honeypot: string | null | undefined;
  /** issueFormStamp() value from the hidden input (or a server-known Date / epoch ms). */
  renderedAt: string | number | Date | null | undefined;
  minSeconds?: number;
  perIpPerHour?: number;
  perLinkPerHour?: number;
};

/**
 * Bot guard for unauthenticated forms. Throws RATE_LIMITED with a retry time (never a silent
 * drop) when the honeypot is filled, the form came back faster than a person can fill it, or
 * the IP / link is over its hourly limit. No third-party script, no CAPTCHA (D1).
 */
export async function checkPublicForm(ctx: Ctx, input: PublicFormInput): Promise<void> {
  const scope = `form.${input.formKey}`;
  const nowMs = ctx.now.getTime();
  const minMs = (input.minSeconds ?? PUBLIC_FORM_DEFAULTS.minSeconds) * 1000;

  if (typeof input.honeypot === "string" && input.honeypot.trim() !== "") {
    await logSecurityEvent(ctx, { event: "public_form.honeypot", scope });
    throw rateLimited(new Date(nowMs + 60_000));
  }
  const rendered = readStamp(input.renderedAt);
  if (rendered === null || rendered > nowMs + 60_000) {
    await logSecurityEvent(ctx, { event: "public_form.bad_stamp", scope });
    throw rateLimited(new Date(nowMs + minMs));
  }
  if (nowMs - rendered < minMs) {
    await logSecurityEvent(ctx, { event: "public_form.too_fast", scope });
    throw rateLimited(new Date(rendered + minMs));
  }
  await enforceRateLimit(ctx, {
    scope,
    rules: [
      { axis: "ip", key: ctx.ip, limit: input.perIpPerHour ?? PUBLIC_FORM_DEFAULTS.perIpPerHour, windowSeconds: HOUR },
      { axis: "key", key: input.linkKey, limit: input.perLinkPerHour ?? PUBLIC_FORM_DEFAULTS.perLinkPerHour, windowSeconds: HOUR },
    ],
  });
}

/* ── Retention ────────────────────────────────────────────────────────────── */

/** The security log holds IP addresses and device hints; nothing in it is needed after 90 days. */
export const SECURITY_LOG_RETENTION_DAYS = 90;

registerRetentionRule({
  name: "security-log",
  run: async (ctx) => {
    requireSystem(ctx);
    const cutoff = new Date(ctx.now.getTime() - SECURITY_LOG_RETENTION_DAYS * 86_400_000);
    const res = await ctx.db.delete(securityLog).where(lt(securityLog.at, cutoff));
    return res.rowCount ?? 0;
  },
});
