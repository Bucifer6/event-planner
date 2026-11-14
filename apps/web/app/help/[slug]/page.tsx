import { actorAccountId } from "@ed/core/context";
import { Eyebrow, Lead, Page } from "@ed/ui";
import { IconArrowLeft, IconArrowRight } from "@ed/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getHelpArticle, type HelpArticle } from "@/components/help/content";
import { HelpArticleBody } from "@/components/help/HelpArticleBody";
import { openerFor, sectionOf } from "@/components/help/registry";
import { isStaffReader } from "@/components/help/staff";
import s from "@/components/help/help.module.css";
import { getCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** The article, or null when it does not exist or is a staff article and the reader is not staff. */
async function load(slug: string): Promise<{ article: HelpArticle; signedIn: boolean } | null> {
  const [ctx, locale] = await Promise.all([getCtx(), getLocale()]);
  const article = /^[a-z0-9-]{1,80}$/.test(slug) ? getHelpArticle(locale, slug) : null;
  if (!article) return null;
  const signedIn = actorAccountId(ctx.actor) !== null;
  if (sectionOf(article.def.section).staffOnly && !(signedIn && (await isStaffReader(ctx)))) return null;
  return { article, signedIn };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations("help");
  const found = await load((await params).slug);
  if (!found) return { title: t("metaTitle") };
  return { title: t("article.metaTitle", { title: found.article.title }), description: found.article.summary };
}

export default async function HelpArticlePage({ params }: Props) {
  const [t, locale] = await Promise.all([getTranslations("help"), getLocale()]);
  const found = await load((await params).slug);
  if (!found) notFound();
  const { article, signedIn } = found;
  const sectionKey = article.def.section;
  const opener = article.def.routes[0] ? openerFor(article.def.routes[0]) : null;
  const showOpener = opener && (signedIn || !opener.signedIn);
  const related = article.def.related
    .map((slug) => getHelpArticle(locale, slug))
    .filter((x): x is HelpArticle => x !== null && (!sectionOf(x.def.section).staffOnly || sectionOf(sectionKey).staffOnly === true));

  return (
    <Page narrow>
      <article className={s.articlePage}>
        <p className={s.crumb}>
          <Link href={`/help#${sectionKey}`}>
            <IconArrowLeft size={16} />
            {t("article.back")}
          </Link>
        </p>
        <header className={s.head}>
          <Eyebrow>{t(`sections.${sectionKey}.title`)}</Eyebrow>
          <h1 className={s.title}>{article.title}</h1>
          <Lead>{article.summary}</Lead>
          <dl className={s.meta}>
            {article.where ? (
              <div>
                <dt>{t("article.where")}</dt>
                <dd>{article.where}</dd>
              </div>
            ) : null}
            {article.need ? (
              <div>
                <dt>{t("article.need")}</dt>
                <dd>{article.need}</dd>
              </div>
            ) : null}
          </dl>
          {showOpener ? (
            <p className={s.crumb}>
              <Link href={opener.href}>
                {t(`article.open.${opener.key}`)}
                <IconArrowRight size={16} />
              </Link>
            </p>
          ) : null}
        </header>

        <HelpArticleBody blocks={article.blocks} noteLabel={t("article.goodToKnow")} />

        {related.length > 0 ? (
          <nav className={s.related} aria-labelledby="help-related">
            <h2 id="help-related" className={s.relatedTitle}>
              {t("article.seeAlso")}
            </h2>
            <ul className={s.bullets}>
              {related.map((r) => (
                <li key={r.def.slug}>
                  <Link href={`/help/${r.def.slug}`}>{r.title}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </article>
    </Page>
  );
}
