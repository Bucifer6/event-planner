import type { Ctx } from "@ed/core/context";
import { desc, eq, jobRuns, type JobRunStatus } from "@ed/db";
import { AppError } from "@ed/shared/errors";

export type JobRunDetail = Record<string, string | number | boolean | null>;

/**
 * Writes one line of the operator-visible run log (backups, restore tests, retention,
 * nightly statistics). Counts and short messages only — never secrets or personal data.
 */
export async function recordJobRun(
  ctx: Pick<Ctx, "db" | "now">,
  run: { name: string; status: JobRunStatus; startedAt?: Date; detail?: JobRunDetail },
): Promise<string> {
  const [row] = await ctx.db
    .insert(jobRuns)
    .values({
      name: run.name,
      status: run.status,
      startedAt: run.startedAt ?? ctx.now,
      finishedAt: ctx.now,
      detail: run.detail ?? null,
    })
    .returning({ id: jobRuns.id });
  return row!.id;
}

/** Latest runs of one operational job, newest first (for the console). */
export async function listJobRuns(ctx: Ctx, name: string, limit = 50) {
  requireOperator(ctx);
  return ctx.db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.name, name))
    .orderBy(desc(jobRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

/** Operational data is for staff (console) and the system only. */
export function requireOperator(ctx: Ctx): void {
  if (ctx.actor.kind !== "staff" && ctx.actor.kind !== "system") {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
}
