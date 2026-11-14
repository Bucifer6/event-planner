import { locales, type Locale } from "@ed/i18n/config";
import { Wordmark, buttonClassName, cx } from "@ed/ui";
import { IconMenu } from "@ed/ui/icons";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import s from "@/app/site.module.css";
import { appLinks, href, paths } from "@/lib/site";

type Props = {
  locale: Locale;
  /** Locale-less path of the current page ("/pentru-firme/"), used for the language links. */
  path: string;
  children: ReactNode;
};

const navItems = [
  { key: "how", path: paths.how },
  { key: "business", path: paths.business },
  { key: "guides", path: paths.guides },
] as const;

/** The public-site frame: skip link, top bar, main, footer and the phone action bar. */
export async function SiteShell({ locale, path, children }: Props) {
  const t = await getTranslations({ locale, namespace: "site" });
  const isCurrent = (p: string) => (path === p || (p !== "/" && path.startsWith(p)) ? "page" : undefined);

  // Plain links between /ro/… and /en/… — static, no cookie, no script.
  const langSwitch = (className?: string) => (
    <div className={cx("ed-langswitch", className)} role="group" aria-label={t("nav.languageLabel")}>
      {locales.map((l) => (
        <a
          key={l}
          href={href(l, path)}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? "true" : undefined}
          aria-label={t(`nav.${l}`)}
          title={t(`nav.${l}`)}
        >
          {t(`nav.${l}Short`)}
        </a>
      ))}
    </div>
  );

  return (
    <div className={s.shell}>
      <a className="ed-skip" href="#continut">
        {t("nav.skip")}
      </a>
      <header className="ed-topbar">
        <div className="ed-topbar__inner">
          <Wordmark href={href(locale, paths.home)} label={t("nav.homeLabel")} />
          <nav className={s.nav} aria-label={t("nav.primaryLabel")}>
            <ul className={s.navList}>
              {navItems.map((item) => (
                <li key={item.key}>
                  <a className="ed-navlink" href={href(locale, item.path)} aria-current={isCurrent(item.path)}>
                    {t(`nav.${item.key}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ed-topbar__end">
            {langSwitch(s.langTop)}
            <a className={buttonClassName({ variant: "primary", size: "sm" }, s.ctaTop)} href={appLinks.signIn}>
              {t("nav.cta")}
            </a>
            <details className={s.menu}>
              <summary className={buttonClassName({ size: "sm" })}>
                <IconMenu size={18} />
                {t("nav.menu")}
              </summary>
              <div className={s.menuPanel}>
                <nav aria-label={t("nav.primaryLabel")}>
                  <ul className={s.menuList}>
                    {navItems.map((item) => (
                      <li key={item.key}>
                        <a href={href(locale, item.path)} aria-current={isCurrent(item.path)}>
                          {t(`nav.${item.key}`)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className={s.menuFoot}>
                  <a className={buttonClassName({ variant: "quiet", size: "sm" })} href={appLinks.signIn}>
                    {t("nav.signIn")}
                  </a>
                  {langSwitch(s.menuLang)}
                </div>
              </div>
            </details>
          </div>
        </div>
      </header>

      <main id="continut" className={s.main} tabIndex={-1}>
        {children}
      </main>

      <footer className={s.footer} aria-label={t("footer.label")}>
        <div className={cx(s.wrap, "ed-footer")}>
          <div className="ed-footer__grid">
            <div className={s.footerAbout}>
              <Wordmark href={href(locale, paths.home)} label={t("nav.homeLabel")} />
              <p>{t("footer.about")}</p>
              {langSwitch()}
            </div>
            <nav className={s.footerCol} aria-label={t("footer.product")}>
              <p className="ed-label">{t("footer.product")}</p>
              <ul>
                <li>
                  <a href={href(locale, paths.how)}>{t("nav.how")}</a>
                </li>
                <li>
                  <a href={href(locale, paths.business)}>{t("nav.business")}</a>
                </li>
                <li>
                  <a href={href(locale, paths.guides)}>{t("nav.guides")}</a>
                </li>
                <li>
                  <a href={appLinks.signIn}>{t("nav.signIn")}</a>
                </li>
              </ul>
            </nav>
            <nav className={s.footerCol} aria-label={t("footer.legal")}>
              <p className="ed-label">{t("footer.legal")}</p>
              <ul>
                <li>
                  <a href={href(locale, paths.terms)}>{t("footer.terms")}</a>
                </li>
                <li>
                  <a href={href(locale, paths.privacy)}>{t("footer.privacy")}</a>
                </li>
                <li>
                  <a href={href(locale, paths.cookies)}>{t("footer.cookies")}</a>
                </li>
                <li>
                  <a href={href(locale, paths.moderation)}>{t("footer.moderation")}</a>
                </li>
              </ul>
            </nav>
            <nav className={s.footerCol} aria-label={t("footer.help")}>
              <p className="ed-label">{t("footer.help")}</p>
              <ul>
                <li>
                  <a href={href(locale, paths.accessibility)}>{t("footer.accessibility")}</a>
                </li>
                <li>
                  <a href={href(locale, paths.status)}>{t("footer.status")}</a>
                </li>
                <li>
                  <a href={appLinks.report}>{t("footer.report")}</a>
                </li>
              </ul>
            </nav>
          </div>
          <div className={s.footerBase}>
            <p>{t("footer.noCookies")}</p>
            <p>{t("footer.operator")}</p>
          </div>
        </div>
      </footer>

      <div className={s.mobilebar}>
        <a className={buttonClassName({ variant: "primary", block: true })} href={appLinks.signIn}>
          {t("nav.cta")}
        </a>
      </div>
    </div>
  );
}

/** <em> inside a translated headline: t.rich("…", emphasis). */
export const emphasis = { em: (chunks: ReactNode) => <em>{chunks}</em> };

/** A band: hairline-ruled section with an eyebrow, a large title and an optional lead. */
export function Band({
  eyebrow,
  title,
  lead,
  children,
  last,
  id,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  last?: boolean;
  id?: string;
}) {
  return (
    <section className={cx("ed-band", last ? s.bandLast : s.band)} id={id}>
      <div className={s.wrap}>
        <div className={cx("ed-band__head", s.bandHead)}>
          {eyebrow ? <p className="ed-eyebrow">{eyebrow}</p> : null}
          <h2 className={s.bandTitle}>{title}</h2>
          {lead ? <p className="ed-lead">{lead}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

/** The closing statement of a page. The filled primary stays in the top bar / phone bar. */
export function Closing({ title, text, cta }: { title: ReactNode; text: string; cta: string }) {
  return (
    <section className={cx("ed-band", s.bandLast)}>
      <div className={cx(s.wrap, s.closing)}>
        <hr className="ed-rule-gilt" />
        <h2 className="ed-display">{title}</h2>
        <p className="ed-lead">{text}</p>
        <a className={buttonClassName()} href={appLinks.signIn}>
          {cta}
        </a>
      </div>
    </section>
  );
}

export function PageHead({ eyebrow, title, lead, children }: { eyebrow: string; title: ReactNode; lead?: string; children?: ReactNode }) {
  return (
    <header className={cx(s.wrap)}>
      <div className={s.pageHead}>
        <p className="ed-eyebrow">{eyebrow}</p>
        <h1 className="ed-display">{title}</h1>
        {lead ? <p className={cx("ed-lead", s.pageHeadLead)}>{lead}</p> : null}
        {children}
      </div>
    </header>
  );
}
