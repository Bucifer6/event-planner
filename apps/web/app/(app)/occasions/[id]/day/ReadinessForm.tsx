"use client";

import { Checkbox, ChoiceChips, FocusFirstError, Notice, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { recordReadinessAction } from "@/app/actions/eventday";
import styles from "./day.module.css";

type Option = { id: string; label: string };
export type ReadinessLabels = {
  decision: string;
  hold: string;
  proceed: string;
  conditions: string;
  conditionsField: string;
  conditionsHint: string;
  note: string;
  evidenceTitle: string;
  evidenceHint: string;
  tasks: string;
  deliveries: string;
  acks: string;
  noteEvidence: string;
  noteLabel: string;
  noteUrl: string;
  noteUrlHint: string;
  submit: string;
  pending: string;
  done: string;
  optional: string;
};

/**
 * Hold / Proceed / Proceed with conditions. The decision is refused without at least one
 * piece of evidence; the error appears beside the evidence and nothing typed is lost.
 */
export function ReadinessForm({ occasionId, options, labels }: { occasionId: string; options: { tasks: Option[]; deliveries: Option[]; acks: Option[] }; labels: ReadinessLabels }) {
  const [state, formAction] = useActionState(recordReadinessAction, null);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) router.refresh();
  }, [state, router]);
  // checked evidence is kept here so a refused submit never loses the ticks
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const toggle = (value: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(value);
      else next.delete(value);
      return next;
    });
  const error = state && !state.ok ? state.error : null;
  const fe = error?.fieldErrors ?? {};
  const values = error?.values ?? {};
  const beside = ["decision", "conditions", "evidence", "noteLabel", "noteUrl"].some((k) => fe[k]);
  // note evidence errors arrive as evidence.<n>.label / evidence.<n>.url
  const nested = (suffix: string) => Object.entries(fe).find(([k]) => k.startsWith("evidence.") && k.endsWith(suffix))?.[1]?.[0];
  const noteLabelError = fe.noteLabel?.[0] ?? nested(".label");
  const noteUrlError = fe.noteUrl?.[0] ?? nested(".url");

  const group = (title: string, prefix: string, list: Option[]) =>
    list.length === 0 ? null : (
      <fieldset className={styles.group}>
        <legend className="ed-label">{title}</legend>
        <div className={styles.scroll}>
          {list.map((o) => (
            <Checkbox key={o.id} name="evidence" value={`${prefix}:${o.id}`} label={o.label} checked={checked.has(`${prefix}:${o.id}`)} onChange={(e) => toggle(`${prefix}:${o.id}`, e.target.checked)} />
          ))}
        </div>
      </fieldset>
    );

  return (
    <form action={formAction} className="ed-form" noValidate>
      {error && !beside && !noteLabelError && !noteUrlError ? <Notice tone="danger" title={error.message} /> : null}
      {state?.ok ? <Notice tone="success" role="status" title={labels.done} /> : null}
      <input type="hidden" name="occasionId" value={occasionId} />
      <ChoiceChips
        name="decision"
        legend={labels.decision}
        error={fe.decision?.[0]}
        defaultValue={values.decision ?? ""}
        options={[
          { value: "proceed", label: labels.proceed },
          { value: "conditions", label: labels.conditions },
          { value: "hold", label: labels.hold },
        ]}
      />
      <TextareaField id="rd-conditions" name="conditions" label={labels.conditionsField} hint={labels.conditionsHint} error={fe.conditions?.[0]} rows={2} maxLength={1000} defaultValue={values.conditions ?? ""} />
      <div className={styles.block} id="rd-evidence">
        <span className="ed-label">{labels.evidenceTitle}</span>
        <p className={styles.small}>{labels.evidenceHint}</p>
        {fe.evidence?.[0] ? (
          <p className={styles.error} role="alert" tabIndex={-1} id="rd-evidence-error">
            {fe.evidence[0]}
          </p>
        ) : null}
        {group(labels.tasks, "task", options.tasks)}
        {group(labels.deliveries, "delivery", options.deliveries)}
        {group(labels.acks, "briefing_ack", options.acks)}
        <fieldset className={styles.group}>
          <legend className="ed-label">{labels.noteEvidence}</legend>
          <TextField id="rd-note-label" name="noteLabel" label={labels.noteLabel} optionalLabel={labels.optional} error={noteLabelError} maxLength={300} defaultValue={values.noteLabel ?? ""} autoComplete="off" />
          <TextField id="rd-note-url" name="noteUrl" label={labels.noteUrl} hint={labels.noteUrlHint} optionalLabel={labels.optional} error={noteUrlError} type="url" inputMode="url" maxLength={500} defaultValue={values.noteUrl ?? ""} autoComplete="off" />
        </fieldset>
      </div>
      <TextareaField id="rd-note" name="note" label={labels.note} optionalLabel={labels.optional} rows={2} maxLength={1000} defaultValue={values.note ?? ""} />
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div>
        <SubmitButton pendingLabel={labels.pending} block>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
