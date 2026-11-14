import type { Db } from "@ed/db";
import { AppError } from "@ed/shared/errors";

export type Locale = "ro" | "en";

export type AccountActor = { kind: "account"; accountId: string };
export type GuestActor = {
  kind: "guest";
  invitationId: string;
  householdId: string;
  occasionId: string;
};
export type StaffActor = { kind: "staff"; accountId: string; staffId: string; roles: string[] };
export type McpActor = {
  kind: "mcp";
  accountId: string;
  tokenId: string;
  scope: "read" | "read_propose";
};
export type SystemActor = { kind: "system" };
/** Nobody is signed in (public pages, sign-in itself). Has no access to anything private. */
export type AnonymousActor = { kind: "anonymous" };

export type Actor =
  AccountActor | GuestActor | StaffActor | McpActor | SystemActor | AnonymousActor;

/**
 * Passed as the first argument to every core function.
 * `db` may be the pooled connection or an open transaction (see inTx in @ed/core/tx).
 * `now` is the request's clock: use ctx.now, never new Date(), so tests can control time.
 */
export type Ctx = {
  db: Db;
  actor: Actor;
  now: Date;
  ip?: string;
  locale: Locale;
};

export type CtxOptions = { now?: Date; ip?: string; locale?: Locale };

export function makeCtx(db: Db, actor: Actor, opts: CtxOptions = {}): Ctx {
  return { db, actor, now: opts.now ?? new Date(), ip: opts.ip, locale: opts.locale ?? "ro" };
}

/** Worker jobs, seeds, scheduled tasks. */
export function systemCtx(db: Db, opts: CtxOptions = {}): Ctx {
  return makeCtx(db, { kind: "system" }, opts);
}

/** A signed-in account (also the usual ctx in tests). */
export function accountCtx(db: Db, accountId: string, opts: CtxOptions = {}): Ctx {
  return makeCtx(db, { kind: "account", accountId }, opts);
}

export function anonymousCtx(db: Db, opts: CtxOptions = {}): Ctx {
  return makeCtx(db, { kind: "anonymous" }, opts);
}

/** The account behind the actor, or null. MCP tokens and staff act as their own account. */
export function actorAccountId(actor: Actor): string | null {
  switch (actor.kind) {
    case "account":
    case "mcp":
    case "staff":
      return actor.accountId;
    default:
      return null;
  }
}

/** Returns the acting account id or throws UNAUTHENTICATED. */
export function requireAccount(ctx: Ctx): string {
  const accountId = actorAccountId(ctx.actor);
  if (!accountId) throw new AppError("UNAUTHENTICATED", "common.errors.UNAUTHENTICATED");
  return accountId;
}

/** Throws FORBIDDEN unless the actor is the system (worker-only operations). */
export function requireSystem(ctx: Ctx): void {
  if (ctx.actor.kind !== "system") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
}

/** MCP tokens with scope "read" must never reach a mutation; call this at the top of one. */
export function requireWriteCapable(ctx: Ctx): void {
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
}

/** Stable (kind, id) pair identifying the actor in audit rows and logs. */
export function actorRef(actor: Actor): { kind: Actor["kind"]; id: string | null } {
  switch (actor.kind) {
    case "account":
      return { kind: "account", id: actor.accountId };
    case "guest":
      return { kind: "guest", id: actor.invitationId };
    case "staff":
      return { kind: "staff", id: actor.staffId };
    case "mcp":
      return { kind: "mcp", id: actor.tokenId };
    case "system":
      return { kind: "system", id: null };
    case "anonymous":
      return { kind: "anonymous", id: null };
  }
}
