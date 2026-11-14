import {
  accounts,
  and,
  eq,
  gt,
  isNull,
  passkeyCredentials,
  recoveryCodes,
  sessions,
  signInCodes,
  totpSecrets,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import { requireAccount, requireSystem, type Actor, type Ctx, type Locale } from "./context";
import {
  completeDeletion,
  getOpenDeletion,
  listDue,
  requestDeletion,
  RETAINED_AFTER_DELETION,
  undoDeletion,
} from "./deletion";
import { inTx } from "./tx";

// Account domain (R0-04 account part, R0-18): the account's own view of itself, the S4
// fresh-auth check every sensitive core function calls, and account deletion with undo (D6).
// Sign-in mechanics (codes, passwords, sessions, 2FA) live in @ed/auth.

export const ACCOUNT_DELETION_TARGET = "account";
export const FRESH_AUTH_MINUTES = 10;

/** The web session resolver attaches the session id to the account actor. */
export function sessionIdOf(actor: Actor): string | null {
  const id = (actor as { sessionId?: unknown }).sessionId;
  return typeof id === "string" ? id : null;
}

/**
 * True when the actor proved identity with a fresh code within `minutes` (S4).
 * With a session on the actor only THAT session counts; an actor without one (tests,
 * accountCtx) is fresh when any live session of the account is.
 */
export async function isFreshAuth(ctx: Ctx, minutes = FRESH_AUTH_MINUTES): Promise<boolean> {
  if (ctx.actor.kind === "system") return true;
  if (ctx.actor.kind !== "account" && ctx.actor.kind !== "staff") return false;
  const since = new Date(ctx.now.getTime() - minutes * 60_000);
  const sessionId = sessionIdOf(ctx.actor);
  const [row] = await ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.accountId, ctx.actor.accountId),
        sessionId ? eq(sessions.id, sessionId) : undefined,
        isNull(sessions.revokedAt),
        eq(sessions.secondFactorPending, false),
        gt(sessions.expiresAt, ctx.now),
        gt(sessions.freshAuthAt, since),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * S4 gate for sensitive actions (ownership transfer, deletion, login-email change, capability
 * grants, business purchases, member changes). Throws FORBIDDEN "account.errors.freshAuthRequired"
 * with details.freshAuthRequired = true; the UI then asks for a fresh emailed code (or a
 * recovery code for anonymous accounts) and retries. MCP tokens can never pass.
 */
export async function requireFreshAuth(ctx: Ctx, minutes = FRESH_AUTH_MINUTES): Promise<void> {
  if (await isFreshAuth(ctx, minutes)) return;
  throw new AppError("FORBIDDEN", "account.errors.freshAuthRequired", { freshAuthRequired: true });
}

export type AccountView = {
  id: string;
  kind: "email" | "anonymous";
  email: string | null;
  username: string | null;
  /** The name the person chose to be shown as; null = email / username is shown. */
  displayName: string | null;
  locale: Locale;
  createdAt: Date;
  /** Open deletion request, if any (D6). */
  deletion: { requestedAt: Date; undoUntil: Date } | null;
};

/** The signed-in account's own record. */
export async function getOwnAccount(ctx: Ctx): Promise<AccountView> {
  const accountId = requireAccount(ctx);
  const [row] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)));
  if (!row) throw new AppError("UNAUTHENTICATED");
  const open = row.deletionRequestedAt
    ? await getOpenDeletion(ctx, { targetType: ACCOUNT_DELETION_TARGET, targetId: accountId })
    : null;
  return {
    id: row.id,
    kind: row.kind,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    locale: row.locale,
    createdAt: row.createdAt,
    deletion: open ? { requestedAt: open.requestedAt, undoUntil: open.undoUntil } : null,
  };
}

/**
 * THE label of a person towards the people they plan with (member lists, task owners): the
 * display name they chose, else the login email, else the generated username.
 */
export function accountLabel(a: { displayName?: string | null; email?: string | null; username?: string | null }): string {
  return a.displayName?.trim() || a.email || a.username || "";
}

/** Sets or clears (blank) the optional display name of the signed-in account. */
export async function setDisplayName(ctx: Ctx, input: { displayName?: string | null }): Promise<{ displayName: string | null }> {
  if (ctx.actor.kind !== "account") throw new AppError(ctx.actor.kind === "anonymous" ? "UNAUTHENTICATED" : "FORBIDDEN");
  const accountId = ctx.actor.accountId;
  const { displayName } = z
    .object({ displayName: z.string().trim().max(60, "common.validation.tooLong").nullish() })
    .parse(input);
  const value = displayName ? displayName.replace(/\s+/g, " ") : null;
  await ctx.db.update(accounts).set({ displayName: value }).where(eq(accounts.id, accountId));
  await audit(ctx, { action: "account.display_name_set", objectType: "account", objectId: accountId, meta: { set: value !== null } });
  return { displayName: value };
}

