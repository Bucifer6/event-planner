"use client";

import { Checkbox, ChoiceChips, FocusFirstError, Notice, SelectField, SubmitButton, TextareaField, TextField, type ButtonVariant } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";
import { FormError, type FormAction } from "@/app/(auth)/_components/forms";
import type { ActionResult } from "@/lib/action";

// One declarative form for the console, the public report form and the assistants page:
// labels above inputs, the error beside its field, typed input kept after a failed submit
// (the action echoes it back), the first invalid field focused, the button disabled and
// saying what is happening while the action runs.

export type FieldSpec =
  | {
      kind: "text" | "email" | "date" | "number";
      name: string;
      label: ReactNode;
      hint?: ReactNode;
      required?: boolean;
      defaultValue?: string;
      maxLength?: number;
      min?: number;
      max?: number;
      placeholder?: string;
      optionalLabel?: string;
    }
  | {
      kind: "textarea";
      name: string;
      label: ReactNode;
      hint?: ReactNode;
      required?: boolean;
      defaultValue?: string;
      maxLength?: number;
      rows?: number;
      optionalLabel?: string;
    }
  | {
      kind: "select";
      name: string;
      label: ReactNode;
      hint?: ReactNode;
      required?: boolean;
      defaultValue?: string;
      options: Array<{ value: string; label: string }>;
      /** First, empty option ("Alege…"). */
      placeholder?: string;
    }
  | {
      kind: "chips";
      name: string;
      label: ReactNode;
      required?: boolean;
      defaultValue?: string;
      options: Array<{ value: string; label: ReactNode }>;
      stack?: boolean;
    }
  | {
      /** One checkbox per option, each with its OWN field name (value "on"). */
      kind: "checks";
      name: string;
      label: ReactNode;
      options: Array<{ name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean }>;
    }
  | { kind: "check"; name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean };

type Props<R> = {
  action: FormAction<R>;
  fields: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: ReactNode;
  pendingLabel: string;
  variant?: ButtonVariant;
  block?: boolean;
  /** Shown instead of nothing after it worked. */
  success?: ReactNode;
  /** Like `success`, built from the action's result (client parents only). */
  successRender?: (data: R) => ReactNode;
  /** Replace the whole form with the success message once it worked (public forms). */
  replaceOnSuccess?: boolean;
  refreshOnSuccess?: boolean;
  /** Content between the fields and the button. */
  children?: ReactNode;
  /** SEC11 bot guard for public forms. */
  honeypot?: { name: string; label: string; stampName: string; stamp: string };
};

export function SpecForm<R>({
  action,
  fields,
  hidden,
  submitLabel,
  pendingLabel,
  variant = "primary",
  block = false,
  success: successNode,
  successRender,
  replaceOnSuccess,
  refreshOnSuccess,
  children,
  honeypot,
}: Props<R>) {
  const [state, formAction] = useActionState<ActionResult<R> | null, FormData>(action, null);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  const uid = useId();

  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    if (refreshOnSuccess) router.refresh();
  }, [state, refreshOnSuccess, router]);

  const success = state?.ok && successRender ? successRender(state.data) : successNode;
  if (state?.ok && replaceOnSuccess && success) {
    return (
      <Notice tone="success" role="status">
        {success}
      </Notice>
    );
  }

  const error = state && !state.ok ? state.error : null;
  const errOf = (name: string) => error?.fieldErrors?.[name]?.[0];
  const valOf = (name: string, fallback?: string) => error?.values?.[name] ?? fallback;
  const names = fields.flatMap((f) => (f.kind === "checks" ? [f.name, ...f.options.map((o) => o.name)] : [f.name]));

  return (
    <form action={formAction} className="ed-form" noValidate>
      <FormError state={state} skipFields={names} />
      {state?.ok && success ? (
        <Notice tone="success" role="status">
          {success}
        </Notice>
      ) : null}
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
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        switch (f.kind) {
          case "textarea":
            return (
              <TextareaField
                key={f.name}
                id={id}
                name={f.name}
                label={f.label}
                hint={f.hint}
                rows={f.rows ?? 4}
                maxLength={f.maxLength}
                required={f.required}
                optionalLabel={f.optionalLabel}
                defaultValue={valOf(f.name, f.defaultValue)}
                error={errOf(f.name)}
              />
            );
          case "select":
            return (
              <SelectField
                key={`${f.name}:${valOf(f.name, f.defaultValue) ?? ""}`}
                id={id}
                name={f.name}
                label={f.label}
                hint={f.hint}
                required={f.required}
                defaultValue={valOf(f.name, f.defaultValue) ?? ""}
                error={errOf(f.name)}
              >
                {f.placeholder !== undefined ? <option value="">{f.placeholder}</option> : null}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
            );
          case "chips":
            return (
              <ChoiceChips
                key={`${f.name}:${valOf(f.name, f.defaultValue) ?? ""}`}
                name={f.name}
                legend={f.label}
                options={f.options}
                defaultValue={valOf(f.name, f.defaultValue)}
                required={f.required}
                stack={f.stack}
                error={errOf(f.name)}
              />
            );
          case "checks":
            return (
              <fieldset key={f.name} className="ed-fieldset" aria-invalid={errOf(f.name) ? true : undefined}>
                <legend className="ed-field__label">{f.label}</legend>
                {f.options.map((o) => (
                  <Checkbox
                    key={`${o.name}:${error ? (error.values?.[o.name] ?? "off") : "initial"}`}
                    name={o.name}
                    label={o.label}
                    hint={o.hint}
                    defaultChecked={error ? error.values?.[o.name] === "on" : o.defaultChecked}
                  />
                ))}
                {errOf(f.name) ? (
                  <span className="ed-field__error" role="alert">
                    {errOf(f.name)}
                  </span>
                ) : null}
              </fieldset>
            );
          case "check":
            return (
              <div key={f.name}>
                <Checkbox
                  key={`${f.name}:${error ? (error.values?.[f.name] ?? "off") : "initial"}`}
                  name={f.name}
                  label={f.label}
                  hint={f.hint}
                  defaultChecked={error ? error.values?.[f.name] === "on" : f.defaultChecked}
                  aria-invalid={errOf(f.name) ? true : undefined}
                />
                {errOf(f.name) ? (
                  <span className="ed-field__error" role="alert">
                    {errOf(f.name)}
                  </span>
                ) : null}
              </div>
            );
          default:
            return (
              <TextField
                key={f.name}
                id={id}
                name={f.name}
                label={f.label}
                hint={f.hint}
                type={f.kind === "number" ? "text" : f.kind}
                inputMode={f.kind === "number" ? "numeric" : f.kind === "email" ? "email" : undefined}
                autoComplete={f.kind === "email" ? "email" : "off"}
                autoCapitalize={f.kind === "email" ? "none" : undefined}
                spellCheck={f.kind === "email" ? false : undefined}
                maxLength={f.maxLength}
                required={f.required}
                placeholder={f.placeholder}
                optionalLabel={f.optionalLabel}
                defaultValue={valOf(f.name, f.defaultValue)}
                error={errOf(f.name)}
              />
            );
        }
      })}
      {children}
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <SubmitButton pendingLabel={pendingLabel} variant={variant} block={block}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
