"use client";

import { Notice, SelectField, SubmitButton } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveLanguage } from "@/app/actions/account";
import { FormError } from "@/app/(auth)/_components/forms";

/** L2: account language. Changes wording only, never data. */
export function LanguageForm({ locale }: { locale: "ro" | "en" }) {
  const t = useTranslations("account.profile");
  const c = useTranslations("common");
  const [state, formAction] = useActionState(saveLanguage, null);
  return (
    <form action={formAction} className="ed-form">
      <FormError state={state} />
      {state?.ok ? <Notice tone="success">{t("languageSaved")}</Notice> : null}
      <SelectField id="f-locale" name="locale" label={t("language")} hint={t("languageHint")} defaultValue={locale}>
        <option value="ro">{c("languages.ro")}</option>
        <option value="en">{c("languages.en")}</option>
      </SelectField>
      <SubmitButton pendingLabel={c("status.saving")} variant="secondary">
        {t("saveLanguage")}
      </SubmitButton>
    </form>
  );
}
