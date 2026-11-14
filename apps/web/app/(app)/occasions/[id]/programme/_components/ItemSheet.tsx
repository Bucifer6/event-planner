"use client";

import { Button, FocusFirstError, Notice, SelectField, Sheet, SubmitButton, TextareaField, TextField, type ButtonVariant } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { removeProgrammeItemAction, saveProgrammeItemAction } from "@/app/actions/programme";
import styles from "./programme.module.css";

// Add / edit a moment in a Sheet. Text fields keep what was typed after a failed submit
// (error.values); everything that decides what else is shown — after midnight, visible to
// guests, who it concerns and which households — lives in state.

export type ItemValues = {
  id: string;
  title: string;
  kind: string;
  time: string;
  nextDay: boolean;
  durationMin: number | null;
  place: string | null;
  visibleToGuests: boolean;
  concernsAll: boolean;
  concernsHouseholdIds: string[];
  supplierId: string | null;
  notes: string | null;
};

export type ItemLabels = {
  close: string;
  optional: string;
  title: string;
  titleHint: string;
  kind: string;
  time: string;
  timeHint: string;
  nextDay: string;
  nextDayHint: string;
  duration: string;
  durationHint: string;
  place: string;
  placeHint: string;
  performer: string;
  performerNone: string;
  performerHint: string;
  visible: string;
  visibleHint: string;
  concerns: string;
  concernsAll: string;
  concernsSome: string;
  households: string;
  householdsEmpty: string;
  notes: string;
  notesHint: string;
  submit: string;
  saving: string;
  remove: string;
  removeBody: string;
  removeSubmit: string;
  removeKeep: string;
  removing: string;
};

export function ItemSheet({
  occasionId,
  item,
  trigger,
  sheetTitle,
  variant,
  icon,
  kinds,
  suppliers,
  households,
  labels,
}: {
  occasionId: string;
  item?: ItemValues;
  trigger: string;
  sheetTitle: string;
  variant?: ButtonVariant;
  icon?: ReactNode;
  kinds: Array<{ value: string; label: string }>;
  suppliers: Array<{ id: string; name: string }>;
  households: Array<{ id: string; name: string }>;
  labels: ItemLabels;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {icon}
        {trigger}
      </Button>
      <Sheet open={open} onClose={close} title={sheetTitle} closeLabel={labels.close}>
        {open ? <ItemForm occasionId={occasionId} item={item} kinds={kinds} suppliers={suppliers} households={households} labels={labels} onDone={close} /> : null}
      </Sheet>
    </>
  );
}

