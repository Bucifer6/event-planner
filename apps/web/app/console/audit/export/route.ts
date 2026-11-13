import { auditFilterSchema, exportAuditCsv } from "@ed/core/auditview";
import { resolveStaff } from "@ed/core/staff";
import { isAppError } from "@ed/shared/errors";
import { sameOriginOr403 } from "@/lib/csrf";
import { getCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

/**
 * W8: download a read-only CSV copy of the filtered audit log. POST (it writes one audit row:
 * the export itself), same-origin only, and behind the full console guard (S5).
 */
export async function POST(request: Request): Promise<Response> {
  const denied = sameOriginOr403(request);
  if (denied) return denied;
  try {
    const ctx = await resolveStaff(await getCtx());
    const form = await request.formData();
    const filter = auditFilterSchema.parse(
      Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")),
    );
    const out = await exportAuditCsv(ctx, filter);
    // BOM so spreadsheet programs read the diacritics as UTF-8
    return new Response(String.fromCharCode(0xfeff) + out.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const status = isAppError(e) ? (e.code === "FORBIDDEN" || e.code === "UNAUTHENTICATED" ? 403 : 400) : 400;
    return Response.json({ ok: false, error: { code: isAppError(e) ? e.code : "VALIDATION" } }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
