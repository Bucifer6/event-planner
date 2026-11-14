// E-03 offline capture — the device side. IndexedDB only (never localStorage):
//
//   queue    what was captured and not yet acknowledged by the server
//            { clientKey (uuid), occasionId, kind: "arrival" | "tick", payload, capturedAt, label }
//   bundles  the last fetched check-in roster + own checklist of an occasion, with the expiry
//            the server gave it; dropped when expired, on sign-out (see sw.js) and replaced
//            after every sync.
//
// Only arrivals and the person's own checklist ticks are ever queued. The queue holds ids and
// counts; `label` (a household or item name) is kept only so the person can see what waits.

export type ArrivalPayload = { householdId: string; adults?: number; children?: number };
export type TickPayload = { itemId: string; done: boolean; baseRevision: number };
export type QueueItem =
  | { clientKey: string; occasionId: string; kind: "arrival"; payload: ArrivalPayload; capturedAt: string; label: string }
  | { clientKey: string; occasionId: string; kind: "tick"; payload: TickPayload; capturedAt: string; label: string };

export type RosterRow = {
  householdId: string;
  name: string;
  search: string;
  rsvp: "yes" | "no" | "maybe" | "pending";
  expectedAdults: number | null;
  expectedChildren: number | null;
  qr: string | null;
  arrived: null | { checkInId: string; adults: number; children: number; at: string };
};
export type ChecklistItem = { itemId: string; taskId: string; taskTitle: string; label: string; done: boolean; revision: number };
export type Bundle = { occasionId: string; title: string; status: string; fetchedAt: string; expiresAt: string; roster: RosterRow[] | null; checklist: ChecklistItem[] };

export type SyncResult = { clientKey: string; kind: "arrival" | "tick"; state: "pending" | "applied" | "merged" | "conflict" | "rejected" | "dropped"; code: string | null; detail: Record<string, unknown> | null };
export type SyncOutcome = { ok: true; results: SyncResult[]; counts: Record<SyncResult["state"], number> } | { ok: false; offline: boolean; message: string | null };

