import { audit } from "@ed/core/audit";
import { requireAccount, type Ctx } from "@ed/core/context";
import { sessionIdOf } from "@ed/core/accounts";
import { inTx } from "@ed/core/tx";
import { accounts, and, desc, eq, gt, isNull, lt, ne, sessions, type DeviceType } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import {
  SECOND_FACTOR_PENDING_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  summariseUserAgent,
} from "./util";

// Sessions (S3, SEC3, SEC12): 30 days, or 14 days idle; the cookie value is a random token
// stored only as a hash; every session is revocable server-side.

/** Cookie names. Exactly these plus the language cookie exist (LAU1). */
export const SESSION_COOKIE = "ed_session";
export { DEVICE_COOKIE } from "@ed/core/ratelimit";

/** lastSeenAt is refreshed at most this often. */
export const LAST_SEEN_GRANULARITY_MS = 5 * 60_000;

export type SessionInfo = {
  id: string;
  accountId: string;
  deviceType: DeviceType;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  freshAuthAt: Date | null;
  /** First factor passed, second not yet (S2). Such a session is NOT signed in. */
  secondFactorPending: boolean;
  /** The account's saved language. */
  locale: "ro" | "en";
};

export type NewSession = { token: string; sessionId: string; expiresAt: Date };

/**
 * Internal to @ed/auth and tests: opens a session for an account that has just proven its
 * identity. `fresh` stamps freshAuthAt (the proof was a code). Returns the cookie value —
 * the only time it exists in readable form.
 */
export async function createSession(
  ctx: Ctx,
  input: {
    accountId: string;
    userAgent?: string | null;
    fresh?: boolean;
    secondFactorPending?: boolean;
  },
): Promise<NewSession> {
  const token = randomToken(32);
  const ua = summariseUserAgent(input.userAgent);
  const pending = input.secondFactorPending ?? false;
  const expiresAt = new Date(ctx.now.getTime() + (pending ? SECOND_FACTOR_PENDING_MS : SESSION_MAX_MS));
  const [row] = await ctx.db
    .insert(sessions)
    .values({
      accountId: input.accountId,
      tokenHash: hashToken(token),
      deviceType: ua.deviceType,
      userAgent: ua.label,
      createdAt: ctx.now,
      lastSeenAt: ctx.now,
      expiresAt,
      freshAuthAt: input.fresh && !pending ? ctx.now : null,
      secondFactorPending: pending,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row!.id, expiresAt };
}

/**
 * Looks a cookie value up. Returns null for unknown, revoked, expired (30 days) or idle
 * (14 days) sessions and for purged accounts. Sessions waiting for a second factor are
 * returned only with `allowPending`. With `touch` (default) lastSeenAt moves forward at most
 * once per five minutes.
 */
export async function resolveSession(
  ctx: Ctx,
  token: string | null | undefined,
  opts: { touch?: boolean; allowPending?: boolean } = {},
): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const idleLimit = new Date(ctx.now.getTime() - SESSION_IDLE_MS);
  const [row] = await ctx.db
    .select({
      id: sessions.id,
      accountId: sessions.accountId,
      deviceType: sessions.deviceType,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      freshAuthAt: sessions.freshAuthAt,
      secondFactorPending: sessions.secondFactorPending,
      locale: accounts.locale,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, ctx.now),
        gt(sessions.lastSeenAt, idleLimit),
        isNull(accounts.deletedAt),
      ),
    );
  if (!row) return null;
  if (row.secondFactorPending && !opts.allowPending) return null;
  if (opts.touch !== false && !row.secondFactorPending) {
    const stale = new Date(ctx.now.getTime() - LAST_SEEN_GRANULARITY_MS);
    if (row.lastSeenAt.getTime() < stale.getTime()) {
      await ctx.db
        .update(sessions)
        .set({ lastSeenAt: ctx.now })
        .where(and(eq(sessions.id, row.id), lt(sessions.lastSeenAt, stale)));
      row.lastSeenAt = ctx.now;
    }
  }
  return row;
}

