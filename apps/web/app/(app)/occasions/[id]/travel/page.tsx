import { getItinerary, BUCHAREST } from "@ed/core/itinerary";
import { listPackingLists } from "@ed/core/packing";
import { getRooming } from "@ed/core/rooms";
import { listTransport } from "@ed/core/transport";
import { formatInZone, formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { buttonClassName, Card, EmptyState, Figure, Figures, PageHeader, Tag } from "@ed/ui";
import { IconArrowRight, IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { duration } from "./_components/LegTimes";
import { Tabs, travelTabs } from "./_components/Tabs";
import styles from "./_components/travel.module.css";
import { HelpLink } from "@/components/help/HelpLink";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("title") };
}

/**
 * Release D hub: calm. Leads with the next departure — its local time and the time in
 * Bucharest — then the tabs and four quiet numbers.
 */
export default async function TravelHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const it = await orNotFound(getItinerary(ctx, id));
  const [rooming, transport, packing] = await Promise.all([getRooming(ctx, id), listTransport(ctx, id), listPackingLists(ctx, id)]);
  const next = it.next;
  const base = `/occasions/${id}/travel`;
  const started = next ? next.startsAt.getTime() < ctx.now.getTime() : false;
  const seats = transport.reduce((n, v) => n + (v.seats ?? 0), 0);
  const seatsTaken = transport.reduce((n, v) => n + v.taken, 0);
  const packed = packing.reduce((n, l) => n + l.done, 0);
  const toPack = packing.reduce((n, l) => n + l.total, 0);

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <HelpLink topic="travel" />
      {next ? (
        <Card framed>
          <div className={styles.heroBody}>
            <span className={styles.heroLabel}>{started ? t("hub.underWay") : t("hub.next")}</span>
            <h3 className={styles.heroTitle}>{next.title}</h3>
            <dl className={styles.heroTimes}>
              <div>
                <dt>{t("hub.localTime")}</dt>
                <dd>
                  {formatTime(next.startsAt, ctx.locale, next.startTz)}
                  <small>
                    {formatWeekdayDate(next.startsAt, ctx.locale, next.startTz)} · {next.startTz}
                  </small>
                </dd>
              </div>
              <div>
                <dt>{t("hub.bucharestTime")}</dt>
                <dd>
                  {formatTime(next.startsAt, ctx.locale, BUCHAREST)}
                  <small>{formatWeekdayDate(next.startsAt, ctx.locale, BUCHAREST)}</small>
                </dd>
              </div>
            </dl>
            <div className={styles.meta}>
              <Tag>{t(`kinds.${next.kind}`)}</Tag>
              {next.placeFrom || next.placeTo ? <span>{[next.placeFrom, next.placeTo].filter(Boolean).join(" → ")}</span> : null}
              {next.endsAt ? <span>{t("hub.arrives", { time: formatInZone(next.endsAt, next.endTz, ctx.locale), zone: next.endTz })}</span> : null}
              {duration(next.durationMinutes) ? <span>{t("leg.duration", { duration: duration(next.durationMinutes) ?? "" })}</span> : null}
              {next.reference ? <span>{t("leg.referenceShort", { code: next.reference })}</span> : null}
            </div>
            <div>
              <Link href={`${base}/itinerary`} className={buttonClassName({ variant: "secondary" })}>
                {t("hub.seeItinerary")} <IconArrowRight />
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState
          title={it.legs.length === 0 ? t("hub.emptyTitle") : t("hub.doneTitle")}
          action={
            it.canPlan ? (
              <Link href={`${base}/itinerary`} className={buttonClassName({ variant: "primary" })}>
                <IconPlus /> {it.legs.length === 0 ? t("hub.addFirst") : t("hub.seeItinerary")}
              </Link>
            ) : undefined
          }
        >
          {it.legs.length === 0 ? (it.canPlan ? t("hub.emptyBody") : t("hub.emptyBodyMember")) : t("hub.doneBody")}
        </EmptyState>
      )}

      <Tabs items={travelTabs(id, t)} current="hub" label={t("tabs.label")} />

      <Figures>
        <Figure size="sm" label={t("hub.figures.legs")} value={it.legs.length} note={t("hub.figures.legsNote")} />
        <Figure size="sm" label={t("hub.figures.beds")} value={rooming.beds.total === 0 ? "—" : `${rooming.beds.taken} / ${rooming.beds.total}`} note={rooming.beds.total === 0 ? t("hub.figures.noRooms") : t("hub.figures.bedsNote")} />
        <Figure size="sm" label={t("hub.figures.seats")} value={transport.length === 0 ? "—" : seats > 0 ? `${seatsTaken} / ${seats}` : seatsTaken} note={transport.length === 0 ? t("hub.figures.noTransport") : t("hub.figures.seatsNote")} />
        <Figure size="sm" label={t("hub.figures.packing")} value={toPack === 0 ? "—" : `${packed} / ${toPack}`} note={toPack === 0 ? t("hub.figures.noPacking") : t("hub.figures.packingNote")} />
      </Figures>
    </div>
  );
}
