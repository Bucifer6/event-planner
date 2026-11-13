import { requireFreshAuth } from "@ed/core/accounts";
import { audit } from "@ed/core/audit";
import { requireAccount, type Ctx } from "@ed/core/context";
import { limitCodeEntry, limitCodeRequest } from "@ed/core/ratelimit";
import { inTx } from "@ed/core/tx";
import { accounts, and, eq, isNotNull, ne, recoveryCodes, totpSecrets } from "@ed/db";
import { sendEmail } from "@ed/email";
import { AppError } from "@ed/shared/errors";
import { zEmail } from "@ed/shared/zod";
import { z } from "zod";
import { hashPassword, zPassword } from "./anonymous";
import { consumeCode, issueCode } from "./codes";
import { replaceRecoveryCodes } from "./recovery";
import { createSession, revokeAllForAccount, type NewSession } from "./sessions";
import { CODE_TTL_MINUTES, codeInvalid, newUsername, withTimingFloor } from "./util";

// The login email (S1, S4, S8, SEC3): add one to an anonymous account, change it, remove it.
// Every one of these is a sensitive action (fresh auth) and, like "sign out everywhere",
// ends all sessions and MCP tokens; this device gets a new session straight away.

function ownId(ctx: Ctx): string {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN");
  return accountId;
}

/**
 * Step 1 (add or change): send a code to the NEW address. Same answer whether or not that
 * address already belongs to someone (SEC1). Needs fresh auth (S4).
 */
export async function requestNewEmailCode(
  ctx: Ctx,
  input: { email: string; deviceId?: string | null },
): Promise<{ expiresAt: Date }> {
  const accountId = ownId(ctx);
  const data = z.object({ email: zEmail, deviceId: z.string().max(200).nullish() }).parse(input);
  await requireFreshAuth(ctx);
  return withTimingFloor(async () => {
    await limitCodeRequest(ctx, { email: data.email, deviceId: data.deviceId, scope: "newemail.code_request" });
    const issued = await issueCode(ctx, { email: data.email, purpose: "new_email", accountId });
    await sendEmail(ctx, {
      to: data.email,
      template: "auth.newEmail",
      locale: ctx.locale,
      params: { code: issued.code, minutes: CODE_TTL_MINUTES },
    });
    return { expiresAt: issued.expiresAt };
  });
}

/**
 * Step 2: the code proves the new address. The account becomes (or stays) an email account
 * with that login; an anonymous account's password stops existing (email accounts have none,
 * S1) and its recovery codes go unless two-step is on. All sessions and MCP tokens end
 * (SEC3); the returned session is the new one for this device.
 */
export async function confirmNewEmail(
  ctx: Ctx,
  input: { email: string; code: string; deviceId?: string | null; userAgent?: string | null },
): Promise<NewSession> {
  const accountId = ownId(ctx);
  const data = z
    .object({
      email: zEmail,
      code: z.string().min(1).max(20),
      deviceId: z.string().max(200).nullish(),
      userAgent: z.string().max(1000).nullish(),
    })
    .parse(input);
  await requireFreshAuth(ctx);
  await limitCodeEntry(ctx, { deviceId: data.deviceId, scope: "newemail.code_entry" });
  const ok = await consumeCode(ctx, { email: data.email, purpose: "new_email", code: data.code, accountId });
  if (!ok) throw codeInvalid();
  return inTx(ctx, async (tx) => {
    const [taken] = await tx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.email, data.email), ne(accounts.id, accountId)));
    if (taken) {
      throw new AppError("VALIDATION", "account.errors.emailUnavailable", {
        fieldErrors: { email: ["account.errors.emailUnavailable"] },
      });
    }
    const [before] = await tx.db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!before) throw new AppError("UNAUTHENTICATED");
    await tx.db
      .update(accounts)
      .set({ kind: "email", email: data.email, emailVerifiedAt: tx.now, passwordHash: null })
      .where(eq(accounts.id, accountId));
    const [totp] = await tx.db
      .select({ id: totpSecrets.id })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.accountId, accountId), isNotNull(totpSecrets.enabledAt)));
    if (!totp) await tx.db.delete(recoveryCodes).where(eq(recoveryCodes.accountId, accountId));
    await audit(tx, {
      action: before.kind === "anonymous" ? "account.email_added" : "account.email_changed",
      objectType: "account",
      objectId: accountId,
    });
    await revokeAllForAccount(tx, { accountId, reason: "login_email_changed" });
    return createSession(tx, { accountId, userAgent: data.userAgent, fresh: true });
  });
}

/**
 * S8: remove the email and go back to anonymous rules: a username (the earlier one if the
 * account had one, otherwise a new random one), a password chosen now, and a fresh set of
 * ten recovery codes shown once. Needs fresh auth (an emailed code, since it still is an
 * email account). All sessions and MCP tokens end; this device gets a new session.
 */
export async function removeEmail(
  ctx: Ctx,
  input: { password: string; userAgent?: string | null },
): Promise<NewSession & { username: string; recoveryCodes: string[] }> {
  const accountId = ownId(ctx);
  const data = z.object({ password: zPassword, userAgent: z.string().max(1000).nullish() }).parse(input);
  await requireFreshAuth(ctx);
  const passwordHash = await hashPassword(data.password);
  return inTx(ctx, async (tx) => {
    const [account] = await tx.db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!account) throw new AppError("UNAUTHENTICATED");
    if (account.kind !== "email") throw new AppError("CONFLICT", "account.errors.noEmail");
    let username = account.username;
    for (let attempt = 0; attempt < 5 && !username; attempt++) {
      const candidate = newUsername();
      const [clash] = await tx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.username, candidate));
      if (!clash) username = candidate;
    }
    if (!username) throw new Error("Could not generate a unique username");
    await tx.db
      .update(accounts)
      .set({ kind: "anonymous", email: null, emailVerifiedAt: null, username, passwordHash })
      .where(eq(accounts.id, accountId));
    const codes = await replaceRecoveryCodes(tx, accountId);
    await audit(tx, { action: "account.email_removed", objectType: "account", objectId: accountId });
    await revokeAllForAccount(tx, { accountId, reason: "login_email_removed" });
    const session = await createSession(tx, { accountId, userAgent: data.userAgent, fresh: true });
    return { ...session, username, recoveryCodes: codes };
  });
}

