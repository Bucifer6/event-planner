import "server-only";
import type { PublishedListingStats } from "@ed/core/listingstats";
import { plural } from "@/app/(app)/occasions/_lib/plural";

export const directoryHref = (category: string, county: string, locality?: string | null, occasion?: string | null) =>
  `/directory/${category}/${county}${locality ? `/${locality}` : ""}${occasion ? `?occasion=${occasion}` : ""}`;

export const listingHref = (id: string) => `/directory/listing/${id}`;

type T = (key: string, params?: Record<string, string | number>) => string;

/** P31 in words: "Răspunde la 9 din 10 cereri · de obicei în 3 ore". No score of any kind. */
export function statsInWords(t: T, stats: PublishedListingStats, locale: string): { answered: string; reply: string | null } {
  const answered = t("stats.answered", { count: stats.answeredOfTen });
  const m = stats.medianReplyMinutes;
  if (m === null) return { answered, reply: null };
  let reply: string;
  if (m < 60) {
    const n = Math.max(1, m);
    reply = t(`stats.replyMinutes.${plural(n, locale)}`, { count: n });
  } else if (m < 48 * 60) {
    const n = Math.round(m / 60);
    reply = t(`stats.replyHours.${plural(n, locale)}`, { count: n });
  } else {
    const n = Math.round(m / (24 * 60));
    reply = t(`stats.replyDays.${plural(n, locale)}`, { count: n });
  }
  return { answered, reply };
}