function ItemForm({
  occasionId,
  item,
  kinds,
  suppliers,
  households,
  labels,
  onDone,
}: {
  occasionId: string;
  item?: ItemValues;
  kinds: Array<{ value: string; label: string }>;
  suppliers: Array<{ id: string; name: string }>;
  households: Array<{ id: string; name: string }>;
  labels: ItemLabels;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(saveProgrammeItemAction, null);
  const [removeState, removeAction] = useActionState(removeProgrammeItemAction, null);
  const [nextDay, setNextDay] = useState(item?.nextDay ?? false);
  const [visible, setVisible] = useState(item?.visibleToGuests ?? false);
  const [concerns, setConcerns] = useState<"all" | "some">(item && !item.concernsAll ? "some" : "all");
  const [picked, setPicked] = useState<Set<string>>(new Set(item?.concernsHouseholdIds ?? []));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const router = useRouter();
  const handled = useRef<unknown>(null);

  useEffect(() => {
    const done = state?.ok ? state : removeState?.ok ? removeState : null;
    if (!done || handled.current === done) return;
    handled.current = done;
    router.refresh();
    onDone();
  }, [state, removeState, router, onDone]);

  const error = state && !state.ok ? state.error : null;
  const fe = error?.fieldErrors ?? {};
  const v = error?.values ?? {};
  const fid = (name: string) => `pi-${item?.id ?? "new"}-${name}`;
  const besideField = !!error && error.code === "VALIDATION" && ["title", "time", "durationMin", "place", "notes", "householdIds"].some((n) => fe[n]);

  return (
    <div className={styles.stack}>
      <form action={formAction} className="ed-form" noValidate>
        <input type="hidden" name="occasionId" value={occasionId} />
        {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
        {error && !besideField ? <Notice tone="danger" title={error.message} role="alert" /> : null}
        <TextField id={fid("title")} name="title" label={labels.title} hint={labels.titleHint} maxLength={160} required autoComplete="off" defaultValue={v.title ?? item?.title ?? ""} error={fe.title?.[0]} />
        <div className={styles.pair}>
          <TextField id={fid("time")} name="time" label={labels.time} hint={labels.timeHint} maxLength={5} required inputMode="numeric" autoComplete="off" placeholder="18:30" defaultValue={v.time ?? item?.time ?? ""} error={fe.time?.[0]} />
          <TextField id={fid("durationMin")} name="durationMin" label={labels.duration} hint={labels.durationHint} optionalLabel={labels.optional} maxLength={4} inputMode="numeric" pattern="[0-9]*" autoComplete="off" defaultValue={v.durationMin ?? item?.durationMin?.toString() ?? ""} error={fe.durationMin?.[0]} />
        </div>
        <label className="ed-check">
          <input type="checkbox" name="nextDay" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
          <span className="ed-check__text">
            <span>{labels.nextDay}</span>
            <span className="ed-check__hint">{labels.nextDayHint}</span>
          </span>
        </label>
        <SelectField id={fid("kind")} name="kind" label={labels.kind} defaultValue={v.kind ?? item?.kind ?? "moment"}>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </SelectField>
        <TextField id={fid("place")} name="place" label={labels.place} hint={labels.placeHint} optionalLabel={labels.optional} maxLength={160} autoComplete="off" defaultValue={v.place ?? item?.place ?? ""} error={fe.place?.[0]} />
        <SelectField id={fid("supplierId")} name="supplierId" label={labels.performer} hint={labels.performerHint} defaultValue={v.supplierId ?? item?.supplierId ?? ""} error={fe.supplierId?.[0]}>
          <option value="">{labels.performerNone}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>

        <label className="ed-check">
          <input type="checkbox" name="visibleToGuests" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          <span className="ed-check__text">
            <span>{labels.visible}</span>
            <span className="ed-check__hint">{labels.visibleHint}</span>
          </span>
        </label>
        {visible ? (
          <fieldset className="ed-fieldset" aria-invalid={fe.householdIds ? true : undefined}>
            <legend className="ed-field__label">{labels.concerns}</legend>
            <div className="ed-chips">
              {(["all", "some"] as const).map((c) => (
                <label className="ed-chip" key={c}>
                  <input type="radio" name="concerns" value={c} checked={concerns === c} onChange={() => setConcerns(c)} />
                  <span>{c === "all" ? labels.concernsAll : labels.concernsSome}</span>
                </label>
              ))}
            </div>
            {concerns === "some" ? (
              households.length > 0 ? (
                <div className={styles.checklist} role="group" aria-label={labels.households}>
                  {households.map((h) => (
                    <label className="ed-check" key={h.id}>
                      <input
                        type="checkbox"
                        name="householdIds"
                        value={h.id}
                        checked={picked.has(h.id)}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(h.id);
                            else next.delete(h.id);
                            return next;
                          })
                        }
                      />
                      <span className="ed-check__text">
                        <span>{h.name}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="ed-small ed-muted">{labels.householdsEmpty}</p>
              )
            ) : null}
            {fe.householdIds ? (
              <span className="ed-field__error" role="alert">
                <span>{fe.householdIds[0]}</span>
              </span>
            ) : null}
          </fieldset>
        ) : null}

        <TextareaField id={fid("notes")} name="notes" label={labels.notes} hint={labels.notesHint} optionalLabel={labels.optional} rows={3} maxLength={2000} defaultValue={v.notes ?? item?.notes ?? ""} error={fe.notes?.[0]} />
        <FocusFirstError errors={error?.fieldErrors ?? null} />
        <div>
          <SubmitButton pendingLabel={labels.saving} block>
            {labels.submit}
          </SubmitButton>
        </div>
      </form>

      {item ? (
        confirmRemove ? (
          <form action={removeAction} className={styles.stack}>
            <input type="hidden" name="occasionId" value={occasionId} />
            <input type="hidden" name="itemId" value={item.id} />
            <Notice tone="attention" title={labels.remove}>
              {labels.removeBody}
            </Notice>
            {removeState && !removeState.ok ? <Notice tone="danger" title={removeState.error.message} role="alert" /> : null}
            <div className={styles.inline}>
              <Button onClick={() => setConfirmRemove(false)}>{labels.removeKeep}</Button>
              <SubmitButton variant="danger" pendingLabel={labels.removing}>
                {labels.removeSubmit}
              </SubmitButton>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="danger-quiet" onClick={() => setConfirmRemove(true)}>
              {labels.remove}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
