import { Card, DescriptionList, Fact, Unknown, buttonClassName, cx } from "@ed/ui";
import { IconArrowRight, IconShield } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import s from "@/app/site.module.css";
import { Band, Closing, SiteShell, emphasis } from "@/components/site-shell";
import { Plate } from "@/components/vignettes";
import { entries, pageLocale, type LocaleParams } from "@/lib/page";
import { appLinks, pageMetadata, paths } from "@/lib/site";

type Item = { title: string; text: string };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.business.meta" });
  return pageMetadata(locale, paths.business, t("title"), t("description"));
}

export default async function BusinessPage({ params }: LocaleParams) {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.business" });

  return (
    <SiteShell locale={locale} path={paths.business}>
      <div className={s.wrap}>
        <section className={cx("ed-hero", s.hero, s.heroRuled)}>
          <div className="ed-hero__copy">
            <p className="ed-eyebrow">{t("eyebrow")}</p>
            <h1 className="ed-display">{t.rich("title", emphasis)}</h1>
            <p className={cx("ed-lead", s.heroLead)}>{t("lead")}</p>
            <div className={s.statement}>
              <p className={s.statementTitle}>{t("launch.title")}</p>
              <p className="ed-muted">{t("launch.text")}</p>
            </div>
          </div>
          <Plate caption={t("sample.caption")}>
            <Card framed>
              <p className="ed-label">{t("sample.category")}</p>
              <p className={cx("ed-display", s.listingName)}>{t("sample.name")}</p>
              <p className="ed-muted">{t("sample.area")}</p>
              <div className={s.listingFacts}>
                <Fact icon={<IconShield size={16} />}>{t("sample.fact1")}</Fact>
                <Fact icon={<IconShield size={16} />}>{t("sample.fact2")}</Fact>
              </div>
              <DescriptionList
                cols={2}
                items={[
                  { term: t("sample.capacity"), value: t("sample.capacityValue") },
                  { term: t("sample.parking"), value: t("sample.parkingValue") },
                  { term: t("sample.drawing"), value: t("sample.drawingValue") },
                  { term: t("sample.price"), value: <Unknown label={t("sample.priceValue")} /> },
                ]}
              />
            </Card>
          </Plate>
        </section>
      </div>

      <Band eyebrow={t("listing.eyebrow")} title={t.rich("listing.title", emphasis)} lead={t("listing.lead")}>
        <ol className={cx("ed-numbered", s.numbered4)}>
          {entries<Item>(t.raw("listing.steps")).map(([key, item]) => (
            <li key={key}>
              <h3 className={s.itemTitle}>{item.title}</h3>
              <p className={s.itemText}>{item.text}</p>
            </li>
          ))}
        </ol>
        <div className={s.categoriesBlock}>
          <h3 className={s.itemTitle}>{t("categories.title")}</h3>
          <ol className={s.categories}>
            {entries<string>(t.raw("categories.items")).map(([key, label]) => (
              <li key={key}>{label}</li>
            ))}
          </ol>
          <p className="ed-small ed-muted">{t("categories.note")}</p>
        </div>
      </Band>

      <Band eyebrow={t("get.eyebrow")} title={t.rich("get.title", emphasis)}>
        <ul className={s.entries}>
          {entries<Item>(t.raw("get.items")).map(([key, item]) => (
            <li key={key} className={s.entry}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </Band>

      <Band id="reguli" eyebrow={t("rules.eyebrow")} title={t.rich("rules.title", emphasis)} lead={t("rules.lead")}>
        <ol className={s.entriesIndexed}>
          {entries<Item>(t.raw("rules.items")).map(([key, item]) => (
            <li key={key} className={s.entryIndexed}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ol>
      </Band>

      <Band id="nerevendicate" eyebrow={t("unclaimed.eyebrow")} title={t.rich("unclaimed.title", emphasis)} lead={t("unclaimed.lead")}>
        <ol className={cx("ed-numbered", s.numbered3)}>
          {entries<Item>(t.raw("unclaimed.items")).map(([key, item]) => (
            <li key={key}>
              <h3 className={s.itemTitle}>{item.title}</h3>
              <p className={s.itemText}>{item.text}</p>
            </li>
          ))}
        </ol>
        <div className={s.afterGrid}>
          <p className="ed-muted">{t("unclaimed.note")}</p>
          <a className={buttonClassName()} href={appLinks.report}>
            {t("unclaimed.link")}
            <IconArrowRight size={16} />
          </a>
        </div>
      </Band>

      <Closing title={t.rich("closing.title", emphasis)} text={t("closing.text")} cta={t("closing.cta")} />
    </SiteShell>
  );
}
