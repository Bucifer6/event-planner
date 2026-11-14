import { actorAccountId } from "@ed/core/context";
import { buildStationeryPrintPdf, buildStationeryProofPdf } from "@ed/core/stationery";
import { isAppError } from "@ed/shared/errors";
import { getCtx } from "@/lib/ctx";

/**
 * C-04 downloads: ?kind=proof (any planning member; every piece, stamped PROBĂ) or
 * ?kind=print (managers; ONLY a proofed version — core refuses otherwise). A read: GET only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!actorAccountId(ctx.actor)) return new Response(null, { status: 401 });
  const q = new URL(request.url).searchParams;
  const version = Number(q.get("version")) || null;
  try {
    const file = q.get("kind") === "print" ? await buildStationeryPrintPdf(ctx, { occasionId: id, version, cropMarks: q.get("marks") === "on" }) : await buildStationeryProofPdf(ctx, { occasionId: id, version });
    return new Response(file.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isAppError(e)) {
      // the proof gate (and "nothing to print") send the person back to the page, which says why
      if (e.code === "CONFLICT") return Response.redirect(new URL(`/occasions/${id}/stationery?blocked=${encodeURIComponent(e.messageKey)}`, request.url), 303);
      return new Response(null, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    }
    throw e;
  }
}
