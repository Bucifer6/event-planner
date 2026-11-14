import { onSignOutEverywhere } from "@ed/auth";
import { onAccountPurge, requireFreshAuth } from "@ed/core/accounts";
import { audit } from "@ed/core/audit";
import { requireSystem, type Ctx, type McpActor } from "@ed/core/context";
import { registerRetentionRule } from "@ed/core/retention";
import { inTx } from "@ed/core/tx";
import {
  accounts,
  and,
  auditLog,
  count,
  desc,
  eq,
  gt,
  isNull,
  lt,
  mcpCallLog,
  mcpScopeSchema,
  mcpTokens,
  sql,
  type McpScope,
} from "@ed/db";
import { defineJob, defineSchedule } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import { z } from "zod";

// Personal MCP connection tokens (MCP1, MCP4, SEC8).
// - The token exists in readable form exactly once: in the return value of createMcpToken.
//   The database keeps its SHA-256 and the last four characters.
// - A token works only after its owner accepted, in the app, the warning that occasion data
//   will leave EventDesk for the assistant's provider (per token, MCP4).
// - It stops working at once when revoked, after 30 days without use, when the account signs
//   out everywhere, and it is deleted with the account.

export const MCP_TOKEN_PREFIX = "edmcp_";
export const MCP_INACTIVITY_DAYS = 30;
export const MCP_MAX_ACTIVE_TOKENS = 10;
export const MCP_CALL_LOG_DAYS = 730;
const DAY_MS = 24 * 60 * 60_000;
/** lastUsedAt is written at most this often. */
const LAST_USED_GRANULARITY_MS = 60_000;

/**
 * MCP4: the classes of data an assistant can receive through read tools. The consent screen
 * names every one of them (mcp.consent.classes.<key>); adding a tool that returns a new class
 * means adding it here first (and revisiting the DPIA, LAU2).
 */
export const MCP_CONSENT_DATA_CLASSES = [
  "occasionDetails",
  "tasks",
  "guestCounts",
  "budgetSummaries",
  "spaceModel",
  "ownMessages",
  // added with the release 0–P tool catalogue (tools.ts)
  "team",
  "guestNames",
  "seating",
  "suppliers",
  "planNotes",
  "proposals",
  // the invitation builder (tools-stationery.ts)
  "invitations",
] as const;

export type McpTokenRow = typeof mcpTokens.$inferSelect;

/** What the UI may know about a token (SEC8: never more than the last four characters). */
export type McpTokenView = {
  id: string;
  name: string;
  scope: McpScope;
  last4: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** When it stops working if it is not used again. */
  expiresAt: Date;
  consentAccepted: boolean;
};

function lastActivity(t: Pick<McpTokenRow, "lastUsedAt" | "consentAcceptedAt" | "createdAt">): Date {
  return t.lastUsedAt ?? t.consentAcceptedAt ?? t.createdAt;
}

function toView(t: McpTokenRow): McpTokenView {
  return {
    id: t.id,
    name: t.name,
    scope: t.scope,
    last4: t.last4,
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    expiresAt: new Date(lastActivity(t).getTime() + MCP_INACTIVITY_DAYS * DAY_MS),
    consentAccepted: !!t.consentAcceptedAt,
  };
}

/** Only a signed-in person manages tokens — never a token itself, staff-as-staff or a guest. */
function ownerId(ctx: Ctx): string {
  if (ctx.actor.kind !== "account") {
    throw new AppError(ctx.actor.kind === "anonymous" ? "UNAUTHENTICATED" : "FORBIDDEN");
  }
  return ctx.actor.accountId;
}

const createInput = z.object({
  name: z.string().trim().min(1, "common.validation.required").max(60, "common.validation.tooLong"),
  scope: mcpScopeSchema,
  /** True when the person accepted the MCP4 warning on the creation screen. */
  consent: z.boolean().optional(),
});

/**
 * Creates a token. S4 sensitive action: needs fresh auth. Returns the token ONCE.
 * Without `consent: true` the token exists but is refused until acceptMcpConsent().
 */
