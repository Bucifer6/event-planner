import { requireFreshAuth } from "@ed/core/accounts";
import { audit } from "@ed/core/audit";
import { requireAccount, type Ctx } from "@ed/core/context";
import { enforceRateLimit, limitCodeEntry } from "@ed/core/ratelimit";
import { inTx } from "@ed/core/tx";
import { accounts, and, count, eq, isNotNull, isNull, passkeyCredentials, recoveryCodes, sessions, totpSecrets } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken } from "@ed/shared/ids";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { z } from "zod";
import { replaceRecoveryCodes, useRecoveryCode } from "./recovery";
import { codeInvalid, normaliseCode, seal, SESSION_MAX_MS, unseal } from "./util";

// Opt-in two-step sign-in (S2): a standard TOTP authenticator app (RFC 6238, SHA-1, 6 digits,
// 30 s — what every authenticator app understands), ten recovery codes, enabling/disabling
// behind a fresh code (S4). It is never required and never mentioned by the sign-in flow;
// only an account that turned it on is asked for the second factor after the first.

const ISSUER = "EventDesk";
const SEAL_PURPOSE = "totp";
const PERIOD = 30;

function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** Internal + tests: the code an authenticator app would show at `at`. */
export function totpCodeAt(secretBase32: string, at: Date): string {
  return totpFor(secretBase32, "x").generate({ timestamp: at.getTime() });
}

function ownId(ctx: Ctx): string {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN");
  return accountId;
}

export type TwoStepStatus = {
  totpEnabled: boolean;
  /** Unused recovery codes left (0 when the account has none). */
  recoveryCodesLeft: number;
  /** Last four characters of each unused code — the most that is ever shown again (SEC8). */
  recoveryCodeEndings: string[];
  passkeys: number;
};

export async function getTwoStepStatus(ctx: Ctx): Promise<TwoStepStatus> {
  const accountId = ownId(ctx);
  const [totp] = await ctx.db
    .select({ id: totpSecrets.id })
    .from(totpSecrets)
    .where(and(eq(totpSecrets.accountId, accountId), isNotNull(totpSecrets.enabledAt)));
  const endings = await ctx.db
    .select({ lastFour: recoveryCodes.lastFour })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.accountId, accountId), isNull(recoveryCodes.usedAt)));
  const [pk] = await ctx.db
    .select({ n: count() })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.accountId, accountId));
  return {
    totpEnabled: !!totp,
    recoveryCodesLeft: endings.length,
    recoveryCodeEndings: endings.map((e) => e.lastFour),
    passkeys: pk?.n ?? 0,
  };
}

export type TotpEnrolment = {
  /** Base32 secret for typing by hand. */
  secret: string;
  otpauthUri: string;
  /** data:image/svg+xml QR of the otpauth URI, for an <img> (no script, no external asset). */
  qrDataUrl: string;
};

/**
 * Step 1 of enabling: make a new secret (not active yet) and return it with its QR code.
 * Needs fresh auth (S4). Starting again replaces an unconfirmed secret.
 */
export async function beginTotpEnrolment(ctx: Ctx): Promise<TotpEnrolment> {
  const accountId = ownId(ctx);
  await requireFreshAuth(ctx);
  const [account] = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) throw new AppError("UNAUTHENTICATED");
  const [existing] = await ctx.db.select().from(totpSecrets).where(eq(totpSecrets.accountId, accountId));
  if (existing?.enabledAt) throw new AppError("CONFLICT", "account.errors.twoStepAlreadyOn");
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await ctx.db
    .insert(totpSecrets)
    .values({ accountId, secretEnc: seal(SEAL_PURPOSE, secret), createdAt: ctx.now })
    .onConflictDoUpdate({
      target: totpSecrets.accountId,
      set: { secretEnc: seal(SEAL_PURPOSE, secret), enabledAt: null, lastUsedStep: null, createdAt: ctx.now },
    });
  const otpauthUri = totpFor(secret, account.email ?? account.username ?? "EventDesk").toString();
  const svg = await QRCode.toString(otpauthUri, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  return {
    secret,
    otpauthUri,
    qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  };
}

/** Internal: accept a TOTP code once (±1 step for clock drift; a step is never reused). */
async function checkTotp(ctx: Ctx, accountId: string, code: string, requireEnabled: boolean): Promise<boolean> {
  const [row] = await ctx.db.select().from(totpSecrets).where(eq(totpSecrets.accountId, accountId));
  if (!row || (requireEnabled && !row.enabledAt)) return false;
  const typed = normaliseCode(code);
  if (typed.length !== 6) return false;
  const delta = totpFor(unseal(SEAL_PURPOSE, row.secretEnc), "x").validate({
    token: typed,
    timestamp: ctx.now.getTime(),
    window: 1,
  });
  if (delta === null) return false;
  const step = Math.floor(ctx.now.getTime() / 1000 / PERIOD) + delta;
  if (row.lastUsedStep !== null && step <= row.lastUsedStep) return false;
  await ctx.db.update(totpSecrets).set({ lastUsedStep: step }).where(eq(totpSecrets.id, row.id));
  return true;
}

/**
 * Step 2 of enabling: a first valid code from the app turns two-step on and returns ten new
 * recovery codes — shown once (they replace any older codes). Needs fresh auth (S4).
 */
