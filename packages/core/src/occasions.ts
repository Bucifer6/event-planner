import {
  and,
  asc,
  deletionRequests,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  occasionKindSchema,
  occasionMembers,
  occasions,
  sql,
  tasks,
  whatifPreviews,
  type OccasionDateMode,
  type OccasionKind,
  type WhatIfDeltaRow,
} from "@ed/db";
import { deleteOwnerAssets, registerAssetAccess } from "@ed/storage";
import { AppError } from "@ed/shared/errors";
import { zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { getMember, isManager, requireMember, type Member } from "./access";
import { requireFreshAuth } from "./accounts";
import { audit } from "./audit";
import { requireAccount, requireSystem, requireWriteCapable, type Ctx } from "./context";
import {
  completeDeletion,
  getOpenDeletion,
  listDue,
  requestDeletion,
  RETAINED_AFTER_DELETION,
  undoDeletion,
  type DeletionRequest,
} from "./deletion";
import { registerRetentionRule } from "./retention";
import {
  applyTemplatePlan,
  dayToInstant,
  daysBetween,
  formatDay,
  instantToDay,
  planTemplate,
  PREVIEW_ROW_LIMIT,
  scheduleDue,
  shiftDay,
  zDay,
} from "./templates";
import { inTx } from "./tx";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Occasions (A1, A11, D6). An occasion is free to create and activate: there is no payment,
// promo or card step anywhere (MON1). Dates are whole days in the occasion's time zone.

export type Occasion = typeof occasions.$inferSelect;
export const OCCASION_DELETION_TARGET = "occasion";
export const MAX_PRIORITIES = 3;

const idSchema = z.string().min(1).max(64);

/** The occasion row, for members only (non-members get NOT_FOUND). */
export async function getOccasion(ctx: Ctx, occasionId: string): Promise<Occasion> {
  await requireMember(ctx, occasionId);
  return loadOccasion(ctx, occasionId);
}

async function loadOccasion(ctx: Ctx, occasionId: string): Promise<Occasion> {
  const [row] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

export type OccasionView = {
  occasion: Occasion;
  member: Member;
  /** Open deletion request (seven-day undo running), if any. */
  deletion: { requestedAt: Date; undoUntil: Date } | null;
  /** Calendar days from today to the occasion day; negative = past; null = no date yet. */
  daysLeft: number | null;
};

export function daysUntil(occasion: Pick<Occasion, "startsAt" | "timezone">, now: Date): number | null {
  if (!occasion.startsAt) return null;
  return daysBetween(
    instantToDay(now, occasion.timezone),
    instantToDay(occasion.startsAt, occasion.timezone),
  );
}

/** Everything a layout needs: the occasion, the actor's membership and the deletion state. */
export async function getOccasionView(ctx: Ctx, occasionId: string): Promise<OccasionView> {
  const member = await requireMember(ctx, occasionId);
  const occasion = await loadOccasion(ctx, occasionId);
  const open = await getOpenDeletion(ctx, { targetType: OCCASION_DELETION_TARGET, targetId: occasionId });
  return {
    occasion,
    member,
    deletion: open ? { requestedAt: open.requestedAt, undoUntil: open.undoUntil } : null,
    daysLeft: daysUntil(occasion, ctx.now),
  };
}

export type OccasionListItem = {
  occasion: Occasion;
  role: Member["role"];
  customLabel: string | null;
  daysLeft: number | null;
  pendingDeletion: boolean;
  openTasks: number;
};

/** The actor's occasions: upcoming first (soonest at the top), then undated, then past. */
export async function listOccasions(ctx: Ctx): Promise<OccasionListItem[]> {
  const accountId = requireAccount(ctx);
  const rows = await ctx.db
    .select({ occasion: occasions, role: occasionMembers.role, customLabel: occasionMembers.customLabel })
    .from(occasionMembers)
    .innerJoin(occasions, eq(occasions.id, occasionMembers.occasionId))
    .where(and(eq(occasionMembers.accountId, accountId), isNull(occasionMembers.removedAt)))
    .orderBy(desc(occasions.createdAt))
    .limit(500);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.occasion.id);
  const [pending, open] = await Promise.all([
    ctx.db
      .select({ targetId: deletionRequests.targetId })
      .from(deletionRequests)
      .where(
        and(
          eq(deletionRequests.targetType, OCCASION_DELETION_TARGET),
          inArray(deletionRequests.targetId, ids),
          isNull(deletionRequests.undoneAt),
          isNull(deletionRequests.completedAt),
        ),
      ),
    ctx.db
      .select({ occasionId: tasks.occasionId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(inArray(tasks.occasionId, ids), ne(tasks.status, "done")))
      .groupBy(tasks.occasionId),
  ]);
  const pendingSet = new Set(pending.map((p) => p.targetId));
  const openMap = new Map(open.map((o) => [o.occasionId, o.n]));
  const items = rows.map((r) => ({
    occasion: r.occasion,
    role: r.role,
    customLabel: r.customLabel,
    daysLeft: daysUntil(r.occasion, ctx.now),
    pendingDeletion: pendingSet.has(r.occasion.id),
    openTasks: openMap.get(r.occasion.id) ?? 0,
  }));
  const rank = (d: number | null) => (d === null ? 1 : d >= 0 ? 0 : 2);
  return items.sort((a, b) => {
    const ra = rank(a.daysLeft);
    const rb = rank(b.daysLeft);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.daysLeft! - b.daysLeft!;
    if (ra === 2) return b.daysLeft! - a.daysLeft!;
    return 0;
  });
}

/* ── Create ─────────────────────────────────────────────────────────────── */

const zPriorities = z
  .array(z.string().trim().max(200, "common.validation.tooLong"))
  .max(MAX_PRIORITIES)
  .transform((list) => list.filter((p) => p.length > 0));

const dateFields = {
  dateMode: z.enum(["date", "range", "poll"]),
  startsOn: z.preprocess((v) => (v === "" ? undefined : v), zDay.optional()),
  endsOn: z.preprocess((v) => (v === "" ? undefined : v), zDay.optional()),
};

function checkDates(
  v: { dateMode: OccasionDateMode; startsOn?: string; endsOn?: string },
  issue: z.core.$RefinementCtx,
): void {
  if (v.dateMode === "poll") return;
  if (!v.startsOn) {
    issue.addIssue({ code: "custom", path: ["startsOn"], message: "occasions.errors.dateRequired" });
  }
  if (v.dateMode === "range") {
    if (!v.endsOn) {
      issue.addIssue({ code: "custom", path: ["endsOn"], message: "occasions.errors.endRequired" });
    } else if (v.startsOn && v.endsOn < v.startsOn) {
      issue.addIssue({ code: "custom", path: ["endsOn"], message: "occasions.errors.endBeforeStart" });
    }
  }
}

export const createOccasionInput = z
  .object({
    title: zText(120),
    kind: occasionKindSchema.default("blank"),
    ...dateFields,
    venueName: zOptionalText(160),
    venueAddress: zOptionalText(300),
    purpose: zOptionalText(600),
    priorities: zPriorities.default([]),
    locale: z.enum(["ro", "en"]).optional(),
  })
  .superRefine(checkDates);
export type CreateOccasionInput = z.input<typeof createOccasionInput>;

const DEFAULT_TZ = "Europe/Bucharest";

/**
 * Creates the occasion, makes the actor its owner and lays out the template's tasks. The
 * occasion is active at once — free, with no payment step (A1, MON1).
 */
export async function createOccasion(ctx: Ctx, input: CreateOccasionInput): Promise<Occasion> {
  const accountId = requireAccount(ctx);
  requireWriteCapable(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const data = createOccasionInput.parse(input);
  const startsAt = data.dateMode !== "poll" && data.startsOn ? dayToInstant(data.startsOn, DEFAULT_TZ) : null;
  const endsAt = data.dateMode === "range" && data.endsOn ? dayToInstant(data.endsOn, DEFAULT_TZ) : null;

  return inTx(ctx, async (tx) => {
    const [occasion] = await tx.db
      .insert(occasions)
      .values({
        ownerAccountId: accountId,
        title: data.title,
        kind: data.kind,
        dateMode: data.dateMode,
        startsAt,
        endsAt,
        timezone: DEFAULT_TZ,
        venueName: data.venueName ?? null,
        venueAddress: data.venueAddress ?? null,
        purpose: data.purpose ?? null,
        priorities: data.priorities,
        locale: data.locale ?? ctx.locale,
        createdAt: tx.now,
      })
      .returning();
    const [owner] = await tx.db
      .insert(occasionMembers)
      .values({ occasionId: occasion!.id, accountId, role: "owner", createdAt: tx.now })
      .returning();
    let created = 0;
    if (data.kind !== "blank") {
      const plan = await planTemplate(tx, occasion!, data.kind);
      created = (await applyTemplatePlan(tx, occasion!, plan, owner!.id)).created;
    }
    await audit(tx, {
      action: "occasion.created",
      objectType: "occasion",
      objectId: occasion!.id,
      after: { title: occasion!.title, kind: occasion!.kind, dateMode: occasion!.dateMode },
      meta: { templateTasks: created },
    });
    return occasion!;
  });
}

/* ── Edit details and brief ─────────────────────────────────────────────── */

export const updateOccasionInput = z.object({
  occasionId: idSchema,
  title: zText(120).optional(),
  venueName: zOptionalText(160),
  venueAddress: zOptionalText(300),
  purpose: zOptionalText(600),
  priorities: zPriorities.optional(),
});

/** Title, venue and the event brief (A11). Owner or project manager. Dates move via What-if. */
export async function updateOccasion(
  ctx: Ctx,
  input: z.input<typeof updateOccasionInput>,
): Promise<Occasion> {
  requireWriteCapable(ctx);
  const data = updateOccasionInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  return inTx(ctx, async (tx) => {
    const before = await loadOccasion(tx, data.occasionId);
    const [after] = await tx.db
      .update(occasions)
      .set({
        title: data.title ?? before.title,
        venueName: data.venueName ?? null,
        venueAddress: data.venueAddress ?? null,
        purpose: data.purpose ?? null,
        priorities: data.priorities ?? before.priorities,
      })
      .where(eq(occasions.id, data.occasionId))
      .returning();
    await audit(tx, {
      action: "occasion.updated",
      objectType: "occasion",
      objectId: data.occasionId,
      before: { title: before.title, venueName: before.venueName, purpose: before.purpose, priorities: before.priorities },
      after: { title: after!.title, venueName: after!.venueName, purpose: after!.purpose, priorities: after!.priorities },
    });
    return after!;
  });
}

/* ── Moving the date: a What-if preview, never silent (A2, principle 3) ──── */

export const MOVE_DATE_KIND = "occasion.moveDate";

const moveDateInput = z
  .object({
    ...dateFields,
    /** The occasion day the preview was computed against ("" = no date): stale if it changed. */
    expectedStartsOn: z.string().max(10).optional(),
  })
  .superRefine(checkDates);
type MoveDateInput = z.infer<typeof moveDateInput>;

type TaskShift = { id: string; title: string; from: Date | null; to: Date | null };

/**
 * Every open task whose due date moves with the occasion. Template tasks still on their
 * template schedule are re-scheduled from their offsets (so "3 months before" stays exactly
 * that); any other dated task moves by the same number of days. Done tasks never move.
 */
async function computeShifts(ctx: Ctx, occasion: Occasion, newStart: Date | null): Promise<TaskShift[]> {
  const tz = occasion.timezone;
  const rows = await ctx.db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      offsetMonths: tasks.offsetMonths,
      offsetDays: tasks.offsetDays,
      templateTaskKey: tasks.templateTaskKey,
    })
    .from(tasks)
    .where(and(eq(tasks.occasionId, occasion.id), ne(tasks.status, "done")))
    .orderBy(asc(tasks.dueAt), asc(tasks.createdAt));
  const dayDelta =
    occasion.startsAt && newStart
      ? daysBetween(instantToDay(occasion.startsAt, tz), instantToDay(newStart, tz))
      : null;
  const shifts: TaskShift[] = [];
  for (const t of rows) {
    const scheduled = t.templateTaskKey !== null && t.offsetMonths !== null;
    const onSchedule =
      scheduled &&
      (t.dueAt?.getTime() ?? null) ===
        (scheduleDue(occasion.startsAt, tz, t.offsetMonths, t.offsetDays)?.getTime() ?? null);
    let to: Date | null;
    if (onSchedule) {
      to = scheduleDue(newStart, tz, t.offsetMonths, t.offsetDays);
    } else if (t.dueAt && dayDelta !== null) {
      to = dayToInstant(shiftDay(instantToDay(t.dueAt, tz), { days: dayDelta }), tz);
    } else {
      to = t.dueAt; // hand-dated task with no reference date to move from: left alone
    }
    if ((to?.getTime() ?? null) !== (t.dueAt?.getTime() ?? null)) {
      shifts.push({ id: t.id, title: t.title, from: t.dueAt, to });
    }
  }
  return shifts;
}

function newDates(occasion: Occasion, input: MoveDateInput): { startsAt: Date | null; endsAt: Date | null } {
  const tz = occasion.timezone;
  return {
    startsAt: input.dateMode !== "poll" && input.startsOn ? dayToInstant(input.startsOn, tz) : null,
    endsAt: input.dateMode === "range" && input.endsOn ? dayToInstant(input.endsOn, tz) : null,
  };
}

function dateText(start: Date | null, end: Date | null, tz: string): WhatIfDeltaRow["before"] {
  if (!start) return { key: "occasions.whatif.byPoll" };
  return end ? `${formatDay(start, tz)} – ${formatDay(end, tz)}` : formatDay(start, tz);
}

registerWhatIf<MoveDateInput>(MOVE_DATE_KIND, {
  input: moveDateInput,
  authorize: async (ctx, subject, action) => {
    await requireMember(ctx, subject.occasionId ?? "", action === "read" ? {} : { manage: true });
  },
  compute: async (ctx, input, subject) => {
    const occasion = await loadOccasion(ctx, subject.occasionId ?? "");
    const tz = occasion.timezone;
    const next = newDates(occasion, input);
    const shifts = await computeShifts(ctx, occasion, next.startsAt);
    const delta: WhatIfDeltaRow[] = [
      {
        key: "_date",
        what: { key: "occasions.whatif.dateRow" },
        kindLabelKey: "whatif.kinds.moved",
        before: dateText(occasion.startsAt, occasion.endsAt, tz),
        after: dateText(next.startsAt, next.endsAt, tz),
      },
    ];
    for (const s of shifts.slice(0, PREVIEW_ROW_LIMIT)) {
      delta.push({
        key: s.id,
        what: s.title,
        kindLabelKey: "occasions.whatif.taskLabel",
        before: s.from ? formatDay(s.from, tz) : null,
        after: s.to ? formatDay(s.to, tz) : null,
      });
    }
    if (shifts.length > PREVIEW_ROW_LIMIT) {
      delta.push({
        key: "_more",
        what: { key: "occasions.whatif.moreTasks", params: { count: shifts.length - PREVIEW_ROW_LIMIT } },
      });
    }
    if (shifts.length === 0) {
      delta.push({ key: "_none", what: { key: "occasions.whatif.noTasksMove" } });
    }
    return { title: { key: "occasions.whatif.moveTitle" }, delta };
  },
  apply: async (tx, preview) => {
    const occasion = await loadOccasion(tx, preview.occasionId ?? "");
    const input = preview.input;
    const current = occasion.startsAt ? instantToDay(occasion.startsAt, occasion.timezone) : "";
    if (input.expectedStartsOn !== undefined && input.expectedStartsOn !== current) {
      throw new AppError("CONFLICT", "whatif.errors.stale");
    }
    const next = newDates(occasion, input);
    const shifts = await computeShifts(tx, occasion, next.startsAt);
    for (const s of shifts) {
      await tx.db
        .update(tasks)
        .set({ dueAt: s.to })
        .where(and(eq(tasks.id, s.id), eq(tasks.occasionId, occasion.id)));
    }
    await tx.db
      .update(occasions)
      .set({ dateMode: input.dateMode, startsAt: next.startsAt, endsAt: next.endsAt })
      .where(eq(occasions.id, occasion.id));
    await audit(tx, {
      action: "occasion.date_moved",
      objectType: "occasion",
      objectId: occasion.id,
      before: { dateMode: occasion.dateMode, startsAt: occasion.startsAt, endsAt: occasion.endsAt },
      after: { dateMode: input.dateMode, startsAt: next.startsAt, endsAt: next.endsAt },
      meta: { tasksShifted: shifts.length },
    });
  },
});

/** Preview of moving the occasion date: lists every task whose due date shifts. */
export async function proposeMoveDate(
  ctx: Ctx,
  input: { occasionId: string; dateMode: OccasionDateMode; startsOn?: string; endsOn?: string },
): Promise<WhatIfPreview> {
  const occasionId = idSchema.parse(input.occasionId);
  await requireMember(ctx, occasionId, { manage: true });
  const occasion = await loadOccasion(ctx, occasionId);
  const parsed = moveDateInput.parse({
    dateMode: input.dateMode,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  });
  const next = newDates(occasion, parsed);
  if (
    parsed.dateMode === occasion.dateMode &&
    (next.startsAt?.getTime() ?? null) === (occasion.startsAt?.getTime() ?? null) &&
    (next.endsAt?.getTime() ?? null) === (occasion.endsAt?.getTime() ?? null)
  ) {
    throw new AppError("VALIDATION", "occasions.errors.sameDate", {
      fieldErrors: { startsOn: ["occasions.errors.sameDate"] },
    });
  }
  return createPreview(ctx, {
    kind: MOVE_DATE_KIND,
    occasionId,
    subjectType: "occasion",
    subjectId: occasionId,
    input: {
      ...parsed,
      expectedStartsOn: occasion.startsAt ? instantToDay(occasion.startsAt, occasion.timezone) : "",
    },
  });
}

/* ── Proposals history ──────────────────────────────────────────────────── */

/** Recently applied or discarded previews of the occasion (members only), newest first. */
export async function listDecidedPreviews(ctx: Ctx, occasionId: string, limit = 20): Promise<WhatIfPreview[]> {
  await requireMember(ctx, occasionId);
  return ctx.db
    .select()
    .from(whatifPreviews)
    .where(and(eq(whatifPreviews.occasionId, occasionId), ne(whatifPreviews.state, "pending"), isNotNull(whatifPreviews.decidedAt)))
    .orderBy(desc(whatifPreviews.decidedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

/* ── Deletion with a seven-day undo (D6, R0-18) ─────────────────────────── */

/**
 * Owner only, after a fresh confirmation (S4). Nothing is removed for seven days; the
 * occasion stays readable with a banner and can be restored with undoOccasionDeletion.
 */
export async function requestOccasionDeletion(
  ctx: Ctx,
  input: { occasionId: string },
): Promise<{ undoUntil: Date; retained: typeof RETAINED_AFTER_DELETION }> {
  requireWriteCapable(ctx);
  const occasionId = idSchema.parse(input.occasionId);
  await requireMember(ctx, occasionId, { roles: ["owner"] });
  await requireFreshAuth(ctx);
  const request = await requestDeletion(ctx, {
    targetType: OCCASION_DELETION_TARGET,
    targetId: occasionId,
    retainedNote: `receipts ${RETAINED_AFTER_DELETION.receiptsYears}y; objection records ${RETAINED_AFTER_DELETION.objectionRecordsYears}y; audit ${RETAINED_AFTER_DELETION.auditYears}y`,
  });
  return { undoUntil: request.undoUntil, retained: RETAINED_AFTER_DELETION };
}

/** Cancels the pending deletion inside the seven days. Owner or project manager. */
export async function undoOccasionDeletion(ctx: Ctx, input: { occasionId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const occasionId = idSchema.parse(input.occasionId);
  await requireMember(ctx, occasionId, { manage: true });
  await undoDeletion(ctx, { targetType: OCCASION_DELETION_TARGET, targetId: occasionId });
}

export async function getOccasionDeletion(ctx: Ctx, occasionId: string): Promise<DeletionRequest | null> {
  await requireMember(ctx, occasionId);
  return getOpenDeletion(ctx, { targetType: OCCASION_DELETION_TARGET, targetId: occasionId });
}

export type OccasionPurgeHook = (tx: Ctx, occasionId: string) => Promise<void>;
const g = globalThis as unknown as { __edOccasionPurge?: OccasionPurgeHook[] };
const purgeHooks: OccasionPurgeHook[] = (g.__edOccasionPurge ??= []);

/**
 * Other domains (guests, budget, suppliers…) register what must be removed — or deliberately
 * kept (receipts 7 years) — when an occasion is purged. Runs inside the purge transaction,
 * before the occasion row (and everything that cascades from it) is deleted.
 */
export function onOccasionPurge(fn: OccasionPurgeHook): void {
  if (!purgeHooks.includes(fn)) purgeHooks.push(fn);
}

/** Worker only: hard-deletes every occasion whose undo window has closed. Returns their ids. */
export async function purgeDueOccasions(ctx: Ctx, input: { limit?: number } = {}): Promise<string[]> {
  requireSystem(ctx);
  const due = await listDue(ctx, { targetType: OCCASION_DELETION_TARGET, limit: input.limit });
  const purged: string[] = [];
  for (const request of due) {
    const occasionId = request.targetId;
    await inTx(ctx, async (tx) => {
      for (const hook of purgeHooks) await hook(tx, occasionId);
      await tx.db.delete(whatifPreviews).where(eq(whatifPreviews.occasionId, occasionId));
      // tasks, checklists, dependencies, delegations, digests and members cascade
      await tx.db.delete(occasions).where(eq(occasions.id, occasionId));
      await completeDeletion(tx, { id: request.id });
    });
    // stored files are removed outside the row transaction (object storage is not transactional)
    await deleteOwnerAssets(ctx, { ownerType: "occasion", ownerId: occasionId }).catch(() => 0);
    purged.push(occasionId);
  }
  return purged;
}

function registerRules(): void {
  registerRetentionRule({
    name: "occasions-deleted",
    run: async (ctx) => (await purgeDueOccasions(ctx)).length,
  });
  // Occasion files: every member may read, owner and project manager may add or remove.
  registerAssetAccess("occasion", {
    canRead: async (ctx, asset) => (await getMember(ctx, asset.ownerId)) !== null,
    canWrite: async (ctx, owner) => {
      const member = await getMember(ctx, owner.ownerId);
      return member !== null && isManager(member) && ctx.actor.kind === "account";
    },
  });
}
registerRules();

export function registerJobs(): void {
  registerRules();
}
