import { actorAccountId } from "@ed/core/context";
import { ExternalLink, Page, PageHeader } from "@ed/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listHelpEntries } from "@/components/help/content";
import { HelpSearch, type HelpSearchEntry } from "@/components/help/HelpSearch";
import { helpSections } from "@/components/help/registry";
import { isStaffReader } from "@/components/help/staff";
import s from "@/components/help/help.module.css";
import { getCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("help");
  return { title: t("metaTitle"), description: t("lead") };
}

/** Public site pages (status, legal) live on PUBLIC_URL, in both languages. */
function publicUrl(locale: string, path: string): string {
  return `${(process.env.PUBLIC_URL ?? "http://localhost:3001").replace(/\/+$/, "")}/${locale}${path}`;
}

/** Operator-set support address (SUPPORT_EMAIL). Shown only when it looks like one. */
function supportEmail(): string | null {
  const value = (process.env.SUPPORT_EMAIL ?? "").trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value) ? value : null;
}

export default async function HelpIndexPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [ctx, locale, t, sp] = await Promise.all([getCtx(), getLocale(), getTranslations("help"), searchParams]);
  const signedIn = actorAccountId(ctx.actor) !== null;
  const staff = signedIn ? await isStaffReader(ctx) : false;
  const sections = helpSections.filter((x) => !x.staffOnly || staff);
  const entries = listHelpEntries(locale, { staff });
  const searchEntries: HelpSearchEntry[] = entries.map((e) => ({
    slug: e.slug,
    title: e.title,
    summary: e.summary,
    keywords: e.keywords,
    where: e.where,
    sectionTitle: t(`sections.${e.section}.title`),
  }));
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const email = supportEmail();

  return (
    <Page narrow>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("lead")} />
      <div className={s.sections}>
        <HelpSearch
          entries={searchEntries}
          locale={locale}
          initialQuery={q}
          labels={{
            label: t("search.label"),
            hint: t("search.hint"),
            submit: t("search.submit"),
            clear: t("search.clear"),
            resultsTitle: t("search.resultsTitle"),
            count: { one: t.raw("search.count.one"), few: t.raw("search.count.few"), other: t.raw("search.count.other") },
            emptyTitle: t("search.emptyTitle"),
            emptyBody: t("search.emptyBody"),
          }}
        >
          <nav aria-label={t("toc")}>
            <ul className={s.toc}>
              {sections.map((sec) => (
                <li key={sec.key}>
                  <a href={`#${sec.key}`}>{t(`sections.${sec.key}.title`)}</a>
                </li>
              ))}
              <li>
                <a href="#contact">{t("contact.title")}</a>
              </li>
            </ul>
          </nav>
          {sections.map((sec) => {
            const list = entries.filter((e) => e.section === sec.key);
            return (
              <section key={sec.key} id={sec.key} className={s.section} aria-labelledby={`h-${sec.key}`}>
                <h2 id={`h-${sec.key}`} className={s.sectionTitle}>
                  {t(`sections.${sec.key}.title`)}
                </h2>
                <p className={s.sectionIntro}>{t(`sections.${sec.key}.intro`)}</p>
                <ol className={s.articles}>
                  {list.map((e, i) => (
                    <li key={e.slug}>
                      <Link href={`/help/${e.slug}`} className={s.article}>
                        <span className={s.index} aria-hidden>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className={s.articleMain}>
                          <span className={s.articleTitle}>{e.title}</span>
                          <span className={s.articleSummary}>{e.summary}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </HelpSearch>

        <section id="contact" className={s.section} aria-labelledby="h-contact">
          <h2 id="h-contact" className={s.sectionTitle}>
            {t("contact.title")}
          </h2>
          <p className={s.sectionIntro}>{t("contact.intro")}</p>
          <ul className={s.contact}>
            <li>
              <Link href="/report">{t("contact.report")}</Link>
              <span>{t("contact.reportBody")}</span>
            </li>
            <li>
              <ExternalLink href={publicUrl(locale, "/stare/")}>{t("contact.status")}</ExternalLink>
              <span>{t("contact.statusBody")}</span>
            </li>
            <li>
              <ExternalLink href={publicUrl(locale, "/confidentialitate/")}>{t("contact.privacy")}</ExternalLink>
              <span>{t("contact.privacyBody")}</span>
            </li>
            <li>
              <ExternalLink href={publicUrl(locale, "/termeni/")}>{t("contact.terms")}</ExternalLink>
              <span>{t("contact.termsBody")}</span>
            </li>
            {email ? (
              <li>
                <a href={`mailto:${email}`}>{email}</a>
                <span>{t("contact.supportBody")}</span>
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </Page>
  );
}
