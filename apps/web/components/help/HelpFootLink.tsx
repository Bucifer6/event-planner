import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { HelpSectionKey } from "./registry";
import s from "./help.module.css";

/** One small line for a frame's footer: a link to a section of the help centre. */
export async function HelpFootLink({ section }: { section?: HelpSectionKey }) {
  const t = await getTranslations("nav");
  return (
    <p className={s.footLink}>
      <Link href={section ? `/help#${section}` : "/help"}>{t("help")}</Link>
    </p>
  );
}
