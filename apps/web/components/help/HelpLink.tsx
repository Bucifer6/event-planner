import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getHelpArticle } from "./content";
import { HelpIcon } from "./HelpIcon";
import { helpTopics, type HelpTopic } from "./registry";
import s from "./help.module.css";

/** Contextual help: a small "Ajutor: <titlu>" link to the article about the current screen. */
export async function HelpLink({ topic }: { topic: HelpTopic }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("help")]);
  const slug = helpTopics[topic];
  const article = getHelpArticle(locale, slug);
  if (!article) return null;
  return (
    <p className={s.contextLink}>
      <Link href={`/help/${slug}`}>
        <HelpIcon size={18} />
        <span>{t("link.label", { title: article.title })}</span>
      </Link>
    </p>
  );
}
