import { locales } from "@ed/i18n/config";
import { loadMessages } from "@ed/i18n/load";
import { buttonClassName, cx } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import s from "@/app/site.module.css";
import { Doc, type DocTree } from "@/components/doc";
import { SiteShell } from "@/components/site-shell";
import { pageLocale } from "@/lib/page";
import { appLinks, guidePath, guideSlugs, href, pageMetadata, paths, type GuideSlug } from "@/lib/site";

type Props = { params: Promise<{ locale: string; slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.flatMap((locale) => guideSlugs.map((slug) => ({ locale, slug })));
}

const isGuide = (slug: string): slug is GuideSlug => (guideSlugs as readonly string[]).includes(slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await pageLocale(params);
  const { slug } = await params;
  if (!isGuide(slug)) return {};
  const t = await getTranslations({ locale, namespace: `guides.items.${slug}` });
  return pageMetadata(locale, guidePath(slug), t("title"), t("summary"));
}

export default async function GuidePage({ params }: Props) {
  const locale = await pageLocale(params);
  const { slug } = await params;
  if (!isGuide(slug)) notFound();
  const t = await getTranslations({ locale, namespace: "guides" });
  const items = loadMessages(locale).guides?.items as Record<string, { body: DocTree }>;
  const body = items[slug]?.body;
  if (!body) notFound();
  const next = guideSlugs[(guideSlugs.indexOf(slug) + 1) % guideSlugs.length] ?? guideSlugs[0];

  return (
    <SiteShell locale={locale} path={guidePath(slug)}>
      <article className={cx(s.wrapNarrow, s.article)}>
        <header className={s.articleHead}>
          <p className="ed-eyebrow">
            {t("index.kicker")} · {t(`items.${slug}.minutes`)}
          </p>
          <h1 className={s.articleTitle}>{t(`items.${slug}.title`)}</h1>
          <p className="ed-lead">{t(`items.${slug}.summary`)}</p>
        </header>
        <Doc locale={locale} body={body} />
        <footer className={s.articleFoot}>
          <a className={s.nextLink} href={href(locale, guidePath(next))}>
            <span className="ed-label">{t("index.next")}</span>
            <span>{t(`items.${next}.title`)}</span>
          </a>
          <div className={s.articleActions}>
            <a className={buttonClassName({ variant: "quiet" })} href={href(locale, paths.guides)}>
              <IconArrowLeft size={16} />
              {t("index.back")}
            </a>
            <a className={buttonClassName()} href={appLinks.signIn}>
              {t("index.closingCta")}
            </a>
          </div>
        </footer>
      </article>
    </SiteShell>
  );
}