export const OFFLINE_DB = "ed-offline";
export const OFFLINE_EVENT = "ed-offline-changed";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "clientKey" }).createIndex("occasionId", "occasionId");
      if (!db.objectStoreNames.contains("bundles")) db.createObjectStore("bundles", { keyPath: "occasionId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: "queue" | "bundles", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let value: T | undefined;
      if (req) req.onsuccess = () => (value = req.result);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const changed = () => window.dispatchEvent(new Event(OFFLINE_EVENT));

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function listQueue(occasionId: string): Promise<QueueItem[]> {
  const all = (await run<QueueItem[]>("queue", "readonly", (s) => s.index("occasionId").getAll(occasionId))) ?? [];
  return all.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/** Queues an arrival. A household already waiting in the queue is not queued twice. */
export async function enqueueArrival(occasionId: string, payload: ArrivalPayload, label: string): Promise<QueueItem> {
  const existing = (await listQueue(occasionId)).find((i) => i.kind === "arrival" && i.payload.householdId === payload.householdId);
  if (existing) return existing;
  const item: QueueItem = { clientKey: uuid(), occasionId, kind: "arrival", payload, capturedAt: new Date().toISOString(), label };
  await run("queue", "readwrite", (s) => s.put(item));
  changed();
  return item;
}

/**
 * Queues a tick. One pending tick per item: ticking again replaces the waiting one and keeps
 * the revision the device FIRST saw, so the server can still tell whether the item changed.
 */
export async function enqueueTick(occasionId: string, payload: TickPayload, label: string): Promise<QueueItem> {
  const waiting = (await listQueue(occasionId)).find((i) => i.kind === "tick" && i.payload.itemId === payload.itemId);
  const base = waiting && waiting.kind === "tick" ? waiting.payload.baseRevision : payload.baseRevision;
  const item: QueueItem = { clientKey: uuid(), occasionId, kind: "tick", payload: { ...payload, baseRevision: base }, capturedAt: new Date().toISOString(), label };
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("queue", "readwrite");
      if (waiting) tx.objectStore("queue").delete(waiting.clientKey);
      tx.objectStore("queue").put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  changed();
  return item;
}

async function removeFromQueue(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("queue", "readwrite");
      for (const k of keys) tx.objectStore("queue").delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  changed();
}

export async function saveBundle(bundle: Bundle): Promise<void> {
  await run("bundles", "readwrite", (s) => s.put(bundle));
}

/** The stored bundle, or null. An expired bundle is deleted, not returned. */
export async function loadBundle(occasionId: string): Promise<Bundle | null> {
  const b = await run<Bundle | undefined>("bundles", "readonly", (s) => s.get(occasionId));
  if (!b) return null;
  if (new Date(b.expiresAt).getTime() <= Date.now()) {
    await run("bundles", "readwrite", (s) => s.delete(occasionId));
    return null;
  }
  return b;
}

export async function clearBundle(occasionId: string): Promise<void> {
  await run("bundles", "readwrite", (s) => s.delete(occasionId));
}

/** Network first; the stored copy when there is no network. `fresh` says which one it is. */
export async function fetchBundle(occasionId: string): Promise<{ bundle: Bundle | null; fresh: boolean; conflicts: number; gone: boolean }> {
  try {
    const res = await fetch(`/api/occasions/${occasionId}/offline`, { cache: "no-store", credentials: "same-origin" });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      // signed out or no longer a member: nothing of this occasion stays on the device
      await clearBundle(occasionId);
      return { bundle: null, fresh: true, conflicts: 0, gone: true };
    }
    const json = (await res.json()) as { ok: boolean; data?: { bundle: Bundle; conflicts: number } };
    if (json.ok && json.data) {
      if (json.data.bundle.status === "closed") await clearBundle(occasionId);
      else await saveBundle(json.data.bundle);
      return { bundle: json.data.bundle, fresh: true, conflicts: json.data.conflicts, gone: false };
    }
  } catch {
    // no network: fall through to the stored copy
  }
  return { bundle: await loadBundle(occasionId), fresh: false, conflicts: 0, gone: false };
}

let inFlight: Promise<SyncOutcome> | null = null;

/**
 * Sends the queue. Safe to call at any time and from several places at once (one request at a
 * time); safe to repeat (the server takes each clientKey once). Items the server has decided
 * leave the queue; items it has not seen stay.
 */
export function syncQueue(occasionId: string): Promise<SyncOutcome> {
  inFlight ??= (async (): Promise<SyncOutcome> => {
    try {
      const items = await listQueue(occasionId);
      const empty = { pending: 0, applied: 0, merged: 0, conflict: 0, rejected: 0, dropped: 0 };
      if (items.length === 0) return { ok: true, results: [], counts: empty };
      if (!navigator.onLine) return { ok: false, offline: true, message: null };
      let res: Response;
      try {
        res = await fetch(`/api/occasions/${occasionId}/offline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ items: items.map(({ clientKey, kind, payload, capturedAt }) => ({ clientKey, kind, payload, capturedAt })) }),
        });
      } catch {
        return { ok: false, offline: true, message: null };
      }
      const json = (await res.json().catch(() => null)) as { ok: boolean; data?: { results: SyncResult[]; counts: Record<SyncResult["state"], number> }; error?: { message?: string } } | null;
      if (!res.ok || !json?.ok || !json.data) return { ok: false, offline: false, message: json?.error?.message ?? null };
      await removeFromQueue(json.data.results.filter((r) => r.state !== "pending").map((r) => r.clientKey));
      return { ok: true, results: json.data.results, counts: json.data.counts };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** sha-256 hex of a scanned QR id — the roster carries only these digests. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The QR on an invitation is a link ending in the QR id (…/g/q/<id>) or the bare id. */
export function qrIdFromScan(scanned: string): string {
  const s = scanned.trim();
  const m = /\/g\/q\/([A-Za-z0-9_-]{4,128})\/?(?:[?#].*)?$/.exec(s);
  return (m ? m[1]! : s).slice(0, 128);
}

export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
