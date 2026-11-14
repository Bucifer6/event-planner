import { actorAccountId } from "@ed/core/context";
import { stationeryThumbnail } from "@ed/core/stationery";
import { isAppError } from "@ed/shared/errors";
import { getCtx } from "@/lib/ctx";

/**
 * C-04 gallery: ?design=<key> → that design's thumbnail as SVG (artwork and the occasion's
 * motif, no text). Loaded lazily by the designer's gallery. A read: GET only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!actorAccountId(ctx.actor)) return new Response(null, { status: 401 });
  const design = new URL(request.url).searchParams.get("design") ?? "";
  try {
    const svg = await stationeryThumbnail(ctx, id, design);
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isAppError(e)) return new Response(null, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    throw e;
  }
}
