import { isManager } from "@ed/core/access";
import { getOverview } from "@ed/core/overview";
import { formatWeekdayDate } from "@ed/i18n/format";
import { buttonClassName, Card, EmptyState, Figure, List, Meter, Notice, Row, Section, Tag } from "@ed/ui";
import { IconCheck } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireCtx } from "@/lib/ctx";
import { OfferActions } from "../_components/OfferActions";
import styles from "../_components/planning.module.css";
import { TaskLine } from "../_components/TaskLine";
import { orNotFound } from "../_lib/load";
import { plural } from "../_lib/plural";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("title") };
}

function Clear({ children }: { children: ReactNode }) {
  return (
    <p className={styles.clear}>
      <IconCheck size={18} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * A10: one number first — the days to go — then the four things that need attention: next
 * milestone, overdue work, unaccepted delegations, blockers. Then the brief the plan serves.
 */
export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("overview");
  const all = await getTranslations();
  const o = await orNotFound(getOverview(ctx, id));
  const { occasion, member } = o;
  const tz = occasion.timezone;
  const base = `/occasions/${occasion.id}`;
  const manager = isManager(member);
  const text = (v: string | { key: string; params?: Record<string, string | number> }) =>
    typeof v === "string" ? v : all.has(v.key as never) ? all(v.key as never, v.params as never) : v.key;

  const dateNote = occasion.startsAt ? formatWeekdayDate(occasion.startsAt, ctx.locale, tz) : t("hero.noDateNote");
  const hero =
    o.daysLeft === null ? (
      <Figure size="hero" label={t("hero.label")} value={<em>{t("hero.noDate")}</em>} note={dateNote} />
    ) : o.daysLeft === 0 ? (
      <Figure size="hero" label={t("hero.label")} value={<em>{t("hero.today")}</em>} note={dateNote} />
    ) : o.daysLeft > 0 ? (
      <Figure size="hero" label={t("hero.label")} value={o.daysLeft} unit={t(`hero.unit.${plural(o.daysLeft, ctx.locale)}`)} note={dateNote} />
    ) : (
      <Figure size="hero" label={t("hero.labelPast")} value={-o.daysLeft} unit={t(`hero.unit.${plural(-o.daysLeft, ctx.locale)}`)} note={dateNote} />
    );

  return (
    <>
      <h1 className="ed-vh">{t("title")}</h1>
      <Card framed>
        <div className={styles.hero}>
          {hero}
          <div className={styles.heroSide}>
            {o.progress.total > 0 ? (
              <Meter value={o.progress.done} max={o.progress.total} label={t("hero.progress", { done: o.progress.done, total: o.progress.total })} />
            ) : (
              <p className="ed-muted">{t("hero.noTasks")}</p>
            )}
            <div>
              <Link href={`${base}/tasks`} className={buttonClassName({ variant: "primary" })}>
                {o.progress.total > 0 ? t("hero.openTasks") : t("hero.addFirstTask")}
              </Link>
            </div>
          </div>
        </div>
      </Card>

      {o.pendingProposals > 0 ? (
        <div style={{ marginTop: "var(--s-4)" }}>
          <Notice
            tone="accent"
            title={t(`proposals.title.${plural(o.pendingProposals, ctx.locale)}`, { count: o.pendingProposals })}
            actions={
              <Link href={`${base}/proposals`} className={buttonClassName({ size: "sm" })}>
                {t("proposals.open")}
              </Link>
            }
          >
            {t("proposals.body")}
          </Notice>
        </div>
      ) : null}

      <div className={styles.quarters} style={{ marginTop: "var(--s-5)" }}>
        <Section title={t("milestone.title")}>
          {o.nextMilestone ? (
            <div style={{ borderTop: "var(--hair) solid var(--line)" }}>
              <TaskLine task={o.nextMilestone} timezone={tz} />
            </div>
          ) : (
            <Clear>{t("milestone.empty")}</Clear>
          )}
        </Section>

        <Section
          title={
            <>
              {t("overdue.title")}
              {o.overdue.total > 0 ? <span className={styles.groupCount}>{o.overdue.total}</span> : null}
            </>
          }
        >
          {o.overdue.items.length > 0 ? (
            <div style={{ borderTop: "var(--hair) solid var(--line)" }}>
              {o.overdue.items.map((task) => (
                <TaskLine key={task.id} task={task} timezone={tz} />
              ))}
              {o.overdue.total > o.overdue.items.length ? (
                <p className="ed-small" style={{ paddingTop: "var(--s-2)" }}>
                  <Link href={`${base}/tasks`}>{t("more", { count: o.overdue.total - o.overdue.items.length })}</Link>
                </p>
              ) : null}
            </div>
          ) : (
            <Clear>{t("overdue.empty")}</Clear>
          )}
        </Section>

        <Section
          title={
            <>
              {t("delegations.title")}
              {o.offers.total > 0 ? <span className={styles.groupCount}>{o.offers.total}</span> : null}
            </>
          }
        >
          {o.offers.items.length > 0 ? (
            <List>
              {o.offers.items.map((offer) => {
                const mine = offer.toMemberId === member.id;
                return (
                  <Row
                    key={offer.id}
                    title={<Link href={`${base}/tasks/${offer.taskId}`}>{offer.taskTitle}</Link>}
                    meta={
                      mine
                        ? t("delegations.toYou", { from: offer.fromName ?? "" })
                        : t("delegations.waitingFor", { to: offer.toName ?? "", from: offer.fromName ?? "" })
                    }
                  >
                    {mine ? (
                      <div style={{ marginTop: "var(--s-2)" }}>
                        <OfferActions occasionId={occasion.id} delegationId={offer.id} taskTitle={offer.taskTitle} fromName={offer.fromName ?? ""} />
                      </div>
                    ) : null}
                  </Row>
                );
              })}
            </List>
          ) : (
            <Clear>{t("delegations.empty")}</Clear>
          )}
        </Section>

        <Section
          title={
            <>
              {t("blockers.title")}
              {o.blockers.total > 0 ? <span className={styles.groupCount}>{o.blockers.total}</span> : null}
            </>
          }
        >
          {o.blockers.items.length > 0 ? (
            <List>
              {o.blockers.items.map(({ task, reason }) => (
                <Row
                  key={`${task.id}-${reason}`}
                  title={<Link href={`${base}/tasks/${task.id}`}>{task.title}</Link>}
                  meta={t(`blockers.reason.${reason}`)}
                  end={<Tag tone="attention">{t(`blockers.tag.${reason}`)}</Tag>}
                />
              ))}
            </List>
          ) : (
            <Clear>{t("blockers.empty")}</Clear>
          )}
        </Section>
      </div>

      <div style={{ marginTop: "var(--s-6)" }}>
        <Section title={t("brief.title")} id="brief">
          {o.brief.purpose || o.brief.priorities.length > 0 ? (
            <>
              {o.brief.purpose ? <p className="ed-lead" style={{ maxWidth: "var(--measure)" }}>{o.brief.purpose}</p> : null}
              {o.brief.priorities.length > 0 ? (
                <List>
                  {o.brief.priorities.map((p) => (
                    <Row
                      key={p.index}
                      index={p.index + 1}
                      title={p.text}
                      meta={
                        <Link href={`${base}/tasks?priority=${p.index}`}>{t(`brief.linked.${plural(p.openTasks, ctx.locale, { zero: true })}`, { count: p.openTasks })}</Link>
                      }
                    />
                  ))}
                </List>
              ) : null}
              {manager ? (
                <p className="ed-small">
                  <Link href={`${base}/settings#brief`}>{t("brief.edit")}</Link>
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState
              title={t("brief.emptyTitle")}
              action={
                manager ? (
                  <Link href={`${base}/settings#brief`} className={buttonClassName()}>
                    {t("brief.write")}
                  </Link>
                ) : undefined
              }
            >
              {t("brief.emptyBody")}
            </EmptyState>
          )}
        </Section>
      </div>

      {o.extra.map((section) => (
        <div key={section.key} style={{ marginTop: "var(--s-5)" }}>
          <Section
            title={text({ key: section.titleKey })}
            actions={section.slug ? <Link href={`${base}/${section.slug}`}>{t("seeAll")}</Link> : undefined}
          >
            <List>
              {section.lines.map((line, i) => (
                <Row key={i} title={text(line)} />
              ))}
            </List>
          </Section>
        </div>
      ))}
    </>
  );
}
