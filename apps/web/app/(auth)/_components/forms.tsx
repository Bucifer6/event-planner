"use client";

import { Cluster, CopyButton, FocusFirstError, List, Notice, Row, Stack, SubmitButton, TextField, type ButtonVariant } from "@ed/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type HTMLInputTypeAttribute, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action";

// Shared client form pieces for the sign-in and account screens: errors beside their field,
// typed input kept after a failed submit (error.values), the first invalid field focused,
// a rate-limit answer always shown with its retry time.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = ActionResult<any>;
export type FormAction<R = unknown> = (
  prev: ActionResult<R> | null | undefined,
  formData: FormData,
) => Promise<ActionResult<R>>;

export type FieldSpec = {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  inputMode?: "numeric" | "email" | "text";
  /** Large spaced digits for codes. */
  code?: boolean;
  required?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  defaultValue?: string;
};

/** The form-level message: what went wrong and, when throttled, from when to try again. */
export function FormError({ state, skipFields }: { state: AnyResult | null | undefined; skipFields?: string[] }) {
  const t = useTranslations("common");
  const format = useFormatter();
  if (!state || state.ok) return null;
  const { error } = state;
  const shownBesideField =
    error.code === "VALIDATION" &&
    Object.keys(error.fieldErrors ?? {}).some((name) => (skipFields ?? []).includes(name));
  if (shownBesideField) return null;
  const retry = error.retryAt
    ? t("errors.retryAt", { time: format.dateTime(new Date(error.retryAt), { hour: "2-digit", minute: "2-digit" }) })
    : null;
  return (
    <Notice tone="danger" title={error.message}>
      {retry}
    </Notice>
  );
}

type FormProps = {
  fields?: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: ReactNode;
  pendingLabel: string;
  variant?: ButtonVariant;
  block?: boolean;
  /** Shown above the form after it worked. */
  success?: ReactNode;
  refreshOnSuccess?: boolean;
  /** Extra content between the fields and the button. */
  children?: ReactNode;
  /** SEC11: hidden trap field + signed render stamp for public forms. */
  honeypot?: { name: string; label: string; stampName: string; stamp: string };
};

/**
 * A complete small form around a wrapped Server Action.
 *
 * Pass `action` and the form keeps its own state, or pass `bound` — the pair returned by
 * useActionState in a parent — when the parent decides what to show from the result. Flows
 * that hand out one-time secrets (recovery codes) use `bound` at the top of a component that
 * never unmounts, so the result survives any server re-render and also works without
 * JavaScript (the result arrives with the page).
 */
export function ActionForm<R>(
  props: FormProps &
    ({ action: FormAction<R>; bound?: undefined } | { bound: readonly [ActionResult<R> | null, (fd: FormData) => void, ...unknown[]]; action?: undefined }),
) {
  if (props.bound) return <FormBody {...props} state={props.bound[0]} formAction={props.bound[1]} />;
  return <SelfBound {...props} action={props.action} />;
}

function SelfBound<R>({ action, ...rest }: FormProps & { action: FormAction<R> }) {
  const [state, formAction] = useActionState(action, null);
  return <FormBody {...rest} state={state} formAction={formAction} />;
}

function FormBody<R>({
  state,
  formAction,
  fields = [],
  hidden,
  submitLabel,
  pendingLabel,
  variant = "primary",
  block = true,
  success,
  refreshOnSuccess,
  children,
  honeypot,
}: FormProps & { state: ActionResult<R> | null; formAction: (fd: FormData) => void }) {
  const router = useRouter();
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    if (refreshOnSuccess) router.refresh();
  }, [state, refreshOnSuccess, router]);

  const error = state && !state.ok ? state.error : null;
  return (
    <form action={formAction} className="ed-form" noValidate>
      <FormError state={state} skipFields={fields.map((f) => f.name)} />
      {state?.ok && success ? <Notice tone="success">{success}</Notice> : null}
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {honeypot ? (
        <>
          <input type="hidden" name={honeypot.stampName} value={honeypot.stamp} />
          <div className="ed-vh" aria-hidden="true">
            <label>
              {honeypot.label}
              <input type="text" name={honeypot.name} tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
          </div>
        </>
      ) : null}
      {fields.map((f) => (
        <TextField
          key={f.name}
          id={`f-${f.name}`}
          name={f.name}
          label={f.label}
          hint={f.hint}
          type={f.type ?? "text"}
          autoComplete={f.autoComplete}
          inputMode={f.inputMode}
          code={f.code}
          required={f.required ?? true}
          maxLength={f.maxLength}
          autoFocus={f.autoFocus}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={error?.values?.[f.name] ?? f.defaultValue}
          error={error?.fieldErrors?.[f.name]?.[0]}
        />
      ))}
      {children}
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <SubmitButton pendingLabel={pendingLabel} variant={variant} block={block}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

/** The ten recovery codes, shown once, with the plain warning (S2, S8). */
export function RecoveryCodes({ codes, anonymous }: { codes: string[]; anonymous: boolean }) {
  const t = useTranslations("auth.recoveryCodes");
  return (
    <Stack>
      <Notice tone="attention" title={t("title")}>
        {anonymous ? t("warningAnonymous") : t("warningTwoStep")}
      </Notice>
      <List aria-label={t("listLabel")}>
        {codes.map((code) => (
          <Row key={code} title={<span className="ed-num">{code}</span>} />
        ))}
      </List>
      <Cluster>
        <CopyButton text={codes.join("\n")} label={t("copy")} copiedLabel={t("copied")} />
      </Cluster>
      <p className="ed-small ed-muted">{t("onceOnly")}</p>
    </Stack>
  );
}
