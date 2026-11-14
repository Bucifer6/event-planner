import { getBusinessReport } from "@ed/core/bizoccasions";
import { formatDate, formatInteger } from "@ed/i18n/format";
import { BarList, EmptyState, Figure, Figures, List, Section, Table, Unknown } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { plural } from "@/app/(app)/occasions/_lib/plural";
import { requireCtx } from "@/lib/ctx";
import biz from "../occasions/biz.module.css";
import styles from "../../business.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bizoccasions"))("tabs.reports") };
}

/**
 * P21: the business's occasions at a glance and how its shared assets are used. Counts and
 * daily totals only — nothing here says who did what (D4), and nothing about guests.
 */
export default async function BusinessReportsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("bizoccasions");
  const c = await getTranslations("common");
  const r = await orNotFound(getBusinessReport(ctx, businessId));
  const n = (v: number) => formatInteger(v, ctx.locale);
  const inWork = r.occasions.byStatus.planning + r.occasions.byStatus.postponed;

  return (
    <>
      <Section title={t("reports.title")} level={2}>
        <Figure size="hero" label={t("reports.inWork")} value={n(inWork)} note={t("reports.inWorkNote", { total: n(r.occasions.total + r.occasions.handedOver) })} />
        <Figures>
          <Figure label={t("reports.overdue")} value={n(r.tasks.overdue)} note={t("reports.today")} noteTone={r.tasks.overdue > 0 ? "danger" : undefined} />
          <Figure label={t("reports.openTasks")} value={n(r.tasks.open)} note={t("reports.today")} />
          <Figure label={t("reports.handedOver")} value={n(r.occasions.handedOver)} note={t("reports.allTime")} />
          <Figure
            label={t("reports.enquiries")}
            value={r.enquiries ? n(r.enquiries.received) : <Unknown label={c("unknown")} />}
            note={r.enquiries ? t("reports.enquiriesNote", { days: r.days, unanswered: n(r.enquiries.unanswered) }) : t("reports.lastDays", { days: r.days })}
          />
        </Figures>
      </Section>

      <Section title={t("reports.byStatus")} level={2}>
        <div className={biz.narrow}>
          <Table caption={t("reports.byStatus")}>
            <thead>
              <tr>
                <th scope="col">{t("reports.status")}</th>
                <th scope="col" data-num>
                  {t("reports.occasions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(["planning", "postponed", "cancelled", "closed"] as const).map((s) => (
                <tr key={s}>
                  <td>{t(`status.${s}`)}</td>
                  <td data-num className="ed-num">
                    {n(r.occasions.byStatus[s])}
                  </td>
                </tr>
              ))}
              <tr>
                <td>{t("reports.handedOver")}</td>
                <td data-num className="ed-num">
                  {n(r.occasions.handedOver)}
                </td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Section>

      <Section title={t("reports.upcoming")} level={2}>
        {r.upcoming.length === 0 ? (
          <EmptyState title={t("reports.upcomingEmpty")} />
        ) : (
          <List>
            {r.upcoming.map((u) => (
              <li key={u.id} className="ed-row">
                <div className="ed-row__main">
                  <Link href={`/occasions/${u.id}`} className={`ed-row__title ${styles.rowLink}`}>
                    {u.title}
                  </Link>
                  <span className="ed-row__meta">{formatDate(u.startsAt, ctx.locale, u.timezone)}</span>
                </div>
                <div className="ed-row__end ed-num">{u.daysLeft === 0 ? t("reports.todayShort") : t(`reports.inDays.${plural(u.daysLeft, ctx.locale)}`, { count: u.daysLeft })}</div>
              </li>
            ))}
          </List>
        )}
      </Section>

      <Section title={t("reports.assetUse", { days: r.days })} level={2}>
        <p className="ed-muted">{t("reports.assetUseBody")}</p>
        {r.assetUse.total === 0 ? (
          <EmptyState title={t("reports.assetUseEmpty")} />
        ) : (
          <div className={styles.twoCol}>
            <BarList
              items={r.assetUse.byKind.map((k, i) => ({
                key: k.kind,
                label: t.has(`reports.assetKinds.${k.kind}` as never) ? t(`reports.assetKinds.${k.kind}` as never) : k.kind,
                value: k.value,
                display: n(k.value),
                highlight: i === 0,
              }))}
            />
            <Table caption={t("reports.byDay")}>
              <thead>
                <tr>
                  <th scope="col">{t("reports.day")}</th>
                  <th scope="col" data-num>
                    {t("reports.uses")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...r.assetUse.byDay].reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{d.day.split("-").reverse().join(".")}</td>
                    <td data-num className="ed-num">
                      {n(d.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Section>
    </>
  );
}