/** Account-level language (L2): wording only, never data. */
export async function setAccountLocale(ctx: Ctx, input: { locale: Locale }): Promise<void> {
  const accountId = requireAccount(ctx);
  const { locale } = z.object({ locale: z.enum(["ro", "en"]) }).parse(input);
  await ctx.db.update(accounts).set({ locale }).where(eq(accounts.id, accountId));
}

/**
 * D6: asks to delete the signed-in account. Needs fresh auth (S4). The account keeps working
 * for seven days so its owner can sign in and undo; after that the worker purges it.
 */
export async function requestAccountDeletion(
  ctx: Ctx,
): Promise<{ undoUntil: Date; retained: typeof RETAINED_AFTER_DELETION }> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN");
  await requireFreshAuth(ctx);
  return inTx(ctx, async (tx) => {
    const request = await requestDeletion(tx, {
      targetType: ACCOUNT_DELETION_TARGET,
      targetId: accountId,
      retainedNote: `receipts ${RETAINED_AFTER_DELETION.receiptsYears}y; objection records ${RETAINED_AFTER_DELETION.objectionRecordsYears}y; audit ${RETAINED_AFTER_DELETION.auditYears}y`,
    });
    await tx.db
      .update(accounts)
      .set({ deletionRequestedAt: request.requestedAt })
      .where(eq(accounts.id, accountId));
    return { undoUntil: request.undoUntil, retained: RETAINED_AFTER_DELETION };
  });
}

/** D6: cancels the pending deletion inside the seven days. */
export async function undoAccountDeletion(ctx: Ctx): Promise<void> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN");
  await inTx(ctx, async (tx) => {
    await undoDeletion(tx, { targetType: ACCOUNT_DELETION_TARGET, targetId: accountId });
    await tx.db.update(accounts).set({ deletionRequestedAt: null }).where(eq(accounts.id, accountId));
  });
}

/* ── Purge (worker) ─────────────────────────────────────────────────────── */

export type AccountPurgeHook = (ctx: Ctx, accountId: string) => Promise<void>;

const registry = globalThis as unknown as { __edAccountPurgeHooks?: AccountPurgeHook[] };
const purgeHooks = (registry.__edAccountPurgeHooks ??= []);

/**
 * Other domains register what they must delete together with an account (MCP tokens — MCP1,
 * memberships, uploads …). Hooks run inside the purge transaction with a system ctx.
 */
export function onAccountPurge(fn: AccountPurgeHook): void {
  if (!purgeHooks.includes(fn)) purgeHooks.push(fn);
}

/**
 * Worker only: purge every account whose undo window has closed. The account row stays as an
 * anonymised tombstone (no email, username or password) so retained records (receipts 7 years,
 * objection records 3 years, audit 2 years) keep a valid reference. Returns purged ids.
 */
export async function purgeDueAccounts(ctx: Ctx, input: { limit?: number } = {}): Promise<string[]> {
  requireSystem(ctx);
  const due = await listDue(ctx, { targetType: ACCOUNT_DELETION_TARGET, limit: input.limit });
  const purged: string[] = [];
  for (const request of due) {
    await inTx(ctx, async (tx) => {
      const accountId = request.targetId;
      for (const hook of purgeHooks) await hook(tx, accountId);
      await tx.db.delete(sessions).where(eq(sessions.accountId, accountId));
      await tx.db.delete(signInCodes).where(eq(signInCodes.accountId, accountId));
      await tx.db.delete(recoveryCodes).where(eq(recoveryCodes.accountId, accountId));
      await tx.db.delete(totpSecrets).where(eq(totpSecrets.accountId, accountId));
      await tx.db.delete(passkeyCredentials).where(eq(passkeyCredentials.accountId, accountId));
      await tx.db
        .update(accounts)
        .set({
          email: null,
          username: null,
          displayName: null,
          passwordHash: null,
          emailVerifiedAt: null,
          deletedAt: tx.now,
        })
        .where(eq(accounts.id, accountId));
      await completeDeletion(tx, { id: request.id });
      await audit(tx, { action: "account.purged", objectType: "account", objectId: accountId });
    });
    purged.push(request.targetId);
  }
  return purged;
}
