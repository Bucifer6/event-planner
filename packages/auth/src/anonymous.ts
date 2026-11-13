import { audit } from "@ed/core/audit";
import type { Ctx } from "@ed/core/context";
import { checkPublicForm, limitPasswordEntry } from "@ed/core/ratelimit";
import { inTx } from "@ed/core/tx";
import { accounts, and, eq, isNotNull, isNull, sessions, totpSecrets } from "@ed/db";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import type { SignInResult } from "./codes";
import { replaceRecoveryCodes, useRecoveryCode } from "./recovery";
import { createSession } from "./sessions";
import {
  credentialsInvalid,
  newUsername,
  normaliseUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  withTimingFloor,
} from "./util";

// Anonymous accounts (S7, S8): a random generated username and a user-chosen password — no
// email, no phone, no name. Passwords are hashed with Argon2id (per-account random salt inside
// the PHC string). A wrong username and a wrong password fail identically.

// OWASP baseline for Argon2id: 19 MiB, 2 passes, 1 lane. algorithm 2 = Argon2id.
const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const zPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "auth.errors.passwordTooShort")
  .max(PASSWORD_MAX_LENGTH, "common.validation.tooLong");

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when the username does not exist, so both failures cost the same.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("ed-dummy-password-for-timing"));

export type AnonymousSignup = SignInResult & {
  username: string;
  /** Shown once, never again. */
  recoveryCodes: string[];
};

/**
 * S7: create an anonymous account and sign it in. Public form: honeypot + time floor +
 * per-IP limit (SEC11). Returns the generated username and the ten recovery codes — the only
 * time they are readable.
 */
export async function createAnonymousAccount(
  ctx: Ctx,
  input: {
    password: string;
    honeypot?: string | null;
    renderedAt: string | number | Date | null | undefined;
    userAgent?: string | null;
  },
): Promise<AnonymousSignup> {
  const data = z
    .object({ password: zPassword, userAgent: z.string().max(1000).nullish() })
    .parse({ password: input.password, userAgent: input.userAgent });
  await checkPublicForm(ctx, {
    formKey: "anonymous_signup",
    honeypot: input.honeypot,
    renderedAt: input.renderedAt,
    perIpPerHour: 10,
  });
  const passwordHash = await hashPassword(data.password);
  return inTx(ctx, async (tx) => {
    let account: typeof accounts.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !account; attempt++) {
      [account] = await tx.db
        .insert(accounts)
        .values({
          kind: "anonymous",
          username: newUsername(),
          passwordHash,
          locale: tx.locale,
          createdAt: tx.now,
        })
        .onConflictDoNothing()
        .returning();
    }
    if (!account?.username) throw new Error("Could not generate a unique username");
    const recoveryCodes = await replaceRecoveryCodes(tx, account.id);
    const session = await createSession(tx, { accountId: account.id, userAgent: data.userAgent });
    await audit(tx, {
      action: "account.created",
      objectType: "account",
      objectId: account.id,
      meta: { kind: "anonymous" },
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      accountId: account.id,
      secondFactorRequired: false,
      locale: account.locale,
      username: account.username,
      recoveryCodes,
    };
  });
}

const credentials = z.object({
  username: z.string().trim().min(1, "common.validation.required").max(100),
  password: z.string().min(1, "common.validation.required").max(PASSWORD_MAX_LENGTH),
  deviceId: z.string().max(200).nullish(),
  userAgent: z.string().max(1000).nullish(),
});

/**
 * S8: username + password. Unknown username and wrong password are the same VALIDATION
 * "auth.errors.credentialsInvalid" with the same cost. SEC16 limits per username, IP, device.
 */
export async function signInAnonymous(
  ctx: Ctx,
  input: { username: string; password: string; deviceId?: string | null; userAgent?: string | null },
): Promise<SignInResult> {
  const data = credentials.parse(input);
  const username = normaliseUsername(data.username);
  return withTimingFloor(async () => {
    await limitPasswordEntry(ctx, { username, deviceId: data.deviceId });
    const [account] = await ctx.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.username, username), eq(accounts.kind, "anonymous"), isNull(accounts.deletedAt)));
    const ok = await verifyPassword(account?.passwordHash ?? (await getDummyHash()), data.password);
    if (!account || !account.passwordHash || !ok) throw credentialsInvalid();
    const [totp] = await ctx.db
      .select({ id: totpSecrets.id })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.accountId, account.id), isNotNull(totpSecrets.enabledAt)));
    const session = await createSession(ctx, {
      accountId: account.id,
      userAgent: data.userAgent,
      secondFactorPending: !!totp,
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      accountId: account.id,
      secondFactorRequired: !!totp,
      locale: account.locale,
    };
  });
}

/**
 * S8: the only way back into an anonymous account whose password is lost — username + one
 * unused recovery code + a new password. Uses the code up, replaces the password, signs every
 * other session out and signs this device in. Same generic failure as sign-in.
 */
export async function recoverAnonymousAccount(
  ctx: Ctx,
  input: {
    username: string;
    recoveryCode: string;
    newPassword: string;
    deviceId?: string | null;
    userAgent?: string | null;
  },
): Promise<SignInResult> {
  const data = z
    .object({
      username: z.string().trim().min(1, "common.validation.required").max(100),
      recoveryCode: z.string().trim().min(1, "common.validation.required").max(40),
      newPassword: zPassword,
      deviceId: z.string().max(200).nullish(),
      userAgent: z.string().max(1000).nullish(),
    })
    .parse(input);
  const username = normaliseUsername(data.username);
  return withTimingFloor(async () => {
    await limitPasswordEntry(ctx, { username, deviceId: data.deviceId });
    const passwordHash = await hashPassword(data.newPassword);
    return inTx(ctx, async (tx) => {
      const [account] = await tx.db
        .select()
        .from(accounts)
        .where(and(eq(accounts.username, username), eq(accounts.kind, "anonymous"), isNull(accounts.deletedAt)));
      if (!account || !(await useRecoveryCode(tx, account.id, data.recoveryCode))) {
        throw credentialsInvalid();
      }
      await tx.db.update(accounts).set({ passwordHash }).where(eq(accounts.id, account.id));
      await tx.db
        .update(sessions)
        .set({ revokedAt: tx.now })
        .where(and(eq(sessions.accountId, account.id), isNull(sessions.revokedAt)));
      const session = await createSession(tx, {
        accountId: account.id,
        userAgent: data.userAgent,
        fresh: true,
      });
      await audit(tx, { action: "account.recovered", objectType: "account", objectId: account.id });
      return {
        token: session.token,
        expiresAt: session.expiresAt,
        accountId: account.id,
        secondFactorRequired: false,
        locale: account.locale,
      };
    });
  });
}
