import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, timestamptz, updatedAt } from "./_helpers";

/**
 * The job queue (Q7, R0-12). Written through @ed/jobs only.
 * A job is leased with FOR UPDATE SKIP LOCKED (locked_at/locked_by); a lease that is not
 * completed in time expires and the job is picked up again (at-least-once).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    name: text("name").notNull(),
    payload: jsonb("payload").notNull().default({}),
    runAt: timestamptz("run_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamptz("locked_at"),
    lockedBy: text("locked_by"),
    /** When the current lease runs out (locked_at + the job's lease time). */
    leaseExpiresAt: timestamptz("lease_expires_at"),
    lastError: text("last_error"),
    lastErrorAt: timestamptz("last_error_at"),
    doneAt: timestamptz("done_at"),
    /** Set when the job used up max_attempts; it is never retried again. */
    failedAt: timestamptz("failed_at"),
    /** Dedupe: a second enqueue with the same key is a no-op while this row exists. */
    uniqueKey: text("unique_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("jobs_unique_key_uq").on(t.uniqueKey),
    index("jobs_due_idx").on(t.doneAt, t.failedAt, t.runAt),
    index("jobs_name_idx").on(t.name, t.createdAt),
  ],
);

/** One row per recurring schedule: the last slot that was enqueued (restart-safe). */
export const jobSchedules = pgTable("job_schedules", {
  name: text("name").primaryKey(),
  lastSlot: timestamptz("last_slot").notNull(),
  updatedAt: updatedAt(),
});

export const JOB_RUN_STATUSES = ["ok", "failed", "skipped"] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];
export const jobRunStatusSchema = z.enum(JOB_RUN_STATUSES);

/** Operator-visible log of operational runs (backup, restore test, retention, stats). */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    name: text("name").notNull(),
    status: text("status").$type<JobRunStatus>().notNull(),
    startedAt: timestamptz("started_at").notNull(),
    finishedAt: timestamptz("finished_at").notNull(),
    /** Counts and short messages only. Never secrets, never personal data. */
    detail: jsonb("detail"),
  },
  (t) => [index("job_runs_name_idx").on(t.name, t.startedAt)],
);
