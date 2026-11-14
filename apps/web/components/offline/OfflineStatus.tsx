"use client";

import { Button, Notice } from "@ed/ui";
import { IconRefresh } from "@ed/ui/icons";
import type { OfflineQueueState } from "./useOfflineQueue";

export type OfflineStatusLabels = {
  /** One per plural form; "{count}" is replaced. */
  waiting: { one: string; few: string; other: string };
  offline: string;
  offlineBody: string;
  syncNow: string;
  syncing: string;
  /** "{applied}", "{merged}" are replaced. */
  synced: string;
  /** "{count}" is replaced. */
  conflicts: string;
  rejected: string;
  failed: string;
  seeConflicts: string;
};

function pick(labels: OfflineStatusLabels["waiting"], n: number, locale: string): string {
  const rule = new Intl.PluralRules(locale === "en" ? "en" : "ro").select(n);
  return (rule === "one" ? labels.one : rule === "few" ? labels.few : labels.other).replace("{count}", String(n));
}

/**
 * What waits and what became of the last sync, in words: "3 înregistrări așteaptă
 * sincronizarea", then "Sincronizat: 3 aplicate…". Conflicts are announced, never hidden.
 */
export function OfflineStatus({ queue, labels, locale, conflictsHref }: { queue: OfflineQueueState; labels: OfflineStatusLabels; locale: string; conflictsHref: string }) {
  const { pending, online, syncing, last, sync } = queue;
  const n = pending.length;
  const out: React.ReactNode[] = [];
  if (!online) {
    out.push(
      <Notice key="offline" tone="attention" title={labels.offline} role="status">
        {labels.offlineBody}
      </Notice>,
    );
  }
  if (n > 0) {
    out.push(
      <Notice
        key="waiting"
        tone={online ? "neutral" : "attention"}
        title={pick(labels.waiting, n, locale)}
        role="status"
        actions={
          online ? (
            <Button type="button" variant="secondary" disabled={syncing} onClick={() => void sync()}>
              <IconRefresh /> {syncing ? labels.syncing : labels.syncNow}
            </Button>
          ) : undefined
        }
      />,
    );
  }
  if (last?.ok && last.results.length > 0) {
    const c = last.counts;
    out.push(
      <Notice key="synced" tone={c.conflict > 0 || c.rejected > 0 ? "attention" : "success"} title={labels.synced.replace("{applied}", String(c.applied)).replace("{merged}", String(c.merged))} role="status" actions={c.conflict > 0 ? <a href={conflictsHref}>{labels.seeConflicts}</a> : undefined}>
        {c.conflict > 0 ? <span>{labels.conflicts.replace("{count}", String(c.conflict))} </span> : null}
        {c.rejected > 0 ? <span>{labels.rejected.replace("{count}", String(c.rejected))}</span> : null}
      </Notice>,
    );
  } else if (last && !last.ok && !last.offline) {
    out.push(
      <Notice key="failed" tone="danger" title={last.message ?? labels.failed} role="alert" />,
    );
  }
  return out.length > 0 ? <div data-offline-status>{out}</div> : null;
}
