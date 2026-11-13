import { and, idempotencyKeys, isNotNull, jobRuns, jobs, lt } from "@ed/db";
import { defineJob, defineSchedule, recordJobRun } from "@ed/jobs";
import { addDays } from "@ed/shared/time";
import { z } from "zod";
import { requireSystem, type Ctx } from "./context";

// Retention purges (INF6, D5). Every domain that owns data with a retention period registers
// a rule; the nightly "retention.purge" job runs them all and logs the counts.
//
//   registerRetentionRule({
//     name: "signin-codes",                       // unique, kebab-case
//     run: async (ctx) => { …delete where expired…; return deletedCount; },
//   });
//
// Rules run as the system actor, must be idempotent, must use ctx.now (never new Date()),
// and return how many rows/objects they removed. A rule that throws does not stop the others.

export type RetentionRule = { name: string; run: (ctx: Ctx) => Promise<number> };
export type RetentionResult = { name: string; deleted: number; error?: string };

const g = globalThis as unknown as { __edRetention?: Map<string, RetentionRule> };
const rules: Map<string, RetentionRule> = (g.__edRetention ??= new Map());

/** Registers (or replaces, by name) a purge rule. */
export function registerRetentionRule(rule: RetentionRule): void {
  if (!/^[a-z][a-z0-9-]*$/.test(rule.name)) throw new Error(`Invalid rule name: ${rule.name}`);
  rules.set(rule.name, rule);
}

export function listRetentionRules(): string[] {
  return [...rules.keys()].sort();
}

/** Idempotency keys only need to outlive retries of the same submit (Q4). */
export const IDEMPOTENCY_KEY_DAYS = 7;
export const DONE_JOB_DAYS = 30;
export const FAILED_JOB_DAYS = 90;
export const JOB_RUN_DAYS = 730;

function registerBuiltInRules(): void {
  registerRetentionRule({
    name: "idempotency-keys",
    run: async (ctx) => {
      const gone = await ctx.db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.createdAt, addDays(ctx.now, -IDEMPOTENCY_KEY_DAYS)))
        .returning({ id: idempotencyKeys.id });
      return gone.length;
    },
  });
  registerRetentionRule({
    name: "jobs-done",
    run: async (ctx) => {
      const gone = await ctx.db
        .delete(jobs)
        .where(and(isNotNull(jobs.doneAt), lt(jobs.doneAt, addDays(ctx.now, -DONE_JOB_DAYS))))
        .returning({ id: jobs.id });
      return gone.length;
    },
  });
  registerRetentionRule({
    name: "jobs-failed",
    run: async (ctx) => {
      const gone = await ctx.db
        .delete(jobs)
        .where(and(isNotNull(jobs.failedAt), lt(jobs.failedAt, addDays(ctx.now, -FAILED_JOB_DAYS))))
        .returning({ id: jobs.id });
      return gone.length;
    },
  });
  registerRetentionRule({
    name: "job-runs",
    run: async (ctx) => {
      const gone = await ctx.db
        .delete(jobRuns)
        .where(lt(jobRuns.startedAt, addDays(ctx.now, -JOB_RUN_DAYS)))
        .returning({ id: jobRuns.id });
      return gone.length;
    },
  });
}
registerBuiltInRules();

export const RETENTION_JOB = "retention.purge";

/** Runs every registered rule (system only) and writes the counts to the run log. */
export async function runRetention(ctx: Ctx): Promise<RetentionResult[]> {
  requireSystem(ctx);
  const results: RetentionResult[] = [];
  for (const rule of [...rules.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      results.push({ name: rule.name, deleted: await rule.run(ctx) });
    } catch (e) {
      results.push({ name: rule.name, deleted: 0, error: (e as Error).name ?? "Error" });
    }
  }
  const failed = results.filter((r) => r.error);
  const detail: Record<string, number | string> = {};
  for (const r of results) detail[r.name] = r.error ? `error: ${r.error}` : r.deleted;
  await recordJobRun(ctx, {
    name: RETENTION_JOB,
    status: failed.length > 0 ? "failed" : "ok",
    detail,
  });
  return results;
}

export function registerJobs(): void {
  registerBuiltInRules();
  defineJob(RETENTION_JOB, z.object({}).passthrough(), async (ctx) => {
    const results = await runRetention(ctx);
    const failed = results.filter((r) => r.error).map((r) => r.name);
    // Failing the job retries every rule; rules are idempotent, so that is safe.
    if (failed.length > 0) throw new Error(`retention rules failed: ${failed.join(", ")}`);
  });
  defineSchedule({ name: "retention.daily", job: RETENTION_JOB, every: { kind: "daily", at: "03:30" } });
}
