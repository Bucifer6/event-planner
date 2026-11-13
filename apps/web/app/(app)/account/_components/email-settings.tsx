"use client";

import { buttonClassName, DescriptionList, Notice, Section, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { confirmEmail, removeLoginEmail, requestEmailCode } from "@/app/actions/account";
import { ActionForm, RecoveryCodes } from "@/app/(auth)/_components/forms";
import { FreshGate } from "./fresh-gate";

type Props = {
  fresh: boolean;
  method: "email_code" | "recovery_code";
  kind: "email" | "anonymous";
};

/**
 * The login email (S1, S4, S8, SEC3): add, change or remove. Each ends every session and
 * assistant token; this device stays signed in with a new session.
 */
export function EmailSettings({ fresh, method, kind }: Props) {
  const t = useTranslations("account.email");
  // All action state lives here, at the top of a component that stays mounted: the one-time
  // recovery codes stay on screen whatever the server re-renders after the session changes.
  const request = useActionState(requestEmailCode, null);
  const confirm = useActionState(confirmEmail, null);
  const remove = useActionState(removeLoginEmail, null);
  const pendingEmail = request[0]?.ok ? request[0].data.email : null;
  const changedTo = confirm[0]?.ok ? confirm[0].data.email : null;
  const removed = remove[0]?.ok ? remove[0].data : null;

  if (removed) {
    return (
      <Stack gap={4}>
        <Notice tone="success" title={t("removedTitle")}>
          {t("removedBody")}
        </Notice>
        <DescriptionList items={[{ term: t("usernameLabel"), value: <span className="ed-num">{removed.username}</span> }]} />
        <RecoveryCodes codes={removed.recoveryCodes} anonymous />
        <a href="/account" className={buttonClassName({ variant: "primary", block: true })}>
          {t("savedBack")}
        </a>
      </Stack>
    );
  }
  if (changedTo) {
    return (
      <Stack gap={4}>
        <Notice tone="success" title={t("changedTitle")}>
          {t("changedBody", { email: changedTo })}
        </Notice>
        <a href="/account" className={buttonClassName({ variant: "primary", block: true })}>
          {t("backToAccount")}
        </a>
      </Stack>
    );
  }
  if (!fresh) return <FreshGate method={method} />;

  if (pendingEmail) {
    return (
      <Stack gap={4}>
        <Notice tone="success" title={t("codeSentTitle")} role="status">
          {t("codeSentBody", { email: pendingEmail })}
        </Notice>
        <ActionForm
          bound={confirm}
          hidden={{ email: pendingEmail }}
          fields={[
            { name: "code", label: t("codeLabel"), hint: t("codeHint"), inputMode: "numeric", autoComplete: "one-time-code", code: true, maxLength: 7, autoFocus: true },
          ]}
          submitLabel={t("confirm")}
          pendingLabel={t("confirming")}
        />
<p>
          <a href="/account/email">{t("otherAddress")}</a>
        </p>
      </Stack>
    );
  }

  return (
    <Stack gap={5}>
      <Section title={kind === "email" ? t("changeTitle") : t("addTitle")}>
        <Stack gap={3}>
          <p>{kind === "email" ? t("changeBody") : t("addBody")}</p>
          <Notice tone="attention">{t("signOutNote")}</Notice>
          <ActionForm
            bound={request}
            fields={[
              { name: "email", label: t("newEmailLabel"), hint: t("newEmailHint"), type: "email", inputMode: "email", autoComplete: "email", maxLength: 254 },
            ]}
            submitLabel={t("sendCode")}
            pendingLabel={t("sendingCode")}
          />
        </Stack>
      </Section>
      {kind === "email" ? (
        <Section title={t("removeTitle")}>
          <Stack gap={3}>
            <p>{t("removeBody")}</p>
            <ul className="ed-prose">
              <li>{t("removeMeansNoEmail")}</li>
              <li>{t("removeMeansPassword")}</li>
              <li>{t("removeMeansCodes")}</li>
            </ul>
            <ActionForm
              bound={remove}
              variant="danger"
              fields={[
                { name: "newPassword", label: t("newPasswordLabel"), hint: t("newPasswordHint"), type: "password", autoComplete: "new-password", maxLength: 200 },
              ]}
              submitLabel={t("remove")}
              pendingLabel={t("removing")}
            />
          </Stack>
        </Section>
      ) : null}
    </Stack>
  );
}
