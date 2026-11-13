"use client";

import { useTranslations } from "next-intl";
import { submitReport } from "@/app/actions/report";
import { SpecForm } from "@/app/console/_components/SpecForm";

type Props = {
  categories: string[];
  prefill: { targetRef: string; targetType: string; targetId: string };
  honeypot: { name: string; stampName: string; stamp: string };
};

/** LAU8: the public report form. On success it is replaced by the case reference. */
export function ReportForm({ categories, prefill, honeypot }: Props) {
  const t = useTranslations("report");
  return (
    <SpecForm
      action={submitReport}
      replaceOnSuccess
      block
      successRender={(data) => (
        <>
          <strong>{t("done.title")}</strong>
          <br />
          {t("done.body", { reference: data.reference })}
        </>
      )}
      hidden={prefill.targetType && prefill.targetId ? { targetType: prefill.targetType, targetId: prefill.targetId } : undefined}
      honeypot={{ ...honeypot, label: t("form.trap") }}
      fields={[
        { kind: "text", name: "targetRef", label: t("form.target"), hint: t("form.targetHint"), required: true, maxLength: 500, defaultValue: prefill.targetRef },
        {
          kind: "select",
          name: "reasonCategory",
          label: t("form.category"),
          required: true,
          placeholder: t("form.categoryPlaceholder"),
          options: categories.map((c) => ({ value: c, label: t(`categories.${c}` as never) })),
        },
        { kind: "textarea", name: "description", label: t("form.description"), hint: t("form.descriptionHint"), required: true, maxLength: 4000, rows: 6 },
        { kind: "email", name: "reporterContact", label: t("form.contact"), hint: t("form.contactHint"), maxLength: 254, optionalLabel: t("form.optional") },
      ]}
      submitLabel={t("form.submit")}
      pendingLabel={t("form.submitting")}
    />
  );
}
