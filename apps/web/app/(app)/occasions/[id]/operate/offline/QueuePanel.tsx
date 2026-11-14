"use client";

import { Notice } from "@ed/ui";
import { useRouter } from "next/navigation";
import { OfflineStatus, type OfflineStatusLabels } from "@/components/offline/OfflineStatus";
import { useOfflineQueue } from "@/components/offline/useOfflineQueue";
import styles from "../_components/operate.module.css";

export type QueueLabels = { empty: string; arrival: string; tick: string; untick: string; listTitle: string; status: OfflineStatusLabels };

/** What this device still holds: each captured arrival / tick, when it was captured, and the sync result. */
export function QueuePanel({ occasionId, locale, labels }: { occasionId: string; locale: string; labels: QueueLabels }) {
  const router = useRouter();
  const queue = useOfflineQueue(occasionId, () => router.refresh());
  const time = (iso: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ro-RO", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  return (
    <>
      <OfflineStatus queue={queue} labels={labels.status} locale={locale} conflictsHref="#conflicts" />
      {queue.pending.length === 0 ? (
        <Notice tone="success" role="status">
          {labels.empty}
        </Notice>
      ) : (
        <>
          <h3 className="ed-label">{labels.listTitle}</h3>
          <ul className={styles.queue} data-testid="queue">
            {queue.pending.map((i) => (
              <li key={i.clientKey}>
                <span>
                  {(i.kind === "arrival" ? labels.arrival : i.payload.done ? labels.tick : labels.untick).replace("{label}", i.label)}
                </span>
                <span className={styles.small}>{time(i.capturedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
