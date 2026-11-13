import { formatTime } from "@ed/i18n/format";
import { getOwnAccount } from "@ed/core/accounts";
import { Tag, Wordmark } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { leaveConsole } from "@/app/actions/console";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { ConsoleNav } from "./_components/ConsoleNav";
import { consoleAccess } from "./_lib";
import { consoleNav } from "./_nav";
import styles from "./console.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console");
  return { title: { default: t("title"), template: `%s · ${t("title")}` }, robots: { index: false, follow: false } };
}

/**
 * The `.ed-console` frame. It draws the navigation only for a fully admitted staff member;
 * everyone else gets a bare frame around whatever the page decides to show (the set-up
 * explanation, or "not found"). The frame is not the guard — every page calls requireConsole().
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const access = await consoleAccess();
  const nav = await getTranslations("nav");
  if (access.state !== "ok") {
    return (
      <div className="ed-solo">
        <header className="ed-solo__head">
          <Wordmark href="/occasions" label={nav("home")} />
          <LanguageSwitch />
        </header>
        <main className="ed-solo__main" data-wide id="main">
          {children}
        </main>
      </div>
    );
  }

  const t = await getTranslations("console");
  const account = await getOwnAccount(access.ctx);
  const entries = consoleNav
    .filter((item) => !item.roles || item.roles.some((r) => access.roles.includes(r)))
    .map((item) => ({ href: item.href, exact: item.exact, label: t(`nav.${item.key}` as never) }));

  return (
    <div className="ed-console">
      <a className="ed-skip" href="#main">
        {nav("skip")}
      </a>
      <header className="ed-console__nav">
        <div className={styles.brand}>
          <span className={styles.brandName}>
            <Wordmark href="/console" label={t("title")} />
          </span>
          <span className={styles.brandEnd}>
            <span className={styles.badge}>
              <Tag>{t("badge")}</Tag>
            </span>
            <LanguageSwitch />
          </span>
        </div>
        <ConsoleNav entries={entries} label={t("navLabel")} />
        <div className={styles.meta}>
          <span>{account.email ?? account.username}</span>
          <span>{access.roles.map((r) => t(`roles.${r}`)).join(" · ")}</span>
          <span>{t("session.until", { time: formatTime(access.expiresAt, access.ctx.locale) })}</span>
          <ActionForm
            action={leaveConsole}
            variant="quiet"
            block={false}
            submitLabel={t("session.leave")}
            pendingLabel={t("session.leaving")}
          />
        </div>
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
