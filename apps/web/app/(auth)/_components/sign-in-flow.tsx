"use client";

import { Notice, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { requestCode, verifyCode } from "@/app/actions/auth";
import { ActionForm } from "./forms";

/** S1: email, then the six-digit code. The one-tap link in the same email does the same. */
export function SignInFlow() {
  const t = useTranslations("auth");
  const request = useActionState(requestCode, null);
  const sentTo = request[0]?.ok ? request[0].data.email : null;

  if (!sentTo) {
    return (
      <ActionForm
        bound={request}
        fields={[
          {
            name: "email",
            label: t("signIn.emailLabel"),
            hint: t("signIn.emailHint"),
            type: "email",
            inputMode: "email",
            autoComplete: "email",
            maxLength: 254,
          },
        ]}
        submitLabel={t("signIn.sendCode")}
        pendingLabel={t("signIn.sendingCode")}
      />
    );
  }
  return (
    <Stack gap={4}>
      <Notice tone="success" title={t("code.sentTitle")} role="status">
        {t("code.sentBody", { email: sentTo })}
      </Notice>
      <ActionForm
        action={verifyCode}
        hidden={{ email: sentTo }}
        fields={[
          {
            name: "code",
            label: t("code.label"),
            hint: t("code.hint"),
            inputMode: "numeric",
            autoComplete: "one-time-code",
            code: true,
            maxLength: 7,
            autoFocus: true,
          },
        ]}
        submitLabel={t("code.submit")}
        pendingLabel={t("code.submitting")}
      />
      {/* A plain link: a full load starts the flow again, with or without JavaScript. */}
      <p>
        <a href="/sign-in">{t("code.otherEmail")}</a>
      </p>
    </Stack>
  );
}
