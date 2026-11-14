import { exportGuestsCsv, type GuestCsvLabels } from "@ed/core/guests";
import { formatDateTime } from "@ed/i18n/format";
import { describeError, isAppError } from "@ed/shared/errors";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/lib/ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the guest list as CSV — owner / PM only (it contains contacts, D2). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("guests");
  const labels: GuestCsvLabels = {
    household: t("csv.household"),
    lead: t("csv.lead"),
    email: t("csv.email"),
    language: t("csv.language"),
    adults: t("csv.adults"),
    status: t("csv.status"),
    adultsCount: t("csv.adultsCount"),
    childrenCount: t("csv.childrenCount"),
    answeredAt: t("csv.answeredAt"),
    statuses: { yes: t("status.yes"), maybe: t("status.maybe"), no: t("status.no"), pending: t("status.pending") },
  };
  try {
    const csv = await exportGuestsCsv(ctx, {
      occasionId: id,
      labels,
      formatDate: (d) => formatDateTime(d, ctx.locale),
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${t("csv.fileName")}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const status = isAppError(e) ? (e.code === "FORBIDDEN" ? 403 : e.code === "UNAUTHENTICATED" ? 401 : 404) : 500;
    if (status === 500) console.error("[guests.export]", describeError(e, { frames: true }));
    return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  }
}
