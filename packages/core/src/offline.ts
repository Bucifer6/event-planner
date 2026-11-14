import { and, asc, checkItemRevisions, eq, inArray, occasions, offlineItems, sql, taskCheckItems, tasks, type OfflineArrivalPayload, type OfflineState, type OfflineTickPayload } from "@ed/db";
import { AppError, isAppError } from "@ed/shared/errors";
import { z } from "zod";
import { getMember, requireMember, type Member } from "./access";
import { audit } from "./audit";
import { requireAccount, requireWriteCapable, type Ctx } from "./context";
import { checkInHousehold, getCheckInRoster, type RosterRow } from "./checkin";
import { assertOccasionWritable } from "./lifecycle";
import { PLANNING_ROLES } from "./suppliers";
import { inTx } from "./tx";

// RELEASE E (E-03): limited offline capture — ARRIVALS and the person's OWN CHECKLIST TICKS,
// nothing else. A device queues what it captured without network and sends it on reconnect:
//
//   submitOfflineItems()      stores each item once per (occasion, clientKey) — a replayed
//                             request changes nothing (Q4) — then reconciles
//   reconcileOfflineQueue()   applies each pending item EXACTLY ONCE, in its own transaction
//                             (row lock + savepoint), and marks it:
//       applied    it was done now
//       merged     an arrival that was already recorded: no duplicate, no error
//       conflict   a tick whose checklist item changed on the server after the device saw it
//                  ("changed_since_capture") or was removed: NOT applied — the person decides
//       rejected   not allowed (not their checklist, occasion closed, unknown household)
//   resolveOfflineConflict()  the person's decision: apply my tick anyway, or drop it
//
// Conflicts are never merged silently.

export type OfflineItem = typeof offlineItems.$inferSelect;
const idSchema = z.string().min(1).max(64);

const arrivalPayload = z.object({ householdId: idSchema, adults: z.number().int().min(0).max(200).optional(), children: z.number().int().min(0).max(200).optional() });
const tickPayload = z.object({ itemId: idSchema, done: z.boolean(), baseRevision: z.number().int().min(0).max(1_000_000) });
const itemSchema = z.discriminatedUnion("kind", [
  z.object({ clientKey: z.string().uuid(), kind: z.literal("arrival"), payload: arrivalPayload, capturedAt: z.iso.datetime() }),
  z.object({ clientKey: z.string().uuid(), kind: z.literal("tick"), payload: tickPayload, capturedAt: z.iso.datetime() }),
]);
export const offlineSubmitSchema = z.object({ items: z.array(itemSchema).max(500) });
export type OfflineSubmitItem = z.infer<typeof itemSchema>;

export type OfflineResult = { clientKey: string; kind: "arrival" | "tick"; state: OfflineState; code: string | null; detail: Record<string, unknown> | null };

const toResult = (r: OfflineItem): OfflineResult => ({ clientKey: r.clientKey, kind: r.kind, state: r.state, code: r.resultCode, detail: r.resultDetail ?? null });

type Outcome = { state: Exclude<OfflineState, "pending">; code: string | null; detail?: Record<string, unknown> };

async function applyOne(tx: Ctx, member: Member, item: OfflineItem): Promise<Outcome> {
  if (item.kind === "arrival") {
    const p = item.payload as OfflineArrivalPayload;
    const res = await checkInHousehold(tx, { occasionId: item.occasionId, householdId: p.householdId, adults: p.adults, children: p.children, source: "offline", at: item.capturedAt });
    // already there (another device, or this one online): merged — no duplicate, no error
    return res.already ? { state: "merged", code: "already_arrived", detail: { householdName: res.householdName } } : { state: "applied", code: null, detail: { householdName: res.householdName } };
  }
  const p = item.payload as OfflineTickPayload;
  const [row] = await tx.db
    .select({ id: taskCheckItems.id, label: taskCheckItems.label, done: taskCheckItems.done, taskTitle: tasks.title, owner: tasks.ownerMemberId, occasionId: tasks.occasionId, revision: sql<number>`coalesce(${checkItemRevisions.revision}, 0)::int` })
    .from(taskCheckItems)
    .innerJoin(tasks, eq(tasks.id, taskCheckItems.taskId))
    .leftJoin(checkItemRevisions, eq(checkItemRevisions.itemId, taskCheckItems.id))
    .where(eq(taskCheckItems.id, p.itemId))
    .for("update", { of: taskCheckItems });
  if (!row || row.occasionId !== item.occasionId) return { state: "conflict", code: "item_removed", detail: { wanted: p.done } };
  // offline ticks are for the person's OWN checklist only
  if (row.owner === null || row.owner !== member.id) return { state: "rejected", code: "not_yours" };
  await assertOccasionWritable(tx, item.occasionId);
  if (row.revision !== p.baseRevision) {
    return { state: "conflict", code: "changed_since_capture", detail: { label: row.label, taskTitle: row.taskTitle, serverDone: row.done, wanted: p.done } };
  }
  if (row.done !== p.done) await tx.db.update(taskCheckItems).set({ done: p.done }).where(eq(taskCheckItems.id, row.id));
  return { state: "applied", code: null, detail: { label: row.label } };
}

