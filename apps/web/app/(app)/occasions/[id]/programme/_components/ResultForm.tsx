"use client";

import { Notice, SubmitButton, type ButtonVariant } from "@ed/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-core";

// A one-button form around a Server Action that says what happened afterwards, with values
// from the result ("Publicat ca versiunea {version}"). Used for the small confirm-and-do
// actions of the release C planner pages.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (prev: ActionResult<any> | null | undefined, formData: FormData) => Promise<ActionResult<any>>;

export function ResultForm({
  action,
  hidden,
  submitLabel,
  pendingLabel,
  variant = "secondary",
  block,
  successTemplate,
  children,
  onDone,
}: {
  action: AnyAction;
  hidden: Record<string, string>;
  submitLabel: ReactNode;
  pendingLabel: string;
  variant?: ButtonVariant;
  block?: boolean;
  /** Shown after it worked; `{key}` is replaced with result.data[key]. */
  successTemplate?: string;
  /** Extra fields between the hidden ones and the button. */
  children?: ReactNode;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const t = useTranslations("common");
  const format = useFormatter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
    onDone?.();
  }, [state, router, onDone]);
  const error = state && !state.ok ? state.error : null;
  const fieldError = error?.fieldErrors ? Object.values(error.fieldErrors)[0]?.[0] : undefined;
  return (
    <form action={formAction} className="ed-form" noValidate>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {error ? (
        <Notice tone="danger" title={fieldError ?? error.message} role="alert">
          {error.retryAt ? t("errors.retryAt", { time: format.dateTime(new Date(error.retryAt), { hour: "2-digit", minute: "2-digit" }) }) : null}
        </Notice>
      ) : null}
      {state?.ok && successTemplate ? (
        <Notice tone="success" role="status">
          {successTemplate.replace(/\{(\w+)\}/g, (_, k: string) => String(((state.data ?? {}) as Record<string, unknown>)[k] ?? ""))}
        </Notice>
      ) : null}
      <div>
        <SubmitButton pendingLabel={pendingLabel} variant={variant} block={block}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
