import { audit } from "@ed/core/audit";
import { requireSystem, type Ctx } from "@ed/core/context";
import { limitCodeEntry, limitCodeRequest } from "@ed/core/ratelimit";
import { inTx } from "@ed/core/tx";
import {
  accounts,
  and,
  desc,
  eq,
  gt,
  isNull,
  lt,
  magicLinks,
  rateLimitBackoffs,
  rateLimitBuckets,
  sessions,
  signInCodes,
  sql,
  totpSecrets,
  isNotNull,
  type SignInCodePurpose,
} from "@ed/db";
import { sendEmail } from "@ed/email";
import { hashEquals, hashToken, randomToken, sixDigitCode } from "@ed/shared/ids";
import { zEmail } from "@ed/shared/zod";
import { z } from "zod";
import { getSignInLimits } from "@ed/core/ratelimit";
import { createSession } from "./sessions";
import {
  appUrl,
  CODE_TTL_MINUTES,
  CODE_TTL_MS,
  codeHash,
  codeInvalid,
  emailLookupHash,
  normaliseCode,
  normaliseEmail,
  withTimingFloor,
} from "./util";

// Emailed six-digit codes and the one-tap link (S1, INF4, SEC1, SEC8, SEC14).
//
// Enumeration safety: asking for a code does exactly the same work for an address with an
// account and for one without (the account is created only when a code is first confirmed),
// answers with the same value, and is padded to the same timing band.

export type SignInResult = {
  /** Cookie value for ed_session — the only readable copy. */
  token: string;
  expiresAt: Date;
  accountId: string;
  /** S2: the account turned on two-step sign-in; the session waits for the second factor. */
  secondFactorRequired: boolean;
  locale: "ro" | "en";
};

type IssuedCode = { id: string; code: string; expiresAt: Date; linkToken: string | null };

/**
 * Internal: store a new code (hashed) for an address+purpose and invalidate every older one
 * (SEC1). For sign-in it also creates the one-tap link that expires with it (SEC14).
 */
export async function issueCode(
  ctx: Ctx,
  input: { email: string; purpose: SignInCodePurpose; accountId?: string | null },
): Promise<IssuedCode> {
  const email = normaliseEmail(input.email);
  const emailHash = emailLookupHash(email);
  const code = sixDigitCode();
  const expiresAt = new Date(ctx.now.getTime() + CODE_TTL_MS);
  return inTx(ctx, async (tx) => {
    await tx.db
      .update(signInCodes)
      .set({ invalidatedAt: tx.now })
      .where(
        and(
          eq(signInCodes.emailHash, emailHash),
          eq(signInCodes.purpose, input.purpose),
          isNull(signInCodes.usedAt),
          isNull(signInCodes.invalidatedAt),
        ),
      );
    const [row] = await tx.db
      .insert(signInCodes)
      .values({
        accountId: input.accountId ?? null,
        emailHash,
        purpose: input.purpose,
        codeHash: "pending",
        expiresAt,
        createdAt: tx.now,
      })
      .returning({ id: signInCodes.id });
    const id = row!.id;
    await tx.db.update(signInCodes).set({ codeHash: codeHash(id, code) }).where(eq(signInCodes.id, id));
    let linkToken: string | null = null;
    if (input.purpose === "sign_in") {
      linkToken = randomToken(32);
      await tx.db.insert(magicLinks).values({
        signInCodeId: id,
        tokenHash: hashToken(linkToken),
        email,
        expiresAt,
        createdAt: tx.now,
      });
    }
    return { id, code, expiresAt, linkToken };
  });
}

/**
 * Internal: check a typed code against the newest live code for address+purpose. Counts the
 * attempt first (at most 5 per code: the sixth fails even when correct), then consumes the
 * code on a match. Returns the code row id, or null for any failure — callers answer with
 * the one generic message.
 */
export async function consumeCode(
  ctx: Ctx,
  input: { email: string; purpose: SignInCodePurpose; code: string; accountId?: string | null },
): Promise<string | null> {
  const typed = normaliseCode(input.code);
  const limits = await getSignInLimits(ctx);
  const [row] = await ctx.db
    .select()
    .from(signInCodes)
    .where(
      and(
        eq(signInCodes.emailHash, emailLookupHash(input.email)),
        eq(signInCodes.purpose, input.purpose),
        isNull(signInCodes.usedAt),
        isNull(signInCodes.invalidatedAt),
        gt(signInCodes.expiresAt, ctx.now),
        input.accountId ? eq(signInCodes.accountId, input.accountId) : undefined,
      ),
    )
    .orderBy(desc(signInCodes.createdAt))
    .limit(1);
  if (!row) return null;
  const counted = await ctx.db
    .update(signInCodes)
    .set({ attempts: sql`${signInCodes.attempts} + 1` })
    .where(
      and(
        eq(signInCodes.id, row.id),
        lt(signInCodes.attempts, limits.codeAttemptsPerCode),
        isNull(signInCodes.usedAt),
      ),
    )
    .returning({ id: signInCodes.id });
  if (counted.length === 0) return null;
  if (typed.length !== 6 || !hashEquals(row.codeHash, codeHash(row.id, typed))) return null;
  const used = await ctx.db
    .update(signInCodes)
    .set({ usedAt: ctx.now })
    .where(and(eq(signInCodes.id, row.id), isNull(signInCodes.usedAt)))
    .returning({ id: signInCodes.id });
  if (used.length === 0) return null;
  // The link and the code are two ways to use the same sign-in: once the code is used the
  // link is dead too.
  await ctx.db
    .update(magicLinks)
    .set({ usedAt: ctx.now })
    .where(and(eq(magicLinks.signInCodeId, row.id), isNull(magicLinks.usedAt)));
  return row.id;
}

