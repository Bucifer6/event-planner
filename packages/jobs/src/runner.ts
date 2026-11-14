import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Ctx } from "@ed/core/context";
import { errorText, jsonLogger, type Logger } from "./log";
import { writeQueueMetrics, type QueueMetrics } from "./metrics";
import { releaseLeases, runOnce } from "./queue";
import { tickSchedules } from "./schedule";

export type RunnerOptions = {
  /** Jobs run in parallel per pass. Default 4 (WORKER_CONCURRENCY). */
  concurrency?: number;
  /** Idle wait between passes. Default 2 s (WORKER_POLL_MS). */
  pollMs?: number;
  /** How often schedules are checked. Default 30 s. */
  scheduleMs?: number;
  /** How often queue metrics are written. Default 60 s. */
  metricsMs?: number;
  logger?: Logger;
  /** Called when the set of active alerts changes (operator channel seam, LAU5). */
  onAlert?: (metrics: QueueMetrics) => Promise<void> | void;
};

export type RunnerHandle = { workerId: string; stop: () => Promise<void> };

/**
 * Operator-channel seam (LAU5): when OPS_ALERT_WEBHOOK_URL is set, alert changes are POSTed
 * to it as JSON. Whatever the channel, the same event is logged with level "alert".
 */
async function defaultOnAlert(m: QueueMetrics): Promise<void> {
  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "eventdesk-worker", ...m }),
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * The worker loop: schedules → lease → run, until stop(). stop() waits for running jobs,
 * then hands back any lease this worker still holds. If the process is killed instead, the
 * leases expire and the jobs resume on the next start (at-least-once).
 */
export function startRunner(ctx: Pick<Ctx, "db">, opts: RunnerOptions = {}): RunnerHandle {
  const env = process.env;
  const log = opts.logger ?? jsonLogger;
  const concurrency = opts.concurrency ?? (Number(env.WORKER_CONCURRENCY) || 4);
  const pollMs = opts.pollMs ?? (Number(env.WORKER_POLL_MS) || 2000);
  const scheduleMs = opts.scheduleMs ?? 30_000;
  const metricsMs = opts.metricsMs ?? 60_000;
  const onAlert = opts.onAlert ?? defaultOnAlert;
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  let stopping = false;
  let wake: (() => void) | null = null;
  let lastSchedule = 0;
  let lastMetrics = 0;
  let lastAlerts = "";

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });

  const loop = (async () => {
    log("info", "runner started", { workerId, concurrency, pollMs });
    while (!stopping) {
      const tick = { db: ctx.db, now: new Date() };
      let busy = false;
      try {
        if (Date.now() - lastSchedule >= scheduleMs) {
          lastSchedule = Date.now();
          for (const name of await tickSchedules(tick)) log("info", "schedule fired", { schedule: name });
        }
        const res = await runOnce(tick, { limit: concurrency, workerId, logger: log });
        busy = res.leased >= concurrency;
        if (Date.now() - lastMetrics >= metricsMs) {
          lastMetrics = Date.now();
          const m = await writeQueueMetrics({ db: ctx.db, now: new Date() });
          log("info", "queue metrics", {
            depth: m.depth,
            running: m.running,
            scheduled: m.scheduled,
            dead: m.dead,
            oldestDueSeconds: m.oldestDueSeconds,
            errorRate: m.errorRate,
          });
          const alerts = m.alerts.join(",");
          if (alerts !== lastAlerts) {
            lastAlerts = alerts;
            log(alerts ? "alert" : "info", alerts ? "queue alert" : "queue alert cleared", {
              alerts,
              depth: m.depth,
              errorRate: m.errorRate,
              oldestDueSeconds: m.oldestDueSeconds,
            });
            await Promise.resolve(onAlert(m)).catch((e) =>
              log("error", "alert channel failed", { error: errorText(e) }),
            );
          }
        }
      } catch (e) {
        // Database briefly unavailable etc.: log, wait, carry on.
        log("error", "runner pass failed", { error: errorText(e) });
      }
      if (!busy && !stopping) await sleep(pollMs);
    }
  })();

  return {
    workerId,
    stop: async () => {
      stopping = true;
      wake?.();
      await loop;
      const released = await releaseLeases(ctx, workerId).catch(() => 0);
      log("info", "runner stopped", { workerId, released });
    },
  };
}
