import { and, asc, corrections, eq, sql } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import { actorRef, type Ctx } from "./context";

// Corrections (principle 4). A fact — a payment made, a quantity received, an arrival — is
// changed only together with a row here that keeps the old value, the new value and the reason.
//
//   await inTx(ctx, async (tx) => {
//     await recordCorrection(tx, { occasionId, targetTable: "expenses", targetId, field: "amountMinor",
//                                  before: 1000, after: 1200, reason });
//     await tx.db.update(expenses)…                       // the change itself, SAME transaction
//   });
//
// recordCorrection does NO access check: the calling domain function has already decided that
// the actor may change the fact. It refuses actors that can never change facts (anonymous).

export type Correction = typeof corrections.$inferSelect;

const recordInput = z.object({
  occasionId: z.string().min(1).max(64).nullish(),
  targetTable: z.string().min(1).max(100),
  targetId: z.string().min(1).max(64),
  field: z.string().min(1).max(100),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  /** Why the fact is being changed. Required: a correction without a reason is refused. */
  reason: z.string().trim().min(3, "corrections.errors.reasonRequired").max(1000),
});
export type RecordCorrectionInput = {
  occasionId?: string | null;
  targetTable: string;
  targetId: string;
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
};

function toJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/**
 * Appends the correction row and an audit entry; returns the correction id. Call it INSIDE the
 * transaction that changes the fact (pass the inTx ctx) so both commit or roll back together.
 */
export async function recordCorrection(ctx: Ctx, input: RecordCorrectionInput): Promise<string> {
  const parsed = recordInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "corrections.errors.reasonRequired", {
      fieldErrors: { reason: ["corrections.errors.reasonRequired"] },
    });
  }
  const data = parsed.data;
  if (ctx.actor.kind === "anonymous") {
    throw new AppError("UNAUTHENTICATED", "common.errors.UNAUTHENTICATED");
  }
  const ref = actorRef(ctx.actor);
  const [row] = await ctx.db
    .insert(corrections)
    .values({
      occasionId: data.occasionId ?? null,
      targetTable: data.targetTable,
      targetId: data.targetId,
      field: data.field,
      before: toJson(data.before),
      after: toJson(data.after),
      reason: data.reason,
      actorKind: ref.kind,
      actorId: ref.id,
      createdAt: ctx.now,
    })
    .returning({ id: corrections.id });
  await audit(ctx, {
    action: "correction.recorded",
    objectType: data.targetTable,
    objectId: data.targetId,
    before: { [data.field]: toJson(data.before) },
    after: { [data.field]: toJson(data.after) },
    meta: { correctionId: row!.id, reason: data.reason, occasionId: data.occasionId ?? null },
  });
  return row!.id;
}

/**
 * The correction history of one fact, oldest first. NO access check — call it from code that
 * has already checked that the actor may read the fact itself.
 */
export async function listCorrections(
  ctx: Ctx,
  input: { targetTable: string; targetId: string },
): Promise<Correction[]> {
  const data = z
    .object({ targetTable: z.string().min(1).max(100), targetId: z.string().min(1).max(64) })
    .parse(input);
  return ctx.db
    .select()
    .from(corrections)
    .where(and(eq(corrections.targetTable, data.targetTable), eq(corrections.targetId, data.targetId)))
    // ties (several corrections in one request share ctx.now) fall back to physical insertion
    // order, which is stable because the table is append-only
    .orderBy(asc(corrections.createdAt), sql`corrections.ctid asc`);
}
