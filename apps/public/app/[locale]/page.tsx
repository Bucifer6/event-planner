import { isLocale } from "@ed/i18n/config";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

// Placeholder home page. Every page under [locale] must call setRequestLocale(locale) before
// using translations so it can be rendered statically.
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <main>
      <h1>{t("home.title")}</h1>
      <p>{t("home.tagline")}</p>
      <p>{t("home.comingSoon")}</p>
    </main>
  );
}
