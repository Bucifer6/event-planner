import type { Ctx } from "@ed/core/context";
import { and, eq, inArray, jobs, sql } from "@ed/db";
import type { z } from "zod";
import { errorText, silentLogger, type Logger } from "./log";

// Postgres job queue (Q7, R0-12).
//
// Guarantees:
// - at-least-once: a job is marked done only after its handler returned. Handlers MUST be
//   idempotent (a job can run twice: crash after the work but before the mark).
// - a killed worker's jobs resume: every lease has an expiry; an expired lease is picked up
//   again by any worker.
// - leasing uses FOR UPDATE SKIP LOCKED, so several workers never take the same job.
// - failures retry with exponential backoff until max_attempts, then the job is parked
//   (failed_at) and shows up in the queue metrics.
//
// This file must not import @ed/core at runtime (core domains import @ed/jobs to enqueue).

export type JobMeta = { jobId: string; name: string; attempt: number; maxAttempts: number };
export type JobHandler<P> = (ctx: Ctx, payload: P, meta: JobMeta) => Promise<void>;

export type JobOptions = {
  /** Total tries before the job is parked. Default 5. */
  maxAttempts?: number;
  /** How long one run may take before another worker may pick it up. Default 5 minutes. */
  leaseMs?: number;
};

export type EnqueueOptions = {
  /** Earliest time to run. Default: now. */
  runAt?: Date;
  /** Dedupe: while a job row with this key exists, enqueue returns it and adds nothing. */
  uniqueKey?: string;
  maxAttempts?: number;
};

export type EnqueueResult = { id: string; deduped: boolean };

export type JobDefinition<S extends z.ZodType = z.ZodType> = {
  name: string;
  schema: S;
  handler: JobHandler<z.output<S>>;
  options: Required<JobOptions>;
  enqueue: (ctx: Pick<Ctx, "db" | "now">, payload: z.input<S>, opts?: EnqueueOptions) => Promise<EnqueueResult>;
};

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_MS = 5 * 60_000;

// Survives module re-evaluation (Next dev) so definitions are not lost or duplicated.
const g = globalThis as unknown as { __edJobs?: Map<string, JobDefinition> };
const registry: Map<string, JobDefinition> = (g.__edJobs ??= new Map());

/**
 * Registers a job. Calling it again with the same name replaces the definition (idempotent,
 * so registerJobs() functions can run more than once).
 *
 *   export const sendDigest = defineJob("digest.send", z.object({ occasionId: zId }),
 *     async (ctx, { occasionId }) => { … });           // ctx is a system-actor Ctx
 *   await sendDigest.enqueue(ctx, { occasionId }, { uniqueKey: `digest:${occasionId}:${day}` });
 */
export function defineJob<S extends z.ZodType>(
  name: string,
  schema: S,
  handler: JobHandler<z.output<S>>,
  options: JobOptions = {},
): JobDefinition<S> {
  if (!/^[a-z][a-z0-9]*([.-][a-z0-9]+)*$/.test(name)) throw new Error(`Invalid job name: ${name}`);
  const def: JobDefinition<S> = {
    name,
    schema,
    handler,
    options: {
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
    },
    enqueue: (ctx, payload, opts) => enqueue(ctx, name, payload, opts),
  };
  registry.set(name, def as unknown as JobDefinition);
  return def;
}

export function getJob(name: string): JobDefinition | undefined {
  return registry.get(name);
}
export function listJobs(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Adds a job. Runs on ctx.db, so inside inTx() the job is enqueued only if the transaction
 * commits. The payload is validated when the job is known in this process; it must be
 * JSON-serialisable and should carry ids, not copies of data.
 */
export async function enqueue(
  ctx: Pick<Ctx, "db" | "now">,
  name: string,
  payload: unknown,
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const def = registry.get(name);
  const data: unknown = def ? def.schema.parse(payload) : payload;
  const json = JSON.parse(JSON.stringify(data ?? {})) as unknown;
  const values = {
    name,
    payload: json,
    runAt: opts.runAt ?? ctx.now,
    maxAttempts: opts.maxAttempts ?? def?.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    uniqueKey: opts.uniqueKey ?? null,
    createdAt: ctx.now,
  };
  const inserted = await ctx.db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.uniqueKey })
    .returning({ id: jobs.id });
  if (inserted[0]) return { id: inserted[0].id, deduped: false };
  const [existing] = await ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.uniqueKey, opts.uniqueKey!));
  if (!existing) throw new Error(`enqueue(${name}): conflicting job vanished, retry`);
  return { id: existing.id, deduped: true };
}

/** 30 s, 1 min, 2 min, … capped at 6 h. `attempt` is the attempt that just failed (1-based). */
export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60_000);
}

export type RunOnceOptions = {
  /** Maximum jobs leased in this pass. Default 10. */
  limit?: number;
  workerId?: string;
  /** Only these job names (tests). */
  names?: string[];
  logger?: Logger;
};

export type RunOnceResult = { leased: number; done: number; retried: number; failed: number };

type Leased = typeof jobs.$inferSelect;