/**
 * Applies the actor's pending items of one occasion, oldest capture first. Each item is taken
 * with a row lock (a concurrent reconcile waits, then finds it decided), applied inside a savepoint and marked —
 * so it is applied exactly once, and one bad item never blocks the rest.
 */
export async function reconcileOfflineQueue(ctx: Ctx, occasionId: string): Promise<OfflineResult[]> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const pending = await ctx.db
    .select({ id: offlineItems.id })
    .from(offlineItems)
    .where(and(eq(offlineItems.occasionId, id), eq(offlineItems.accountId, accountId), eq(offlineItems.state, "pending")))
    .orderBy(asc(offlineItems.capturedAt), asc(offlineItems.receivedAt));
  const out: OfflineResult[] = [];
  for (const p of pending) {
    const done = await inTx(ctx, async (tx) => {
      const [item] = await tx.db.select().from(offlineItems).where(and(eq(offlineItems.id, p.id), eq(offlineItems.state, "pending"))).for("update");
      if (!item) return null; // a concurrent request applied it while we waited for the lock
      let outcome: Outcome;
      try {
        if (item.kind === "arrival" && !PLANNING_ROLES.includes(member.role)) outcome = { state: "rejected", code: "forbidden" };
        else outcome = await inTx(tx, (sp) => applyOne(sp, member, item));
      } catch (e) {
        if (!isAppError(e)) throw e;
        outcome = { state: "rejected", code: e.code === "CONFLICT" ? "occasion_closed" : e.code.toLowerCase() };
      }
      const [saved] = await tx.db
        .update(offlineItems)
        .set({ state: outcome.state, resultCode: outcome.code, resultDetail: outcome.detail ?? null, resolvedAt: outcome.state === "conflict" ? null : tx.now })
        .where(eq(offlineItems.id, item.id))
        .returning();
      return saved ?? null;
    });
    if (done) out.push(toResult(done));
  }
  return out;
}

/**
 * Receives a device's queue. Idempotent by (occasion, clientKey): an item sent again is not
 * stored or applied again — the answer simply repeats what became of it. Returns one result
 * per submitted clientKey.
 */
export async function submitOfflineItems(ctx: Ctx, input: { occasionId: string; items: unknown }): Promise<{ results: OfflineResult[]; counts: Record<OfflineState, number> }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const occasionId = idSchema.parse(input.occasionId);
  const { items } = offlineSubmitSchema.parse({ items: input.items });
  await requireMember(ctx, occasionId);
  if (items.length > 0) {
    await ctx.db
      .insert(offlineItems)
      .values(
        items.map((i) => ({
          occasionId,
          accountId,
          clientKey: i.clientKey,
          kind: i.kind,
          payload: i.payload,
          // a device clock ahead of ours never puts an arrival in the future
          capturedAt: new Date(Math.min(new Date(i.capturedAt).getTime(), ctx.now.getTime())),
          receivedAt: ctx.now,
        })),
      )
      .onConflictDoNothing({ target: [offlineItems.occasionId, offlineItems.clientKey] });
  }
  await reconcileOfflineQueue(ctx, occasionId);
  const keys = items.map((i) => i.clientKey);
  const rows = keys.length
    ? await ctx.db
        .select()
        .from(offlineItems)
        // only the actor's own rows: somebody else's clientKey is never reported back
        .where(and(eq(offlineItems.occasionId, occasionId), eq(offlineItems.accountId, accountId), inArray(offlineItems.clientKey, keys)))
    : [];
  const results = rows.map(toResult);
  const counts: Record<OfflineState, number> = { pending: 0, applied: 0, merged: 0, conflict: 0, rejected: 0, dropped: 0 };
  for (const r of results) counts[r.state] += 1;
  return { results, counts };
}

export type OfflineConflict = { id: string; kind: "arrival" | "tick"; code: string; capturedAt: Date; detail: Record<string, unknown> | null };

/** The actor's own unresolved conflicts for an occasion. */
export async function listOfflineConflicts(ctx: Ctx, occasionId: string): Promise<OfflineConflict[]> {
  const accountId = requireAccount(ctx);
  const id = idSchema.parse(occasionId);
  await requireMember(ctx, id);
  const rows = await ctx.db
    .select()
    .from(offlineItems)
    .where(and(eq(offlineItems.occasionId, id), eq(offlineItems.accountId, accountId), eq(offlineItems.state, "conflict")))
    .orderBy(asc(offlineItems.capturedAt));
  return rows.map((r) => ({ id: r.id, kind: r.kind, code: r.resultCode ?? "", capturedAt: r.capturedAt, detail: r.resultDetail ?? null }));
}

