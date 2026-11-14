import "@ed/ui/styles.css";
import { defaultLocale } from "@ed/i18n/config";
import type { ReactNode } from "react";

// Root layout for "/" only: a static page that forwards to the default locale.
export default function RedirectLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale}>
      <body>{children}</body>
    </html>
  );
}
