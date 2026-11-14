"use client";

import { Checkbox, Notice, Skeleton } from "@ed/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineStatus, type OfflineStatusLabels } from "@/components/offline/OfflineStatus";
import { enqueueTick, fetchBundle, type ChecklistItem } from "@/components/offline/store";
import { useOfflineQueue } from "@/components/offline/useOfflineQueue";
import styles from "../_components/operate.module.css";

export type ChecklistLabels = { empty: string; emptyBody: string; stale: string; none: string; waitingSync: string; closed: string; status: OfflineStatusLabels };

/**
 * The person's own checklist (the check items of the tasks they are accountable for). Every
 * tick goes through the offline queue with the revision the device saw, so it works without
 * network and a tick on an item that changed meanwhile comes back as a conflict to decide.
 */
export function MyChecklist({ occasionId, locale, labels }: { occasionId: string; locale: string; labels: ChecklistLabels }) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "stale" | "none" | "closed">("loading");

  const refresh = useCallback(async () => {
    const res = await fetchBundle(occasionId);
    if (!res.bundle) {
      setItems(null);
      setState("none");
      return;
    }
    setItems(res.bundle.checklist);
    setState(res.bundle.status === "closed" ? "closed" : res.fresh ? "ready" : "stale");
  }, [occasionId]);
  const queue = useOfflineQueue(occasionId, () => void refresh());
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (queue.online && state === "stale") void refresh();
  }, [queue.online, state, refresh]);

  // what waits in the queue is what the person sees
  const waiting = useMemo(() => new Map(queue.pending.filter((i) => i.kind === "tick").map((i) => (i.kind === "tick" ? [i.payload.itemId, i.payload.done] : ["", false]))), [queue.pending]);
  const toggle = async (item: ChecklistItem, done: boolean) => {
    await enqueueTick(occasionId, { itemId: item.itemId, done, baseRevision: item.revision }, item.label);
    if (navigator.onLine) void queue.sync();
  };

  const groups = new Map<string, { title: string; items: ChecklistItem[] }>();
  for (const i of items ?? []) {
    const g = groups.get(i.taskId) ?? { title: i.taskTitle, items: [] };
    g.items.push(i);
    groups.set(i.taskId, g);
  }

  return (
    <>
      <OfflineStatus queue={queue} labels={labels.status} locale={locale} conflictsHref={`/occasions/${occasionId}/operate/offline`} />
      {state === "stale" ? <Notice tone="attention">{labels.stale}</Notice> : null}
      {state === "none" ? <Notice tone="attention">{labels.none}</Notice> : null}
      {state === "closed" ? <Notice>{labels.closed}</Notice> : null}
      {state === "loading" ? (
        <Skeleton height={64} />
      ) : items && items.length === 0 ? (
        <Notice title={labels.empty}>{labels.emptyBody}</Notice>
      ) : (
        [...groups.entries()].map(([taskId, g]) => (
          <section key={taskId} className={styles.task}>
            <h3 className={styles.taskTitle}>{g.title}</h3>
            <ul className={styles.ticks}>
              {g.items.map((i) => {
                const done = waiting.has(i.itemId) ? waiting.get(i.itemId)! : i.done;
                return (
                  <li key={i.itemId} className={styles.tick} data-done={done ? "" : undefined} data-item={i.itemId}>
                    <Checkbox checked={done} disabled={state === "closed"} onChange={(e) => void toggle(i, e.target.checked)} label={<span className={styles.tickLabel}>{i.label}</span>} hint={waiting.has(i.itemId) ? labels.waitingSync : undefined} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