/**
 * The person decides a conflict: "apply" ticks the item as they captured it (if it still
 * exists), "drop" keeps what the server has. Either way the item leaves the conflict list.
 */
export async function resolveOfflineConflict(ctx: Ctx, input: { offlineItemId: string; decision: "apply" | "drop" }): Promise<{ state: OfflineState }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const data = z.object({ offlineItemId: idSchema, decision: z.enum(["apply", "drop"]) }).parse(input);
  return inTx(ctx, async (tx) => {
    const [item] = await tx.db.select().from(offlineItems).where(eq(offlineItems.id, data.offlineItemId)).for("update");
    if (!item || item.accountId !== accountId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const member = await requireMember(tx, item.occasionId);
    if (item.state !== "conflict") return { state: item.state }; // decided already (double tap)
    let state: OfflineState = "dropped";
    if (data.decision === "apply" && item.kind === "tick") {
      const p = item.payload as OfflineTickPayload;
      const [row] = await tx.db
        .select({ id: taskCheckItems.id, owner: tasks.ownerMemberId, occasionId: tasks.occasionId })
        .from(taskCheckItems)
        .innerJoin(tasks, eq(tasks.id, taskCheckItems.taskId))
        .where(eq(taskCheckItems.id, p.itemId));
      if (!row || row.occasionId !== item.occasionId) throw new AppError("CONFLICT", "operate.errors.itemRemoved");
      if (row.owner !== member.id) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
      await assertOccasionWritable(tx, item.occasionId);
      await tx.db.update(taskCheckItems).set({ done: p.done }).where(eq(taskCheckItems.id, row.id));
      state = "applied";
    }
    await tx.db.update(offlineItems).set({ state, resolvedAt: tx.now }).where(eq(offlineItems.id, item.id));
    await audit(tx, { action: "offline.conflict_resolved", objectType: "offline_item", objectId: item.id, after: { decision: data.decision, state } });
    return { state };
  });
}

/* ── What a device keeps for offline work ───────────────────────────────── */

export type OwnChecklistItem = { itemId: string; taskId: string; taskTitle: string; label: string; done: boolean; revision: number };

/** The check items of the tasks the actor is accountable for (packing lists of their own included). */
export async function getOwnChecklist(ctx: Ctx, occasionId: string): Promise<OwnChecklistItem[]> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  if (member.viaBusiness) return [];
  const rows = await ctx.db
    .select({ itemId: taskCheckItems.id, taskId: tasks.id, taskTitle: tasks.title, label: taskCheckItems.label, done: taskCheckItems.done, revision: sql<number>`coalesce(${checkItemRevisions.revision}, 0)::int` })
    .from(taskCheckItems)
    .innerJoin(tasks, eq(tasks.id, taskCheckItems.taskId))
    .leftJoin(checkItemRevisions, eq(checkItemRevisions.itemId, taskCheckItems.id))
    .where(and(eq(tasks.occasionId, id), eq(tasks.ownerMemberId, member.id)))
    .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt), asc(taskCheckItems.position), asc(taskCheckItems.createdAt))
    .limit(1000);
  return rows;
}

export type OfflineBundle = {
  occasionId: string;
  title: string;
  status: string;
  /** Server clock when the bundle was made. */
  fetchedAt: string;
  /** The device must drop the bundle after this instant (end of the event + 36 h, at most 7 days). */
  expiresAt: string;
  /** null when the actor may not check people in. */
  roster: RosterRow[] | null;
  checklist: OwnChecklistItem[];
};

/** Roster (planning members) + own checklist: what the check-in and checklist screens need without network. */
export async function getOfflineBundle(ctx: Ctx, occasionId: string): Promise<OfflineBundle> {
  const id = idSchema.parse(occasionId);
  const member = await getMember(ctx, id);
  if (!member) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [occasion] = await ctx.db.select().from(occasions).where(eq(occasions.id, id));
  if (!occasion) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const door = PLANNING_ROLES.includes(member.role);
  const [roster, checklist] = await Promise.all([door ? getCheckInRoster(ctx, id) : null, getOwnChecklist(ctx, id)]);
  const endOfEvent = (occasion.endsAt ?? occasion.startsAt ?? ctx.now).getTime() + 36 * 3_600_000;
  const cap = ctx.now.getTime() + 7 * 24 * 3_600_000;
  const floor = ctx.now.getTime() + 12 * 3_600_000;
  return {
    occasionId: id,
    title: occasion.title,
    status: occasion.status,
    fetchedAt: ctx.now.toISOString(),
    expiresAt: new Date(Math.min(cap, Math.max(floor, endOfEvent))).toISOString(),
    roster: roster?.rows ?? null,
    checklist,
  };
}
