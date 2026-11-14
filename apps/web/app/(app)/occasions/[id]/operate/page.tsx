import { getGuestFlow, type GuestFlow } from "@ed/core/checkin";
import { getMember } from "@ed/core/access";
import { getOccasionView } from "@ed/core/occasions";
import { listOfflineConflicts } from "@ed/core/offline";
import { getSustainability } from "@ed/core/sustainability";
import { PLANNING_ROLES } from "@ed/core/suppliers";
import { formatTime } from "@ed/i18n/format";
import { BarList, buttonClassName, Tag } from "@ed/ui";
import { IconChevronRight, IconQr } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import styles from "./_components/operate.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("operate"))("title") };
}

/**
 * Release E hub on the dark "Minuit" surface. Leads with the one number of the evening —
 * "128 din 180 sosiți" — then the arrivals per time bucket (bars from zero), the estimate of
 * when most guests will be in, and the ways in: check-in, rehearsal, my list, sync, sustainability.
 */
export default async function OperateHub({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bucket?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("operate");
  const { occasion } = await orNotFound(getOccasionView(ctx, id));
  const member = await getMember(ctx, id);
  const door = !!member && PLANNING_ROLES.includes(member.role);
  const bucket = sp.bucket === "30" ? 30 : 15;
  const flow: GuestFlow | null = door ? await getGuestFlow(ctx, id, { bucketMinutes: bucket }) : null;
  const [conflicts, sustain] = await Promise.all([listOfflineConflicts(ctx, id), getSustainability(ctx, id)]);
  const tz = occasion.timezone;
  const base = `/occasions/${id}/operate`;
  const s = flow?.summary;
  const p = flow?.projection;

  const links: Array<{ href: string; title: string; body: string; tag?: string }> = [
    ...(door ? [{ href: `${base}/rehearsal`, title: t("hub.rehearsal"), body: t("hub.rehearsalBody") }] : []),
    { href: `${base}/checklist`, title: t("hub.checklist"), body: t("hub.checklistBody") },
    { href: `${base}/offline`, title: t("hub.offline"), body: t("hub.offlineBody"), tag: conflicts.length > 0 ? t("hub.conflictsTag", { count: conflicts.length }) : undefined },
    { href: `${base}/sustainability`, title: t("hub.sustainability"), body: sustain.goals.length === 0 ? t("hub.sustainabilityNone") : t("hub.sustainabilityBody", { count: sustain.goals.length }) },
  ];

  return (
    <div data-theme="dark" className={styles.surface}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <div className={styles.hero}>
            <span className="ed-label">{s ? t("hub.heroLabel") : t("title")}</span>
            {s ? (
              <>
                <span className={styles.heroValue}>
                  {s.arrivedPeople}
                  <span className={styles.heroOf}> {t("hub.heroOf", { expected: s.expectedPeople })}</span>
                </span>
                <span className={styles.heroNote}>{t("hub.heroNote", { arrived: s.arrivedHouseholds, expected: s.expectedHouseholds, left: s.notYetHouseholds })}</span>
              </>
            ) : (
              <span className={styles.heroNote}>{t("hub.memberIntro")}</span>
            )}
          </div>
          {door ? (
            <Link href={`${base}/checkin`} className={buttonClassName({ variant: "primary" }, styles.big)}>
              <IconQr /> {t("hub.checkin")}
            </Link>
          ) : null}
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.col}>
          {flow && p ? (
            <section className={styles.block}>
              <div className={styles.blockHead}>
                <h2 className={styles.blockTitle}>{t("flow.title")}</h2>
                <nav className={styles.days} aria-label={t("flow.bucketLabel")}>
                  {[15, 30].map((b) => (
                    <Link key={b} href={`${base}?bucket=${b}`} aria-current={b === bucket ? "page" : undefined}>
                      {t("flow.bucket", { minutes: b })}
                    </Link>
                  ))}
                </nav>
              </div>
              <p>
                {p.status === "unknown" ? (
                  <>
                    {t("flow.projectionLabel")} <em className={styles.small}>{t("flow.unknown")}</em>
                  </>
                ) : p.status === "reached" ? (
                  t("flow.reached", { percent: Math.round(p.share * 100) })
                ) : (
                  t("flow.estimate", { time: formatTime(p.at, ctx.locale, tz), perHour: p.perHour })
                )}
              </p>
              {flow.buckets.length === 0 ? (
                <p className={styles.small}>{t("flow.empty")}</p>
              ) : (
                <BarList
                  sort={false}
                  items={flow.buckets.map((b) => ({
                    key: b.start.toISOString(),
                    label: `${formatTime(b.start, ctx.locale, tz)}–${formatTime(new Date(b.start.getTime() + bucket * 60_000), ctx.locale, tz)}`,
                    value: b.people,
                    display: t("flow.people", { count: b.people }),
                    highlight: b.people === Math.max(...flow.buckets.map((x) => x.people)),
                  }))}
                />
              )}
              <p className={styles.small}>{t("flow.foot")}</p>
            </section>
          ) : null}
        </div>
        <div className={styles.col}>
          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle}>{t("hub.tools")}</h2>
            </div>
            <ul className={styles.links}>
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>
                    <span className={styles.linkBody}>
                      <span className={styles.linkTitle}>
                        {l.title} {l.tag ? <Tag tone="attention">{l.tag}</Tag> : null}
                      </span>
                      <span className={styles.small}>{l.body}</span>
                    </span>
                    <IconChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