export type SessionListItem = {
  id: string;
  deviceType: DeviceType;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  current: boolean;
};

/** SEC3: the account's active sessions (device type, last seen), newest activity first. */
export async function listSessions(ctx: Ctx): Promise<SessionListItem[]> {
  const accountId = requireAccount(ctx);
  const current = sessionIdOf(ctx.actor);
  const rows = await ctx.db
    .select({
      id: sessions.id,
      deviceType: sessions.deviceType,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.accountId, accountId),
        isNull(sessions.revokedAt),
        eq(sessions.secondFactorPending, false),
        gt(sessions.expiresAt, ctx.now),
        gt(sessions.lastSeenAt, new Date(ctx.now.getTime() - SESSION_IDLE_MS)),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map((r) => ({ ...r, current: r.id === current }));
}

/** Sign one of your own sessions out (another device). */
export async function revokeSession(ctx: Ctx, input: { sessionId: string }): Promise<void> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN");
  const rows = await ctx.db
    .update(sessions)
    .set({ revokedAt: ctx.now })
    .where(
      and(eq(sessions.id, input.sessionId), eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
    )
    .returning({ id: sessions.id });
  if (rows.length === 0) throw new AppError("NOT_FOUND");
  await audit(ctx, { action: "session.revoked", objectType: "session", objectId: input.sessionId });
}

/** Sign out the session behind a cookie value. Never throws for an unknown token. */
export async function signOut(ctx: Ctx, input: { token: string | null | undefined }): Promise<void> {
  if (!input.token) return;
  await ctx.db
    .update(sessions)
    .set({ revokedAt: ctx.now })
    .where(and(eq(sessions.tokenHash, hashToken(input.token)), isNull(sessions.revokedAt)));
}

export type SignOutEverywhereHook = (ctx: Ctx, accountId: string) => Promise<void>;

const registry = globalThis as unknown as { __edSignOutEverywhereHooks?: SignOutEverywhereHook[] };
const hooks = (registry.__edSignOutEverywhereHooks ??= []);

/**
 * SEC3: whatever else must die with "sign out everywhere" registers here — the MCP package
 * registers the revocation of all of the account's MCP tokens. Hooks run in the same
 * transaction as the session revocation: if one fails, nothing is revoked and the user is told.
 * Also runs when the login email is added, changed or removed.
 */
export function onSignOutEverywhere(fn: SignOutEverywhereHook): void {
  if (!hooks.includes(fn)) hooks.push(fn);
}

/** Internal: revoke every session of an account (optionally keeping one) and run the hooks. */
export async function revokeAllForAccount(
  ctx: Ctx,
  input: { accountId: string; exceptSessionId?: string | null; reason: string },
): Promise<number> {
  return inTx(ctx, async (tx) => {
    const rows = await tx.db
      .update(sessions)
      .set({ revokedAt: tx.now })
      .where(
        and(
          eq(sessions.accountId, input.accountId),
          isNull(sessions.revokedAt),
          input.exceptSessionId ? ne(sessions.id, input.exceptSessionId) : undefined,
        ),
      )
      .returning({ id: sessions.id });
    for (const hook of hooks) await hook(tx, input.accountId);
    await audit(tx, {
      action: "account.signed_out_everywhere",
      objectType: "account",
      objectId: input.accountId,
      meta: { reason: input.reason, sessions: rows.length },
    });
    return rows.length;
  });
}

/**
 * SEC3 one-tap "sign out everywhere": invalidates ALL sessions of the signed-in account —
 * this device included — and, through the hooks, all its MCP tokens. Returns sessions revoked.
 */
export async function signOutEverywhere(ctx: Ctx): Promise<number> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN");
  return revokeAllForAccount(ctx, { accountId, reason: "user" });
}
