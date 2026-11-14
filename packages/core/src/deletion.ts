import { and, asc, deletionRequests, eq, isNull, lte } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import { actorRef, requireSystem, type Ctx } from "./context";

// Deletion with a seven-day undo (D6, R0-18). Generic over the target ("account", "occasion").
//
// This module only keeps the request and its clock. The CALLER owns:
//  - the access check on the target (who may delete it) and the S4 fresh-auth check;
//  - hiding/locking the target while the request is open;
//  - the purge itself, run by a worker job over listDue(), finished with completeDeletion().

export const DELETION_UNDO_DAYS = 7;
const UNDO_MS = DELETION_UNDO_DAYS * 24 * 60 * 60 * 1000;

/** INF6 retention stated to the user at confirmation (years). */
export const RETAINED_AFTER_DELETION = { receiptsYears: 7, objectionRecordsYears: 3, auditYears: 2 } as const;

const target = z.object({
  targetType: z.string().min(1).max(50),
  targetId: z.string().min(1).max(200),
});

export type DeletionRequest = typeof deletionRequests.$inferSelect;

function openFor(input: z.infer<typeof target>) {
  return and(
    eq(deletionRequests.targetType, input.targetType),
    eq(deletionRequests.targetId, input.targetId),
    isNull(deletionRequests.undoneAt),
    isNull(deletionRequests.completedAt),
  );
}

/** The open (not undone, not completed) request for a target, or null. */
export async function getOpenDeletion(
  ctx: Ctx,
  input: { targetType: string; targetId: string },
): Promise<DeletionRequest | null> {
  const [row] = await ctx.db.select().from(deletionRequests).where(openFor(target.parse(input)));
  return row ?? null;
}

/**
 * Opens a deletion request with `undoUntil = now + 7 days`. Idempotent: asking again for a
 * target that already has an open request returns that request unchanged (Q4).
 */
export async function requestDeletion(
  ctx: Ctx,
  input: { targetType: string; targetId: string; retainedNote?: string },
): Promise<DeletionRequest> {
  const data = target.extend({ retainedNote: z.string().max(2000).optional() }).parse(input);
  if (ctx.actor.kind === "anonymous" || ctx.actor.kind === "guest") {
    throw new AppError("UNAUTHENTICATED");
  }
  const ref = actorRef(ctx.actor);
  const [created] = await ctx.db
    .insert(deletionRequests)
    .values({
      targetType: data.targetType,
      targetId: data.targetId,
      requestedByKind: ref.kind,
      requestedById: ref.id,
      requestedAt: ctx.now,
      undoUntil: new Date(ctx.now.getTime() + UNDO_MS),
      retainedNote: data.retainedNote ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const existing = await getOpenDeletion(ctx, data);
    if (!existing) throw new AppError("CONFLICT");
    return existing;
  }
  await audit(ctx, {
    action: `${data.targetType}.deletion_requested`,
    objectType: data.targetType,
    objectId: data.targetId,
    after: { undoUntil: created.undoUntil },
  });
  return created;
}

/**
 * Cancels the open request while the undo window is open. After `undoUntil` (or once purged)
 * it throws CONFLICT "common.errors.CONFLICT"; with no open request it throws NOT_FOUND.
 */
export async function undoDeletion(
  ctx: Ctx,
  input: { targetType: string; targetId: string },
): Promise<DeletionRequest> {
  const data = target.parse(input);
  if (ctx.actor.kind === "anonymous" || ctx.actor.kind === "guest") {
    throw new AppError("UNAUTHENTICATED");
  }
  const open = await getOpenDeletion(ctx, data);
  if (!open) throw new AppError("NOT_FOUND");
  if (open.undoUntil.getTime() <= ctx.now.getTime()) throw new AppError("CONFLICT");
  const [row] = await ctx.db
    .update(deletionRequests)
    .set({ undoneAt: ctx.now })
    .where(and(eq(deletionRequests.id, open.id), isNull(deletionRequests.undoneAt), isNull(deletionRequests.completedAt)))
    .returning();
  if (!row) throw new AppError("CONFLICT");
  await audit(ctx, {
    action: `${data.targetType}.deletion_undone`,
    objectType: data.targetType,
    objectId: data.targetId,
  });
  return row;
}

/** Worker only: open requests whose undo window has closed, oldest first. */
export async function listDue(
  ctx: Ctx,
  input: { targetType?: string; limit?: number } = {},
): Promise<DeletionRequest[]> {
  requireSystem(ctx);
  const data = z
    .object({ targetType: z.string().max(50).optional(), limit: z.number().int().min(1).max(500).default(100) })
    .parse(input);
  return ctx.db
    .select()
    .from(deletionRequests)
    .where(
      and(
        isNull(deletionRequests.undoneAt),
        isNull(deletionRequests.completedAt),
        lte(deletionRequests.undoUntil, ctx.now),
        data.targetType ? eq(deletionRequests.targetType, data.targetType) : undefined,
      ),
    )
    .orderBy(asc(deletionRequests.undoUntil))
    .limit(data.limit);
}

/** Worker only: mark a due request as purged. Idempotent. */
export async function completeDeletion(ctx: Ctx, input: { id: string }): Promise<void> {
  requireSystem(ctx);
  const [row] = await ctx.db
    .update(deletionRequests)
    .set({ completedAt: ctx.now })
    .where(and(eq(deletionRequests.id, input.id), isNull(deletionRequests.undoneAt), isNull(deletionRequests.completedAt)))
    .returning();
  if (!row) return;
  await audit(ctx, {
    action: `${row.targetType}.deletion_completed`,
    objectType: row.targetType,
    objectId: row.targetId,
  });
}
