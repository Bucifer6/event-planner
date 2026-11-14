import { handleStripeWebhook, stripeConfig } from "@ed/core/billing";
import { systemCtx } from "@ed/core/context";
import { getDb } from "@ed/db";
import { describeError, isAppError } from "@ed/shared/errors";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, VALIDATION: 400, NOT_FOUND: 404, CONFLICT: 409 };

/**
 * Payment-processor webhook (P24) — the ONLY thing that can change a subscription. DORMANT:
 * with no STRIPE_WEBHOOK_SECRET configured (the launch state, MON1) it answers 404 to
 * everything, like a route that does not exist.
 *
 * The raw body is verified against the `Stripe-Signature` header (HMAC-SHA256, five-minute
 * tolerance, constant-time compare) before a single byte of it is trusted; each event id is
 * handled once. A 409 asks the processor to retry (events can arrive out of order).
 * No session, no cookie, no CSRF token: the signature is the authentication.
 */
export async function POST(request: Request): Promise<Response> {
  if (!stripeConfig().webhookSecret) return new Response(null, { status: 404 });
  // refuse an oversized body by its declared length, before any of it is read
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 1_000_000) return Response.json({ ok: false }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return Response.json({ ok: false }, { status: 413 });
  try {
    const result = await handleStripeWebhook(systemCtx(getDb()), { rawBody, signature: request.headers.get("stripe-signature") });
    return Response.json({ ok: true, status: result.status });
  } catch (e) {
    if (isAppError(e)) return Response.json({ ok: false }, { status: STATUS[e.code] ?? 400 });
    console.error("[billing] webhook failed", describeError(e));
    return Response.json({ ok: false }, { status: 500 });
  }
}
