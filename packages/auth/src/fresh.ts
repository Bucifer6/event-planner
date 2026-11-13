import { sessionIdOf } from "@ed/core/accounts";
import { requireAccount, type Ctx } from "@ed/core/context";
import { enforceRateLimit, limitCodeEntry, limitCodeRequest } from "@ed/core/ratelimit";
import { accounts, and, eq, isNull, sessions } from "@ed/db";
import { sendEmail } from "@ed/email";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { consumeCode, issueCode } from "./codes";
import { useRecoveryCode } from "./recovery";
import { CODE_TTL_MINUTES, codeInvalid, withTimingFloor } from "./util";

// S4: sensitive actions need a fresh proof of identity within ten minutes — an emailed code
// for email accounts, a recovery code for anonymous accounts (S8).
// The check itself (requireFreshAuth / isFreshAuth) lives in @ed/core/accounts so core
// domains can call it; it is re-exported from @ed/auth.

async function ownAccount(ctx: Ctx) {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN");
  const [account] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)));
  if (!account) throw new AppError("UNAUTHENTICATED");
  return account;
}

/** Which proof this account uses for S4. */
export async function getFreshAuthMethod(ctx: Ctx): Promise<"email_code" | "recovery_code"> {
  return (await ownAccount(ctx)).kind === "email" ? "email_code" : "recovery_code";
}

/** Email accounts: send the confirmation code to the login address (INF4 limits apply). */
export async function requestFreshAuthCode(
  ctx: Ctx,
  input: { deviceId?: string | null } = {},
): Promise<{ expiresAt: Date }> {
  const account = await ownAccount(ctx);
  if (account.kind !== "email" || !account.email) {
    throw new AppError("VALIDATION", "account.errors.useRecoveryCode");
  }
  const email = account.email;
  return withTimingFloor(async () => {
    await limitCodeRequest(ctx, { email, deviceId: input.deviceId, scope: "fresh.code_request" });
    const issued = await issueCode(ctx, { email, purpose: "fresh_auth", accountId: account.id });
    await sendEmail(ctx, {
      to: email,
      template: "auth.confirm",
      locale: account.locale,
      params: { code: issued.code, minutes: CODE_TTL_MINUTES },
    });
    return { expiresAt: issued.expiresAt };
  });
}

/** Internal: stamp the proof on this session (or on all live ones when the actor has none). */
export async function markFreshAuth(ctx: Ctx, accountId: string): Promise<void> {
  const sessionId = sessionIdOf(ctx.actor);
  await ctx.db
    .update(sessions)
    .set({ freshAuthAt: ctx.now })
    .where(
      and(
        eq(sessions.accountId, accountId),
        isNull(sessions.revokedAt),
        eq(sessions.secondFactorPending, false),
        sessionId ? eq(sessions.id, sessionId) : undefined,
      ),
    );
}

/**
 * Confirm identity for S4: `code` (emailed, email accounts) or `recoveryCode` (anonymous
 * accounts — the code is used up). On success requireFreshAuth passes for ten minutes on
 * this session. Failures are the one generic code error.
 */
export async function confirmFreshAuth(
  ctx: Ctx,
  input: { code?: string; recoveryCode?: string; deviceId?: string | null },
): Promise<void> {
  const data = z
    .object({
      code: z.string().max(20).optional(),
      recoveryCode: z.string().max(40).optional(),
      deviceId: z.string().max(200).nullish(),
    })
    .parse(input);
  const account = await ownAccount(ctx);
  await limitCodeEntry(ctx, { deviceId: data.deviceId, scope: "fresh.code_entry" });
  if (account.kind === "email" && account.email) {
    const ok = await consumeCode(ctx, {
      email: account.email,
      purpose: "fresh_auth",
      code: data.code ?? "",
      accountId: account.id,
    });
    if (!ok) throw codeInvalid("code");
  } else {
    await enforceRateLimit(ctx, {
      scope: "fresh.recovery_entry",
      rules: [{ axis: "key", key: account.id, limit: 10, windowSeconds: 3600 }],
    });
    const ok = await useRecoveryCode(ctx, account.id, data.recoveryCode ?? "");
    if (!ok) throw codeInvalid("recoveryCode", "auth.errors.recoveryCodeInvalid");
  }
  await markFreshAuth(ctx, account.id);
}
