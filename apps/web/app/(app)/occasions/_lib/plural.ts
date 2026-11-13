/**
 * Plural form of a count as a message-key suffix: "zero" | "one" | "few" | "other".
 * Romanian needs three forms (1 zi · 2 zile · 20 de zile); messages carry one key per form:
 *   t(`countdown.inDays.${plural(n, locale)}`, { count: n })
 * English files repeat the "other" text under "few".
 */
export function plural(count: number, locale: string, opts: { zero?: boolean } = {}): "zero" | "one" | "few" | "other" {
  if (opts.zero && count === 0) return "zero";
  const rule = new Intl.PluralRules(locale === "en" ? "en" : "ro").select(count);
  return rule === "one" ? "one" : rule === "few" ? "few" : "other";
}
