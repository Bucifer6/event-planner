import type { Locale } from "@ed/i18n/config";
import { loadMessages } from "@ed/i18n/load";
import { cx } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import s from "@/app/site.module.css";
import { Doc, type DocTree } from "@/components/doc";
import { SiteShell, emphasis } from "@/components/site-shell";
import { href, pageMetadata, paths, type PathKey } from "@/lib/site";

export type LegalKey = "terms" | "privacy" | "cookies" | "accessibility" | "moderation";
const legalKeys: LegalKey[] = ["terms", "privacy", "cookies", "accessibility", "moderation"];

export async function legalMetadata(locale: Locale, doc: LegalKey): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: `legal.${doc}.meta` });
  return pageMetadata(locale, paths[doc as PathKey], t("title"), t("description"));
}

/**
 * Operator-owned legal documents (LAU1, LAU8, LAU9). The text is a plain-language draft, visibly
 * marked as such, with explicit [placeholders] wherever the operator must supply a fact.
 */
export async function LegalPage({ locale, doc }: { locale: Locale; doc: LegalKey }) {
  const t = await getTranslations({ locale, namespace: "legal" });
  const body = (loadMessages(locale).legal?.[doc] as DocTree | undefined)?.body as DocTree;

  return (
    <SiteShell locale={locale} path={paths[doc as PathKey]}>
      <article className={cx(s.wrapNarrow, s.article)}>
        <header className={s.articleHead}>
          <p className="ed-eyebrow">{t("common.eyebrow")}</p>
          <h1 className={s.articleTitle}>{t.rich(`${doc}.title`, emphasis)}</h1>
          <p className="ed-lead">{t(`${doc}.lead`)}</p>
          <p className={s.version}>{t("common.version")}</p>
          <div className={s.draft} role="note">
            <span className={s.draftTitle}>{t("common.draftTitle")}</span>
            <p className="ed-small">{t("common.draftText")}</p>
          </div>
        </header>
        <Doc locale={locale} body={body} />
        <footer className={s.articleFoot}>
          <p className="ed-label" id="alte-documente">
            {t("common.others")}
          </p>
          <ul className={s.others} aria-labelledby="alte-documente">
            {legalKeys
              .filter((k) => k !== doc)
              .map((k) => (
                <li key={k}>
                  <a href={href(locale, paths[k as PathKey])}>{t(`${k}.meta.title`)}</a>
                </li>
              ))}
          </ul>
        </footer>
      </article>
    </SiteShell>
  );
}
