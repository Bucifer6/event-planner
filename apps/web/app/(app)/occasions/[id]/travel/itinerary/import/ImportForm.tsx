"use client";

import { Field, FocusFirstError, Notice, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { proposeImportAction } from "@/app/actions/travel";

export type ImportLabels = {
  text: string;
  textHint: string;
  file: string;
  fileHint: string;
  fileLoaded: string;
  fileTooBig: string;
  zone: string;
  zoneHint: string;
  submit: string;
  pending: string;
  optional: string;
};

/**
 * Paste a confirmation or pick an .ics file. The file is read in the browser into the text
 * field (nothing is uploaded on its own), so both ways are one form — and what was pasted is
 * kept when nothing could be read from it.
 */
export function ImportForm({ occasionId, defaultTz, zones, labels }: { occasionId: string; defaultTz: string; zones: string[]; labels: ImportLabels }) {
  const [state, formAction] = useActionState(proposeImportAction, null);
  const [text, setText] = useState("");
  const [fileNote, setFileNote] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const router = useRouter();
  const listId = useId();
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) router.push(`/occasions/${occasionId}/travel/itinerary/import?preview=${encodeURIComponent(state.data.previewId)}`);
  }, [state, router, occasionId]);

  const error = state && !state.ok ? state.error : null;
  const fieldError = error?.fieldErrors?.text?.[0];

  return (
    <form action={formAction} className="ed-form" noValidate>
      {error && !fieldError ? <Notice tone="danger" title={error.message} /> : null}
      <input type="hidden" name="occasionId" value={occasionId} />
      <TextareaField id="import-text" name="text" label={labels.text} hint={labels.textHint} error={fieldError} rows={10} value={text} onChange={(e) => setText(e.target.value)} maxLength={300000} />
      <Field id="import-file" label={labels.file} hint={labels.fileHint} optionalLabel={labels.optional}>
        <input
          id="import-file"
          className="ed-input"
          type="file"
          accept=".ics,text/calendar,.txt,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 300_000) {
              setFileNote({ tone: "danger", text: labels.fileTooBig });
              return;
            }
            setText(await file.text());
            setFileNote({ tone: "success", text: labels.fileLoaded.replace("{name}", file.name) });
          }}
        />
      </Field>
      {fileNote ? (
        <Notice tone={fileNote.tone} role="status">
          {fileNote.text}
        </Notice>
      ) : null}
      <datalist id={listId}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <TextField id="import-zone" name="defaultTz" label={labels.zone} hint={labels.zoneHint} list={listId} defaultValue={error?.values?.defaultTz ?? defaultTz} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div>
        <SubmitButton pendingLabel={labels.pending}>{labels.submit}</SubmitButton>
      </div>
    </form>
  );
}
