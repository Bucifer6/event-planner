"use client";

import { useTranslations } from "next-intl";
import { createSourceAction, updateSourceAction } from "@/app/actions/discovery";
import { SpecForm, type FieldSpec } from "@/app/console/_components/SpecForm";

export type SourceFormValues = {
  id?: string;
  kind: "onrc_public" | "business_page" | "licensed_dataset";
  name: string;
  termsReference: string;
  rateLimitPerHour: string;
  format: string;
  url: string;
  inline: string;
  urls: string;
  defaultCategoryId: string;
  targetCategoryIds: string;
  targetCountyCodes: string;
};

/**
 * W5: configure one discovery source. The fields follow the source's kind: a dataset has a
 * format and a file (address or pasted content); a pages source has its list of public
 * addresses; ONRC has only the shared settings (its adapter is the operator's).
 */
export function SourceForm({ values, categories }: { values: SourceFormValues; categories: Array<{ value: string; label: string }> }) {
  const t = useTranslations("discovery");
  const editing = !!values.id;
  const shared: FieldSpec[] = [
    { kind: "text", name: "name", label: t("sourceForm.name"), required: true, maxLength: 120, defaultValue: values.name },
    { kind: "text", name: "termsReference", label: t("sourceForm.terms"), hint: t("sourceForm.termsHint"), required: true, maxLength: 500, defaultValue: values.termsReference },
    { kind: "number", name: "rateLimitPerHour", label: t("sourceForm.rate"), hint: t("sourceForm.rateHint"), required: true, min: 1, max: 3600, defaultValue: values.rateLimitPerHour },
  ];
  const byKind: FieldSpec[] =
    values.kind === "licensed_dataset"
      ? [
          { kind: "chips", name: "format", label: t("sourceForm.format"), defaultValue: values.format || "csv", options: [{ value: "csv", label: t("sourceForm.formats.csv") }, { value: "json", label: t("sourceForm.formats.json") }] },
          { kind: "text", name: "url", label: t("sourceForm.url"), hint: t("sourceForm.urlHint"), maxLength: 1000, defaultValue: values.url, optionalLabel: t("sourceForm.optional") },
          { kind: "textarea", name: "inline", label: t("sourceForm.inline"), hint: t("sourceForm.inlineHint"), rows: 8, defaultValue: values.inline, optionalLabel: t("sourceForm.optional") },
        ]
      : values.kind === "business_page"
        ? [{ kind: "textarea", name: "urls", label: t("sourceForm.urls"), hint: t("sourceForm.urlsHint"), rows: 8, required: true, defaultValue: values.urls }]
        : [];
  const targeting: FieldSpec[] = [
    { kind: "select", name: "defaultCategoryId", label: t("sourceForm.defaultCategory"), hint: t("sourceForm.defaultCategoryHint"), defaultValue: values.defaultCategoryId, placeholder: t("sourceForm.none"), options: categories },
    { kind: "text", name: "targetCategoryIds", label: t("sourceForm.targetCategories"), hint: t("sourceForm.targetCategoriesHint"), maxLength: 2000, defaultValue: values.targetCategoryIds, optionalLabel: t("sourceForm.optional") },
    { kind: "text", name: "targetCountyCodes", label: t("sourceForm.targetCounties"), hint: t("sourceForm.targetCountiesHint"), maxLength: 400, defaultValue: values.targetCountyCodes, optionalLabel: t("sourceForm.optional") },
  ];
  const fields = [...shared, ...byKind, ...targeting];
  if (editing) {
    return (
      <SpecForm action={updateSourceAction} hidden={{ id: values.id! }} fields={fields} submitLabel={t("sourceForm.save")} pendingLabel={t("sourceForm.saving")} success={t("sourceForm.saved")} refreshOnSuccess>
        {values.kind === "onrc_public" ? <p className="ed-small ed-muted">{t("sourceForm.onrcNote")}</p> : null}
      </SpecForm>
    );
  }
  return (
    <SpecForm action={createSourceAction} hidden={{ kind: values.kind }} fields={fields} submitLabel={t("sourceForm.create")} pendingLabel={t("sourceForm.saving")}>
      {values.kind === "onrc_public" ? <p className="ed-small ed-muted">{t("sourceForm.onrcNote")}</p> : null}
    </SpecForm>
  );
}
