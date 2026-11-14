import { listOccasions } from "@ed/core/occasions";
import { formatWeekdayDate, monthName } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Page, PageHeader, Tag } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import { zonedParts } from "@ed/shared/time";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import styles from "./_components/planning.module.css";
import { plural } from "./_lib/plural";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("occasions"))("list.title") };
}

/** A1: the planner's occasions, soonest first. Creating one is free — no payment step exists. */
export default async function OccasionsPage() {
  const ctx = await requireCtx();
  const t = await getTranslations("occasions");
  const team = await getTranslations("team");
  const items = await listOccasions(ctx);

  const newLink = (
    <Link href="/occasions/new" className={buttonClassName({ variant: "primary" })}>
      <IconPlus size={18} />
      {t("list.new")}
    </Link>
  );

  return (
    <Page>
      <PageHeader
        eyebrow={t("list.eyebrow")}
        title={t("list.title")}
        description={items.length > 0 ? t("list.description") : undefined}
        actions={items.length > 0 ? newLink : undefined}
      />
      {items.length === 0 ? (
        <EmptyState title={t("list.emptyTitle")} action={newLink}>
          {t("list.emptyBody")}
        </EmptyState>
      ) : (
        <ul className={styles.occasions}>
          {items.map(({ occasion, role, customLabel, daysLeft, pendingDeletion, openTasks }) => {
            const p = occasion.startsAt ? zonedParts(occasion.startsAt, occasion.timezone) : null;
            return (
              <li key={occasion.id}>
                <Link href={`/occasions/${occasion.id}`} className={styles.occasion}>
                  <span className={styles.plate} aria-hidden>
                    {p ? (
                      <>
                        <span className={styles.plateDay}>{p.day}</span>
                        <span className={styles.plateMonth}>
                          {monthName(p.month, ctx.locale).slice(0, 3)} {p.year}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={styles.plateDay} data-open>
                          ?
                        </span>
                        <span className={styles.plateMonth}>{t("list.noDateShort")}</span>
                      </>
                    )}
                  </span>
                  <span className={styles.occasionMain}>
                    <span className="ed-label">{t(`kinds.${occasion.kind}`)}</span>
                    <span className={styles.occasionTitle}>{occasion.title}</span>
                    <span className={styles.occasionMeta}>
                      <span>
                        {occasion.startsAt
                          ? formatWeekdayDate(occasion.startsAt, ctx.locale, occasion.timezone)
                          : t("date.byPoll")}
                      </span>
                      {occasion.venueName ? <span>{occasion.venueName}</span> : null}
                      <span>{t(`list.openTasks.${plural(openTasks, ctx.locale, { zero: true })}`, { count: openTasks })}</span>
                    </span>
                  </span>
                  <span className={styles.occasionEnd}>
                    {daysLeft !== null && occasion.status === "planning" && !pendingDeletion ? (
                      <span className={styles.countdown}>
                        {daysLeft === 0 ? t("countdown.today") : daysLeft > 0 ? t(`countdown.inDays.${plural(daysLeft, ctx.locale)}`, { count: daysLeft }) : t("countdown.past")}
                      </span>
                    ) : null}
                    {pendingDeletion ? <Tag tone="attention">{t("status.pendingDeletion")}</Tag> : null}
                    {occasion.status !== "planning" ? <Tag>{t(`status.${occasion.status}`)}</Tag> : null}
                    {role !== "owner" ? <Tag plain>{customLabel ?? team(`roles.${role}`)}</Tag> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
