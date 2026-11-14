"use client";

import { Button, Notice, Skeleton, Tag } from "@ed/ui";
import { IconCheck, IconQr, IconSearch } from "@ed/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkInByQrAction, correctCheckInAction } from "@/app/actions/operate";
import { OfflineStatus, type OfflineStatusLabels } from "@/components/offline/OfflineStatus";
import { enqueueArrival, fetchBundle, foldName, qrIdFromScan, sha256Hex, type RosterRow } from "@/components/offline/store";
import { useOfflineQueue } from "@/components/offline/useOfflineQueue";
import { SheetForm } from "../../travel/_components/forms";
import styles from "../_components/operate.module.css";

export type CheckInLabels = {
  heroLabel: string;
  /** "{arrived}", "{expected}" */
  heroOf: string;
  heroUnit: string;
  /** "{arrived}", "{expected}", "{left}" */
  heroNote: string;
  search: string;
  searchHint: string;
  scan: string;
  stopScan: string;
  scanning: string;
  scanUnsupported: string;
  cameraDenied: string;
  codeLabel: string;
  codeSubmit: string;
  arrive: string;
  arrived: string;
  /** "{time}" */
  arrivedAt: string;
  waitingSync: string;
  /** "{adults}", "{children}" */
  party: string;
  partyUnknown: string;
  rsvp: Record<RosterRow["rsvp"], string>;
  /** "{name}" */
  fbArrived: string;
  fbAlready: string;
  fbQueued: string;
  fbUnknownCode: string;
  fbUnknownOffline: string;
  emptyRoster: string;
  emptyRosterBody: string;
  noMatch: string;
  /** "{shown}", "{total}" */
  more: string;
  staleRoster: string;
  noRoster: string;
  closed: string;
  correct: string;
  correctTitle: string;
  correctIntro: string;
  correctAdults: string;
  correctChildren: string;
  correctUndo: string;
  correctUndoHint: string;
  correctReason: string;
  correctReasonHint: string;
  correctSubmit: string;
  saving: string;
  close: string;
  optional: string;
  status: OfflineStatusLabels;
};

type Feedback = { tone: "success" | "attention" | "danger"; title: string; body?: string };
const SHOWN = 40;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };

/**
 * Check-in for a doorway at night: one large search field, big rows, one tap to record an
 * arrival, instant words about what happened. Every arrival goes through the offline queue
 * (IndexedDB) and is sent at once when there is network — so the screen behaves the same
 * with and without it, and a double tap or a second scan is applied once.
 */
