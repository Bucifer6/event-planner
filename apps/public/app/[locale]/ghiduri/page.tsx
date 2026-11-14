import { cx } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import s from "@/app/site.module.css";
import { Closing, PageHead, SiteShell, emphasis } from "@/components/site-shell";
import { pageLocale, type LocaleParams } from "@/lib/page";
import { guidePath, guideSlugs, href, pageMetadata, paths } from "@/lib/site";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "guides.index.meta" });
  return pageMetadata(locale, paths.guides, t("title"), t("description"));
}

export default async function GuidesPage({ params }: LocaleParams) {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "guides" });

  return (
    <SiteShell locale={locale} path={paths.guides}>
      <PageHead eyebrow={t("index.eyebrow")} title={t.rich("index.title", emphasis)} lead={t("index.lead")} />
      <section className={cx("ed-band", s.band)} aria-label={t("index.listLabel")}>
        <div className={s.wrap}>
          <ol className={s.guideList}>
            {guideSlugs.map((slug) => (
              <li key={slug}>
                <a className={s.guideLink} href={href(locale, guidePath(slug))}>
                  <span className={s.guideTitle}>{t(`items.${slug}.title`)}</span>
                  <span className={s.guideSummary}>{t(`items.${slug}.summary`)}</span>
                  <span className={cx("ed-label", s.guideMeta)}>{t(`items.${slug}.minutes`)}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <Closing title={t.rich("index.closingTitle", emphasis)} text={t("index.closingText")} cta={t("index.closingCta")} />
    </SiteShell>
  );
}
