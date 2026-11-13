"use client";

import { Button, Notice } from "@ed/ui";
import { IconCheck } from "@ed/ui/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setBookingStateAction } from "@/app/actions/suppliers";
import styles from "./suppliers.module.css";

type State = "enquired" | "quoted" | "booked" | "confirmed" | "delivered" | "cancelled";

/**
 * Booking state as a tap path: enquired → quoted → booked → confirmed → delivered. Any step
 * can be tapped (plans skip steps and go back); every change is recorded on the server.
 */
export function BookingStepper({
  occasionId,
  bookingId,
  state,
  path,
  labels,
  canManage,
}: {
  occasionId: string;
  bookingId: string;
  state: State;
  path: State[];
  labels: { states: Record<State, string>; current: string; cancel: string; reopen: string; saving: string; cancelledNote: string };
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = pending && target ? target : state;
  const at = path.indexOf(shown);

  function move(to: State) {
    if (to === state || pending) return;
    setTarget(to);
    setError(null);
    startTransition(async () => {
      const res = await setBookingStateAction({ occasionId, bookingId, state: to });
      if (!res.ok) setError(res.error.message);
      router.refresh();
    });
  }

  return (
    <div className={styles.stack}>
      {error ? <Notice tone="danger" title={error} /> : null}
      {shown === "cancelled" ? <Notice tone="attention" title={labels.states.cancelled}>{labels.cancelledNote}</Notice> : null}
      <ol className={styles.steps} aria-busy={pending}>
        {path.map((s, i) => {
          const current = s === shown;
          const passed = at >= 0 && i < at;
          return (
            <li key={s}>
              <button
                type="button"
                className={styles.step}
                aria-current={current ? "step" : undefined}
                data-passed={passed ? "" : undefined}
                disabled={!canManage || pending}
                onClick={() => move(s)}
              >
                <span className={styles.stepIndex} aria-hidden>
                  {i + 1}
                </span>
                <span>{labels.states[s]}</span>
                {current ? <span className={styles.stepNow}>{pending ? labels.saving : labels.current}</span> : passed ? (
                  <span className={styles.stepMark} aria-hidden>
                    <IconCheck size={18} />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      {canManage ? (
        <div>
          {shown === "cancelled" ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => move("enquired")}>
              {labels.reopen}
            </Button>
          ) : (
            <Button type="button" variant="danger-quiet" disabled={pending} onClick={() => move("cancelled")}>
              {labels.cancel}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
