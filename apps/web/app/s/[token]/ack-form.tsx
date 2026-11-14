"use client";

import { FocusFirstError, Notice, SubmitButton, TextField } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { acknowledgeBriefingAction } from "@/app/actions/suppliers";
import type { ActionResult } from "@/lib/action-core";
import styles from "./supplier.module.css";

type Ack = { version: number; name: string; at: string; alreadyAcknowledged: boolean };

/**
 * "Am primit și am înțeles briefingul": one name field and the primary button, in thumb reach.
 * The name typed stays in the field when something fails; pressing twice changes nothing.
 */
export function AckForm({
  token,
  lang,
  versionId,
  defaultName,
  stamp,
  stampField,
  honeypotField,
  labels,
}: {
  token: string;
  lang: "ro" | "en";
  versionId: string;
  defaultName: string;
  stamp: string;
  stampField: string;
  honeypotField: string;
  labels: { name: string; nameHint: string; submit: string; pending: string; honeypot: string; retryAt: string };
}) {
  const [state, formAction] = useActionState<ActionResult<Ack> | null, FormData>(
    acknowledgeBriefingAction as unknown as (prev: ActionResult<Ack> | null, fd: FormData) => Promise<ActionResult<Ack>>,
    null,
  );
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  const nameError = error?.fieldErrors?.name?.[0];
  const retry = error?.retryAt ? labels.retryAt.replace("{time}", new Date(error.retryAt).toLocaleTimeString(lang === "ro" ? "ro-RO" : "en-GB", { hour: "2-digit", minute: "2-digit" })) : null;

  return (
    <form action={formAction} className="ed-form" noValidate>
      {error && !nameError ? (
        <Notice tone="danger" title={error.message}>
          {retry}
        </Notice>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name={stampField} value={stamp} />
      <div className={styles.hp} aria-hidden>
        <label>
          {labels.honeypot}
          <input type="text" name={honeypotField} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <TextField id="ack-name" name="name" label={labels.name} hint={labels.nameHint} error={nameError} defaultValue={error?.values?.name ?? defaultName} maxLength={160} autoComplete="name" required />
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div className="ed-actionbar">
        <SubmitButton pendingLabel={labels.pending}>{labels.submit}</SubmitButton>
      </div>
    </form>
  );
}