export async function confirmTotpEnrolment(ctx: Ctx, input: { code: string }): Promise<{ recoveryCodes: string[] }> {
  const accountId = ownId(ctx);
  await requireFreshAuth(ctx);
  await limitCodeEntry(ctx, { scope: "totp.enrol" });
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db.select().from(totpSecrets).where(eq(totpSecrets.accountId, accountId));
    if (!row) throw new AppError("NOT_FOUND");
    if (row.enabledAt) throw new AppError("CONFLICT", "account.errors.twoStepAlreadyOn");
    if (!(await checkTotp(tx, accountId, input.code, false))) {
      throw codeInvalid("code", "auth.errors.totpInvalid");
    }
    await tx.db.update(totpSecrets).set({ enabledAt: tx.now }).where(eq(totpSecrets.id, row.id));
    const codes = await replaceRecoveryCodes(tx, accountId);
    await audit(tx, { action: "account.two_step_enabled", objectType: "account", objectId: accountId });
    return { recoveryCodes: codes };
  });
}

/** Turn two-step off. Needs fresh auth (S4). Email accounts lose their recovery codes with it. */
export async function disableTotp(ctx: Ctx): Promise<void> {
  const accountId = ownId(ctx);
  await requireFreshAuth(ctx);
  await inTx(ctx, async (tx) => {
    const removed = await tx.db
      .delete(totpSecrets)
      .where(eq(totpSecrets.accountId, accountId))
      .returning({ id: totpSecrets.id });
    if (removed.length === 0) return;
    const [account] = await tx.db.select({ kind: accounts.kind }).from(accounts).where(eq(accounts.id, accountId));
    // Anonymous accounts keep their codes: they are the only way back in (S8).
    if (account?.kind === "email") {
      await tx.db.delete(recoveryCodes).where(eq(recoveryCodes.accountId, accountId));
    }
    await audit(tx, { action: "account.two_step_disabled", objectType: "account", objectId: accountId });
  });
}

/**
 * New set of ten recovery codes (the old ones stop working). For accounts that have them:
 * anonymous accounts and accounts with two-step on. Needs fresh auth (S4).
 */
export async function regenerateRecoveryCodes(ctx: Ctx): Promise<{ recoveryCodes: string[] }> {
  const accountId = ownId(ctx);
  await requireFreshAuth(ctx);
  return inTx(ctx, async (tx) => {
    const [account] = await tx.db.select({ kind: accounts.kind }).from(accounts).where(eq(accounts.id, accountId));
    const [totp] = await tx.db
      .select({ id: totpSecrets.id })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.accountId, accountId), isNotNull(totpSecrets.enabledAt)));
    if (account?.kind !== "anonymous" && !totp) throw new AppError("CONFLICT", "account.errors.noRecoveryCodes");
    const codes = await replaceRecoveryCodes(tx, accountId);
    await audit(tx, { action: "account.recovery_codes_regenerated", objectType: "account", objectId: accountId });
    return { recoveryCodes: codes };
  });
}

/**
 * Second step of sign-in for an account with two-step on: the pending session (cookie value
 * from the first step) plus a TOTP code or a recovery code. On success the session becomes a
 * normal 30-day session. Limits: per IP/device (SEC16) and per account, never a lockout.
 */
export async function verifySecondFactor(
  ctx: Ctx,
  input: { sessionToken: string; code?: string; recoveryCode?: string; deviceId?: string | null },
): Promise<{ accountId: string; expiresAt: Date }> {
  const data = z
    .object({
      sessionToken: z.string().min(20).max(200),
      code: z.string().max(20).optional(),
      recoveryCode: z.string().max(40).optional(),
      deviceId: z.string().max(200).nullish(),
    })
    .parse(input);
  await limitCodeEntry(ctx, { deviceId: data.deviceId, scope: "signin.second_factor" });
  const [session] = await ctx.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashToken(data.sessionToken)),
        eq(sessions.secondFactorPending, true),
        isNull(sessions.revokedAt),
      ),
    );
  if (!session || session.expiresAt.getTime() <= ctx.now.getTime()) {
    throw new AppError("UNAUTHENTICATED", "auth.errors.secondFactorExpired");
  }
  await enforceRateLimit(ctx, {
    scope: "signin.second_factor.account",
    rules: [{ axis: "key", key: session.accountId, limit: 10, windowSeconds: 3600, backoff: true }],
  });
  const ok = data.recoveryCode
    ? await useRecoveryCode(ctx, session.accountId, data.recoveryCode)
    : await checkTotp(ctx, session.accountId, data.code ?? "", true);
  if (!ok) {
    throw data.recoveryCode
      ? codeInvalid("recoveryCode", "auth.errors.recoveryCodeInvalid")
      : codeInvalid("code", "auth.errors.totpInvalid");
  }
  const expiresAt = new Date(ctx.now.getTime() + SESSION_MAX_MS);
  await ctx.db
    .update(sessions)
    .set({ secondFactorPending: false, freshAuthAt: ctx.now, lastSeenAt: ctx.now, expiresAt })
    .where(eq(sessions.id, session.id));
  return { accountId: session.accountId, expiresAt };
}

