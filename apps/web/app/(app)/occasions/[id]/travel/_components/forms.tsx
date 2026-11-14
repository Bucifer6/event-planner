"use client";

import { Button, Checkbox, Field, FocusFirstError, Notice, SelectField, SheetTrigger, SubmitButton, TextareaField, TextField, type ButtonVariant } from "@ed/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-core";
import styles from "./travel.module.css";

// The one small form used by the travel and operate pages: label above each field, the error
// beside its field, typed input and ticks kept after a failed submit, the first invalid field
// focused, the button disabled with words while the action runs. No drag anywhere.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (prev: ActionResult<any> | null | undefined, formData: FormData) => Promise<ActionResult<any>>;

export type TFieldSpec = {
  name: string;
  label: string;
  type?: "text" | "number" | "decimal" | "date" | "datetime" | "textarea" | "select" | "checkbox" | "zone" | "checks";
  hint?: string;
  defaultValue?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string; hint?: string; group?: string }>;
  /** checks: the values ticked at first. */
  defaultChecked?: string[];
  rows?: number;
  maxLength?: number;
  placeholder?: string;
};

export type TFormProps = {
  action: AnyAction;
  /** Unique within the page: prefixes the field ids. */
  id: string;
  hidden?: Record<string, string>;
  fields?: TFieldSpec[];
  submitLabel: string;
  pendingLabel: string;
  variant?: ButtonVariant;
  block?: boolean;
  success?: string;
  /** Go here after it worked; `{key}` is replaced with result.data[key]. */
  redirectTo?: string;
  optionalLabel?: string;
  /** id of the page's <ZoneList> datalist, for fields of type "zone" (a searchable native list). */
  zoneListId?: string;
  /** A fresh idempotency key is sent in this field with every successful submit. */
  idempotencyField?: string;
  onDone?: () => void;
  children?: ReactNode;
};

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export function TForm({ action, id, hidden, fields = [], submitLabel, pendingLabel, variant = "primary", block, success, redirectTo, optionalLabel, zoneListId, idempotencyField, onDone, children }: TFormProps) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const t = useTranslations("common");
  const format = useFormatter();
  const handled = useRef<unknown>(null);
  const [key, setKey] = useState(newKey);
  const [checks, setChecks] = useState<Record<string, string[]>>(() => Object.fromEntries(fields.filter((f) => f.type === "checks").map((f) => [f.name, f.defaultChecked ?? []])));

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (!state.ok) return;
    setKey(newKey());
    if (redirectTo) {
      const data = (state.data ?? {}) as Record<string, unknown>;
      router.push(redirectTo.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(data[k] ?? ""))));
    } else {
      router.refresh();
    }
    onDone?.();
  }, [state, redirectTo, router, onDone]);

  const error = state && !state.ok ? state.error : null;
  const names = fields.map((f) => f.name);
  const besideField = !!error && Object.keys(error.fieldErrors ?? {}).some((n) => names.includes(n));

  return (
    <form action={formAction} className="ed-form" noValidate>
      {error && !besideField ? (
        <Notice tone="danger" title={error.message}>
          {error.retryAt ? t("errors.retryAt", { time: format.dateTime(new Date(error.retryAt), { hour: "2-digit", minute: "2-digit" }) }) : null}
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
      {idempotencyField ? <input type="hidden" name={idempotencyField} value={key} /> : null}
      {fields.map((f) => {
        const fid = `${id}-${f.name}`;
        const value = error?.values?.[f.name] ?? f.defaultValue ?? "";
        const fieldError = error?.fieldErrors?.[f.name]?.[0];
        const optional = f.required ? undefined : optionalLabel;
        if (f.type === "textarea") {
          return <TextareaField key={f.name} id={fid} name={f.name} label={f.label} hint={f.hint} error={fieldError} optionalLabel={optional} rows={f.rows ?? 3} maxLength={f.maxLength} defaultValue={value} placeholder={f.placeholder} />;
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
        if (f.type === "checks") {
          const ticked = checks[f.name] ?? [];
          const toggle = (v: string) => setChecks((c) => ({ ...c, [f.name]: ticked.includes(v) ? ticked.filter((x) => x !== v) : [...ticked, v] }));
          let lastGroup: string | undefined;
          return (
            <Field key={f.name} id={fid} label={f.label} hint={f.hint} error={fieldError}>
              <div className={styles.checks} id={fid} role="group" aria-label={f.label}>
                {(f.options ?? []).map((o) => {
                  const head = o.group && o.group !== lastGroup ? <span className={`ed-label ${styles.checkGroup}`}>{o.group}</span> : null;
                  lastGroup = o.group;
                  return (
                    <span key={o.value} className={styles.checkWrap}>
                      {head}
                      <Checkbox name={f.name} value={o.value} checked={ticked.includes(o.value)} onChange={() => toggle(o.value)} label={o.label} hint={o.hint} />
                    </span>
                  );
                })}
              </div>
            </Field>
          );
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
            type={f.type === "datetime" ? "datetime-local" : f.type === "date" ? "date" : "text"}
            inputMode={f.type === "number" ? "numeric" : f.type === "decimal" ? "decimal" : undefined}
            pattern={f.type === "number" ? "[0-9]*" : undefined}
            list={f.type === "zone" ? zoneListId : undefined}
            maxLength={f.maxLength}
            autoComplete="off"
            autoCapitalize={f.type === "zone" ? "none" : undefined}
            spellCheck={f.type === "zone" ? false : undefined}
            required={f.required}
            placeholder={f.placeholder}
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

/** A button that opens a sheet with a TForm in it; the sheet closes when the action worked. */
export function SheetForm({ label, title, closeLabel, variant = "secondary", icon, block, intro, form, onDone }: { label: ReactNode; title: ReactNode; closeLabel: string; variant?: ButtonVariant; icon?: ReactNode; block?: boolean; intro?: ReactNode; form: Omit<TFormProps, "onDone">; onDone?: () => void }) {
  return (
    <SheetTrigger label={label} title={title} closeLabel={closeLabel} variant={variant} icon={icon} block={block}>
      {(close) => (
        <>
          {intro ? <p className="ed-muted">{intro}</p> : null}
          <TForm
            {...form}
            block
            onDone={
              form.redirectTo
                ? undefined
                : () => {
                    close();
                    onDone?.();
                  }
            }
          />
        </>
      )}
    </SheetTrigger>
  );
}

/** One-button form (opt in, take a seat, apply a starter): says what is happening, shows the error beside the button. */
export function QuickAction({ action, hidden, label, pendingLabel, variant = "secondary", block, done, idempotencyField }: { action: AnyAction; hidden: Record<string, string>; label: ReactNode; pendingLabel: string; variant?: ButtonVariant; block?: boolean; done?: string; idempotencyField?: string }) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  const [key, setKey] = useState(newKey);
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      setKey(newKey());
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={formAction} className={styles.quick}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {idempotencyField ? <input type="hidden" name={idempotencyField} value={key} /> : null}
      <SubmitButton pendingLabel={pendingLabel} variant={variant} block={block}>
        {label}
      </SubmitButton>
      {state && !state.ok ? (
        <span className={styles.quickError} role="alert">
          {state.error.message}
        </span>
      ) : null}
      {state?.ok && done ? (
        <span className="ed-small ed-muted" role="status">
          {done}
        </span>
      ) : null}
    </form>
  );
}

/** Destructive: a quiet button that opens a sheet naming the object, with "Păstrează" beside the danger button. */
export function DangerSheet({ action, hidden, label, title, body, confirmLabel, keepLabel, pendingLabel, closeLabel }: { action: AnyAction; hidden: Record<string, string>; label: ReactNode; title: ReactNode; body: ReactNode; confirmLabel: string; keepLabel: string; pendingLabel: string; closeLabel: string }) {
  return (
    <SheetTrigger label={label} title={title} closeLabel={closeLabel} variant="danger-quiet">
      {(close) => (
        <div className="ed-form">
          <p>{body}</p>
          <div className={styles.dangerRow}>
            <Button type="button" variant="secondary" onClick={close}>
              {keepLabel}
            </Button>
            <QuickAction action={action} hidden={hidden} label={confirmLabel} pendingLabel={pendingLabel} variant="danger" />
          </div>
        </div>
      )}
    </SheetTrigger>
  );
}
