import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, t, type Locale } from '@eventdesk/i18n';

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get('ed_lang')?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function translate(
  key: string,
  params?: Record<string, string | number>
): Promise<string> {
  return t(await getLocale(), key, params);
}

export function tf(locale: Locale) {
  return (key: string, params?: Record<string, string | number>) => t(locale, key, params);
}
