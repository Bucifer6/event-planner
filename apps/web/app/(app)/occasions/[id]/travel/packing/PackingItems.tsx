"use client";

import { Checkbox, IconButton } from "@ed/ui";
import { IconTrash } from "@ed/ui/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removePackingItemAction, setPackingItemAction } from "@/app/actions/travel";
import styles from "../_components/travel.module.css";

export type PackingItemView = { id: string; label: string; done: boolean };

/** The check items of one packing list — the task's own checklist rows. Ticks answer at once and are confirmed by the server. */
export function PackingItems({ occasionId, items, canShape, readOnly, removeLabel, errorLabel }: { occasionId: string; items: PackingItemView[]; canShape: boolean; readOnly: boolean; removeLabel: string; errorLabel: string }) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [, start] = useTransition();
  const toggle = (item: PackingItemView, done: boolean) => {
    setLocal((l) => ({ ...l, [item.id]: done }));
    setFailed(null);
    start(async () => {
      const res = await setPackingItemAction({ occasionId, itemId: item.id, done });
      if (!res.ok) {
        setLocal((l) => ({ ...l, [item.id]: item.done }));
        setFailed(res.error.message || errorLabel);
      } else router.refresh();
    });
  };
  return (
    <>
      <ul className={styles.items}>
        {items.map((item) => {
          const done = local[item.id] ?? item.done;
          return (
            <li key={item.id} className={styles.item} data-done={done ? "" : undefined}>
              <Checkbox checked={done} disabled={readOnly} onChange={(e) => toggle(item, e.target.checked)} label={<span className={styles.itemLabel}>{item.label}</span>} />
              {canShape && !readOnly ? (
                <IconButton
                  label={`${removeLabel}: ${item.label}`}
                  onClick={() =>
                    start(async () => {
                      const res = await removePackingItemAction({ occasionId, itemId: item.id });
                      if (!res.ok) setFailed(res.error.message || errorLabel);
                      else router.refresh();
                    })
                  }
                >
                  <IconTrash />
                </IconButton>
              ) : null}
            </li>
          );
        })}
      </ul>
      {failed ? (
        <p className={styles.quickError} role="alert">
          {failed}
        </p>
      ) : null}
    </>
  );
}