export async function createMcpToken(
  ctx: Ctx,
  input: z.input<typeof createInput>,
): Promise<{ id: string; token: string; last4: string; view: McpTokenView }> {
  const accountId = ownerId(ctx);
  const data = createInput.parse(input);
  await requireFreshAuth(ctx);
  return inTx(ctx, async (tx) => {
    // serialise per account so two parallel creates cannot slip past the limit
    await tx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for("update");
    const [active] = await tx.db
      .select({ n: count() })
      .from(mcpTokens)
      .where(and(eq(mcpTokens.accountId, accountId), isNull(mcpTokens.revokedAt)));
    if ((active?.n ?? 0) >= MCP_MAX_ACTIVE_TOKENS) throw new AppError("LIMIT", "mcp.errors.tooManyTokens");
    const token = `${MCP_TOKEN_PREFIX}${randomToken(32)}`;
    const [row] = await tx.db
      .insert(mcpTokens)
      .values({
        accountId,
        name: data.name,
        tokenHash: hashToken(token),
        last4: token.slice(-4),
        scope: data.scope,
        createdAt: tx.now,
        consentAcceptedAt: data.consent ? tx.now : null,
      })
      .returning();
    await audit(tx, {
      action: "mcp_token.created",
      objectType: "mcp_token",
      objectId: row!.id,
      after: { name: data.name, scope: data.scope, last4: row!.last4 },
    });
    if (data.consent) {
      await audit(tx, {
        action: "mcp_token.consent_accepted",
        objectType: "mcp_token",
        objectId: row!.id,
        meta: { dataClasses: [...MCP_CONSENT_DATA_CLASSES] },
      });
    }
    return { id: row!.id, token, last4: row!.last4, view: toView(row!) };
  });
}

/** MCP4: the owner accepts the data-leaves-EventDesk warning for one token. Idempotent. */
export async function acceptMcpConsent(ctx: Ctx, input: { tokenId: string }): Promise<void> {
  const accountId = ownerId(ctx);
  const updated = await ctx.db
    .update(mcpTokens)
    .set({ consentAcceptedAt: ctx.now })
    .where(
      and(
        eq(mcpTokens.id, input.tokenId),
        eq(mcpTokens.accountId, accountId),
        isNull(mcpTokens.revokedAt),
        isNull(mcpTokens.consentAcceptedAt),
      ),
    )
    .returning({ id: mcpTokens.id });
  if (updated[0]) {
    await audit(ctx, {
      action: "mcp_token.consent_accepted",
      objectType: "mcp_token",
      objectId: input.tokenId,
      meta: { dataClasses: [...MCP_CONSENT_DATA_CLASSES] },
    });
    return;
  }
  const [row] = await ctx.db
    .select({ id: mcpTokens.id })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.id, input.tokenId), eq(mcpTokens.accountId, accountId), isNull(mcpTokens.revokedAt)));
  if (!row) throw new AppError("NOT_FOUND");
}

/** The account's working tokens, newest first. Revoked and expired ones are not listed. */
export async function listMcpTokens(ctx: Ctx): Promise<McpTokenView[]> {
  const accountId = ownerId(ctx);
  const rows = await ctx.db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.accountId, accountId), isNull(mcpTokens.revokedAt)))
    .orderBy(desc(mcpTokens.createdAt));
  const cutoff = ctx.now.getTime() - MCP_INACTIVITY_DAYS * DAY_MS;
  return rows.filter((r) => lastActivity(r).getTime() > cutoff).map(toView);
}

/**
 * Ends a token for good. The stored hash is overwritten, so the credential cannot match
 * again even if `revoked_at` were ever cleared; the row stays so the call log keeps its
 * reference (MCP4: disconnecting ends access at once).
 */
async function revokeWhere(
  ctx: Ctx,
  where: ReturnType<typeof and>,
  reason: NonNullable<McpTokenRow["revokedReason"]>,
): Promise<string[]> {
  const rows = await ctx.db
    .update(mcpTokens)
    .set({
      revokedAt: ctx.now,
      revokedReason: reason,
      tokenHash: sql`'revoked:' || ${mcpTokens.id}`,
    })
    .where(and(where, isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id });
  return rows.map((r) => r.id);
}

/** The owner disconnects an assistant. Takes effect immediately. */
export async function revokeMcpToken(ctx: Ctx, input: { tokenId: string }): Promise<void> {
  const accountId = ownerId(ctx);
  const ids = await revokeWhere(
    ctx,
    and(eq(mcpTokens.id, input.tokenId), eq(mcpTokens.accountId, accountId)),
    "user",
  );
  if (ids.length === 0) throw new AppError("NOT_FOUND");
  await audit(ctx, { action: "mcp_token.revoked", objectType: "mcp_token", objectId: input.tokenId, meta: { reason: "user" } });
}

/** Revokes every token of an account (sign out everywhere, login-email change — SEC3). */
export async function revokeAllMcpTokens(
  ctx: Ctx,
  accountId: string,
  reason: "signed_out_everywhere" | "handover" = "signed_out_everywhere",
): Promise<number> {
  const ids = await revokeWhere(ctx, eq(mcpTokens.accountId, accountId), reason);
  if (ids.length > 0) {
    await audit(ctx, {
      action: "mcp_token.revoked_all",
      objectType: "account",
      objectId: accountId,
      meta: { reason, tokens: ids.length },
    });
  }
  return ids.length;
}

/** MCP7: business tokens stop working when the client takes the occasion over. */
export async function revokeBusinessMcpTokens(ctx: Ctx, businessId: string): Promise<number> {
  requireSystem(ctx);
  return (await revokeWhere(ctx, eq(mcpTokens.businessId, businessId), "handover")).length;
}

