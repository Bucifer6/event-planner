import { Wordmark } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";

/** Public frame of the claim and removal pages (P30, BD6): reachable from the invitation email without an account. */
export default async function ClaimLayout({ children }: { children: ReactNode }) {
  const nav = await getTranslations("nav");
  return (
    <div className="ed-solo">
      <header className="ed-solo__head">
        <Wordmark href="/directory" label={nav("home")} />
        <LanguageSwitch />
      </header>
      <main className="ed-solo__main" data-wide id="main">
        {children}
      </main>
    </div>
  );
}
