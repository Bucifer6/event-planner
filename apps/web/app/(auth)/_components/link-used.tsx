"use client";

import { Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { resendFromLink, verifyCode } from "@/app/actions/auth";
import { ActionForm } from "./forms";

/**
 * SEC14: the link was already used (often by a mail scanner). The code from the same email
 * still works here, and ONE new code can be requested.
 */
export function LinkUsed({ token }: { token: string }) {
  const t = useTranslations("auth");
  return (
    <Stack gap={5}>
      <ActionForm
        action={verifyCode}
        hidden={{ linkToken: token }}
        fields={[
          {
            name: "code",
            label: t("code.label"),
            hint: t("link.codeHint"),
            inputMode: "numeric",
            autoComplete: "one-time-code",
            code: true,
            maxLength: 7,
          },
        ]}
        submitLabel={t("code.submit")}
        pendingLabel={t("code.submitting")}
      />
      <Stack gap={2}>
        <p className="ed-small ed-muted">{t("link.resendIntro")}</p>
        <ActionForm
          action={resendFromLink}
          hidden={{ linkToken: token }}
          variant="secondary"
          submitLabel={t("link.resend")}
          pendingLabel={t("signIn.sendingCode")}
          success={t("link.resendDone")}
        />
      </Stack>
    </Stack>
  );
}
