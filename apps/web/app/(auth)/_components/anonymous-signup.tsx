"use client";

import { buttonClassName, DescriptionList, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { anonymousSignUp } from "@/app/actions/auth";
import { ActionForm, RecoveryCodes } from "./forms";

/** S7/S8: choose a password; then the generated username and the recovery codes, shown once. */
export function AnonymousSignup({
  honeypot,
  continueHref,
}: {
  honeypot: { name: string; stampName: string; stamp: string };
  continueHref: string;
}) {
  const t = useTranslations("auth");
  const signup = useActionState(anonymousSignUp, null);
  const created = signup[0]?.ok ? signup[0].data : null;

  if (created) {
    return (
      <Stack gap={4}>
        <h2 className="ed-display">{t("anonymous.createdTitle")}</h2>
        <DescriptionList items={[{ term: t("anonymous.usernameLabel"), value: <span className="ed-num">{created.username}</span> }]} />
        <p>{t("anonymous.createdBody")}</p>
        <RecoveryCodes codes={created.recoveryCodes} anonymous />
        <a href={continueHref} className={buttonClassName({ variant: "primary", block: true })}>
          {t("anonymous.savedContinue")}
        </a>
      </Stack>
    );
  }
  return (
    <ActionForm
      bound={signup}
      honeypot={{ ...honeypot, label: t("anonymous.trapLabel") }}
      fields={[
        {
          name: "password",
          label: t("anonymous.passwordLabel"),
          hint: t("anonymous.passwordHint"),
          type: "password",
          autoComplete: "new-password",
          maxLength: 200,
        },
      ]}
      submitLabel={t("anonymous.create")}
      pendingLabel={t("anonymous.creating")}
    />
  );
}
