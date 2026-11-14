import { systemCtx } from "@ed/core/context";
import { getDb } from "@ed/db";
import { applyEmailEvents, emailEventsSchema } from "@ed/email";
import { hashEquals, hashToken } from "@ed/shared/ids";

export const dynamic = "force-dynamic";

/**
 * Bounce / complaint webhook (R0-11). Feeds the suppression list: a hard-bounced or
 * complaining address is never emailed again.
 *
 * Verification: shared secret EMAIL_WEBHOOK_SECRET in "Authorization: Bearer <secret>"
 * (compared in constant time). With no secret configured the endpoint refuses everything.
 * Body: { events: [{ type: "bounce" | "complaint" | "delivered", email, permanent? }] } —
 * a provider-neutral shape; the chosen vendor's payload is mapped to it by the operator's
 * adapter (the vendor is an operator decision, so none is assumed here).
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!secret || secret.length < 16 || !given || !hashEquals(hashToken(given), hashToken(secret))) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const text = await request.text();
  if (text.length > 1_000_000) return Response.json({ ok: false }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const parsed = emailEventsSchema.safeParse(json);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const suppressed = await applyEmailEvents(systemCtx(getDb()), parsed.data);
  return Response.json({ ok: true, suppressed });
}
