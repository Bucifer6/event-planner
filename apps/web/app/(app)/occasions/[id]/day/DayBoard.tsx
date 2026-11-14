"use client";

import { Notice, Tag, type Tone } from "@ed/ui";
import { IconCheck } from "@ed/ui/icons";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { setDayStateAction } from "@/app/actions/eventday";
import styles from "./day.module.css";

export type DayState = "ready" | "running" | "waiting" | "done";
export type BoardItem = {
  taskId: string;
  title: string;
  state: DayState;
  startTime: string | null;
  contactPhone: string | null;
  ownerName: string | null;
  canProgress: boolean;
};
export type BoardLabels = {
  states: Record<DayState, string>;
  now: string;
  start: string;
  resume: string;
  finish: string;
  wait: string;
  reopen: string;
  noTime: string;
  call: string;
  allDone: string;
};

const TONE: Record<DayState, Tone> = { ready: "neutral", running: "accent", waiting: "attention", done: "success" };

/** Same rule as the server (pickNow in @ed/core/eventday): running, else next ready, else waiting. */
function pickNow(items: BoardItem[]): string | null {
  return (
    items.find((i) => i.state === "running")?.taskId ??
    items.find((i) => i.state === "ready")?.taskId ??
    items.find((i) => i.state === "waiting")?.taskId ??
    null
  );
}

/**
 * The programme of the day. A tap changes the state at once on screen (optimistic) and the
 * server confirms it by setting the status of the same task row; a refused change is rolled
 * back with the reason. Exactly one row is "Acum".
 */
export function DayBoard({ occasionId, items, labels, edit }: { occasionId: string; items: BoardItem[]; labels: BoardLabels; edit?: Record<string, ReactNode> }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [shown, setOptimistic] = useOptimistic(items, (current: BoardItem[], change: { taskId: string; state: DayState }) =>
    current.map((i) => (i.taskId === change.taskId ? { ...i, state: change.state } : i)),
  );
  const nowId = pickNow(shown);

  function move(taskId: string, state: DayState) {
    setError(null);
    startTransition(async () => {
      setOptimistic({ taskId, state });
      const res = await setDayStateAction({ occasionId, taskId, state });
      if (!res.ok) setError(res.error.message);
      router.refresh();
    });
  }

  const tel = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, "")}`;

  return (
    <>
      {error ? <Notice tone="danger" title={error} /> : null}
      {nowId === null && shown.length > 0 ? <Notice tone="success" title={labels.allDone} /> : null}
      <ol className={styles.rows}>
        {shown.map((i) => {
          const isNow = i.taskId === nowId;
          const advance: { to: DayState; label: string } | null =
            i.state === "ready" ? { to: "running", label: labels.start } : i.state === "running" ? { to: "done", label: labels.finish } : i.state === "waiting" ? { to: "running", label: labels.resume } : null;
          return (
            <li key={i.taskId} className={`${styles.row} ${isNow ? `ed-now ${styles.rowNow}` : ""}`} data-state={i.state} aria-current={isNow ? "step" : undefined}>
              <div className={styles.rowHead}>
                <span className={styles.time}>{i.startTime ?? <span aria-label={labels.noTime}>—</span>}</span>
                <div className={styles.titleBlock}>
                  {isNow ? <span className={styles.nowLabel}>{labels.now}</span> : null}
                  <span className={styles.title}>{i.title}</span>
                  <div className={styles.meta}>
                    <Tag tone={TONE[i.state]}>{labels.states[i.state]}</Tag>
                    {i.ownerName ? <span>{i.ownerName}</span> : null}
                    {i.contactPhone ? (
                      <a href={tel(i.contactPhone)} aria-label={`${labels.call} ${i.contactPhone}`}>
                        {i.contactPhone}
                      </a>
                    ) : null}
                    {edit?.[i.taskId]}
                  </div>
                </div>
              </div>
              {i.canProgress ? (
                i.state === "done" ? (
                  <div className={styles.actions}>
                    <button type="button" className="ed-btn ed-btn--quiet" onClick={() => move(i.taskId, "ready")}>
                      {labels.reopen}
                    </button>
                  </div>
                ) : (
                  <div className={styles.actions} data-two={i.state !== "waiting" ? "" : undefined}>
                    {advance ? (
                      <button type="button" className={`ed-btn ${isNow ? "ed-btn--primary" : ""} ${styles.big}`} onClick={() => move(i.taskId, advance.to)}>
                        {advance.to === "done" ? <IconCheck size={20} /> : null}
                        {advance.label}
                      </button>
                    ) : null}
                    {i.state !== "waiting" ? (
                      <button type="button" className={`ed-btn ${styles.big}`} onClick={() => move(i.taskId, "waiting")}>
                        {labels.wait}
                      </button>
                    ) : null}
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
