import { and, delegations, desc, eq, isNull, occasionMembers, tasks } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { isManager, requireMember } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { canDelegate } from "./tasks";
import { inTx } from "./tx";

// Delegation by offer and acceptance (A4). A task is OFFERED to a member; nothing changes
// hands until they accept. Declining needs a short reason and returns the task to the person
// who offered it — never to anyone else.

export type Delegation = typeof delegations.$inferSelect;
const idSchema = z.string().min(1).max(64);

async function loadTaskFor(ctx: Ctx, taskId: string) {
  const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, idSchema.parse(taskId)));
  if (!task) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, task.occasionId);
  return { task, member };
}

/**
 * Offers a task to a member who has joined the team. Allowed for the owner, project managers,
 * workstream leads and the task's current accountable owner. A previous unanswered offer for
 * the same task is withdrawn — a task has at most one open offer.
 */
export async function offerTask(ctx: Ctx, input: { taskId: string; toMemberId: string }): Promise<Delegation> {
  requireWriteCapable(ctx);
  const data = z.object({ taskId: idSchema, toMemberId: idSchema }).parse(input);
  const { task, member } = await loadTaskFor(ctx, data.taskId);
  if (!canDelegate(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotDelegate");
  if (data.toMemberId === member.id) throw new AppError("VALIDATION", "tasks.errors.offerToSelf");
  const [to] = await ctx.db
    .select()
    .from(occasionMembers)
    .where(
      and(
        eq(occasionMembers.id, data.toMemberId),
        eq(occasionMembers.occasionId, task.occasionId),
        isNull(occasionMembers.removedAt),
      ),
    );
  if (!to || !to.accountId) throw new AppError("VALIDATION", "tasks.errors.offerTargetMissing");
  return inTx(ctx, async (tx) => {
    await tx.db
      .update(delegations)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(delegations.taskId, task.id), eq(delegations.state, "offered")));
    const [row] = await tx.db
      .insert(delegations)
      .values({
        occasionId: task.occasionId,
        taskId: task.id,
        fromMemberId: member.id,
        toMemberId: to.id,
        createdAt: tx.now,
      })
      .returning();
    await audit(tx, {
      action: "task.offered",
      objectType: "task",
      objectId: task.id,
      meta: { occasionId: task.occasionId, delegationId: row!.id, fromMemberId: member.id, toMemberId: to.id },
    });
    return row!;
  });
}

async function loadOffer(ctx: Ctx, delegationId: string) {
  const [row] = await ctx.db.select().from(delegations).where(eq(delegations.id, idSchema.parse(delegationId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, row.occasionId);
  return { offer: row, member };
}

/** The person the task was offered to accepts: they become its accountable owner. Applies once. */
export async function acceptOffer(ctx: Ctx, input: { delegationId: string }): Promise<Delegation> {
  requireWriteCapable(ctx);
  const { offer, member } = await loadOffer(ctx, input.delegationId);
  if (offer.toMemberId !== member.id) throw new AppError("FORBIDDEN", "tasks.errors.notYourOffer");
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .update(delegations)
      .set({ state: "accepted", decidedAt: tx.now })
      .where(and(eq(delegations.id, offer.id), eq(delegations.state, "offered")))
      .returning();
    if (!row) {
      const [current] = await tx.db.select().from(delegations).where(eq(delegations.id, offer.id));
      if (current?.state === "accepted") return current; // double tap (Q4)
      throw new AppError("CONFLICT", "tasks.errors.offerClosed");
    }
    await tx.db.update(tasks).set({ ownerMemberId: member.id }).where(eq(tasks.id, offer.taskId));
    await audit(tx, {
      action: "task.offer_accepted",
      objectType: "task",
      objectId: offer.taskId,
      meta: { occasionId: offer.occasionId, delegationId: offer.id },
    });
    return row;
  });
}

/**
 * Declines with a short reason. The task goes back to the delegator — the member who made the
 * offer — and to nobody else. (If that member has since left the team, the task is left
 * without an owner rather than handed to someone who never agreed.)
 */
export async function declineOffer(ctx: Ctx, input: { delegationId: string; reason: string }): Promise<Delegation> {
  requireWriteCapable(ctx);
  const data = z
    .object({
      delegationId: idSchema,
      reason: z.string().trim().min(3, "tasks.errors.reasonRequired").max(300, "common.validation.tooLong"),
    })
    .parse(input);
  const { offer, member } = await loadOffer(ctx, data.delegationId);
  if (offer.toMemberId !== member.id) throw new AppError("FORBIDDEN", "tasks.errors.notYourOffer");
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .update(delegations)
      .set({ state: "declined", declineReason: data.reason, decidedAt: tx.now })
      .where(and(eq(delegations.id, offer.id), eq(delegations.state, "offered")))
      .returning();
    if (!row) {
      const [current] = await tx.db.select().from(delegations).where(eq(delegations.id, offer.id));
      if (current?.state === "declined") return current;
      throw new AppError("CONFLICT", "tasks.errors.offerClosed");
    }
    const [delegator] = await tx.db
      .select({ id: occasionMembers.id })
      .from(occasionMembers)
      .where(and(eq(occasionMembers.id, offer.fromMemberId), isNull(occasionMembers.removedAt)));
    await tx.db
      .update(tasks)
      .set({ ownerMemberId: delegator ? delegator.id : null })
      .where(eq(tasks.id, offer.taskId));
    await audit(tx, {
      action: "task.offer_declined",
      objectType: "task",
      objectId: offer.taskId,
      meta: { occasionId: offer.occasionId, delegationId: offer.id, returnedTo: delegator?.id ?? null },
    });
    return row;
  });
}

/** The delegator (or a manager) takes an unanswered offer back. Idempotent. */
export async function withdrawOffer(ctx: Ctx, input: { delegationId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { offer, member } = await loadOffer(ctx, input.delegationId);
  if (offer.fromMemberId !== member.id && !isManager(member)) {
    throw new AppError("FORBIDDEN", "tasks.errors.cannotDelegate");
  }
  await inTx(ctx, async (tx) => {
    const done = await tx.db
      .update(delegations)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(delegations.id, offer.id), eq(delegations.state, "offered")))
      .returning({ id: delegations.id });
    if (done.length === 0) return;
    await audit(tx, {
      action: "task.offer_withdrawn",
      objectType: "task",
      objectId: offer.taskId,
      meta: { occasionId: offer.occasionId, delegationId: offer.id },
    });
  });
}

export type OpenOffer = {
  id: string;
  taskId: string;
  taskTitle: string;
  fromMemberId: string;
  toMemberId: string;
  createdAt: Date;
};

/** Offers still waiting for an answer in this occasion, oldest first shown last. */
export async function listOpenOffers(ctx: Ctx, occasionId: string): Promise<OpenOffer[]> {
  await requireMember(ctx, occasionId);
  return listOpenOffersUnchecked(ctx, occasionId);
}

export async function listOpenOffersUnchecked(ctx: Ctx, occasionId: string): Promise<OpenOffer[]> {
  return ctx.db
    .select({
      id: delegations.id,
      taskId: delegations.taskId,
      taskTitle: tasks.title,
      fromMemberId: delegations.fromMemberId,
      toMemberId: delegations.toMemberId,
      createdAt: delegations.createdAt,
    })
    .from(delegations)
    .innerJoin(tasks, eq(tasks.id, delegations.taskId))
    .where(and(eq(delegations.occasionId, occasionId), eq(delegations.state, "offered")))
    .orderBy(desc(delegations.createdAt))
    .limit(200);
}