/** Leases due jobs for this worker. Exposed for tests of the leasing rules. */
export async function leaseJobs(
  ctx: Pick<Ctx, "db" | "now">,
  workerId: string,
  limit: number,
  names?: string[],
): Promise<Leased[]> {
  const now = ctx.now;
  // Jobs whose last lease expired after the final attempt can never be completed: park them.
  await ctx.db
    .update(jobs)
    .set({ failedAt: now, lockedAt: null, lockedBy: null, leaseExpiresAt: null })
    .where(
      sql`${jobs.doneAt} is null and ${jobs.failedAt} is null and ${jobs.lockedAt} is not null
          and ${jobs.leaseExpiresAt} <= ${now} and ${jobs.attempts} >= ${jobs.maxAttempts}`,
    );
  const nameFilter =
    names && names.length > 0
      ? sql`and name in (${sql.join(
          names.map((n) => sql`${n}`),
          sql`, `,
        )})`
      : sql``;
  const defaultExpiry = new Date(now.getTime() + DEFAULT_LEASE_MS);
  const res = await ctx.db.execute<{ id: string }>(sql`
    update jobs set locked_at = ${now}, locked_by = ${workerId},
                    lease_expires_at = ${defaultExpiry}, attempts = attempts + 1
    where id in (
      select id from jobs
      where done_at is null and failed_at is null and run_at <= ${now}
        and attempts < max_attempts
        and (locked_at is null or lease_expires_at <= ${now})
        ${nameFilter}
      order by run_at, created_at
      for update skip locked
      limit ${limit}
    )
    returning id`);
  const ids = res.rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const rows = await ctx.db.select().from(jobs).where(inArray(jobs.id, ids));
  for (const row of rows) {
    const leaseMs = registry.get(row.name)?.options.leaseMs ?? DEFAULT_LEASE_MS;
    if (leaseMs !== DEFAULT_LEASE_MS) {
      const expiry = new Date(now.getTime() + leaseMs);
      await ctx.db.update(jobs).set({ leaseExpiresAt: expiry }).where(mine(row, workerId));
      row.leaseExpiresAt = expiry;
    }
  }
  return rows.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
}

/** Fencing: only the worker holding THIS attempt's lease may change the job. */
function mine(job: Leased, workerId: string) {
  return and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId), eq(jobs.attempts, job.attempts));
}

async function runLeased(
  ctx: Pick<Ctx, "db" | "now">,
  job: Leased,
  workerId: string,
  log: Logger,
): Promise<"done" | "retried" | "failed"> {
  const def = registry.get(job.name);
  const started = Date.now();
  const fields = { job: job.name, jobId: job.id, attempt: job.attempts };
  let permanent = false;
  try {
    if (!def) throw new Error("no handler registered for this job name");
    const parsed = def.schema.safeParse(job.payload);
    if (!parsed.success) {
      permanent = true;
      throw new Error("payload does not match the job schema");
    }
    const jobCtx: Ctx = { db: ctx.db, actor: { kind: "system" }, now: ctx.now, locale: "ro" };
    await def.handler(jobCtx, parsed.data, {
      jobId: job.id,
      name: job.name,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    });
    await ctx.db
      .update(jobs)
      .set({ doneAt: ctx.now, lockedAt: null, lockedBy: null, leaseExpiresAt: null })
      .where(mine(job, workerId));
    log("info", "job done", { ...fields, ms: Date.now() - started });
    return "done";
  } catch (e) {
    const text = errorText(e);
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    await ctx.db
      .update(jobs)
      .set({
        lastError: text,
        lastErrorAt: ctx.now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        ...(exhausted
          ? { failedAt: ctx.now }
          : { runAt: new Date(ctx.now.getTime() + backoffMs(job.attempts)) }),
      })
      .where(mine(job, workerId));
    log(exhausted ? "error" : "warn", exhausted ? "job failed for good" : "job failed, will retry", {
      ...fields,
      ms: Date.now() - started,
      error: text,
    });
    return exhausted ? "failed" : "retried";
  }
}

/**
 * One pass: lease up to `limit` due jobs (as of ctx.now) and run them. Used by the worker
 * loop and directly by tests.
 */
export async function runOnce(
  ctx: Pick<Ctx, "db" | "now">,
  opts: RunOnceOptions = {},
): Promise<RunOnceResult> {
  const workerId = opts.workerId ?? "run-once";
  const log = opts.logger ?? silentLogger;
  const leased = await leaseJobs(ctx, workerId, opts.limit ?? 10, opts.names);
  const out: RunOnceResult = { leased: leased.length, done: 0, retried: 0, failed: 0 };
  const results = await Promise.all(leased.map((job) => runLeased(ctx, job, workerId, log)));
  for (const r of results) out[r]++;
  return out;
}

/** Hand back this worker's unfinished leases at shutdown so they run again at once. */
export async function releaseLeases(ctx: Pick<Ctx, "db">, workerId: string): Promise<number> {
  const released = await ctx.db
    .update(jobs)
    .set({
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
    })
    .where(and(eq(jobs.lockedBy, workerId), sql`${jobs.doneAt} is null`))
    .returning({ id: jobs.id });
  return released.length;
}
