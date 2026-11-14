"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listQueue, OFFLINE_EVENT, syncQueue, type QueueItem, type SyncOutcome } from "./store";

export type OfflineQueueState = {
  /** Captured, not yet acknowledged by the server. */
  pending: QueueItem[];
  online: boolean;
  syncing: boolean;
  /** The result of the last sync attempt (null until one ran). */
  last: SyncOutcome | null;
  /** Sends the queue now; resolves with the outcome. */
  sync: () => Promise<SyncOutcome>;
};

/**
 * The offline queue of one occasion as React state. Syncs when the page opens with something
 * waiting, whenever the network comes back, and when asked. `onSynced` runs after every
 * successful sync (refresh the roster / checklist there).
 */
export function useOfflineQueue(occasionId: string, onSynced?: (outcome: Extract<SyncOutcome, { ok: true }>) => void): OfflineQueueState {
  const [pending, setPending] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<SyncOutcome | null>(null);
  const cb = useRef(onSynced);
  cb.current = onSynced;

  const reload = useCallback(async () => {
    try {
      setPending(await listQueue(occasionId));
    } catch {
      setPending([]);
    }
  }, [occasionId]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const outcome = await syncQueue(occasionId);
      await reload();
      // an empty queue is not a result worth announcing
      if (!outcome.ok || outcome.results.length > 0) setLast(outcome);
      if (outcome.ok && outcome.results.length > 0) cb.current?.(outcome);
      return outcome;
    } finally {
      setSyncing(false);
    }
  }, [occasionId, reload]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void reload().then(() => {
      if (navigator.onLine) void sync();
    });
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    const changed = () => void reload();
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener(OFFLINE_EVENT, changed);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener(OFFLINE_EVENT, changed);
    };
  }, [reload, sync]);

  return { pending, online, syncing, last, sync };
}
