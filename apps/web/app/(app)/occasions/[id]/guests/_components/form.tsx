"use client";

import {
  Checkbox,
  CopyButton,
  FocusFirstError,
  Notice,
  SelectField,
  SheetTrigger,
  SubmitButton,
  TextareaField,
  TextField,
  type ButtonVariant,
} from "@ed/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-core";
import styles from "./guests.module.css";

// One small form component for the guests / polls / contributions planner pages: label above
// each field, the error beside its field, typed input kept after a failed submit, the first
// invalid field focused, the button disabled with words while the action runs.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (prev: ActionResult<any> | null | undefined, formData: FormData) => Promise<ActionResult<any>>;

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "textarea" | "select" | "checkbox";
  hint?: string;
  defaultValue?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  rows?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  autoComplete?: string;
};

export type PlannerFormProps = {
  action: AnyAction;
  /** Unique within the page: prefixes the field ids. */
  id: string;
  hidden?: Record<string, string>;
  fields?: FieldSpec[];
  submitLabel: string;
  pendingLabel: string;
  variant?: ButtonVariant;
  block?: boolean;
  /** Shown after it worked. */
  success?: string;
  /** Go here after it worked; `{key}` is replaced with result.data[key]. */
  redirectTo?: string;
  /** Show result.data.path as a copy-once guest link after it worked. */
  linkOnce?: { title: string; body: string; copy: string; copied: string };
  /**
   * When the action answers with this exact message (the child-details warning), the form
   * shows it as a warning and marks itself as "warned" for the next submit.
   */
  childWarning?: string;
  optionalLabel?: string;
  children?: ReactNode;
};

export function PlannerForm({
  action,
  id,
  hidden,
  fields = [],
  submitLabel,
  pendingLabel,
  variant = "primary",
  block,
  success,
  redirectTo,
  linkOnce,
  childWarning,
  optionalLabel,
  children,
}: PlannerFormProps) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const t = useTranslations("common");
  const format = useFormatter();
  const handled = useRef<unknown>(null);
  const [warned, setWarned] = useState(false);

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (!state.ok) {
      if (childWarning && state.error.message === childWarning) setWarned(true);
      return;
    }
    if (redirectTo) {
      const data = (state.data ?? {}) as Record<string, unknown>;
      router.push(redirectTo.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(data[k] ?? ""))));
    } else {
      router.refresh();
    }
  }, [state, redirectTo, router, childWarning]);

  const error = state && !state.ok ? state.error : null;
  const fieldNames = fields.map((f) => f.name);
  const besideField = error?.code === "VALIDATION" && Object.keys(error.fieldErrors ?? {}).some((n) => fieldNames.includes(n));
  const path = state?.ok && linkOnce ? ((state.data as { path?: string } | null)?.path ?? null) : null;

  if (path && linkOnce) return <LinkOnce path={path} {...linkOnce} />;

  return (
    <form action={formAction} className="ed-form" noValidate>
      {error && !besideField ? (
        <Notice tone={warned && error.message === childWarning ? "attention" : "danger"} title={error.message}>
          {error.retryAt
            ? t("errors.retryAt", { time: format.dateTime(new Date(error.retryAt), { hour: "2-digit", minute: "2-digit" }) })
            : null}
        </Notice>
      ) : null}
      {state?.ok && success ? (
        <Notice tone="success" role="status">
          {success}
        </Notice>
      ) : null}
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {childWarning ? <input type="hidden" name="childDetailsAcknowledged" value={warned ? "1" : ""} /> : null}
      {fields.map((f) => {
        const fid = `${id}-${f.name}`;
        const value = error?.values?.[f.name] ?? f.defaultValue ?? "";
        const fieldError = error?.fieldErrors?.[f.name]?.[0];
        const optional = f.required ? undefined : optionalLabel;
        if (f.type === "textarea") {
          return (
            <TextareaField key={f.name} id={fid} name={f.name} label={f.label} hint={f.hint} error={fieldError} optionalLabel={optional} rows={f.rows ?? 3} maxLength={f.maxLength} defaultValue={value} />
          );
        }
        if (f.type === "select") {
          return (
            <SelectField key={f.name} id={fid} name={f.name} label={f.label} hint={f.hint} error={fieldError} defaultValue={value}>
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
          );
        }
        if (f.type === "checkbox") {
          return <Checkbox key={f.name} name={f.name} label={f.label} hint={f.hint} defaultChecked={value === "on" || value === "true"} />;
        }
        return (
          <TextField
            key={f.name}
            id={fid}
            name={f.name}
            label={f.label}
            hint={f.hint}
            error={fieldError}
            optionalLabel={optional}
            type={f.type === "number" ? "text" : (f.type ?? "text")}
            inputMode={f.type === "number" ? "numeric" : f.type === "email" ? "email" : undefined}
            pattern={f.type === "number" ? "[0-9]*" : undefined}
            min={f.min}
            max={f.max}
            maxLength={f.maxLength}
            autoComplete={f.autoComplete ?? "off"}
            required={f.required}
            defaultValue={value}
          />
        );
      })}
      {children}
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div>
        <SubmitButton pendingLabel={pendingLabel} variant={variant} block={block}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

/** The household's link, shown once after creation or regeneration — it cannot be read again. */
export function LinkOnce({ path, title, body, copy, copied }: { path: string; title: string; body: string; copy: string; copied: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;
  return (
    <Notice tone="success" title={title} role="status">
      <p>{body}</p>
      <p className={`ed-small ${styles.wrap}`}>
        <span className="ed-num">{url}</span>
      </p>
      <CopyButton text={url} label={copy} copiedLabel={copied} />
    </Notice>
  );
}

/** A button that opens a Sheet holding one PlannerForm. */
export function FormSheet({
  label,
  title,
  closeLabel,
  variant,
  icon,
  intro,
  form,
}: {
  label: string;
  title: string;
  closeLabel: string;
  variant?: ButtonVariant;
  icon?: ReactNode;
  intro?: ReactNode;
  form: PlannerFormProps;
}) {
  return (
    <SheetTrigger label={label} title={title} closeLabel={closeLabel} variant={variant} icon={icon}>
      {intro}
      <PlannerForm {...form} block />
    </SheetTrigger>
  );
}