export function CheckInBoard({ occasionId, locale, labels }: { occasionId: string; locale: string; labels: CheckInLabels }) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "stale" | "none" | "closed">("loading");
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScan = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  const refresh = useCallback(async () => {
    const res = await fetchBundle(occasionId);
    if (res.bundle?.status === "closed") {
      setRoster(res.bundle.roster ?? []);
      setState("closed");
    } else if (res.bundle?.roster) {
      setRoster(res.bundle.roster);
      setState(res.fresh ? "ready" : "stale");
    } else {
      setRoster(null);
      setState("none");
    }
  }, [occasionId]);

  const queue = useOfflineQueue(occasionId, () => void refresh());
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // when the network comes back the roster is refreshed even if nothing waited
  useEffect(() => {
    if (queue.online && state === "stale") void refresh();
  }, [queue.online, state, refresh]);

  const waiting = useMemo(() => new Set(queue.pending.filter((i) => i.kind === "arrival").map((i) => (i.kind === "arrival" ? i.payload.householdId : ""))), [queue.pending]);
  const time = useCallback((iso: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ro-RO", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)), [locale]);
  const party = useCallback((a: number | null, c: number | null) => (a === null ? labels.partyUnknown : fill(labels.party, { adults: a, children: c ?? 0 })), [labels]);

  const arrive = useCallback(
    async (row: RosterRow) => {
      if (row.arrived) {
        setFeedback({ tone: "attention", title: fill(labels.fbAlready, { name: row.name }), body: fill(labels.arrivedAt, { time: time(row.arrived.at) }) });
        return;
      }
      if (waiting.has(row.householdId)) {
        setFeedback({ tone: "attention", title: fill(labels.fbAlready, { name: row.name }), body: labels.waitingSync });
        return;
      }
      await enqueueArrival(occasionId, { householdId: row.householdId }, row.name);
      setFeedback({ tone: "success", title: fill(navigator.onLine ? labels.fbArrived : labels.fbQueued, { name: row.name }), body: party(row.expectedAdults, row.expectedChildren) });
      setQ("");
      if (navigator.onLine) void queue.sync();
    },
    [occasionId, labels, waiting, queue, time, party],
  );

  const handleCode = useCallback(
    async (raw: string) => {
      const id = qrIdFromScan(raw);
      if (id === "") return;
      const digest = await sha256Hex(id);
      const row = roster?.find((r) => r.qr === digest);
      if (row) {
        await arrive(row);
        return;
      }
      if (!navigator.onLine) {
        setFeedback({ tone: "danger", title: labels.fbUnknownOffline });
        return;
      }
      // not in the list on this device (a household added a moment ago?): ask the server
      const res = await checkInByQrAction({ occasionId, qrId: id });
      if (res.ok) {
        setFeedback(res.data.already ? { tone: "attention", title: fill(labels.fbAlready, { name: res.data.householdName }), body: fill(labels.arrivedAt, { time: time(res.data.arrivedAt) }) } : { tone: "success", title: fill(labels.fbArrived, { name: res.data.householdName }), body: party(res.data.adults, res.data.children) });
        void refresh();
      } else {
        setFeedback({ tone: "danger", title: res.error.code === "NOT_FOUND" ? labels.fbUnknownCode : res.error.message });
      }
    },
    [roster, arrive, occasionId, labels, refresh, time, party],
  );

  const stopScan = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);
  useEffect(() => stopScan, [stopScan]);

  const startScan = useCallback(async () => {
    setScanNote(null);
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setScanNote(labels.scanUnsupported);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      const detector = new Ctor({ formats: ["qr_code"] });
      requestAnimationFrame(async () => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        const loop = async () => {
          if (!streamRef.current) return;
          try {
            const found = await detector.detect(video);
            const value = found[0]?.rawValue;
            // the same code held in front of the camera is read once, not thirty times a second
            if (value && !(lastScan.current.value === value && Date.now() - lastScan.current.at < 4000)) {
              lastScan.current = { value, at: Date.now() };
              await handleCode(value);
            }
          } catch {
            // a frame that cannot be read is simply skipped
          }
          if (streamRef.current) setTimeout(loop, 350);
        };
        void loop();
      });
    } catch {
      setScanNote(labels.cameraDenied);
    }
  }, [labels, handleCode]);

  const rows = roster ?? [];
  const needle = foldName(q);
  const matches = needle === "" ? rows : rows.filter((r) => r.search.includes(needle));
  // not-yet-arrived first: they are the ones the door is looking for
  const ordered = useMemo(() => [...matches].sort((a, b) => Number(!!a.arrived || waiting.has(a.householdId)) - Number(!!b.arrived || waiting.has(b.householdId)) || a.name.localeCompare(b.name, "ro")), [matches, waiting]);
  const expected = rows.filter((r) => r.rsvp === "yes");
  const expectedPeople = expected.reduce((n, r) => n + (r.expectedAdults ?? 0) + (r.expectedChildren ?? 0), 0);
  const arrivedPeople = rows.reduce((n, r) => n + (r.arrived ? r.arrived.adults + r.arrived.children : waiting.has(r.householdId) ? (r.expectedAdults ?? 1) + (r.expectedChildren ?? 0) : 0), 0);
  const arrivedHouseholds = rows.filter((r) => r.arrived || waiting.has(r.householdId)).length;
  const notYet = expected.filter((r) => !r.arrived && !waiting.has(r.householdId)).length;
  const readOnly = state === "closed";

  return (
    <>
      <div className={styles.hero} aria-live="polite">
        <span className="ed-label">{labels.heroLabel}</span>
        <span className={styles.heroValue} data-testid="arrived-counter">
          {state === "loading" ? <Skeleton width={180} height={48} /> : fill(labels.heroOf, { arrived: arrivedPeople, expected: expectedPeople }).split("|").map((part, i) => (i === 0 ? part : <span key={i} className={styles.heroOf}>{part}</span>))}
        </span>
        <span className={styles.heroNote}>{state === "loading" ? "" : fill(labels.heroNote, { arrived: arrivedHouseholds, expected: expected.length, left: notYet })}</span>
      </div>

      <OfflineStatus queue={queue} labels={labels.status} locale={locale} conflictsHref={`/occasions/${occasionId}/operate/offline`} />
      {state === "stale" ? <Notice tone="attention">{labels.staleRoster}</Notice> : null}
      {state === "none" ? <Notice tone="attention">{labels.noRoster}</Notice> : null}
      {readOnly ? <Notice>{labels.closed}</Notice> : null}

      <div className={styles.feedback} data-tone={feedback?.tone} role="status" aria-live="assertive" data-testid="feedback">
        {feedback ? (
          <>
            <span className={styles.feedbackTitle}>{feedback.title}</span>
            {feedback.body ? <span className={styles.small}>{feedback.body}</span> : null}
          </>
        ) : (
          <span className={styles.small}>{labels.searchHint}</span>
        )}
      </div>

      {!readOnly && state !== "none" ? (
        <>
          <div className={styles.search}>
            <label className="ed-label" htmlFor="checkin-search">
              <IconSearch size={16} /> {labels.search}
            </label>
            <input id="checkin-search" className={`ed-input ${styles.searchInput}`} type="search" inputMode="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className={styles.tools}>
            <div className={styles.scan}>
              <Button type="button" variant="secondary" className={styles.big} onClick={() => (scanning ? stopScan() : void startScan())}>
                <IconQr /> {scanning ? labels.stopScan : labels.scan}
              </Button>
              {scanNote ? <span className={styles.small}>{scanNote}</span> : null}
            </div>
            <form
              className={styles.codeRow}
              onSubmit={(e) => {
                e.preventDefault();
                const value = code;
                setCode("");
                void handleCode(value);
              }}
            >
              <div>
                <label className="ed-label" htmlFor="checkin-code">
                  {labels.codeLabel}
                </label>
                <input id="checkin-code" className="ed-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </div>
              <Button type="submit" variant="secondary" disabled={code.trim() === ""}>
                {labels.codeSubmit}
              </Button>
            </form>
          </div>
          {scanning ? (
            <div className={styles.scan}>
              <video ref={videoRef} className={styles.video} muted playsInline aria-label={labels.scanning} />
              <span className={styles.small}>{labels.scanning}</span>
            </div>
          ) : null}
        </>
      ) : null}

      {state === "loading" ? (
        <Skeleton height={64} />
      ) : rows.length === 0 && state !== "none" ? (
        <Notice title={labels.emptyRoster}>{labels.emptyRosterBody}</Notice>
      ) : ordered.length === 0 && rows.length > 0 ? (
        <p className={styles.small}>{labels.noMatch}</p>
      ) : (
        <ul className={styles.rows} data-testid="roster">
          {ordered.slice(0, SHOWN).map((r) => {
            const isWaiting = waiting.has(r.householdId);
            const done = !!r.arrived || isWaiting;
            return (
              <li key={r.householdId} className={styles.row} data-arrived={done ? "" : undefined} data-household={r.householdId}>
                <div className={styles.rowMain}>
                  <span className={styles.rowName}>{r.name}</span>
                  <span className={styles.rowMeta}>
                    {done ? (
                      <span className={styles.arrivedMark}>
                        <IconCheck size={16} /> {r.arrived ? fill(labels.arrivedAt, { time: time(r.arrived.at) }) : labels.waitingSync}
                      </span>
                    ) : null}
                    <span>{r.arrived ? party(r.arrived.adults, r.arrived.children) : party(r.expectedAdults, r.expectedChildren)}</span>
                    {r.rsvp !== "yes" ? <Tag tone={r.rsvp === "no" ? "attention" : "neutral"}>{labels.rsvp[r.rsvp]}</Tag> : null}
                  </span>
                </div>
                <div className={styles.rowEnd}>
                  {!done && !readOnly ? (
                    <Button type="button" variant="primary" block className={styles.big} onClick={() => void arrive(r)}>
                      {labels.arrive}
                    </Button>
                  ) : r.arrived && queue.online && !readOnly ? (
                    <SheetForm
                      label={labels.correct}
                      title={fill(labels.correctTitle, { name: r.name })}
                      closeLabel={labels.close}
                      variant="quiet"
                      intro={labels.correctIntro}
                      onDone={() => void refresh()}
                      form={{
                        id: `fix-${r.householdId}`,
                        action: correctCheckInAction,
                        hidden: { occasionId, checkInId: r.arrived.checkInId },
                        optionalLabel: labels.optional,
                        pendingLabel: labels.saving,
                        submitLabel: labels.correctSubmit,
                        fields: [
                          { name: "adults", label: labels.correctAdults, type: "number", defaultValue: String(r.arrived.adults), maxLength: 3, required: true },
                          { name: "children", label: labels.correctChildren, type: "number", defaultValue: String(r.arrived.children), maxLength: 3, required: true },
                          { name: "undo", label: labels.correctUndo, type: "checkbox", hint: labels.correctUndoHint },
                          { name: "reason", label: labels.correctReason, type: "textarea", required: true, hint: labels.correctReasonHint, maxLength: 1000, rows: 2 },
                        ],
                      }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ordered.length > SHOWN ? <p className={styles.small}>{fill(labels.more, { shown: SHOWN, total: ordered.length })}</p> : null}
    </>
  );
}
