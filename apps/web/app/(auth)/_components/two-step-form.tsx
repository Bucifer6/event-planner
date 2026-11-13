"use client";

import { Button, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { verifyTwoStep } from "@/app/actions/auth";
import { ActionForm } from "./forms";

/** S2: the second step, only for accounts that turned it on. */
export function TwoStepForm() {
  const t = useTranslations("auth.twoStep");
  const [useRecovery, setUseRecovery] = useState(false);
  return (
    <Stack gap={4}>
      {useRecovery ? (
        <ActionForm
          key="recovery"
          action={verifyTwoStep}
          fields={[{ name: "recoveryCode", label: t("recoveryLabel"), hint: t("recoveryHint"), autoComplete: "off", maxLength: 40 }]}
          submitLabel={t("submit")}
          pendingLabel={t("submitting")}
        />
      ) : (
        <ActionForm
          key="totp"
          action={verifyTwoStep}
          fields={[
            { name: "code", label: t("codeLabel"), hint: t("codeHint"), inputMode: "numeric", autoComplete: "one-time-code", code: true, maxLength: 7 },
          ]}
          submitLabel={t("submit")}
          pendingLabel={t("submitting")}
        />
      )}
      <Button variant="quiet" onClick={() => setUseRecovery((v) => !v)}>
        {useRecovery ? t("useApp") : t("useRecovery")}
      </Button>
    </Stack>
  );
}
