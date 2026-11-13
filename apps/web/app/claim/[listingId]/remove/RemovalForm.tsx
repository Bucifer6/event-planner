"use client";

import { useTranslations } from "next-intl";
import { submitObjectionAction } from "@/app/actions/claims";
import { SpecForm } from "@/app/console/_components/SpecForm";

/** BD6: the public removal / objection / correction form. Replaced by the outcome once sent. */
export function RemovalForm({ listingId, token, honeypot }: { listingId: string; token: string; honeypot: { name: string; stampName: string; stamp: string } }) {
  const t = useTranslations("claims");
  return (
    <SpecForm
      action={submitObjectionAction}
      hidden={{ listingId, ...(token ? { token } : {}) }}
      honeypot={{ ...honeypot, label: t("remove.trap") }}
      replaceOnSuccess
      block
      successRender={(data) => (data.honoured ? t("remove.doneNow") : t("remove.doneLater"))}
      fields={[
        { kind: "chips", name: "kind", label: t("remove.kind"), required: true, stack: true, defaultValue: "removal", options: (["removal", "objection", "correction"] as const).map((k) => ({ value: k, label: t(`remove.kinds.${k}`) })) },
        { kind: "textarea", name: "message", label: t("remove.message"), hint: t("remove.messageHint"), rows: 5, maxLength: 2000, optionalLabel: t("remove.optional") },
        { kind: "email", name: "contactEmail", label: t("remove.contact"), hint: t("remove.contactHint"), maxLength: 254, optionalLabel: t("remove.optional") },
      ]}
      submitLabel={t("remove.submit")}
      pendingLabel={t("remove.submitting")}
    />
  );
}
