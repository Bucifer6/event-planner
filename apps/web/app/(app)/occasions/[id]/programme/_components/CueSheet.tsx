"use client";

import { Button, IconButton, Notice, Sheet, SubmitButton } from "@ed/ui";
import { IconPlus, IconTrash } from "@ed/ui/icons";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { saveCueListAction } from "@/app/actions/programme";
import styles from "./programme.module.css";

// Cue list editor (C-03). Rows live in state, so nothing typed is lost on a failed save.
// Every save creates the next version; earlier versions are listed read-only underneath.

export type CueRow = { offsetMin: string; instruction: string; who: string };
export type CueVersion = { version: number; savedAt: string; cues: Array<{ at: string; instruction: string; who: string | null }> };

export type CueLabels = {
  close: string;
  intro: string;
  offset: string;
  offsetHint: string;
  instruction: string;
  who: string;
  /** contains {n} */
  row: string;
  addRow: string;
  /** contains {n} */
  removeRow: string;
  save: string;
  saving: string;
  /** contains {version} */
  saved: string;
  /** contains {version} */
  unchanged: string;
  empty: string;
  history: string;
  /** contains {version} */
  version: string;
  current: string;
  versionEmpty: string;
  readOnly: boolean;
};

const blank = (): CueRow => ({ offsetMin: "0", instruction: "", who: "" });

export function CueSheet({ occasionId, itemId, trigger, sheetTitle, initial, versions, labels }: { occasionId: string; itemId: string; trigger: string; sheetTitle: string; initial: CueRow[]; versions: CueVersion[]; labels: CueLabels }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{trigger}</Button>
      <Sheet open={open} onClose={close} title={sheetTitle} closeLabel={labels.close}>
        {open ? <CueEditor occasionId={occasionId} itemId={itemId} initial={initial} versions={versions} labels={labels} /> : null}
      </Sheet>
    </>
  );
}

function CueEditor({ occasionId, itemId, initial, versions, labels }: { occasionId: string; itemId: string; initial: CueRow[]; versions: CueVersion[]; labels: CueLabels }) {
  const [state, formAction] = useActionState(saveCueListAction, null);
  const [rows, setRows] = useState<CueRow[]>(initial);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);

  const set = (i: number, patch: Partial<CueRow>) => setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  const error = state && !state.ok ? state.error : null;
  const rowError = (i: number, field: string) => error?.fieldErrors?.[`cue_${i}_${field}`]?.[0];
  const hasRowError = !!error?.fieldErrors && Object.keys(error.fieldErrors).some((k) => k.startsWith("cue_"));
  const n = (template: string, value: number | string, key = "n") => template.replace(`{${key}}`, String(value));

  return (
    <div className={styles.stack}>
      <p className="ed-muted">{labels.intro}</p>
      {labels.readOnly ? null : (
        <form action={formAction} className={styles.stack} noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="cues" value={JSON.stringify(rows)} />
          {rows.length === 0 ? <p className="ed-muted">{labels.empty}</p> : null}
          <div>
            {rows.map((row, i) => (
              <div className={styles.cue} key={i} role="group" aria-label={n(labels.row, i + 1)}>
                <div className="ed-field">
                  <label className="ed-field__label" htmlFor={`cue-${itemId}-${i}-o`}>
                    {labels.offset}
                  </label>
                  <input
                    id={`cue-${itemId}-${i}-o`}
                    className="ed-input"
                    inputMode="numeric"
                    maxLength={5}
                    value={row.offsetMin}
                    onChange={(e) => set(i, { offsetMin: e.target.value })}
                    aria-invalid={rowError(i, "offsetMin") ? true : undefined}
                    aria-describedby={i === 0 ? `cue-${itemId}-ohint` : undefined}
                  />
                  {i === 0 ? (
                    <span className="ed-field__hint" id={`cue-${itemId}-ohint`}>
                      {labels.offsetHint}
                    </span>
                  ) : null}
                </div>
                <div className="ed-field">
                  <label className="ed-field__label" htmlFor={`cue-${itemId}-${i}-i`}>
                    {labels.instruction}
                  </label>
                  <input id={`cue-${itemId}-${i}-i`} className="ed-input" maxLength={500} value={row.instruction} onChange={(e) => set(i, { instruction: e.target.value })} aria-invalid={rowError(i, "instruction") ? true : undefined} />
                </div>
                <div className={styles.cueWide}>
                  <div className="ed-field">
                    <label className="ed-field__label" htmlFor={`cue-${itemId}-${i}-w`}>
                      {labels.who}
                    </label>
                    <input id={`cue-${itemId}-${i}-w`} className="ed-input" maxLength={120} value={row.who} onChange={(e) => set(i, { who: e.target.value })} />
                  </div>
                  <IconButton label={n(labels.removeRow, i + 1)} onClick={() => setRows((r) => r.filter((_, x) => x !== i))}>
                    <IconTrash />
                  </IconButton>
                </div>
                {rowError(i, "instruction") || rowError(i, "offsetMin") ? (
                  <span className={`ed-field__error ${styles.cueWide}`} role="alert">
                    <span>{rowError(i, "instruction") ?? rowError(i, "offsetMin")}</span>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div>
            <Button onClick={() => setRows((r) => [...r, blank()])}>
              <IconPlus size={16} />
              {labels.addRow}
            </Button>
          </div>
          {error && !hasRowError ? <Notice tone="danger" title={error.message} role="alert" /> : null}
          {state?.ok ? (
            <Notice tone={state.data.changed ? "success" : "neutral"} role="status">
              {n(state.data.changed ? labels.saved : labels.unchanged, state.data.version, "version")}
            </Notice>
          ) : null}
          <div>
            <SubmitButton pendingLabel={labels.saving} block>
              {labels.save}
            </SubmitButton>
          </div>
        </form>
      )}

      {versions.length > 0 ? (
        <details className={styles.history} open={labels.readOnly}>
          <summary>{labels.history}</summary>
          {versions.map((v, idx) => (
            <div className={styles.version} key={v.version}>
              <p className="ed-small">
                <strong>{n(labels.version, v.version, "version")}</strong>
                {idx === 0 ? ` · ${labels.current}` : ""} · <span className="ed-muted">{v.savedAt}</span>
              </p>
              {v.cues.length === 0 ? (
                <p className="ed-small ed-muted">{labels.versionEmpty}</p>
              ) : (
                <ul className={styles.cueList}>
                  {v.cues.map((c, i) => (
                    <li key={i}>
                      <span className={styles.cueAt}>{c.at}</span>
                      {c.instruction}
                      {c.who ? <span className="ed-muted"> — {c.who}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}
