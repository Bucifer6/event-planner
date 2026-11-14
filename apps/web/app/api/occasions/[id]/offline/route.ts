import { getOfflineBundle, listOfflineConflicts, offlineSubmitSchema, submitOfflineItems } from "@ed/core/offline";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { runAction, type ActionErrorCode, type Translator } from "@/lib/action-core";
import { sameOriginOr403 } from "@/lib/csrf";
import { getCtx } from "@/lib/ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// E-03 offline capture endpoint.
//   GET   what a device keeps for offline work: the check-in roster (planning members only)
//         and the person's own checklist, with an expiry. Never cached by the service worker
//         or by HTTP (no-store) — the page stores it in IndexedDB itself.
//   POST  { items: [{ clientKey, kind: "arrival" | "tick", payload, capturedAt }] } — the
//         device's queue. Session + membership are checked in core; same-origin only (SEC6).
//         Idempotent by (occasion, clientKey): replaying the same request is safe (Q4).

const STATUS: Record<ActionErrorCode, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, TAKEN: 409, LIMIT: 413, RATE_LIMITED: 429, UNEXPECTED: 500 };
const headers = { "Cache-Control": "no-store, private" };
const MAX_BODY_BYTES = 512 * 1024;

async function translator(): Promise<Translator> {
  const t = await getTranslations();
  return { t: (key, params) => t(key as never, params as never), has: (key) => t.has(key as never) };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const result = await runAction({
    schema: z.object({ occasionId: z.string().min(1).max(64) }),
    rawInput: { occasionId: id },
    getCtx,
    translator: await translator(),
    handler: async (ctx, input) => {
      const [bundle, conflicts] = await Promise.all([getOfflineBundle(ctx, input.occasionId), listOfflineConflicts(ctx, input.occasionId)]);
      return { bundle, conflicts: conflicts.length };
    },
  });
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.error.code], headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = sameOriginOr403(request);
  if (denied) return denied;
  const { id } = await params;
  const tr = await translator();
  const bad = (status: number) => Response.json({ ok: false, error: { code: "VALIDATION", message: tr.t("common.errors.VALIDATION") } }, { status, headers });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return bad(413);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return bad(413);
    body = JSON.parse(raw);
  } catch {
    return bad(400);
  }
  const result = await runAction({
    schema: offlineSubmitSchema,
    rawInput: body,
    getCtx,
    translator: tr,
    handler: (ctx, input) => submitOfflineItems(ctx, { occasionId: id, items: input.items }),
  });
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.error.code], headers });
}
