import "@ed/ui/styles.css";
import { defaultLocale } from "@ed/i18n/config";
import { translate } from "@ed/i18n/load";
import { Wordmark, buttonClassName, cx } from "@ed/ui";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import s from "@/app/site.module.css";
import { href, paths } from "@/lib/site";

const t = (key: string) => translate(defaultLocale, `site.notFound.${key}`);

export const metadata: Metadata = {
  title: `${translate(defaultLocale, "site.notFound.eyebrow")} · EventDesk.ro`,
  robots: { index: false, follow: true },
};

/** "Pagina <em>nu există</em>." → nodes, without next-intl (this page has no locale segment). */
function rich(text: string): ReactNode {
  const m = /^(.*)<em>(.*)<\/em>(.*)$/.exec(text);
  return m ? (
    <>
      {m[1]}
      <em>{m[2]}</em>
      {m[3]}
    </>
  ) : (
    text
  );
}

// One static 404.html serves every unknown address, so it speaks both languages: Romanian first.
export default function GlobalNotFound() {
  return (
    <html lang={defaultLocale}>
      <body>
        <div className="ed-solo">
          <header className="ed-solo__head">
            <Wordmark href={href(defaultLocale, paths.home)} label={translate(defaultLocale, "site.nav.homeLabel")} />
          </header>
          <main className={cx("ed-solo__main", s.soloMain)} data-wide>
            <p className="ed-eyebrow">{t("eyebrow")}</p>
            <h1 className="ed-display">{rich(t("title"))}</h1>
            <p className="ed-lead">{t("text")}</p>
            <div className={s.heroActions}>
              <a className={buttonClassName({ variant: "primary" })} href={href(defaultLocale, paths.home)}>
                {t("home")}
              </a>
              <a className={buttonClassName({ variant: "quiet" })} href={href(defaultLocale, paths.guides)}>
                {t("guides")}
              </a>
            </div>
            <hr className="ed-rule-gilt" />
            <div lang="en" className="ed-stack" data-gap="2">
              <p>
                <strong>{t("enTitle")}</strong> {t("enText")}
              </p>
              <p>
                <a href={href("en", paths.home)}>{t("enHome")}</a>
              </p>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
