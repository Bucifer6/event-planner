import { Figure, Figures, List, Row, buttonClassName, cx } from "@ed/ui";
import { IconArrowRight } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import s from "@/app/site.module.css";
import { Band, Closing, SiteShell, emphasis } from "@/components/site-shell";
import { InvitationPlate, Plate, RsvpVignette, TasksVignette, WhatIfVignette } from "@/components/vignettes";
import { entries, pageLocale, type LocaleParams } from "@/lib/page";
import { href, pageMetadata, paths } from "@/lib/site";

type Item = { title: string; text: string };
type FactItem = { title: string; meta: string };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.home.meta" });
  return { ...pageMetadata(locale, paths.home, t("title"), t("description")), title: { absolute: `EventDesk.ro — ${t("title")}` } };
}

export default async function HomePage({ params }: LocaleParams) {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.home" });
  const scoped = (prefix: string) => (key: string) => t(`${prefix}.${key}`);

  return (
    <SiteShell locale={locale} path={paths.home}>
      <div className={s.wrap}>
        <section className={cx("ed-hero", s.hero)}>
          <div className="ed-hero__copy">
            <p className="ed-eyebrow">{t("hero.eyebrow")}</p>
            <h1 className="ed-display">{t.rich("hero.title", emphasis)}</h1>
            <p className={cx("ed-lead", s.heroLead)}>{t("hero.lead")}</p>
            <ul className={s.occasions} aria-label={t("hero.occasionsLabel")}>
              {entries<string>(t.raw("hero.occasions")).map(([key, label]) => (
                <li key={key}>{label}</li>
              ))}
            </ul>
            <div className={s.heroActions}>
              <a className={buttonClassName()} href={href(locale, paths.how)}>
                {t("hero.secondary")}
                <IconArrowRight size={16} />
              </a>
              <p className={s.heroNote}>{t("hero.note")}</p>
            </div>
          </div>
          <InvitationPlate t={scoped("plate")} />
        </section>
      </div>

      <section className={s.figuresBand} aria-label={t("figures.label")}>
        <div className={s.wrap}>
          <Figures>
            {(["price", "categories", "counties", "cookies"] as const).map((key) => (
              <Figure
                key={key}
                label={t(`figures.${key}.label`)}
                value={t(`figures.${key}.value`)}
                unit={t.has(`figures.${key}.unit`) ? t(`figures.${key}.unit`) : undefined}
                note={t(`figures.${key}.note`)}
              />
            ))}
          </Figures>
        </div>
      </section>

      <Band eyebrow={t("can.eyebrow")} title={t.rich("can.title", emphasis)} lead={t("can.lead")}>
        <ol className={cx("ed-numbered", s.numbered4)}>
          {entries<Item>(t.raw("can.items")).map(([key, item]) => (
            <li key={key}>
              <h3 className={s.itemTitle}>{item.title}</h3>
              <p className={s.itemText}>{item.text}</p>
            </li>
          ))}
        </ol>
      </Band>

      <Band eyebrow={t("plates.eyebrow")} title={t.rich("plates.title", emphasis)} lead={t("plates.lead")}>
        <div className={s.plates}>
          <Plate caption={t("plates.rsvp.caption")}>
            <RsvpVignette t={scoped("plates.rsvp")} />
          </Plate>
          <Plate caption={t("plates.whatif.caption")}>
            <WhatIfVignette t={scoped("plates.whatif")} />
          </Plate>
          <Plate caption={t("plates.tasks.caption")}>
            <TasksVignette t={scoped("plates.tasks")} />
          </Plate>
        </div>
      </Band>

      <Band eyebrow={t("principles.eyebrow")} title={t.rich("principles.title", emphasis)} lead={t("principles.lead")}>
        <ol className={cx("ed-numbered", s.numbered3)}>
          {entries<Item>(t.raw("principles.items")).map(([key, item]) => (
            <li key={key}>
              <h3 className={s.itemTitle}>{item.title}</h3>
              <p className={s.itemText}>{item.text}</p>
            </li>
          ))}
        </ol>
      </Band>

      <section className={cx("ed-band", s.band)}>
        <div className={cx(s.wrap, s.split)}>
          <div className={s.splitCopy}>
            <p className="ed-eyebrow">{t("business.eyebrow")}</p>
            <h2 className={s.bandTitle}>{t.rich("business.title", emphasis)}</h2>
            <p className="ed-lead">{t("business.text")}</p>
            <a className={buttonClassName()} href={href(locale, paths.business)}>
              {t("business.link")}
              <IconArrowRight size={16} />
            </a>
          </div>
          <List>
            {entries<FactItem>(t.raw("business.facts")).map(([key, fact], i) => (
              <Row key={key} index={i + 1} title={fact.title} meta={fact.meta} />
            ))}
          </List>
        </div>
      </section>

      <Closing title={t.rich("closing.title", emphasis)} text={t("closing.text")} cta={t("closing.cta")} />
    </SiteShell>
  );
}