const requestInput = z.object({ email: zEmail, deviceId: z.string().max(200).nullish() });

/**
 * S1: email a six-digit code (15 minutes, 5 attempts) and a one-tap link to `email`.
 * Identical answer and timing whether or not an account exists (SEC1). Rate limits per
 * address / IP / device (SEC16) throw the generic RATE_LIMITED with retryAt.
 */
export async function requestSignInCode(
  ctx: Ctx,
  input: { email: string; deviceId?: string | null },
): Promise<{ expiresAt: Date }> {
  const data = requestInput.parse(input);
  return withTimingFloor(async () => {
    await limitCodeRequest(ctx, { email: data.email, deviceId: data.deviceId });
    const issued = await issueCode(ctx, { email: data.email, purpose: "sign_in" });
    await sendEmail(ctx, {
      to: data.email,
      template: "auth.signIn",
      locale: ctx.locale,
      params: {
        code: issued.code,
        linkUrl: `${appUrl()}/sign-in/link/${issued.linkToken}`,
        minutes: CODE_TTL_MINUTES,
      },
    });
    return { expiresAt: issued.expiresAt };
  });
}

/** Internal: the address is proven — find or create its account and open a session. */
async function completeEmailSignIn(
  ctx: Ctx,
  input: { email: string; userAgent?: string | null },
): Promise<SignInResult> {
  const email = normaliseEmail(input.email);
  return inTx(ctx, async (tx) => {
    let [account] = await tx.db.select().from(accounts).where(eq(accounts.email, email));
    if (!account) {
      const created = await tx.db
        .insert(accounts)
        .values({ kind: "email", email, locale: tx.locale, emailVerifiedAt: tx.now, createdAt: tx.now })
        .onConflictDoNothing()
        .returning();
      account = created[0] ?? (await tx.db.select().from(accounts).where(eq(accounts.email, email)))[0];
      if (created[0]) {
        await audit(tx, { action: "account.created", objectType: "account", objectId: created[0].id, meta: { kind: "email" } });
      }
    }
    if (!account) throw codeInvalid();
    if (!account.emailVerifiedAt) {
      await tx.db.update(accounts).set({ emailVerifiedAt: tx.now }).where(eq(accounts.id, account.id));
    }
    const [totp] = await tx.db
      .select({ id: totpSecrets.id })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.accountId, account.id), isNotNull(totpSecrets.enabledAt)));
    const secondFactorRequired = !!totp;
    const session = await createSession(tx, {
      accountId: account.id,
      userAgent: input.userAgent,
      fresh: true,
      secondFactorPending: secondFactorRequired,
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      accountId: account.id,
      secondFactorRequired,
      locale: account.locale,
    };
  });
}

const verifyInput = z
  .object({
    email: zEmail.optional(),
    /** Alternative to `email`: the one-tap link token from the same message (SEC14 page). */
    linkToken: z.string().min(20).max(200).optional(),
    code: z.string().min(1).max(20),
    deviceId: z.string().max(200).nullish(),
    userAgent: z.string().max(1000).nullish(),
  })
  .refine((v) => v.email || v.linkToken, { message: "common.validation.required", path: ["email"] });

/**
 * S1: confirm the emailed code and sign in. Any failure — wrong, expired, already used,
 * replaced by a newer code, more than 5 attempts, unknown address — is the same VALIDATION
 * error on the `code` field. Entry is also limited per IP and per device (SEC16).
 */
export async function verifySignInCode(
  ctx: Ctx,
  input: {
    email?: string;
    linkToken?: string;
    code: string;
    deviceId?: string | null;
    userAgent?: string | null;
  },
): Promise<SignInResult> {
  const data = verifyInput.parse(input);
  await limitCodeEntry(ctx, { deviceId: data.deviceId });
  let email = data.email;
  if (!email && data.linkToken) {
    const [link] = await ctx.db
      .select({ email: magicLinks.email })
      .from(magicLinks)
      .where(eq(magicLinks.tokenHash, hashToken(data.linkToken)));
    email = link?.email;
  }
  if (!email) throw codeInvalid();
  const ok = await consumeCode(ctx, { email, purpose: "sign_in", code: data.code });
  if (!ok) throw codeInvalid();
  return completeEmailSignIn(ctx, { email, userAgent: data.userAgent });
}

