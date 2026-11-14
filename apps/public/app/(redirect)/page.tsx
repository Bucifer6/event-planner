import { defaultLocale } from "@ed/i18n/config";
import { translate } from "@ed/i18n/load";
import { Wordmark, cx } from "@ed/ui";
import type { Metadata } from "next";
import s from "@/app/site.module.css";

const target = `/${defaultLocale}/`;

export const metadata: Metadata = {
  title: translate(defaultLocale, "common.redirect.title"),
  robots: { index: false, follow: true },
};

// "/" in a static export: no server, no script — a meta refresh plus a visible link.
export default function RootRedirectPage() {
  return (
    <div className="ed-solo">
      <meta httpEquiv="refresh" content={`0; url=${target}`} />
      <header className="ed-solo__head">
        <Wordmark href={target} label={translate(defaultLocale, "site.nav.homeLabel")} />
      </header>
      <main className={cx("ed-solo__main", s.soloMain)}>
        <p className="ed-lead">{translate(defaultLocale, "common.redirect.message")}</p>
        <p>
          <a href={target}>{translate(defaultLocale, "common.redirect.link")}</a>
        </p>
      </main>
    </div>
  );
}
