import { isLocale, type Locale } from "@ed/i18n/config";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export type LocaleParams = { params: Promise<{ locale: string }> };

/** Resolve and register the locale of a statically rendered page. */
export async function pageLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return locale;
}

/** Entries of a message subtree, in file order. */
export function entries<T>(tree: unknown): Array<[string, T]> {
  return Object.entries((tree ?? {}) as Record<string, T>);
}
