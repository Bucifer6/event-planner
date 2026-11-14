"use client";

import { ChoiceChips, FocusFirstError, Notice, SelectField, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormError, type FormAction } from "@/app/(auth)/_components/forms";

type Option = { value: string; label: string };

/** Compose a notice: subject, text, and WHICH BUSINESSES — all, one category, or one county. */
export function NoticeForm({ action, categories, counties }: { action: FormAction<{ businesses: number; emails: number }>; categories: Option[]; counties: Option[] }) {
  const t = useTranslations("comms");
  const router = useRouter();
  const [state, formAction] = useActionState(action, null);
  const [audience, setAudience] = useState("all");
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  const err = (name: string) => error?.fieldErrors?.[name]?.[0];
  const val = (name: string) => error?.values?.[name];

  return (
    <form action={formAction} className="ed-form" noValidate key={state?.ok ? `sent-${state.data.businesses}-${state.data.emails}` : "compose"}>
      <FormError state={state} skipFields={["subject", "body", "audience", "categoryId", "countyCode"]} />
      {state?.ok ? (
        <Notice tone="success" role="status" title={t("compose.sent", { businesses: state.data.businesses, emails: state.data.emails })} />
      ) : null}
      <TextField id="notice-subject" name="subject" label={t("compose.subject")} required maxLength={140} defaultValue={val("subject")} error={err("subject")} />
      <TextareaField id="notice-body" name="body" label={t("compose.text")} hint={t("compose.textHint")} required rows={7} maxLength={4000} defaultValue={val("body")} error={err("body")} />
      <div onChange={(e) => (e.target instanceof HTMLInputElement && e.target.name === "audience" ? setAudience(e.target.value) : undefined)}>
        <ChoiceChips
          name="audience"
          legend={t("compose.audience")}
          required
          defaultValue={val("audience") ?? "all"}
          options={[
            { value: "all", label: t("audience.all") },
            { value: "category", label: t("audience.category") },
            { value: "county", label: t("audience.county") },
          ]}
          error={err("audience")}
        />
      </div>
      {audience === "category" ? (
        <SelectField id="notice-category" name="categoryId" label={t("compose.category")} required defaultValue={val("categoryId") ?? ""} error={err("categoryId")}>
          <option value="">{t("compose.choose")}</option>
          {categories.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      {audience === "county" ? (
        <SelectField id="notice-county" name="countyCode" label={t("compose.county")} required defaultValue={val("countyCode") ?? ""} error={err("countyCode")}>
          <option value="">{t("compose.choose")}</option>
          {counties.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <SubmitButton pendingLabel={t("compose.sending")}>{t("compose.send")}</SubmitButton>
    </form>
  );
}
