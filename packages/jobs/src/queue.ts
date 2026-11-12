import { prisma } from '@eventdesk/db';
import type { Prisma } from '@eventdesk/db';

// Postgres-backed job queue (Q7): at-least-once with idempotent handlers; a killed job
// resumes because the lease expires and the row is claimable again.

export async function enqueue(
  type: string,
  payload: Prisma.InputJsonValue,
  runAt: Date = new Date()
): Promise<string> {
  const job = await prisma.job.create({ data: { type, payload, runAt } });
  return job.id;
}

const LEASE_MS = 5 * 60_000;

export async function claimNext(
  workerId: string
): Promise<{ id: string; type: string; payload: Prisma.JsonValue } | null> {
  const rows = await prisma.$queryRaw<{ id: string; type: string; payload: Prisma.JsonValue }[]>`
    UPDATE "Job"
    SET "lockedAt" = now(), "lockedBy" = ${workerId}
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE "completedAt" IS NULL
        AND "runAt" <= now()
        AND ("lockedAt" IS NULL OR "lockedAt" < now() - ${`${LEASE_MS} milliseconds`}::interval)
      ORDER BY "runAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload
  `;
  return rows[0] ?? null;
}

export async function complete(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { completedAt: new Date(), lockedAt: null, lockedBy: null },
  });
}

export async function fail(id: string, error: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return;
  const attempts = job.attempts + 1;
  const done = attempts >= job.maxAttempts;
  await prisma.job.update({
    where: { id },
    data: {
      attempts,
      lastError: error.slice(0, 2000),
      runAt: done ? job.runAt : new Date(Date.now() + Math.min(2 ** attempts * 30_000, 3_600_000)),
      completedAt: done ? new Date() : null,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function queueDepth(): Promise<number> {
  return prisma.job.count({ where: { completedAt: null, runAt: { lte: new Date() } } });
}