export type MagicLinkStatus = "valid" | "used" | "expired" | "unknown";

/** Read-only look at a link (used by the page before it sends the browser to consume it). */
export async function getMagicLinkStatus(ctx: Ctx, input: { token: string }): Promise<MagicLinkStatus> {
  const [row] = await ctx.db
    .select({
      usedAt: magicLinks.usedAt,
      expiresAt: magicLinks.expiresAt,
      codeInvalidatedAt: signInCodes.invalidatedAt,
    })
    .from(magicLinks)
    .innerJoin(signInCodes, eq(signInCodes.id, magicLinks.signInCodeId))
    .where(eq(magicLinks.tokenHash, hashToken(input.token)));
  if (!row) return "unknown";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= ctx.now.getTime() || row.codeInvalidatedAt) return "expired";
  return "valid";
}

export type MagicLinkResult =
  | ({ status: "signed_in" } & SignInResult)
  | { status: "used" | "expired" | "unknown" };

/**
 * S1/SEC14: the one-tap link. Single-use and expiring with its code. Using the link does NOT
 * use up the code: if a mail scanner opened the link first, the person can still type the
 * code from the same message. "used"/"expired"/"unknown" are shown by the consumed-link page.
 */
export async function consumeMagicLink(
  ctx: Ctx,
  input: { token: string; deviceId?: string | null; userAgent?: string | null },
): Promise<MagicLinkResult> {
  await limitCodeEntry(ctx, { deviceId: input.deviceId, scope: "signin.link" });
  const status = await getMagicLinkStatus(ctx, { token: input.token });
  if (status !== "valid") return { status };
  const used = await ctx.db
    .update(magicLinks)
    .set({ usedAt: ctx.now })
    .where(
      and(
        eq(magicLinks.tokenHash, hashToken(input.token)),
        isNull(magicLinks.usedAt),
        gt(magicLinks.expiresAt, ctx.now),
      ),
    )
    .returning({ email: magicLinks.email });
  const link = used[0];
  if (!link) return { status: "used" };
  const result = await completeEmailSignIn(ctx, { email: link.email, userAgent: input.userAgent });
  return { status: "signed_in", ...result };
}

/**
 * SEC14: the consumed-link page may ask for ONE new code for the link's address. The answer
 * is the same whether a code was sent or not (unknown link, offer already used); the usual
 * INF4/SEC16 limits apply to the request.
 */
export async function requestCodeFromLink(
  ctx: Ctx,
  input: { token: string; deviceId?: string | null },
): Promise<{ ok: true }> {
  const data = z.object({ token: z.string().min(20).max(200), deviceId: z.string().max(200).nullish() }).parse(input);
  return withTimingFloor(async () => {
    const claimed = await ctx.db
      .update(magicLinks)
      .set({ resendUsedAt: ctx.now })
      .where(and(eq(magicLinks.tokenHash, hashToken(data.token)), isNull(magicLinks.resendUsedAt)))
      .returning({ id: magicLinks.id, email: magicLinks.email });
    const link = claimed[0];
    if (!link) return { ok: true as const };
    await limitCodeRequest(ctx, { email: link.email, deviceId: data.deviceId });
    const issued = await issueCode(ctx, { email: link.email, purpose: "sign_in" });
    await sendEmail(ctx, {
      to: link.email,
      template: "auth.signIn",
      locale: ctx.locale,
      params: {
        code: issued.code,
        linkUrl: `${appUrl()}/sign-in/link/${issued.linkToken}`,
        minutes: CODE_TTL_MINUTES,
      },
    });
    return { ok: true as const };
  });
}

/**
 * Worker only: delete what has no further use — codes and links a day past expiry, sessions
 * 30 days past their end, rate-limit windows older than two days, stale backoffs.
 */
export async function purgeExpiredAuthRows(ctx: Ctx): Promise<void> {
  requireSystem(ctx);
  const day = 24 * 60 * 60_000;
  const t = ctx.now.getTime();
  await ctx.db.delete(signInCodes).where(lt(signInCodes.expiresAt, new Date(t - day)));
  await ctx.db.delete(magicLinks).where(lt(magicLinks.expiresAt, new Date(t - day)));
  await ctx.db.delete(sessions).where(lt(sessions.expiresAt, new Date(t - 30 * day)));
  await ctx.db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.windowStart, new Date(t - 2 * day)));
  await ctx.db.delete(rateLimitBackoffs).where(lt(rateLimitBackoffs.lastStrikeAt, new Date(t - 2 * day)));
}
