import { exportDataSubject } from "@ed/core/complianceaccess";
import { resolveStaff } from "@ed/core/staff";
import { isAppError } from "@ed/shared/errors";
import { sameOriginOr403 } from "@/lib/csrf";
import { getCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

/**
 * W8: download the data-subject export as JSON — only while the three-person grant is live.
 * POST (it writes audit rows), same-origin only, behind the full console guard (S5); the
 * grant itself is checked in @ed/core/complianceaccess.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = sameOriginOr403(request);
  if (denied) return denied;
  try {
    const ctx = await resolveStaff(await getCtx());
    const out = await exportDataSubject(ctx, { grantId: (await params).id });
    return new Response(out.json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const status = isAppError(e) ? (e.code === "FORBIDDEN" || e.code === "UNAUTHENTICATED" ? 403 : e.code === "NOT_FOUND" ? 404 : 400) : 400;
    return Response.json({ ok: false, error: { code: isAppError(e) ? e.code : "VALIDATION" } }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
