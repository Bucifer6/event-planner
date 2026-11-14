import { getLocale } from "next-intl/server";
import { publicUrl } from "@/components/incident-banner/public-url";
import { CookieNoticeClient } from "./CookieNoticeClient";

/**
 * In-app cookie notice (LAU1). Lists exactly the three cookies in @ed/core/cookies, says
 * none is for tracking, links the public cookie notice and the privacy policy.
 * Render once, inside <NextIntlClientProvider> in the root layout.
 */
export async function CookieNotice() {
  const locale = await getLocale();
  return (
    <CookieNoticeClient
      cookiesUrl={publicUrl(locale, "/cookies/")}
      privacyUrl={publicUrl(locale, "/confidentialitate/")}
    />
  );
}
