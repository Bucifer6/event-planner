"use server";

import {
  beginTotpEnrolment,
  confirmFreshAuth,
  confirmNewEmail,
  confirmTotpEnrolment,
  disableTotp,
  regenerateRecoveryCodes,
  removeEmail,
  requestFreshAuthCode,
  requestNewEmailCode,
  revokeSession,
  signOutEverywhere,
} from "@ed/auth";
import { requestAccountDeletion, setAccountLocale, undoAccountDeletion } from "@ed/core/accounts";
import { zEmail, zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";
import {
  clearSessionCookie,
  ensureDeviceId,
  requestUserAgent,
  setLanguageCookie,
  setSessionCookie,
  SIGN_IN_PATH,
} from "@/lib/session";

const none = z.object({});
const zCode = z.string().trim().min(1, "common.validation.required").max(20, "common.validation.invalid");
const zNewPassword = z.string().min(1, "common.validation.required").max(200, "common.validation.tooLong");

/** S4: email the confirmation code (email accounts). */
export const requestFreshCode = action(none, async (ctx) => {
  const { expiresAt } = await requestFreshAuthCode(ctx, { deviceId: await ensureDeviceId() });
  return { expiresAt: expiresAt.toISOString() };
});

/** S4: confirm with the emailed code, or with a recovery code on an anonymous account. */
export const confirmFresh = action(
  z.object({ code: z.string().max(20).optional(), recoveryCode: z.string().max(40).optional() }),
  async (ctx, input) => {
    await confirmFreshAuth(ctx, { ...input, deviceId: await ensureDeviceId() });
    revalidatePath("/account", "layout");
    return { confirmed: true };
  },
);

export const saveLanguage = action(z.object({ locale: z.enum(["ro", "en"]) }), async (ctx, input) => {
  await setAccountLocale(ctx, input);
  await setLanguageCookie(input.locale);
  revalidatePath("/", "layout");
  return { locale: input.locale };
});

/** SEC3: sign one other device out. */
export const signOutSession = action(z.object({ sessionId: zId }), async (ctx, input) => {
  await revokeSession(ctx, input);
  revalidatePath("/account");
  return { revoked: true };
});

/** SEC3: one tap — every session (this one too) and every MCP token. */
export const signOutEverywhereAction = action(none, async (ctx) => {
  await signOutEverywhere(ctx);
  await clearSessionCookie();
  redirect(SIGN_IN_PATH);
});

/** S2 step 1: new authenticator secret + QR. */
export const startTwoStep = action(none, async (ctx) => {
  const { secret, qrDataUrl } = await beginTotpEnrolment(ctx);
  return { secret, qrDataUrl };
});

/** S2 step 2: first code from the app turns it on; returns the recovery codes once. */
export const confirmTwoStep = action(z.object({ code: zCode }), async (ctx, input) => {
  // No revalidation here: the page must keep showing the one-time recovery codes.
  return confirmTotpEnrolment(ctx, input);
});

export const turnOffTwoStep = action(none, async (ctx) => {
  await disableTotp(ctx);
  revalidatePath("/account", "layout");
  return { off: true };
});

export const newRecoveryCodes = action(none, async (ctx) => regenerateRecoveryCodes(ctx));

/** Add or change the login email, step 1: code to the new address. */
export const requestEmailCode = action(z.object({ email: zEmail }), async (ctx, input) => {
  const { expiresAt } = await requestNewEmailCode(ctx, { email: input.email, deviceId: await ensureDeviceId() });
  return { email: input.email, expiresAt: expiresAt.toISOString() };
});

/** Step 2: confirm. Every session and MCP token ends; this device gets a new session. */
export const confirmEmail = action(z.object({ email: zEmail, code: zCode }), async (ctx, input) => {
  const session = await confirmNewEmail(ctx, {
    ...input,
    deviceId: await ensureDeviceId(),
    userAgent: await requestUserAgent(),
  });
  await setSessionCookie(session.token, session.expiresAt);
  revalidatePath("/account", "layout");
  return { email: input.email };
});

/** S8: back to an anonymous account. Returns username + new recovery codes once. */
export const removeLoginEmail = action(z.object({ newPassword: zNewPassword }), async (ctx, input) => {
  const result = await removeEmail(ctx, { password: input.newPassword, userAgent: await requestUserAgent() });
  await setSessionCookie(result.token, result.expiresAt);
  return { username: result.username, recoveryCodes: result.recoveryCodes };
});

/** D6: delete the account, with seven days to undo. */
export const deleteAccount = action(none, async (ctx) => {
  const { undoUntil } = await requestAccountDeletion(ctx);
  revalidatePath("/account", "layout");
  return { undoUntil: undoUntil.toISOString() };
});

export const undoDeleteAccount = action(none, async (ctx) => {
  await undoAccountDeletion(ctx);
  revalidatePath("/account", "layout");
  return { undone: true };
});
