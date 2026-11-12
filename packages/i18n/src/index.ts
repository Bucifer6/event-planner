// L1/L2: every user-facing string lives only in messages/ro.json and messages/en.json.
// Default locale is ro-RO; the English toggle changes wording only, never data.
import ro from '../messages/ro.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import type { Locale } from '@eventdesk/shared';

export type { Locale } from '@eventdesk/shared';
export const LOCALES: Locale[] = ['ro', 'en'];
export const DEFAULT_LOCALE: Locale = 'ro';

export const messages: Record<Locale, Record<string, string>> = { ro, en };

export function isLocale(value: unknown): value is Locale {
  return value === 'ro' || value === 'en';
}

export type Messages = Record<string, string>;

function lookup(dict: Messages, key: string): string | undefined {
  return dict[key];
}

export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let template = lookup(messages[locale], key) ?? lookup(messages.ro, key) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
  }
  return template;
}

export function assertDictionariesInSync(): void {
  const roKeys = Object.keys(messages.ro).sort();
  const enKeys = Object.keys(messages.en).sort();
  const missingInEn = roKeys.filter((k) => !enKeys.includes(k));
  const missingInRo = enKeys.filter((k) => !roKeys.includes(k));
  if (missingInEn.length || missingInRo.length) {
    throw new Error(
      `Locale dictionaries out of sync. Missing in en: ${missingInEn.join(', ')}. Missing in ro: ${missingInRo.join(', ')}.`
    );
  }
}
