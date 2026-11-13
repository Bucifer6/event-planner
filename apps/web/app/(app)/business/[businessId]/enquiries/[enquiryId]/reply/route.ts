import { replyAsBusiness } from "@ed/core/enquiries";
import { AppError } from "@ed/shared/errors";
import { MAX_FILE_BYTES } from "@ed/storage";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { runAction, type ActionErrorCode, type Translator } from "@/lib/action-core";
import { sameOriginOr403 } from "@/lib/csrf";
import { getCtx } from "@/lib/ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<ActionErrorCode, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, TAKEN: 409, LIMIT: 413, RATE_LIMITED: 429, UNEXPECTED: 500 };
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

const schema = z.object({
  body: z.string().max(4000, "common.validation.tooLong").default(""),
  quoteFile: z.instanceof(File).optional(),
});

/**
 * POST multipart/form-data (body, quoteFile?) — the business's reply to an enquiry, with an
 * optional PDF marked as its quote (P12). A route handler rather than a Server Action
 * because a PDF may be 10 MB. Same-origin only (SEC6); the size is refused before the body
 * is read; membership of the business is checked in @ed/core/enquiries. Answers in the same
 * { ok, data | error } shape as Server Actions.
 */
export async function POST(request: Request, { params }: { params: Promise<{ businessId: string; enquiryId: string }> }): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const denied = sameOriginOr403(request);
  if (denied) return denied;
  const { businessId, enquiryId } = await params;
  const t = await getTranslations();
  const translator: Translator = { t: (key, p) => t(key as never, p as never), has: (key) => t.has(key as never) };
  const invalid = (status: number, message: string, field?: string) =>
    Response.json({ ok: false, error: { code: "VALIDATION", message, ...(field ? { fieldErrors: { [field]: [message] } } : {}) } }, { status, headers });

  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) return invalid(411, t("common.errors.VALIDATION"));
  if (declared > MAX_REQUEST_BYTES) return invalid(413, t("platform.upload.tooLarge"), "quoteFile");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalid(400, t("common.errors.VALIDATION"));
  }

  const result = await runAction({
    schema,
    rawInput: form,
    getCtx,
    translator,
    handler: async (ctx, input) => {
      const file = input.quoteFile && input.quoteFile.size > 0 ? input.quoteFile : null;
      if (file && file.size > MAX_FILE_BYTES) throw new AppError("VALIDATION", "platform.upload.tooLarge", { fieldErrors: { quoteFile: ["platform.upload.tooLarge"] } });
      const res = await replyAsBusiness(ctx, {
        enquiryId,
        body: input.body,
        quoteFile: file ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()), mime: file.type } : null,
      });
      revalidatePath(`/business/${businessId}/enquiries`, "layout");
      return { messageId: res.messageId };
    },
  });
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.error.code], headers });
}
