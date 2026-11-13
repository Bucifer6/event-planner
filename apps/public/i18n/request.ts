import { DISPLAY_TIME_ZONE, loadMessages, toLocale } from "@ed/i18n";
import { getRequestConfig } from "next-intl/server";

// Static export: the locale comes only from the [locale] URL segment (set with
// setRequestLocale in each layout/page). No cookies, no headers.
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = toLocale(await requestLocale);
  return {
    locale,
    messages: loadMessages(locale),
    timeZone: DISPLAY_TIME_ZONE,
  };
});
