"use client";

import { ExternalLink, FocusFirstError, Notice, SelectField, SubmitButton, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { sandboxCheckoutAction } from "@/app/actions/billing";
import { FormError } from "@/app/(auth)/_components/forms";
import styles from "./commercial.module.css";

/** W6 / MON4: opens a TEST-mode checkout for the acceptance run. Staff only; never a live key. */
export function SandboxCheckout() {
  const t = useTranslations("billing");
  const [state, formAction] = useActionState(sandboxCheckoutAction, null);
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={formAction} className="ed-form" noValidate>
      <h3>{t("console.sandbox.title")}</h3>
      <p className="ed-muted">{t("console.sandbox.body")}</p>
      <FormError state={state} skipFields={["businessId", "plan"]} />
      {state?.ok ? (
        <Notice tone="success" role="status" title={state.data.url ? t("console.sandbox.ready") : t("console.sandbox.featuredByHand")}>
          {state.data.url ? (
            <ExternalLink href={state.data.url} className={styles.link}>
              {t("console.sandbox.open")}
            </ExternalLink>
          ) : null}
        </Notice>
      ) : null}
      <TextField id="sbx-business" name="businessId" label={t("console.sandbox.business")} hint={t("console.sandbox.businessHint")} required maxLength={64} defaultValue={error?.values?.businessId} error={error?.fieldErrors?.businessId?.[0]} />
      <SelectField id="sbx-plan" name="plan" label={t("console.subs.plan")} defaultValue={error?.values?.plan ?? "business_monthly"} error={error?.fieldErrors?.plan?.[0]}>
        <option value="business_monthly">{t("paid.planNames.business_monthly")}</option>
        <option value="business_yearly">{t("paid.planNames.business_yearly")}</option>
      </SelectField>
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <SubmitButton pendingLabel={t("console.sandbox.opening")} variant="secondary" block={false}>
        {t("console.sandbox.run")}
      </SubmitButton>
    </form>
  );
}
