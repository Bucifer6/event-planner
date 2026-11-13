import { isManager } from "@ed/core/access";
import { getOccasionView } from "@ed/core/occasions";
import { formatDate, formatDateTime, formatWeekdayDate } from "@ed/i18n/format";
import { Notice, Page, Stack } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { undoDeleteOccasionAction } from "@/app/actions/occasions";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { OccasionFrame } from "@/components/shell/OccasionFrame";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../_lib/load";
import { plural } from "../_lib/plural";

/**
 * Frame of every occasion page. Members only (anyone else gets "not found"). Sections a member
 * has no grant for are not even listed: budget and shared costs need the finance grant,
 * private requests their own grant (D2).
 */
export default async function OccasionLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("occasions");
  const { occasion, member, deletion, daysLeft } = await orNotFound(getOccasionView(ctx, id));
  const tz = occasion.timezone;

  const dateShort = occasion.startsAt
    ? occasion.endsAt
      ? `${formatDate(occasion.startsAt, ctx.locale, tz)} – ${formatDate(occasion.endsAt, ctx.locale, tz)}`
      : formatDate(occasion.startsAt, ctx.locale, tz)
    : t("date.byPoll");
  const meta: ReactNode[] = [];
  if (occasion.startsAt) meta.push(formatWeekdayDate(occasion.startsAt, ctx.locale, tz));
  if (occasion.venueName) meta.push(occasion.venueName);
  if (daysLeft !== null && occasion.status === "planning") {
    meta.push(daysLeft === 0 ? t("countdown.today") : daysLeft > 0 ? t(`countdown.inDays.${plural(daysLeft, ctx.locale)}`, { count: daysLeft }) : t("countdown.past"));
  }

  const hiddenKeys: string[] = [];
  if (!member.grants.finance) hiddenKeys.push("budget", "ledger");
  if (!member.grants.privateRequests) hiddenKeys.push("requests");

  const banner =
    deletion || occasion.status !== "planning" ? (
      <Page>
        <Stack gap={3}>
          {deletion ? (
            <Notice tone="attention" title={t("deletion.bannerTitle")}>
              <Stack gap={3}>
                <span>{t("deletion.bannerBody", { date: formatDateTime(deletion.undoUntil, ctx.locale) })}</span>
                {isManager(member) ? (
                  <ActionForm
                    action={undoDeleteOccasionAction}
                    hidden={{ occasionId: occasion.id }}
                    refreshOnSuccess
                    variant="secondary"
                    block={false}
                    submitLabel={t("deletion.undo")}
                    pendingLabel={t("deletion.undoing")}
                  />
                ) : null}
              </Stack>
            </Notice>
          ) : null}
          {occasion.status !== "planning" ? (
            <Notice tone={occasion.status === "cancelled" ? "danger" : "attention"} title={t(`statusBanner.${occasion.status}.title`)} role="status">
              {t(`statusBanner.${occasion.status}.body`)}
            </Notice>
          ) : null}
        </Stack>
      </Page>
    ) : undefined;

  return (
    <OccasionFrame
      occasionId={occasion.id}
      eyebrow={`${t(`kinds.${occasion.kind}`)} · ${dateShort}`}
      title={occasion.title}
      meta={meta}
      hiddenKeys={hiddenKeys}
      banner={banner}
    >
      {children}
    </OccasionFrame>
  );
}
