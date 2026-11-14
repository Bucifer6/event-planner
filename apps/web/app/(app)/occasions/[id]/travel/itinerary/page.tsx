import { getItinerary, instantToLocal } from "@ed/core/itinerary";
import { allTimeZones, listSubgroups } from "@ed/core/subgroups";
import { formatWeekdayDate } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Notice, PageHeader, Tag } from "@ed/ui";
import { IconPlus, IconUpload } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createLegAction, deleteLegAction, updateLegAction } from "@/app/actions/travel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { DangerSheet, SheetForm } from "../_components/forms";
import { legFields } from "../_components/legForm";
import { duration, ZonedTime } from "../_components/LegTimes";
import { Tabs, travelTabs, ZONE_LIST_ID, ZoneList } from "../_components/Tabs";
import styles from "../_components/travel.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("itinerary.title") };
}

/** D-01: the itinerary, day by day. Every time is shown in the zone of the place AND in Bucharest. */
export default async function ItineraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const tc = await getTranslations("common");
  const it = await orNotFound(getItinerary(ctx, id));
  const groups = (await listSubgroups(ctx, id)).map((g) => ({ id: g.id, name: g.name }));
  const zones = allTimeZones();
  const tripTz = it.occasion.timezone;
  const closed = it.occasion.status === "closed";
  const canAdd = it.canPlan && !closed;

  const days = new Map<string, typeof it.legs>();
  for (const leg of it.legs) {
    const key = formatWeekdayDate(leg.startsAt, ctx.locale, leg.startTz);
    days.set(key, [...(days.get(key) ?? []), leg]);
  }
  const formBase = { optionalLabel: tc("optional"), pendingLabel: tc("status.saving"), zoneListId: ZONE_LIST_ID };
  const add = (variant: "primary" | "secondary") => (
    <SheetForm
      label={t("itinerary.add")}
      title={t("itinerary.addTitle")}
      closeLabel={tc("actions.close")}
      variant={variant}
      icon={<IconPlus />}
      form={{ ...formBase, id: "leg-new", action: createLegAction, hidden: { occasionId: id }, fields: legFields(t, { tripTz, subgroups: groups }), submitLabel: t("itinerary.addSubmit") }}
    />
  );
  const importLink = (
    <Link href={`/occasions/${id}/travel/itinerary/import`} className={buttonClassName({ variant: "secondary" })}>
      <IconUpload /> {t("itinerary.import")}
    </Link>
  );

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("eyebrow")} title={t("itinerary.title")} description={t("itinerary.description")} actions={canAdd && it.legs.length > 0 ? <>{importLink}{add("primary")}</> : undefined} />
      <Tabs items={travelTabs(id, t)} current="itinerary" label={t("tabs.label")} />
      <ZoneList zones={zones} />
      {it.legs.length === 0 ? (
        <EmptyState title={t("itinerary.emptyTitle")} action={canAdd ? <div className={styles.rowActions}>{add("primary")}{importLink}</div> : undefined}>
          {canAdd ? t("itinerary.emptyBody") : t("hub.emptyBodyMember")}
        </EmptyState>
      ) : (
        [...days.entries()].map(([day, legs]) => (
          <section key={day} className={styles.day}>
            <h3 className={styles.dayHead}>{day}</h3>
            <ul className={styles.legs}>
              {legs.map((leg) => (
                <li key={leg.id} className={styles.leg}>
                  <div className={styles.legHead}>
                    <h4 className={styles.legTitle}>{leg.title}</h4>
                    <span className={styles.meta}>
                      <Tag>{t(`kinds.${leg.kind}`)}</Tag>
                      {leg.subgroupName ? <Tag tone="accent">{leg.subgroupName}</Tag> : null}
                    </span>
                  </div>
                  <dl className={styles.times}>
                    <div>
                      <dt>{leg.endsAt ? t("leg.departs") : t("leg.at")}</dt>
                      <dd>
                        <ZonedTime at={leg.startsAt} tz={leg.startTz} locale={ctx.locale} bucharestLabel={t("leg.inBucharest")} />
                      </dd>
                    </div>
                    {leg.endsAt ? (
                      <div>
                        <dt>{t("leg.arrives")}</dt>
                        <dd>
                          <ZonedTime at={leg.endsAt} tz={leg.endTz} locale={ctx.locale} bucharestLabel={t("leg.inBucharest")} />
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className={styles.meta}>
                    {leg.placeFrom || leg.placeTo ? <span>{[leg.placeFrom, leg.placeTo].filter(Boolean).join(" → ")}</span> : null}
                    {duration(leg.durationMinutes) ? <span>{t("leg.duration", { duration: duration(leg.durationMinutes) ?? "" })}</span> : null}
                    {leg.reference ? <span>{t("leg.referenceShort", { code: leg.reference })}</span> : null}
                    {leg.title === "—" ? <Tag tone="attention">{t("leg.toComplete")}</Tag> : null}
                  </div>
                  {leg.arrivesBeforeLocalDeparture ? <Notice>{t("leg.clockNote")}</Notice> : null}
                  {leg.notes ? <p className="ed-small ed-muted">{leg.notes}</p> : null}
                  {leg.canEdit && !closed ? (
                    <div className={styles.rowActions}>
                      <SheetForm
                        label={tc("actions.edit")}
                        title={t("itinerary.editTitle", { title: leg.title })}
                        closeLabel={tc("actions.close")}
                        variant="quiet"
                        form={{
                          ...formBase,
                          id: `leg-${leg.id}`,
                          action: updateLegAction,
                          hidden: { occasionId: id, legId: leg.id },
                          submitLabel: tc("actions.save"),
                          fields: legFields(t, {
                            tripTz,
                            subgroups: groups,
                            values: {
                              title: leg.title,
                              kind: leg.kind,
                              startsLocal: instantToLocal(leg.startsAt, leg.startTz),
                              startTz: leg.startTz,
                              endsLocal: leg.endsAt ? instantToLocal(leg.endsAt, leg.endTz) : "",
                              endTz: leg.endsAt ? leg.endTz : "",
                              placeFrom: leg.placeFrom ?? "",
                              placeTo: leg.placeTo ?? "",
                              reference: leg.reference ?? "",
                              notes: leg.notes ?? "",
                              subgroupId: leg.subgroupId ?? "",
                            },
                          }),
                        }}
                      />
                      <DangerSheet
                        action={deleteLegAction}
                        hidden={{ occasionId: id, legId: leg.id }}
                        label={tc("actions.delete")}
                        title={t("itinerary.deleteTitle")}
                        body={t("itinerary.deleteBody", { title: leg.title })}
                        confirmLabel={t("itinerary.deleteConfirm")}
                        keepLabel={tc("actions.keep")}
                        pendingLabel={tc("status.deleting")}
                        closeLabel={tc("actions.close")}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
