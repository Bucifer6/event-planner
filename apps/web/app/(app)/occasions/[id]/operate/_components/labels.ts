import type { OfflineStatusLabels } from "@/components/offline/OfflineStatus";

type Raw = (key: string) => string;

/** The offline status sentences, read raw (placeholders are filled on the device). */
export function offlineStatusLabels(raw: Raw): OfflineStatusLabels {
  return {
    waiting: { one: raw("offline.waiting.one"), few: raw("offline.waiting.few"), other: raw("offline.waiting.other") },
    offline: raw("offline.offlineTitle"),
    offlineBody: raw("offline.offlineBody"),
    syncNow: raw("offline.syncNow"),
    syncing: raw("offline.syncing"),
    synced: raw("offline.synced"),
    conflicts: raw("offline.conflictsFound"),
    rejected: raw("offline.rejectedFound"),
    failed: raw("offline.failed"),
    seeConflicts: raw("offline.seeConflicts"),
  };
}
