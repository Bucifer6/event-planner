import { consumeMagicLink } from "@ed/auth";
import { isAppError } from "@ed/shared/errors";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/ctx";
import { applySignIn, ensureDeviceId, requestUserAgent, SIGN_IN_PATH } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Uses the one-tap sign-in link up (S1, SEC14) and sets the session cookie — a page cannot
 * set cookies, so /sign-in/link/[token] sends live links here. Anything else goes back to
 * that page, which explains and offers the code path.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let next = `${SIGN_IN_PATH}?e=limited`;
  if (/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    try {
      const ctx = await getCtx();
      const result = await consumeMagicLink(ctx, {
        token,
        deviceId: await ensureDeviceId(),
        userAgent: await requestUserAgent(),
      });
      next = result.status === "signed_in" ? await applySignIn(result) : `/sign-in/link/${token}`;
    } catch (e) {
      if (!isAppError(e)) console.error("[auth] one-tap link failed", e instanceof Error ? e.message : e);
    }
  }
  redirect(next);
}
