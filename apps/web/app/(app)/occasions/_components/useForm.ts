"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action";

type FormAction<R> = (prev: ActionResult<R> | null | undefined, formData: FormData) => Promise<ActionResult<R>>;

/**
 * useActionState with the bits every planning form needs: the error beside its field, the
 * typed values echoed back after a failed submit (so nothing typed is lost), and an optional
 * callback once it worked.
 */
export function useForm<R>(action: FormAction<R>, opts: { onSuccess?: (data: R) => void; refresh?: boolean } = {}) {
  const [state, formAction] = useActionState<ActionResult<R> | null, FormData>(action, null);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  const { onSuccess, refresh } = opts;
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    onSuccess?.(state.data);
    if (refresh) router.refresh();
  }, [state, onSuccess, refresh, router]);
  const error = state && !state.ok ? state.error : null;
  return {
    state,
    formAction,
    ok: state?.ok === true,
    error,
    /** Message for one field, if the failure names it. */
    fieldError: (name: string): string | undefined => error?.fieldErrors?.[name]?.[0],
    /** What to put back in a field: the typed value after a failure, else the given default. */
    value: (name: string, fallback = ""): string => error?.values?.[name] ?? fallback,
    /** True when the failure is not attached to any of these fields (show it above the form). */
    formLevel: (fields: string[]): boolean =>
      !!error && !Object.keys(error.fieldErrors ?? {}).some((f) => fields.includes(f)),
  };
}
