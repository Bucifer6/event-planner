import { formatMoney } from "@ed/i18n/format";

/** "1.990 RON" → { value: "1.990", unit: "RON" } for a Figure (number large, unit small). */
export function moneyParts(minor: number, currency: string, locale: "ro" | "en"): { value: string; unit: string } {
  const text = formatMoney(minor, currency, locale);
  const at = text.lastIndexOf(" ");
  return at > 0 ? { value: text.slice(0, at), unit: text.slice(at + 1) } : { value: text, unit: "" };
}

/** yyyy-mm-dd → dd.mm.yyyy (ro) / dd/mm/yyyy (en), without going through a time zone. */
export function formatDayKey(day: string, locale: "ro" | "en"): string {
  const [y, m, d] = day.split("-");
  return locale === "en" ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
}
