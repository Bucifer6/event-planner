import { toLocale, type Locale } from "./config";
import { messagesByLocale } from "./messages.generated";

export type Messages = { [key: string]: string | Messages };

/**
 * All messages for a locale as { [namespace]: {...} }, where namespace = the JSON file name
 * (messages/ro/common.json -> messages.common). Works in the Next server runtime, the static
 * export build and vitest because the files are statically imported (see
 * scripts/gen-messages.mjs for how a new namespace is picked up).
 */
export function loadMessages(locale: Locale | string): Record<string, Messages> {
  return messagesByLocale[toLocale(locale)] as Record<string, Messages>;
}

/** Namespaces available for a locale. */
export function listNamespaces(locale: Locale | string): string[] {
  return Object.keys(loadMessages(locale));
}

/**
 * Plain lookup by full key ("common.actions.save") with {name} interpolation, for places
 * without next-intl (worker, emails, PDFs, scripts). Returns the key itself when missing.
 */
export function translate(
  locale: Locale | string,
  key: string,
  params?: Record<string, string | number>,
): string {
  let node: string | Messages | undefined = loadMessages(locale);
  for (const part of key.split(".")) {
    node = typeof node === "object" && node !== null ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  if (!params) return node;
  return node.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** True when the full key exists for the locale. */
export function hasMessage(locale: Locale | string, key: string): boolean {
  let node: string | Messages | undefined = loadMessages(locale);
  for (const part of key.split(".")) {
    node = typeof node === "object" && node !== null ? node[part] : undefined;
  }
  return typeof node === "string";
}
