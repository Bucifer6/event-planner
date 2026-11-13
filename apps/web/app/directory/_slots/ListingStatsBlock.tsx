import type { PublicListing } from "@ed/core/directory";
import { formatDate } from "@ed/i18n/format";
import { getLocale, getTranslations } from "next-intl/server";
import { statsInWords } from "../_lib";
import styles from "../directory.module.css";

/**
 * P31: the two computed facts, in words — the share of enquiries answered and the usual
 * reply time — with the day they were verified. Shown only when the publication rule in
 * @ed/core/listingstats lets it through (claimed, at least ten answered, not hidden).
 * Facts only: nothing here is a score, and nothing can be bought.
 */
export async function ListingStatsBlock({ listing }: { listing: PublicListing }) {
  if (!listing.stats) return null;
  const t = await getTranslations("directory");
  const locale = await getLocale();
  const words = statsInWords((k, p) => t(k as never, p as never), listing.stats, locale);
  const [y, m, d] = listing.stats.day.split("-").map(Number) as [number, number, number];
  const day = formatDate(new Date(Date.UTC(y, m - 1, d, 12)), locale as "ro" | "en");
  return (
    <div className={styles.asideBlock}>
      <span className="ed-label">{t("stats.title")}</span>
      <p className={styles.statLine}>
        {words.answered}
        {words.reply ? <> · {words.reply}</> : null}
      </p>
      <p className="ed-small ed-muted">{t("stats.computed", { date: day })}</p>
    </div>
  );
}
