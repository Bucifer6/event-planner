import { getTranslations } from "next-intl/server";

// Placeholder. Route groups ((auth), (app), console, g/[token], e/[slug], directory, mcp)
// are added by later agents.
export default async function HomePage() {
  const t = await getTranslations("common");
  return (
    <main>
      <h1>{t("home.title")}</h1>
      <p>{t("home.tagline")}</p>
      <p>{t("home.comingSoon")}</p>
    </main>
  );
}
