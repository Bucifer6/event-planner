import { getTranslations } from "next-intl/server";
import { runAction, type ActionErrorCode, type Translator } from "@/lib/action-core";
import { sameOriginOr403 } from "@/lib/csrf";
import { getCtx } from "@/lib/ctx";
import { handleUpload, MAX_UPLOAD_REQUEST_BYTES, uploadSchema } from "./handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<ActionErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  TAKEN: 409,
  LIMIT: 413,
  RATE_LIMITED: 429,
  UNEXPECTED: 500,
};

/**
 * POST multipart/form-data: file, purpose, ownerId → the same { ok, data | error } shape as
 * Server Actions. Same-origin only (SEC6); the body size is refused before it is read.
 */
export async function POST(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const denied = sameOriginOr403(request);
  if (denied) return denied;

  const t = await getTranslations();
  const translator: Translator = {
    t: (key, params) => t(key as never, params as never),
    has: (key) => t.has(key as never),
  };
  const tooLarge = () =>
    Response.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: t("platform.upload.tooLarge"),
          fieldErrors: { file: [t("platform.upload.tooLarge")] },
        },
      },
      { status: 413, headers },
    );

  // Size guard before reading anything: a declared length is required and capped.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) {
    return Response.json({ ok: false, error: { code: "VALIDATION", message: t("common.errors.VALIDATION") } }, { status: 411, headers });
  }
  if (declared > MAX_UPLOAD_REQUEST_BYTES) return tooLarge();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: { code: "VALIDATION", message: t("common.errors.VALIDATION") } }, { status: 400, headers });
  }

  const result = await runAction({
    schema: uploadSchema,
    handler: handleUpload,
    rawInput: form,
    getCtx,
    translator,
  });
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.error.code], headers });
}