/** Worker: tokens unused for 30 days are revoked (MCP1). Returns how many. */
export async function expireInactiveMcpTokens(ctx: Ctx): Promise<number> {
  requireSystem(ctx);
  const cutoff = new Date(ctx.now.getTime() - MCP_INACTIVITY_DAYS * DAY_MS);
  const ids = await revokeWhere(
    ctx,
    lt(sql`coalesce(${mcpTokens.lastUsedAt}, ${mcpTokens.consentAcceptedAt}, ${mcpTokens.createdAt})`, cutoff),
    "inactive",
  );
  if (ids.length > 0) {
    await audit(ctx, { action: "mcp_token.expired", objectType: "mcp_token", meta: { tokens: ids.length } });
  }
  return ids.length;
}

export type McpAuthFailure = "missing" | "invalid" | "consent_required";

export type McpAuthResult =
  | { ok: true; actor: McpActor; token: McpTokenRow; locale: "ro" | "en" }
  | { ok: false; reason: McpAuthFailure; locale?: "ro" | "en" };

/**
 * Bearer authentication. "invalid" covers unknown, revoked, expired and signed-out tokens
 * alike — the caller learns nothing about which. A token whose account was purged, or that
 * predates a "sign out everywhere", fails even if no hook ran in this process.
 */
export async function authenticateMcpToken(ctx: Pick<Ctx, "db" | "now">, bearer: string | null): Promise<McpAuthResult> {
  const token = bearer?.trim();
  if (!token) return { ok: false, reason: "missing" };
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length < 30 || token.length > 200) {
    return { ok: false, reason: "invalid" };
  }
  const [found] = await ctx.db
    .select({ token: mcpTokens, locale: accounts.locale })
    .from(mcpTokens)
    .innerJoin(accounts, eq(accounts.id, mcpTokens.accountId))
    .where(and(eq(mcpTokens.tokenHash, hashToken(token)), isNull(mcpTokens.revokedAt), isNull(accounts.deletedAt)));
  if (!found) return { ok: false, reason: "invalid" };
  const row = found.token;
  const sys: Ctx = { db: ctx.db as Ctx["db"], actor: { kind: "system" }, now: ctx.now, locale: found.locale };

  if (ctx.now.getTime() - lastActivity(row).getTime() > MCP_INACTIVITY_DAYS * DAY_MS) {
    await revokeWhere(sys, eq(mcpTokens.id, row.id), "inactive");
    return { ok: false, reason: "invalid" };
  }
  // SEC3 belt and braces: the account signed out everywhere after this token was made.
  const [signedOut] = await ctx.db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.objectType, "account"),
        eq(auditLog.objectId, row.accountId),
        eq(auditLog.action, "account.signed_out_everywhere"),
        gt(auditLog.at, row.createdAt),
      ),
    )
    .limit(1);
  if (signedOut) {
    await revokeWhere(sys, eq(mcpTokens.id, row.id), "signed_out_everywhere");
    return { ok: false, reason: "invalid" };
  }
  if (!row.consentAcceptedAt) return { ok: false, reason: "consent_required", locale: found.locale };

  if (!row.lastUsedAt || ctx.now.getTime() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    await ctx.db.update(mcpTokens).set({ lastUsedAt: ctx.now }).where(eq(mcpTokens.id, row.id));
  }
  return {
    ok: true,
    actor: { kind: "mcp", accountId: row.accountId, tokenId: row.id, scope: row.scope },
    token: row,
    locale: found.locale,
  };
}

/* ── Wiring: account lifecycle hooks and jobs ───────────────────────────── */

// SEC3: "sign out everywhere" (and a login-email change) revokes every MCP token, in the same
// transaction as the sessions.
onSignOutEverywhere(async (ctx, accountId) => {
  await revokeAllMcpTokens(ctx, accountId, "signed_out_everywhere");
});

// MCP1 / D6: tokens (and their call log) are deleted with the account.
onAccountPurge(async (ctx, accountId) => {
  await ctx.db.delete(mcpTokens).where(eq(mcpTokens.accountId, accountId));
});

export const MCP_EXPIRE_JOB = "mcp.expire-inactive";

export function registerJobs(): void {
  defineJob(MCP_EXPIRE_JOB, z.object({}).passthrough(), async (ctx) => {
    await expireInactiveMcpTokens(ctx);
  });
  defineSchedule({ name: "mcp.expire-inactive.daily", job: MCP_EXPIRE_JOB, every: { kind: "daily", at: "03:50" } });
  registerRetentionRule({
    name: "mcp-call-log",
    run: async (ctx) => {
      const rows = await ctx.db
        .delete(mcpCallLog)
        .where(lt(mcpCallLog.at, new Date(ctx.now.getTime() - MCP_CALL_LOG_DAYS * DAY_MS)))
        .returning({ id: mcpCallLog.id });
      return rows.length;
    },
  });
}
