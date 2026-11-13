import { actorAccountId } from "@ed/core/context";
import { Wordmark } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { getCtx } from "@/lib/ctx";
import styles from "./directory.module.css";

/**
 * The directory is PUBLIC (P6): no account is needed and the pages set no cookie. Someone who
 * is signed in sees the very same pages inside the app frame ("Firme" / "Găsește firme");
 * everyone else gets a plain public frame with the language toggle.
 */
export default async function DirectoryLayout({ children }: { children: ReactNode }) {
  const ctx = await getCtx();
  const t = await getTranslations("directory");
  const nav = await getTranslations("nav");
  const signedIn = ctx.actor.kind === "account" && !!actorAccountId(ctx.actor);
  const foot = (
    <footer className={styles.foot}>
      <div className={styles.footInner}>
        <span>{t("foot.honest")}</span>
        <span className={styles.footLinks}>
          <Link href="/business">{t("foot.forBusinesses")}</Link>
          {signedIn ? null : <Link href="/sign-in">{t("signIn")}</Link>}
        </span>
      </div>
    </footer>
  );
  if (signedIn) {
    return (
      <AppShell>
        {children}
        {foot}
      </AppShell>
    );
  }
  return (
    <div>
      <a className="ed-skip" href="#main">
        {nav("skip")}
      </a>
      <header className="ed-topbar">
        <div className="ed-topbar__inner">
          <Wordmark href="/directory" label={nav("home")} />
          <div className="ed-topbar__end">
            <Link href="/sign-in" className={styles.signin}>
              {t("signIn")}
            </Link>
            <LanguageSwitch />
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      {foot}
    </div>
  );
}
