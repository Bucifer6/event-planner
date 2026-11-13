import { getLocale, getTranslations } from "next-intl/server";
import { setLanguage } from "@/app/actions/auth";

/** One-tap language toggle (L2). Changes wording only, never data. */
export async function LanguageSwitch() {
  const locale = await getLocale();
  const t = await getTranslations("nav");
  return (
    <form action={setLanguage as unknown as (fd: FormData) => Promise<void>} className="ed-langswitch" aria-label={t("language")}>
      <button type="submit" name="locale" value="ro" aria-pressed={locale === "ro"} lang="ro" title="Română">
        RO
      </button>
      <button type="submit" name="locale" value="en" aria-pressed={locale === "en"} lang="en" title="English">
        EN
      </button>
    </form>
  );
}
