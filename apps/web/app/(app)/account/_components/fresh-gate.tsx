"use client";

import { Notice, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { confirmFresh, requestFreshCode } from "@/app/actions/account";
import { ActionForm } from "@/app/(auth)/_components/forms";

/**
 * S4: before a sensitive action, confirm it is you — a fresh emailed code for email accounts,
 * one recovery code for anonymous accounts (S8). Once confirmed the page is re-read and the
 * action itself appears; the confirmation lasts ten minutes.
 */
export function FreshGate({ method }: { method: "email_code" | "recovery_code" }) {
  const t = useTranslations("account.fresh");
  const request = useActionState(requestFreshCode, null);

  if (method === "recovery_code") {
    return (
      <Stack gap={4}>
        <Notice title={t("title")}>{t("recoveryBody")}</Notice>
        <ActionForm
          action={confirmFresh}
          refreshOnSuccess
          fields={[{ name: "recoveryCode", label: t("recoveryLabel"), hint: t("recoveryHint"), autoComplete: "off", maxLength: 40 }]}
          submitLabel={t("confirm")}
          pendingLabel={t("confirming")}
        />
      </Stack>
    );
  }
  if (!request[0]?.ok) {
    return (
      <Stack gap={4}>
        <Notice title={t("title")}>{t("emailBody")}</Notice>
        <ActionForm bound={request} submitLabel={t("sendCode")} pendingLabel={t("sendingCode")} />
      </Stack>
    );
  }
  return (
    <Stack gap={4}>
      <Notice tone="success" title={t("sentTitle")} role="status">
        {t("sentBody")}
      </Notice>
      <ActionForm
        action={confirmFresh}
        refreshOnSuccess
        fields={[
          { name: "code", label: t("codeLabel"), hint: t("codeHint"), inputMode: "numeric", autoComplete: "one-time-code", code: true, maxLength: 7, autoFocus: true },
        ]}
        submitLabel={t("confirm")}
        pendingLabel={t("confirming")}
      />
    </Stack>
  );
}
