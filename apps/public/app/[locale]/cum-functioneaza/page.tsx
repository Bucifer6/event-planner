import { Figure, StepProgress, cx } from "@ed/ui";
import { Ornament } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import s from "@/app/site.module.css";
import { Band, Closing, PageHead, SiteShell, emphasis } from "@/components/site-shell";
import { entries, pageLocale, type LocaleParams } from "@/lib/page";
import { pageMetadata, paths } from "@/lib/site";

type Step = { title: string; text: string; aside: string };
type Question = { q: string; a: string };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.how.meta" });
  return pageMetadata(locale, paths.how, t("title"), t("description"));
}

export default async function HowPage({ params }: LocaleParams) {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.how" });

  return (
    <SiteShell locale={locale} path={paths.how}>
      <PageHead eyebrow={t("eyebrow")} title={t.rich("title", emphasis)} lead={t("lead")} />

      <section className={cx("ed-band", s.band)} aria-label={t("stepsLabel")}>
        <div className={s.wrap}>
          <ol className={s.steps}>
            {entries<Step>(t.raw("steps")).map(([key, step]) => (
              <li key={key} className={s.step}>
                <div className={s.stepBody}>
                  <h2 className={s.itemTitle}>{step.title}</h2>
                  <p>{step.text}</p>
                </div>
                <p className={s.stepAside}>{step.aside}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={cx("ed-band", s.band)}>
        <div className={cx(s.wrap, s.split, s.splitWide)}>
          <div className={s.splitCopy}>
            <p className="ed-eyebrow">{t("guest.eyebrow")}</p>
            <h2 className={s.bandTitle}>{t.rich("guest.title", emphasis)}</h2>
            <p className="ed-lead">{t("guest.text")}</p>
          </div>
          <div className={cx("ed-invite", s.guestCard)}>
            <span className="ed-invite__kicker">{t("guest.kicker")}</span>
            <p className={cx("ed-invite__title", s.guestName)}>{t.rich("guest.name", emphasis)}</p>
            <Ornament />
            <p className="ed-invite__meta">{t("guest.meta")}</p>
            <div className={s.guestQuestion}>
              <StepProgress current={2} total={4} label={t("guest.progress")} />
              <p className="ed-label">{t("guest.progress")}</p>
              <p className={s.vignetteQuestion}>{t("guest.question")}</p>
              <div className={s.guestCounts}>
                <Figure size="sm" label={t("guest.adults")} value={t("guest.adultsValue")} />
                <Figure size="sm" label={t("guest.children")} value={t("guest.childrenValue")} />
              </div>
              <p className="ed-small ed-muted">{t("guest.childrenHint")}</p>
            </div>
          </div>
        </div>
      </section>

      <Band eyebrow={t("questions.eyebrow")} title={t.rich("questions.title", emphasis)}>
        <ul className={s.entries}>
          {entries<Question>(t.raw("questions.items")).map(([key, item]) => (
            <li key={key} className={s.entry}>
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </li>
          ))}
        </ul>
      </Band>

      <Closing title={t.rich("closing.title", emphasis)} text={t("closing.text")} cta={t("closing.cta")} />
    </SiteShell>
  );
}
