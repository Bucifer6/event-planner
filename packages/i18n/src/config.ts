export const locales = ["ro", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ro";

/** Language-preference cookie (one of the three cookies listed in the cookie notice, LAU1). */
export const LOCALE_COOKIE = "ed_lang";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** All times are displayed in this zone (INF8). */
export const DISPLAY_TIME_ZONE = "Europe/Bucharest";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Anything that is not a supported locale becomes the default (ro). */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}
