"use client";

import { Button, Checkbox, ChoiceChips, Cluster, CopyButton, DescriptionList, FocusFirstError, Notice, Stack, SubmitButton, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { createAssistantToken } from "@/app/actions/mcp";
import { FormError } from "@/app/(auth)/_components/forms";

type Props = { serverUrl: string; dataClasses: string[] };

/**
 * Three steps on one screen (MCP1, MCP4, SEC8):
 *   1. name + scope
 *   2. the plain-language warning naming what data can leave EventDesk — must be accepted
 *   3. the token, shown once, with how to connect it
 * One component that never unmounts holds the result, so the token survives any re-render
 * and is gone for good once the person leaves.
 */
export function CreateAssistant({ serverUrl, dataClasses }: Props) {
  const t = useTranslations("mcp");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, formAction] = useActionState(createAssistantToken, null);
  const [step, setStep] = useState<"form" | "consent">("form");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read_propose">("read");
  const [nameError, setNameError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<unknown>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // moving between steps puts focus on the new step's heading (keyboard and screen readers)
  useEffect(() => {
    heading.current?.focus();
  }, [step, state]);

  if (state?.ok && dismissed !== state) {
    const header = `Authorization: Bearer ${state.data.token}`;
    return (
      <Stack gap={4}>
        <h3 ref={heading} tabIndex={-1}>
          {t("created.title")}
        </h3>
        <Notice tone="attention" title={t("created.once")} role="status" />
        <TextField id="mcp-token" label={t("created.tokenLabel")} value={state.data.token} readOnly className="ed-num" onFocus={(e) => e.currentTarget.select()} />
        <Cluster>
          <CopyButton text={state.data.token} label={t("created.copy")} copiedLabel={t("created.copied")} />
        </Cluster>
        <Stack gap={2}>
          <h4 className="ed-label">{t("created.howTitle")}</h4>
          <p>{t("created.howBody")}</p>
          <DescriptionList
            items={[
              { term: t("created.urlLabel"), value: <span className="ed-num">{serverUrl}</span> },
              { term: t("created.headerLabel"), value: <span className="ed-num">Authorization: Bearer …{state.data.last4}</span> },
            ]}
          />
          <Cluster>
            <CopyButton text={serverUrl} label={t("created.copyUrl")} copiedLabel={t("created.copied")} />
            <CopyButton text={header} label={t("created.copyHeader")} copiedLabel={t("created.copied")} />
          </Cluster>
        </Stack>
        <div>
          <Button
            variant="primary"
            onClick={() => {
              setDismissed(state);
              setStep("form");
              setName("");
              setScope("read");
              router.refresh();
            }}
          >
            {t("created.done")}
          </Button>
        </div>
      </Stack>
    );
  }

  const error = state && !state.ok && dismissed !== state ? state.error : null;

  if (step === "form") {
    return (
      <form
        className="ed-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === "") {
            setNameError(tc("validation.required"));
            return;
          }
          setNameError(null);
          setStep("consent");
        }}
      >
        <TextField
          id="mcp-name"
          name="name"
          label={t("create.nameLabel")}
          hint={t("create.nameHint")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={60}
          required
          autoComplete="off"
          error={nameError ?? undefined}
        />
        <div onChange={(e) => setScope((e.target as HTMLInputElement).value === "read_propose" ? "read_propose" : "read")}>
          <ChoiceChips
            name="scope"
            legend={t("create.scopeLegend")}
            stack
            defaultValue={scope}
            options={[
              { value: "read", label: t("scopes.read") },
              { value: "read_propose", label: t("scopes.read_propose") },
            ]}
          />
        </div>
        <p className="ed-small ed-muted">{scope === "read" ? t("scopes.readHint") : t("scopes.read_proposeHint")}</p>
        <FocusFirstError errors={nameError ? { name: nameError } : null} />
        <div>
          <Button type="submit" variant="primary">
            {t("create.continue")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className="ed-form" noValidate>
      <h3 ref={heading} tabIndex={-1}>
        {t("consent.title")}
      </h3>
      <FormError state={dismissed === state ? null : state} skipFields={["consent"]} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="scope" value={scope} />
      <Notice tone="attention" title={t("consent.lead")} role="status" />
      <Stack gap={2}>
        <h4 className="ed-label">{t("consent.classesTitle")}</h4>
        <ul className="ed-prose">
          {dataClasses.map((c) => (
            <li key={c}>{t(`consent.classes.${c}` as never)}</li>
          ))}
        </ul>
      </Stack>
      <p>{t("consent.limits")}</p>
      <p>{t("consent.transfer")}</p>
      <p>{t("consent.retention")}</p>
      <p className="ed-small ed-muted">
        {name} · {t(`scopes.${scope}`)}
      </p>
      <div>
        <Checkbox name="consent" label={t("consent.checkbox")} aria-invalid={error?.fieldErrors?.consent ? true : undefined} />
        {error?.fieldErrors?.consent ? (
          <span className="ed-field__error" role="alert">
            {error.fieldErrors.consent[0]}
          </span>
        ) : null}
      </div>
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <Cluster>
        <Button onClick={() => setStep("form")}>{t("consent.backToForm")}</Button>
        <SubmitButton pendingLabel={t("consent.submitting")}>{t("consent.submit")}</SubmitButton>
      </Cluster>
    </form>
  );
}
