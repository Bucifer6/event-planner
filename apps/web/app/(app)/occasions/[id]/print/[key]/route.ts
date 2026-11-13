import { actorAccountId } from "@ed/core/context";
import { runExport } from "@ed/core/exports";
import { isAppError } from "@ed/shared/errors";
import { getCtx } from "@/lib/ctx";

/**
 * A12: download one export of the occasion (/occasions/<id>/print/<key>). A read: GET only.
 * @ed/core decides who may run it; a non-member and an unknown export both get 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  const ctx = await getCtx();
  if (!actorAccountId(ctx.actor)) return new Response(null, { status: 401 });
  try {
    const file = await runExport(ctx, id, key);
    const ascii = file.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(file.content, {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isAppError(e)) return new Response(null, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    throw e;
  }
}
