import { Cluster, ExternalLink, Wordmark } from "@ed/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { SIGN_IN_PATH } from "@/lib/session";
import { legalUrl } from "./_components/legal";

/** Sign-in frame: wordmark, language switch, one narrow column, legal links. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("auth.legal");
  const nav = await getTranslations("nav");
  const [terms, privacy, cookies] = await Promise.all([
    legalUrl("termeni"),
    legalUrl("confidentialitate"),
    legalUrl("cookies"),
  ]);
  return (
    <div className="ed-solo">
      <header className="ed-solo__head">
        <Wordmark href={SIGN_IN_PATH} label={nav("home")} />
        <LanguageSwitch />
      </header>
      <main className="ed-solo__main" id="main">
        {children}
      </main>
      <footer className="ed-solo__foot">
        <Cluster gap={3} justify="between">
          <ExternalLink href={terms}>{t("terms")}</ExternalLink>
          <ExternalLink href={privacy}>{t("privacy")}</ExternalLink>
          <ExternalLink href={cookies}>{t("cookies")}</ExternalLink>
          <Link href="/help">{nav("help")}</Link>
        </Cluster>
      </footer>
    </div>
  );
}
