import "@ed/ui/styles.css";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { clientMessages } from "@/lib/client-messages";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getUiTheme, UI_THEME_PAPER } from "@ed/core/appearance";
import { getDb } from "@ed/db";
import { CookieNotice } from "@/components/cookie-notice/CookieNotice";
import { RegisterServiceWorker } from "@/components/pwa/RegisterServiceWorker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    referrer: "same-origin",
    icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  };
}

/** The browser chrome takes the paper colour of the look chosen in Console → Appearance. */
export async function generateViewport(): Promise<Viewport> {
  const theme = await getUiTheme({ db: getDb() });
  return { width: "device-width", initialScale: 1, themeColor: UI_THEME_PAPER[theme] };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // The look of the whole app (Console → Aspect): design tokens only.
  const theme = await getUiTheme({ db: getDb() });
  // only what client components read goes to the browser (lib/client-messages.ts)
  const messages = clientMessages((await getMessages()) as Record<string, unknown>);
  return (
    <html lang={locale} data-ui={theme}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
          <CookieNotice />
          <RegisterServiceWorker />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
