import { DISPLAY_TIME_ZONE, LOCALE_COOKIE, loadMessages, toLocale } from "@ed/i18n";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

// No locale-prefixed routing in the app: the language comes from the ed_lang cookie
// (default ro). The account's saved language and the per-guest-link language are applied by
// whoever sets that cookie (auth / guest-link agents) — the toggle changes wording only (L2).
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  // Help articles are read on the server with loadMessages() directly; keeping their namespaces
  // out of the request messages keeps ~115 KB per language out of every page sent to the browser.
  const messages = Object.fromEntries(
    Object.entries(loadMessages(locale)).filter(([ns]) => !/^help[A-Z]/.test(ns)),
  );
  return {
    locale,
    messages,
    timeZone: DISPLAY_TIME_ZONE,
  };
});
