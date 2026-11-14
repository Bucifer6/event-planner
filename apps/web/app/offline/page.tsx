import { Lead, Seal } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReloadButton } from "./ReloadButton";

// The offline shell (B11): pre-cached by /sw.js and shown when a navigation cannot reach the
// network. Public and free of user data by design — it is the ONLY page the worker caches.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform.offline");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function OfflinePage() {
  const t = await getTranslations("platform.offline");
  return (
    <div className="ed-solo">
      <header className="ed-solo__head">
        <Seal size={40} />
      </header>
      <main className="ed-solo__main">
        <h1 className="ed-display">{t("title")}</h1>
        <Lead>{t("body")}</Lead>
        <ReloadButton label={t("retry")} />
      </main>
    </div>
  );
}
