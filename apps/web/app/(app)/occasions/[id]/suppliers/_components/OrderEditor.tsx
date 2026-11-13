"use client";

import { Button, FocusFirstError, IconButton, Notice, SubmitButton, TextField } from "@ed/ui";
import { IconPlus, IconTrash } from "@ed/ui/icons";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { createOrderSnapshotAction } from "@/app/actions/suppliers";
import styles from "./suppliers.module.css";

type Row = { key: number; label: string; quantity: string; unit: string };

/**
 * The items of the final order. Tap "add a line" for more rows; nothing typed is lost when a
 * submit fails. Submitting fixes a NEW version — older versions stay as they were agreed.
 */
export function OrderEditor({
  occasionId,
  bookingId,
  initial,
  labels,
}: {
  occasionId: string;
  bookingId: string;
  initial: Array<{ label: string; quantity: number; unit: string | null }>;
  labels: { item: string; quantity: string; unit: string; unitHint: string; addRow: string; removeRow: string; submit: string; pending: string; done: string; optional: string };
}) {
  const seed = initial.length > 0 ? initial : [{ label: "", quantity: 0, unit: null }];
  const next = useRef(seed.length);
  const [rows, setRows] = useState<Row[]>(() => seed.map((r, i) => ({ key: i, label: r.label, quantity: r.label ? String(r.quantity) : "", unit: r.unit ?? "" })));
  const [state, formAction] = useActionState(createOrderSnapshotAction, null);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) router.refresh();
  }, [state, router]);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const error = state && !state.ok ? state.error : null;
  const itemsError = error?.fieldErrors?.items?.[0] ?? (error ? error.message : null);
  const payload = JSON.stringify(rows.map((r) => ({ label: r.label, quantity: r.quantity.trim(), unit: r.unit })));

  return (
    <form action={formAction} className="ed-form" noValidate>
      {itemsError ? <Notice tone="danger" title={itemsError} /> : null}
      {state?.ok ? <Notice tone="success" role="status" title={labels.done} /> : null}
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="items" value={payload} />
      {rows.map((r, i) => (
        <div key={r.key} className={styles.orderRow} role="group" aria-label={`${labels.item} ${i + 1}`}>
          <TextField id={`order-label-${r.key}`} label={labels.item} value={r.label} maxLength={200} autoComplete="off" onChange={(e) => update(r.key, { label: e.target.value })} />
          <TextField id={`order-qty-${r.key}`} label={labels.quantity} value={r.quantity} inputMode="numeric" pattern="[0-9]*" maxLength={7} autoComplete="off" onChange={(e) => update(r.key, { quantity: e.target.value })} />
          <TextField id={`order-unit-${r.key}`} label={labels.unit} hint={labels.unitHint} optionalLabel={labels.optional} value={r.unit} maxLength={30} autoComplete="off" onChange={(e) => update(r.key, { unit: e.target.value })} />
          {rows.length > 1 ? (
            <div className={styles.orderRowEnd}>
              <IconButton type="button" label={`${labels.removeRow} ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <IconTrash size={18} />
              </IconButton>
            </div>
          ) : null}
        </div>
      ))}
      <div>
        <Button type="button" variant="quiet" onClick={() => setRows((rs) => [...rs, { key: next.current++, label: "", quantity: "", unit: "" }])}>
          <IconPlus size={18} />
          {labels.addRow}
        </Button>
      </div>
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div>
        <SubmitButton pendingLabel={labels.pending} variant="secondary">
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
