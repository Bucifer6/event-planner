import { Wordmark } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";

/** Public frame for the notice-and-action form: no account needed. */
export default async function ReportLayout({ children }: { children: ReactNode }) {
  const nav = await getTranslations("nav");
  return (
    <div className="ed-solo">
      <header className="ed-solo__head">
        <Wordmark href="/" label={nav("home")} />
        <LanguageSwitch />
      </header>
      <main className="ed-solo__main" data-wide id="main">
        {children}
      </main>
    </div>
  );
}
