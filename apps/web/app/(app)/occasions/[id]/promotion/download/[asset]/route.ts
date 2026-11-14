import { actorAccountId } from "@ed/core/context";
import { buildPromotionCard, buildPromotionIcs, buildPromotionPoster } from "@ed/core/promotion";
import { isAppError } from "@ed/shared/errors";
import { getCtx } from "@/lib/ctx";

/**
 * C-12 downloads: card-square, card-story (PNG), calendar (.ics), poster-a4, poster-a3 (PDF).
 * A read: GET only. The file goes to the person who asked — nothing is posted anywhere.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; asset: string }> }) {
  const { id, asset } = await params;
  const ctx = await getCtx();
  if (!actorAccountId(ctx.actor)) return new Response(null, { status: 401 });
  try {
    const file =
      asset === "card-square"
        ? await buildPromotionCard(ctx, { occasionId: id, size: "square" })
        : asset === "card-story"
          ? await buildPromotionCard(ctx, { occasionId: id, size: "story" })
          : asset === "calendar"
            ? await buildPromotionIcs(ctx, id)
            : asset === "poster-a4"
              ? await buildPromotionPoster(ctx, { occasionId: id, size: "A4" })
              : asset === "poster-a3"
                ? await buildPromotionPoster(ctx, { occasionId: id, size: "A3" })
                : null;
    if (!file) return new Response(null, { status: 404 });
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
    if (isAppError(e)) return new Response(null, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    throw e;
  }
}
