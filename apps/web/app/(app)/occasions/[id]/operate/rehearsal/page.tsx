import { simulateDay, type RehearsalConflict, type RehearsalStep } from "@ed/core/rehearsal";
import { BUCHAREST } from "@ed/core/itinerary";
import { formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { buttonClassName, Notice, Tag } from "@ed/ui";
import { IconAlert, IconArrowLeft, IconArrowRight } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import styles from "../_components/operate.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("operate"))("rehearsal.title") };
}

const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/**
 * E-01: the rehearsal. One step of the day at a time ("Pasul 7 din 23"), with what collides
 * said in words. STRICTLY read-only: the step is a number in the address, the page has no
 * form and no action — nothing here can change the plan (principle 3).
 */
export default async function RehearsalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string; step?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("operate");
  const sim = await orNotFound(simulateDay(ctx, id, { day: sp.day }));
  const total = sim.steps.length;
  const index = Math.min(Math.max(1, Number.parseInt(sp.step ?? "1", 10) || 1), Math.max(1, total));
  const step = sim.steps[index - 1];
  const base = `/occasions/${id}/operate/rehearsal`;
  const href = (n: number) => `${base}?${sim.day ? `day=${sim.day}&` : ""}step=${n}`;
  const tz = sim.occasion.timezone;
  const time = (d: Date, zone: string) => formatTime(d, ctx.locale, zone);

  const sentence = (c: RehearsalConflict) => {
    const p = c.params;
    if (c.code === "delivery_late") return t("rehearsal.conflicts.delivery_late", { a: String(p.a), b: String(p.b), at: time(new Date(String(p.at)), tz), need: time(new Date(String(p.need)), tz) });
    if (c.code === "overlap_person" && p.person === "*") return t("rehearsal.conflicts.overlap_everyone", { a: String(p.a), b: String(p.b) });
    return t(`rehearsal.conflicts.${c.code}`, p as Record<string, string | number>);
  };
  const conflictsOf = (s: RehearsalStep) => sim.conflicts.filter((c) => c.stepIds.includes(s.fullId));
  const mine = step ? conflictsOf(step) : [];
  const concurrent = step ? sim.steps.filter((s) => s.fullId !== step.fullId && s.startsAt.getTime() <= step.startsAt.getTime() && (s.endsAt ?? s.startsAt).getTime() > step.startsAt.getTime()) : [];
  const offTimeline = sim.conflicts.filter((c) => c.stepIds.length === 0);

  return (
    <div data-theme="dark" className={styles.surface}>
      <header className={styles.top}>
        <Link href={`/occasions/${id}/operate`} className={styles.back}>
          <IconArrowLeft size={16} /> {t("backToHub")}
        </Link>
        <div className={styles.topRow}>
          <div className={styles.hero}>
            <span className="ed-label">{t("rehearsal.eyebrow")}</span>
            <h2 className={styles.blockTitle}>{sim.day ? formatWeekdayDate(new Date(`${sim.day}T12:00:00Z`), ctx.locale, "UTC") : t("rehearsal.noDate")}</h2>
            <span className={styles.heroNote}>{t("rehearsal.readOnly")}</span>
          </div>
          <Tag tone={sim.conflicts.length > 0 ? "attention" : "success"}>{sim.conflicts.length > 0 ? t("rehearsal.conflictCount", { count: sim.conflicts.length }) : t("rehearsal.noConflicts")}</Tag>
        </div>
        {sim.days.length > 1 ? (
          <nav className={styles.days} aria-label={t("rehearsal.daysNav")}>
            {sim.days.map((d) => (
              <Link key={d} href={`${base}?day=${d}`} aria-current={d === sim.day ? "page" : undefined}>
                {dayLabel(d)}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {!step ? (
        <Notice title={sim.day ? t("rehearsal.emptyTitle") : t("rehearsal.noDate")}>
          {sim.day ? t("rehearsal.emptyBody") : t("rehearsal.noDateBody")}{" "}
          {sim.day ? <Link href={`/occasions/${id}/day`}>{t("rehearsal.emptyAction")}</Link> : null}
        </Notice>
      ) : (
        <div className={styles.layout}>
          <div className={styles.col}>
            <section className={styles.stepper} aria-live="polite">
              <span className={styles.stepCount}>{t("rehearsal.step", { n: index, total })}</span>
              <div className={styles.stepCard}>
                <div className={styles.stepHead}>
                  <span className={styles.stepTime}>{time(step.startsAt, step.tz)}</span>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                </div>
                <div className={styles.small}>
                  <Tag>{t(`rehearsal.kinds.${["task", "moment", "leg", "transport", "activity", "delivery", "return"].includes(step.kind) ? step.kind : "other"}`)}</Tag>{" "}
                  {step.endsAt ? t("rehearsal.until", { time: time(step.endsAt, step.tz) }) : null}
                  {step.tz !== tz ? ` · ${step.tz}` : ""}
                  {step.tz !== BUCHAREST ? ` · ${t("rehearsal.inBucharest", { time: time(step.startsAt, BUCHAREST) })}` : ""}
                </div>
                {step.place ? <div className={styles.small}>{t("rehearsal.place", { place: step.place })}</div> : null}
                {step.everyone ? <div className={styles.small}>{t("rehearsal.everyone")}</div> : step.people && step.people.length > 0 ? <div className={styles.small}>{t("rehearsal.who", { names: step.people.map((p) => p.label).join(", ") })}</div> : null}
                {step.supplier ? <div className={styles.small}>{t("rehearsal.supplier", { name: step.supplier.label })}</div> : null}
                {step.capacity ? <div className={styles.small}>{t("rehearsal.capacity", { used: step.capacity.used, total: step.capacity.total })}</div> : null}
                {mine.length > 0 ? (
                  <ul className={styles.conflicts} aria-label={t("rehearsal.conflictsHere")}>
                    {mine.map((c, i) => (
                      <li key={i} className={styles.conflict}>
                        <IconAlert size={18} />
                        <span>{sentence(c)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={styles.small}>{t("rehearsal.stepClear")}</div>
                )}
                {concurrent.length > 0 ? <div className={styles.small}>{t("rehearsal.meanwhile", { titles: concurrent.map((c) => c.title).join(", ") })}</div> : null}
                {step.slug ? (
                  <div>
                    <Link href={`/occasions/${id}/${step.slug}`}>{t("rehearsal.open")}</Link>
                  </div>
                ) : null}
              </div>
              <nav className={styles.stepNav} aria-label={t("rehearsal.stepNav")}>
                {index > 1 ? (
                  <Link href={href(index - 1)} className={buttonClassName({ variant: "secondary" })} rel="prev">
                    <IconArrowLeft /> {t("rehearsal.back")}
                  </Link>
                ) : (
                  <span className={buttonClassName({ variant: "secondary" })} aria-disabled="true">
                    <IconArrowLeft /> {t("rehearsal.back")}
                  </span>
                )}
                {index < total ? (
                  <Link href={href(index + 1)} className={buttonClassName({ variant: "primary" })} rel="next">
                    {t("rehearsal.next")} <IconArrowRight />
                  </Link>
                ) : (
                  <Link href={href(1)} className={buttonClassName({ variant: "secondary" })}>
                    {t("rehearsal.restart")}
                  </Link>
                )}
              </nav>
            </section>
            {offTimeline.length > 0 ? (
              <section className={styles.block}>
                <div className={styles.blockHead}>
                  <h3 className={styles.blockTitle}>{t("rehearsal.offTimeline")}</h3>
                </div>
                <ul className={styles.conflicts}>
                  {offTimeline.map((c, i) => (
                    <li key={i} className={styles.conflict}>
                      <IconAlert size={18} />
                      <span>{sentence(c)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <div className={styles.col}>
            <section className={styles.block}>
              <div className={styles.blockHead}>
                <h3 className={styles.blockTitle}>{t("rehearsal.timeline")}</h3>
              </div>
              <ol className={styles.timeline}>
                {sim.steps.map((s, i) => (
                  <li key={s.fullId}>
                    <Link href={href(i + 1)} aria-current={i + 1 === index ? "step" : undefined}>
                      <span>{time(s.startsAt, s.tz)}</span>
                      <span>{s.title}</span>
                      {conflictsOf(s).length > 0 ? (
                        <span aria-label={t("rehearsal.hasConflict")}>
                          <IconAlert size={16} />
                        </span>
                      ) : (
                        <span />
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
