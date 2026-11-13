import { defaultLocale } from "@ed/i18n/config";
import { translate } from "@ed/i18n/load";
import type { Metadata } from "next";

const target = `/${defaultLocale}/`;

export const metadata: Metadata = {
  title: translate(defaultLocale, "common.redirect.title"),
  robots: { index: false, follow: true },
};

// "/" in a static export: no server, no script — a meta refresh plus a visible link.
export default function RootRedirectPage() {
  return (
    <main>
      <meta httpEquiv="refresh" content={`0; url=${target}`} />
      <p>{translate(defaultLocale, "common.redirect.message")}</p>
      <p>
        <a href={target}>{translate(defaultLocale, "common.redirect.link")}</a>
      </p>
    </main>
  );
}
