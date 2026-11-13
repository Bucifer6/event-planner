import { systemCtx } from "@ed/core/context";
import { handleInvoicingWebhook } from "@ed/core/invoicing";
import { getDb } from "@ed/db";
import { isAppError } from "@ed/shared/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, VALIDATION: 400, NOT_FOUND: 404 };

/**
 * Fiscal-invoicing provider webhook (PAY3): the e-Factura outcome of an invoice. DORMANT:
 * with no INVOICING_WEBHOOK_SECRET configured it answers 404 to everything.
 * Authentication: the shared secret in "Authorization: Bearer <secret>", compared in constant
 * time. Body: { invoiceId | fiscalRef, status: "issued" | "failed" | "cancelled", number?, pdfUrl? }
 * — a provider-neutral shape; the chosen provider's payload is mapped to it by its adapter.
 */
export async function POST(request: Request): Promise<Response> {
  if (!process.env.INVOICING_WEBHOOK_SECRET?.trim()) return new Response(null, { status: 404 });
  const text = await request.text();
  if (text.length > 200_000) return Response.json({ ok: false }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  try {
    const secret = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
    const result = await handleInvoicingWebhook(systemCtx(getDb()), { secret, body });
    return Response.json({ ok: true, status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false }, { status: 400 });
    if (isAppError(e)) return Response.json({ ok: false }, { status: STATUS[e.code] ?? 400 });
    console.error("[invoicing] webhook failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
