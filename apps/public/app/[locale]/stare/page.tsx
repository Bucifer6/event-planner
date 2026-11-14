import { List, Row, cx } from "@ed/ui";
import { IconSuccess } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import s from "@/app/site.module.css";
import { PageHead, SiteShell, emphasis } from "@/components/site-shell";
import { entries, pageLocale, type LocaleParams } from "@/lib/page";
import { pageMetadata, paths } from "@/lib/site";

type Component = { title: string; meta: string };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.status.meta" });
  return pageMetadata(locale, paths.status, t("title"), t("description"));
}

// LAU5: a plain-language status message. The default says everything works; the operator edits
// site.status.* (and redeploys this static site) when something does not.
export default async function StatusPage({ params }: LocaleParams) {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "site.status" });

  return (
    <SiteShell locale={locale} path={paths.status}>
      <PageHead eyebrow={t("eyebrow")} title={t.rich("title", emphasis)} lead={t("lead")} />
      <section className={cx("ed-band", s.band)} aria-label={t("componentsLabel")}>
        <div className={cx(s.wrap, s.statusHero)}>
          <List className={s.statusList}>
            {entries<Component>(t.raw("components")).map(([key, c]) => (
              <Row
                key={key}
                title={c.title}
                meta={c.meta}
                end={
                  <span className={s.statusMark}>
                    <IconSuccess size={18} />
                    {t("state")}
                  </span>
                }
              />
            ))}
          </List>
          <p className="ed-small ed-muted">{t("updated")}</p>
        </div>
      </section>
      <section className={cx("ed-band", s.bandLast)}>
        <div className={cx(s.wrap, "ed-prose")}>
          <h2>{t("trouble.title")}</h2>
          <p>{t("trouble.p1")}</p>
          <p>{t("trouble.p2")}</p>
        </div>
      </section>
    </SiteShell>
  );
}
