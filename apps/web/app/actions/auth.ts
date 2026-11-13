"use server";

import {
  createAnonymousAccount,
  recoverAnonymousAccount,
  requestCodeFromLink,
  requestSignInCode,
  signInAnonymous,
  signOut,
  verifySecondFactor,
  verifySignInCode,
} from "@ed/auth";
import { setAccountLocale } from "@ed/core/accounts";
import { actorAccountId } from "@ed/core/context";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD } from "@ed/core/ratelimit";
import { isLocale } from "@ed/i18n/config";
import { AppError } from "@ed/shared/errors";
import { zEmail } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";
import { getCtx } from "@/lib/ctx";
import {
  AFTER_SIGN_IN_PATH,
  applySignIn,
  clearSessionCookie,
  ensureDeviceId,
  getSessionToken,
  requestUserAgent,
  setLanguageCookie,
  setSessionCookie,
  SIGN_IN_PATH,
} from "@/lib/session";

const zCode = z.string().trim().min(1, "common.validation.required").max(20, "common.validation.invalid");

/**
 * Language switch (L2): sets the ed_lang cookie and, when signed in, saves it on the account.
 * Plain form action: <form action={setLanguage}><button name="locale" value="en">.
 */
export async function setLanguage(formData: FormData): Promise<void> {
  const value = formData.get("locale") ?? formData.get("lang");
  if (!isLocale(value)) return;
  await setLanguageCookie(value);
  const ctx = await getCtx();
  if (actorAccountId(ctx.actor)) await setAccountLocale(ctx, { locale: value });
  revalidatePath("/", "layout");
}

/** S1 step 1: email a code + one-tap link. Same answer for every address (SEC1). */
export const requestCode = action(
  z.object({ email: zEmail }),
  async (ctx, input) => {
    const deviceId = await ensureDeviceId();
    const { expiresAt } = await requestSignInCode(ctx, { email: input.email, deviceId });
    return { email: input.email, expiresAt: expiresAt.toISOString() };
  },
  { auth: "public" },
);

/** S1 step 2: confirm the code (by address, or by link token on the consumed-link page). */
export const verifyCode = action(
  z.object({ email: zEmail.optional(), linkToken: z.string().max(200).optional(), code: zCode }),
  async (ctx, input) => {
    const deviceId = await ensureDeviceId();
    const result = await verifySignInCode(ctx, {
      email: input.email,
      linkToken: input.linkToken,
      code: input.code,
      deviceId,
      userAgent: await requestUserAgent(),
    });
    redirect(await applySignIn(result));
  },
  { auth: "public" },
);

/** SEC14: the one new code the consumed-link page may ask for. */
export const resendFromLink = action(
  z.object({ linkToken: z.string().min(20).max(200) }),
  async (ctx, input) => {
    const deviceId = await ensureDeviceId();
    await requestCodeFromLink(ctx, { token: input.linkToken, deviceId });
    return { sent: true };
  },
  { auth: "public" },
);

/** S2: second step for accounts that turned two-step on. */
export const verifyTwoStep = action(
  z.object({ code: z.string().max(20).optional(), recoveryCode: z.string().max(40).optional() }),
  async (ctx, input) => {
    const token = await getSessionToken();
    if (!token) throw new AppError("UNAUTHENTICATED", "auth.errors.secondFactorExpired");
    const deviceId = await ensureDeviceId();
    const recoveryCode = input.recoveryCode?.trim() || undefined;
    const done = await verifySecondFactor(ctx, {
      sessionToken: token,
      code: recoveryCode ? undefined : input.code,
      recoveryCode,
      deviceId,
    });
    await setSessionCookie(token, done.expiresAt);
    redirect(AFTER_SIGN_IN_PATH);
  },
  { auth: "public" },
);

/** S7: create an anonymous account. Returns the username and recovery codes — shown once. */
export const anonymousSignUp = action(
  z.object({
    password: z.string().min(1, "common.validation.required").max(200, "common.validation.tooLong"),
    [HONEYPOT_FIELD]: z.string().max(500).optional(),
    [FORM_STAMP_FIELD]: z.string().max(200).optional(),
  }),
  async (ctx, input) => {
    await ensureDeviceId();
    const result = await createAnonymousAccount(ctx, {
      password: input.password,
      honeypot: input[HONEYPOT_FIELD],
      renderedAt: input[FORM_STAMP_FIELD],
      userAgent: await requestUserAgent(),
    });
    await applySignIn(result);
    return { username: result.username, recoveryCodes: result.recoveryCodes };
  },
  { auth: "public" },
);

/** S8: username + password. */
export const anonymousSignIn = action(
  z.object({
    username: z.string().trim().min(1, "common.validation.required").max(100, "common.validation.tooLong"),
    password: z.string().min(1, "common.validation.required").max(200, "common.validation.tooLong"),
  }),
  async (ctx, input) => {
    const deviceId = await ensureDeviceId();
    const result = await signInAnonymous(ctx, { ...input, deviceId, userAgent: await requestUserAgent() });
    redirect(await applySignIn(result));
  },
  { auth: "public" },
);

/** S8: username + recovery code + new password. */
export const anonymousRecover = action(
  z.object({
    username: z.string().trim().min(1, "common.validation.required").max(100, "common.validation.tooLong"),
    recoveryCode: z.string().trim().min(1, "common.validation.required").max(40, "common.validation.invalid"),
    newPassword: z.string().min(1, "common.validation.required").max(200, "common.validation.tooLong"),
  }),
  async (ctx, input) => {
    const deviceId = await ensureDeviceId();
    const result = await recoverAnonymousAccount(ctx, { ...input, deviceId, userAgent: await requestUserAgent() });
    redirect(await applySignIn(result));
  },
  { auth: "public" },
);

/** Sign this device out. Plain form action (POST only, so a link cannot sign anyone out). */
export async function signOutAction(): Promise<void> {
  const ctx = await getCtx();
  await signOut(ctx, { token: await getSessionToken() });
  await clearSessionCookie();
  redirect(SIGN_IN_PATH);
}
