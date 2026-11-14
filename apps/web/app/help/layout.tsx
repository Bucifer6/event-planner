import { actorAccountId } from "@ed/core/context";
import { Wordmark } from "@ed/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import s from "@/components/help/help.module.css";
import { getCtx, SIGN_IN_PATH } from "@/lib/ctx";

/**
 * The help centre is public: signed-in people read it inside the app shell, everyone else in
 * a bare frame with the way to sign in. Nothing here needs an account.
 */
export default async function HelpLayout({ children }: { children: ReactNode }) {
  const ctx = await getCtx();
  if (actorAccountId(ctx.actor)) return <AppShell>{children}</AppShell>;

  const [nav, common] = await Promise.all([getTranslations("nav"), getTranslations("common")]);
  return (
    <div className="ed-solo">
      <a className="ed-skip" href="#main">
        {nav("skip")}
      </a>
      <header className={`ed-solo__head ${s.frameHead}`}>
        <Wordmark href="/help" label={nav("help")} />
        <div className={s.frameEnd}>
          <Link href={SIGN_IN_PATH}>{common("actions.signIn")}</Link>
          <LanguageSwitch />
        </div>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}
