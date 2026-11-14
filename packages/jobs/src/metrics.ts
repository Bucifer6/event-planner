import type { Ctx } from "@ed/core/context";
import { eq, platformSettings, sql } from "@ed/db";
import { requireOperator } from "./runs";

// Queue-depth and error-rate metrics for alerting (LAU5). The worker writes one snapshot
// to platform_settings["ops.queueMetrics"]; the console and the health check read it.

export const QUEUE_METRICS_KEY = "ops.queueMetrics";

export type QueueMetrics = {
  /** ISO time of the snapshot */
  at: string;
  /** due now and not running */
  depth: number;
  running: number;
  /** waiting for a future run_at (includes retries backing off) */
  scheduled: number;
  /** parked after max attempts, all time, not yet purged */
  dead: number;
  /** age of the oldest due job in seconds (0 when none) */
  oldestDueSeconds: number;
  doneLastHour: number;
  /** jobs whose latest failure happened in the last hour */
  failedLastHour: number;
  /** failedLastHour / (doneLastHour + failedLastHour); 0 when nothing ran */
  errorRate: number;
  alerts: Array<"queue_depth" | "error_rate" | "oldest_due">;
};

export type AlertThresholds = { depth: number; errorRate: number; oldestDueSeconds: number };

/** Operator-configurable (env); conservative defaults. */
export function alertThresholds(env: NodeJS.ProcessEnv = process.env): AlertThresholds {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    depth: num(env.ALERT_QUEUE_DEPTH, 500),
    errorRate: num(env.ALERT_ERROR_RATE, 0.2),
    oldestDueSeconds: num(env.ALERT_OLDEST_DUE_SECONDS, 900),
  };
}

export async function computeQueueMetrics(
  ctx: Pick<Ctx, "db" | "now">,
  thresholds: AlertThresholds = alertThresholds(),
): Promise<QueueMetrics> {
  const now = ctx.now;
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const res = await ctx.db.execute<Record<string, string | null>>(sql`
    select
      count(*) filter (where done_at is null and failed_at is null and run_at <= ${now}
                       and (locked_at is null or lease_expires_at <= ${now})) as depth,
      count(*) filter (where done_at is null and failed_at is null and locked_at is not null
                       and lease_expires_at > ${now}) as running,
      count(*) filter (where done_at is null and failed_at is null and run_at > ${now}) as scheduled,
      count(*) filter (where failed_at is not null) as dead,
      min(run_at) filter (where done_at is null and failed_at is null and run_at <= ${now}
                          and (locked_at is null or lease_expires_at <= ${now})) as oldest,
      count(*) filter (where done_at > ${hourAgo}) as done_hour,
      count(*) filter (where last_error_at > ${hourAgo} and done_at is null) as failed_hour
    from jobs`);
  const r = res.rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  const oldest = r.oldest ? new Date(r.oldest as unknown as string | Date) : null;
  const done = n("done_hour");
  const failed = n("failed_hour");
  const m: QueueMetrics = {
    at: now.toISOString(),
    depth: n("depth"),
    running: n("running"),
    scheduled: n("scheduled"),
    dead: n("dead"),
    oldestDueSeconds: oldest ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000)) : 0,
    doneLastHour: done,
    failedLastHour: failed,
    errorRate: done + failed === 0 ? 0 : Math.round((failed / (done + failed)) * 1000) / 1000,
    alerts: [],
  };
  if (m.depth > thresholds.depth) m.alerts.push("queue_depth");
  if (m.errorRate > thresholds.errorRate && failed >= 3) m.alerts.push("error_rate");
  if (m.oldestDueSeconds > thresholds.oldestDueSeconds) m.alerts.push("oldest_due");
  return m;
}

export async function writeQueueMetrics(
  ctx: Pick<Ctx, "db" | "now">,
  thresholds?: AlertThresholds,
): Promise<QueueMetrics> {
  const m = await computeQueueMetrics(ctx, thresholds);
  await ctx.db
    .insert(platformSettings)
    .values({ key: QUEUE_METRICS_KEY, value: m })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: m, updatedAt: ctx.now } });
  return m;
}

/** Last snapshot written by the worker, or null if the worker has never run. Staff/system. */
export async function readQueueMetrics(ctx: Ctx): Promise<QueueMetrics | null> {
  requireOperator(ctx);
  const [row] = await ctx.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, QUEUE_METRICS_KEY));
  return (row?.value as QueueMetrics | undefined) ?? null;
}
