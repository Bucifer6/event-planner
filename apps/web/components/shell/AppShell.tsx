import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Wordmark } from "@ed/ui";
import { IconBuilding, IconDirectory, IconOccasion, IconPerson } from "@ed/ui/icons";
import { BottomNav, TopNav, type NavEntry } from "./NavLinks";
import { LanguageSwitch } from "./LanguageSwitch";

/** Signed-in frame: wordmark + destinations on top (desktop) and at the bottom (phones). */
export async function AppShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("nav");
  const entries: NavEntry[] = [
    { href: "/occasions", label: t("occasions"), icon: <IconOccasion /> },
    { href: "/directory", label: t("directory"), icon: <IconDirectory /> },
    { href: "/business", label: t("business"), icon: <IconBuilding /> },
    { href: "/account", label: t("account"), icon: <IconPerson /> },
  ];
  return (
    <div className="ed-has-bottomnav">
      <a className="ed-skip" href="#main">
        {t("skip")}
      </a>
      <header className="ed-topbar">
        <div className="ed-topbar__inner">
          <Wordmark href="/occasions" label={t("home")} />
          <TopNav entries={entries} label={t("primary")} />
          <div className="ed-topbar__end">
            <LanguageSwitch />
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <BottomNav entries={entries} label={t("primary")} />
    </div>
  );
}
