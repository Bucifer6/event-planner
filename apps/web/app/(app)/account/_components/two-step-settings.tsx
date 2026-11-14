"use client";

import { buttonClassName, DescriptionList, Notice, Section, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { confirmTwoStep, newRecoveryCodes, startTwoStep, turnOffTwoStep } from "@/app/actions/account";
import { ActionForm, RecoveryCodes } from "@/app/(auth)/_components/forms";
import { FreshGate } from "./fresh-gate";

type Props = {
  fresh: boolean;
  method: "email_code" | "recovery_code";
  enabled: boolean;
  anonymous: boolean;
  codesLeft: number;
  codeEndings: string[];
};

/**
 * S2: opt-in two-step with any authenticator app; ten recovery codes shown once; turning it
 * on or off needs a fresh confirmation (S4). One-time secrets live only in this component's
 * state, so they stay on screen whatever the server re-renders around it.
 */
export function TwoStepSettings({ fresh, method, enabled, anonymous, codesLeft, codeEndings }: Props) {
  const t = useTranslations("account.twoStep");
  // All action state lives here, at the top of a component that stays mounted.
  const start = useActionState(startTwoStep, null);
  const confirm = useActionState(confirmTwoStep, null);
  const regenerate = useActionState(newRecoveryCodes, null);
  const codes = confirm[0]?.ok ? confirm[0].data.recoveryCodes : regenerate[0]?.ok ? regenerate[0].data.recoveryCodes : null;
  const setup = start[0]?.ok ? start[0].data : null;

  if (codes) {
    return (
      <Stack gap={4}>
        <RecoveryCodes codes={codes} anonymous={anonymous} />
{/* A plain link: the full load re-reads the page and drops the codes from memory. */}
        <a href="/account/security" className={buttonClassName({ variant: "primary", block: true })}>
          {t("savedCodes")}
        </a>
      </Stack>
    );
  }
  if (!fresh) return <FreshGate method={method} />;

  if (setup) {
    return (
      <Stack gap={4}>
        <h2>{t("scanTitle")}</h2>
        <p>{t("scanBody")}</p>
        {/* A data: URL image with alt text — no script, no external request (strict CSP). */}
        <img src={setup.qrDataUrl} alt={t("qrAlt")} width={220} height={220} />
        <DescriptionList items={[{ term: t("manualKey"), value: <span className="ed-num">{setup.secret}</span> }]} />
        <ActionForm
          bound={confirm}
          fields={[
            { name: "code", label: t("codeLabel"), hint: t("codeHint"), inputMode: "numeric", autoComplete: "one-time-code", code: true, maxLength: 7 },
          ]}
          submitLabel={t("turnOn")}
          pendingLabel={t("turningOn")}
        />
<p>
          <a href="/account/security">{t("cancelSetup")}</a>
        </p>
      </Stack>
    );
  }

  const hasCodes = enabled || anonymous;
  return (
    <Stack gap={5}>
      <Section title={t("appTitle")}>
        <Stack gap={3}>
          <p>{enabled ? t("onBody") : t("offBody")}</p>
          {enabled ? (
            <ActionForm
              action={turnOffTwoStep}
              refreshOnSuccess
              variant="danger"
              block={false}
              submitLabel={t("turnOff")}
              pendingLabel={t("turningOff")}
            />
          ) : (
            <ActionForm
              bound={start}
              variant="secondary"
              block={false}
              submitLabel={t("start")}
              pendingLabel={t("starting")}
            />
          )}
        </Stack>
      </Section>
      {hasCodes ? (
        <Section title={t("codesTitle")}>
          <Stack gap={3}>
            <p>{anonymous ? t("codesBodyAnonymous") : t("codesBody")}</p>
            <DescriptionList
              items={[
                { term: t("codesLeft"), value: <span className="ed-num">{codesLeft}</span> },
                {
                  term: t("codesEndings"),
                  value: <span className="ed-num">{codeEndings.length ? codeEndings.map((e) => `…${e}`).join("  ") : "—"}</span>,
                },
              ]}
            />
            <Notice tone="attention">{t("regenerateWarning")}</Notice>
            <ActionForm
              bound={regenerate}
              variant="secondary"
              block={false}
              submitLabel={t("regenerate")}
              pendingLabel={t("regenerating")}
            />
          </Stack>
        </Section>
      ) : null}
    </Stack>
  );
}
