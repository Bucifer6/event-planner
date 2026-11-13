import { zonedParts } from "@ed/shared/time";
import { DISPLAY_TIME_ZONE, toLocale, type Locale } from "./config";

// Locale formatting (L3, INF8). Deterministic on purpose: no dependence on the ICU data of
// the runtime, so server, browser and tests always print the same text.
//   ro: 1.990 RON · 240,79 RON · 14.06.2026 · 14.06.2026, 18:30 · sâmbătă, 14 iunie 2026
//   en: 1,990 RON · 240.79 RON · 14/06/2026 · 14/06/2026, 18:30 · Saturday, 14 June 2026
// Client-safe (no node: imports).

type L = Locale | string;

const SEP: Record<Locale, { group: string; decimal: string; date: string }> = {
  ro: { group: ".", decimal: ",", date: "." },
  en: { group: ",", decimal: ".", date: "/" },
};

const WEEKDAYS: Record<Locale, readonly string[]> = {
  ro: ["luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

const MONTHS: Record<Locale, readonly string[]> = {
  ro: [
    "ianuarie",
    "februarie",
    "martie",
    "aprilie",
    "mai",
    "iunie",
    "iulie",
    "august",
    "septembrie",
    "octombrie",
    "noiembrie",
    "decembrie",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

const UNKNOWN: Record<Locale, string> = { ro: "necunoscut", en: "unknown" };

const pad2 = (n: number) => String(n).padStart(2, "0");

function group(digits: string, sep: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Whole number with locale grouping: 12345 -> "12.345" (ro) / "12,345" (en). */
export function formatInteger(value: number | bigint, locale: L): string {
  const s = SEP[toLocale(locale)];
  const big = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  const neg = big < 0n;
  return (neg ? "-" : "") + group((neg ? -big : big).toString(), s.group);
}

/**
 * Minor units -> "1.990 RON" (ro) / "1,990 RON" (en). Decimals are shown only when the amount
 * is not whole ("240,79 RON"), or always with { decimals: "always" }.
 * Never call this with an unknown amount: render formatUnknown() instead of 0.
 */
export function formatMoney(
  minor: number | bigint,
  currency: string,
  locale: L,
  opts: { decimals?: "auto" | "always" } = {},
): string {
  const s = SEP[toLocale(locale)];
  const big = typeof minor === "bigint" ? minor : BigInt(Math.trunc(minor));
  const neg = big < 0n;
  const abs = neg ? -big : big;
  const whole = abs / 100n;
  const cents = abs % 100n;
  let out = group(whole.toString(), s.group);
  if (cents !== 0n || opts.decimals === "always")
    out += s.decimal + cents.toString().padStart(2, "0");
  return `${neg ? "-" : ""}${out} ${currency}`;
}

/** "necunoscut" / "unknown" — for NULL facts, which are never shown as 0. */
export function formatUnknown(locale: L): string {
  return UNKNOWN[toLocale(locale)];
}

/** formatMoney, or the "unknown" word when the amount is null/undefined. */
export function formatMoneyOrUnknown(
  minor: number | bigint | null | undefined,
  currency: string,
  locale: L,
): string {
  return minor === null || minor === undefined
    ? formatUnknown(locale)
    : formatMoney(minor, currency, locale);
}

/** UTC instant -> "14.06.2026" (ro) / "14/06/2026" (en), in Europe/Bucharest unless tz given. */
export function formatDate(date: Date, locale: L, timeZone: string = DISPLAY_TIME_ZONE): string {
  const p = zonedParts(date, timeZone);
  return [pad2(p.day), pad2(p.month), String(p.year)].join(SEP[toLocale(locale)].date);
}

/** UTC instant -> "18:30" (24h) in Europe/Bucharest unless tz given. */
export function formatTime(date: Date, locale: L, timeZone: string = DISPLAY_TIME_ZONE): string {
  void locale;
  const p = zonedParts(date, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** UTC instant -> "14.06.2026, 18:30" (ro) / "14/06/2026, 18:30" (en), Europe/Bucharest. */
export function formatDateTime(date: Date, locale: L): string {
  return formatInZone(date, DISPLAY_TIME_ZONE, locale);
}

/** Same as formatDateTime but in any IANA zone. */
export function formatInZone(date: Date, timeZone: string, locale: L): string {
  return `${formatDate(date, locale, timeZone)}, ${formatTime(date, locale, timeZone)}`;
}

/** "sâmbătă, 14 iunie 2026" (ro) / "Saturday, 14 June 2026" (en), Europe/Bucharest. */
export function formatWeekdayDate(
  date: Date,
  locale: L,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const l = toLocale(locale);
  const p = zonedParts(date, timeZone);
  return `${WEEKDAYS[l][p.weekday - 1]}, ${p.day} ${MONTHS[l][p.month - 1]} ${p.year}`;
}

/** "iunie 2026" / "June 2026". */
export function formatMonthYear(
  date: Date,
  locale: L,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const p = zonedParts(date, timeZone);
  return `${MONTHS[toLocale(locale)][p.month - 1]} ${p.year}`;
}

export function weekdayName(isoWeekday: number, locale: L): string {
  return WEEKDAYS[toLocale(locale)][isoWeekday - 1] ?? "";
}

export function monthName(month1to12: number, locale: L): string {
  return MONTHS[toLocale(locale)][month1to12 - 1] ?? "";
}
