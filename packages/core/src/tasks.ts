import {
  accounts,
  and,
  asc,
  delegations,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  occasionMembers,
  occasions,
  sql,
  taskCheckItems,
  taskDependencies,
  taskStatusSchema,
  tasks,
  type DelegationState,
  type OccasionRole,
  type TaskStage,
  type TaskStatus,
} from "@ed/db";
import { TASK_STAGES, TASK_STATUSES } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { isManager, requireMember, type Member } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { dayToInstant, daysBetween, instantToDay, zDay } from "./templates";
import { inTx } from "./tx";

// Tasks (A3, principle 2). A task exists once; the List, Board and Calendar views are
// groupings of the rows returned by queryTasks — there is no second store to keep in step.
// Dependency problems are reported (violations), never silently blocked.

export type Task = typeof tasks.$inferSelect;
export { TASK_STAGES, TASK_STATUSES };
export type { TaskStage, TaskStatus };

const idSchema = z.string().min(1).max(64);

export type TaskViolation =
  /** Marked done while something it depends on is not done. */
  | "doneBeforeDependency"
  /** Marked done while it still has unfinished child tasks. */
  | "doneWithOpenChildren";

export type TaskItem = {
  id: string;
  occasionId: string;
  title: string;
  status: TaskStatus;
  dueAt: Date | null;
  /** "2026-06-14" in the occasion's time zone. */
  dueDay: string | null;
  /** Template stage, or the stage worked out from the due date. Null = undated free task. */
  stage: TaskStage | null;
  parentId: string | null;
  priorityIndex: number | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  fromTemplate: boolean;
  overdue: boolean;
  checklist: { done: number; total: number };
  children: { done: number; total: number };
  /** Unfinished tasks this one waits for. */
  blockedBy: number;
  violations: TaskViolation[];
  /** Open delegation offer (A4), if any. */
  offer: { id: string; fromMemberId: string; toMemberId: string; toName: string | null } | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type TaskFilter = {
  statuses?: TaskStatus[];
  ownerMemberId?: string;
  /** Inclusive day range on the due date ("YYYY-MM-DD"). */
  dueFrom?: string;
  dueTo?: string;
  /** Only tasks with a due date before this day that are not done. */
  overdueBefore?: string;
  parentId?: string;
  /** Tasks linked to this priority of the brief (A11). */
  priorityIndex?: number;
  limit?: number;
  offset?: number;
};

const filterSchema = z.object({
  statuses: z.array(taskStatusSchema).max(4).optional(),
  ownerMemberId: idSchema.optional(),
  dueFrom: zDay.optional(),
  dueTo: zDay.optional(),
  overdueBefore: zDay.optional(),
  parentId: idSchema.optional(),
  priorityIndex: z.number().int().min(0).max(2).optional(),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).max(100_000).default(0),
});

/** Stage of a task with no template stage, from how far before the occasion it is due. */
export function stageForDay(dueDay: string | null, occasionDay: string | null): TaskStage | null {
  if (!dueDay || !occasionDay) return null;
  const days = daysBetween(dueDay, occasionDay);
  if (days < 0) return "after";
  if (days <= 7) return "week";
  if (days <= 45) return "m1";
  if (days <= 135) return "m3";
  if (days <= 225) return "m6";
  if (days <= 320) return "m9";
  return "m12";
}

async function memberNames(ctx: Ctx, occasionId: string): Promise<Map<string, string>> {
  const rows = await ctx.db
    .select({
      id: occasionMembers.id,
      label: occasionMembers.customLabel,
      inviteEmail: occasionMembers.inviteEmail,
      email: accounts.email,
      username: accounts.username,
    })
    .from(occasionMembers)
    .leftJoin(accounts, eq(accounts.id, occasionMembers.accountId))
    .where(eq(occasionMembers.occasionId, occasionId));
  return new Map(rows.map((r) => [r.id, r.email ?? r.username ?? r.inviteEmail ?? ""]));
}

async function enrich(ctx: Ctx, occasionId: string, rows: Task[]): Promise<TaskItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [occasion] = await ctx.db
    .select({ timezone: occasions.timezone, startsAt: occasions.startsAt })
    .from(occasions)
    .where(eq(occasions.id, occasionId));
  const tz = occasion?.timezone ?? "Europe/Bucharest";
  const occasionDay = occasion?.startsAt ? instantToDay(occasion.startsAt, tz) : null;
  const today = instantToDay(ctx.now, tz);

  const [names, checks, kids, deps, offers] = await Promise.all([
    memberNames(ctx, occasionId),
    ctx.db
      .select({
        taskId: taskCheckItems.taskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${taskCheckItems.done})::int`,
      })
      .from(taskCheckItems)
      .where(inArray(taskCheckItems.taskId, ids))
      .groupBy(taskCheckItems.taskId),
    ctx.db
      .select({
        parentId: tasks.parentId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.occasionId, occasionId), inArray(tasks.parentId, ids)))
      .groupBy(tasks.parentId),
    ctx.db
      .select({
        taskId: taskDependencies.taskId,
        open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(inArray(taskDependencies.taskId, ids))
      .groupBy(taskDependencies.taskId),
    ctx.db
      .select()
      .from(delegations)
      .where(and(inArray(delegations.taskId, ids), eq(delegations.state, "offered"))),
  ]);
  const checkMap = new Map(checks.map((c) => [c.taskId, c]));
  const kidMap = new Map(kids.map((k) => [k.parentId!, k]));
  const depMap = new Map(deps.map((d) => [d.taskId, d.open]));
  const offerMap = new Map(offers.map((o) => [o.taskId, o]));

  return rows.map((r) => {
    const dueDay = r.dueAt ? instantToDay(r.dueAt, tz) : null;
    const children = kidMap.get(r.id);
    const blockedBy = depMap.get(r.id) ?? 0;
    const openChildren = children ? children.total - children.done : 0;
    const violations: TaskViolation[] = [];
    if (r.status === "done" && blockedBy > 0) violations.push("doneBeforeDependency");
    if (r.status === "done" && openChildren > 0) violations.push("doneWithOpenChildren");
    const offer = offerMap.get(r.id);
    return {
      id: r.id,
      occasionId: r.occasionId,
      title: r.title,
      status: r.status,
      dueAt: r.dueAt,
      dueDay,
      stage: r.stage ?? stageForDay(dueDay, occasionDay),
      parentId: r.parentId,
      priorityIndex: r.priorityIndex,
      ownerMemberId: r.ownerMemberId,
      ownerName: r.ownerMemberId ? (names.get(r.ownerMemberId) ?? null) : null,
      fromTemplate: r.templateTaskKey !== null,
      overdue: r.status !== "done" && dueDay !== null && dueDay < today,
      checklist: { done: checkMap.get(r.id)?.done ?? 0, total: checkMap.get(r.id)?.total ?? 0 },
      children: { done: children?.done ?? 0, total: children?.total ?? 0 },
      blockedBy,
      violations,
      offer: offer
        ? {
            id: offer.id,
            fromMemberId: offer.fromMemberId,
            toMemberId: offer.toMemberId,
            toName: names.get(offer.toMemberId) ?? null,
          }
        : null,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    };
  });
}

export type TaskPage = { rows: TaskItem[]; total: number; hasMore: boolean };

/**
 * THE task query: every view (List, Board, Calendar), the overview, the digest and the
 * exports read tasks through here. Members only. Ordered by due date (undated last), then age.
 */
export async function queryTasks(ctx: Ctx, occasionId: string, filter: TaskFilter = {}): Promise<TaskPage> {
  await requireMember(ctx, occasionId);
  return queryTasksUnchecked(ctx, occasionId, filter);
}

/** Same rows without the access check — for core code that has already checked (digest job). */
export async function queryTasksUnchecked(ctx: Ctx, occasionId: string, filter: TaskFilter = {}): Promise<TaskPage> {
  const f = filterSchema.parse(filter);
  const [occasion] = await ctx.db
    .select({ timezone: occasions.timezone })
    .from(occasions)
    .where(eq(occasions.id, occasionId));
  const tz = occasion?.timezone ?? "Europe/Bucharest";
  const dayStart = (day: string) => new Date(dayToInstant(day, tz).getTime() - 12 * 3_600_000);
  const where = and(
    eq(tasks.occasionId, occasionId),
    f.statuses && f.statuses.length > 0 ? inArray(tasks.status, f.statuses) : undefined,
    f.ownerMemberId ? eq(tasks.ownerMemberId, f.ownerMemberId) : undefined,
    f.parentId ? eq(tasks.parentId, f.parentId) : undefined,
    f.priorityIndex !== undefined ? eq(tasks.priorityIndex, f.priorityIndex) : undefined,
    f.dueFrom ? gte(tasks.dueAt, dayStart(f.dueFrom)) : undefined,
    f.dueTo ? lt(tasks.dueAt, new Date(dayStart(f.dueTo).getTime() + 24 * 3_600_000)) : undefined,
    f.overdueBefore ? and(lt(tasks.dueAt, dayStart(f.overdueBefore)), ne(tasks.status, "done")) : undefined,
  );
  const [rows, count] = await Promise.all([
    ctx.db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt), asc(tasks.id))
      .limit(f.limit)
      .offset(f.offset),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(where),
  ]);
  const total = count[0]?.n ?? 0;
  return { rows: await enrich(ctx, occasionId, rows), total, hasMore: f.offset + rows.length < total };
}

/** How many tasks are in each status (the board's column counts, the overview's progress). */
export async function countTasks(ctx: Ctx, occasionId: string): Promise<Record<TaskStatus, number> & { total: number }> {
  await requireMember(ctx, occasionId);
  const rows = await ctx.db
    .select({ status: tasks.status, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.occasionId, occasionId))
    .groupBy(tasks.status);
  const out = { todo: 0, doing: 0, waiting: 0, done: 0, total: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.total += r.n;
  }
  return out;
}

/* ── The three views: pure groupings of the same rows ───────────────────── */

export type ListGroupKey = "overdue" | TaskStage | "undated";
export type ListGroup = { key: ListGroupKey; tasks: TaskItem[] };
const LIST_ORDER: ListGroupKey[] = ["overdue", ...TASK_STAGES, "undated"];

/** List view: overdue first, then by planning stage, undated last. */
export function toListView(rows: TaskItem[]): ListGroup[] {
  const groups = new Map<ListGroupKey, TaskItem[]>();
  for (const t of rows) {
    const key: ListGroupKey = t.overdue ? "overdue" : (t.stage ?? "undated");
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return LIST_ORDER.filter((k) => groups.has(k)).map((k) => ({ key: k, tasks: groups.get(k)! }));
}

export type BoardColumn = { status: TaskStatus; tasks: TaskItem[] };

/** Board view: one column per status, always all four (an empty column is still a place). */
export function toBoardView(rows: TaskItem[]): BoardColumn[] {
  return TASK_STATUSES.map((status) => ({ status, tasks: rows.filter((t) => t.status === status) }));
}

export type CalendarDay = { day: string; tasks: TaskItem[] };

/** Calendar view: tasks by due day, ascending. Undated tasks are not on a calendar. */
export function toCalendarView(rows: TaskItem[]): CalendarDay[] {
  const days = new Map<string, TaskItem[]>();
  for (const t of rows) {
    if (!t.dueDay) continue;
    const list = days.get(t.dueDay);
    if (list) list.push(t);
    else days.set(t.dueDay, [t]);
  }
  return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, list]) => ({ day, tasks: list }));
}

/* ── Permissions ────────────────────────────────────────────────────────── */

const CONTRIBUTING: OccasionRole[] = ["owner", "pm", "workstream_lead", "contributor"];

export function canAddTasks(member: Member): boolean {
  return CONTRIBUTING.includes(member.role);
}

function canLead(member: Member): boolean {
  return isManager(member) || member.role === "workstream_lead";
}

/** Title, date, structure: managers and leads; a contributor for tasks they own or created. */
export function canEditTask(member: Member, task: Pick<Task, "ownerMemberId" | "createdByMemberId">): boolean {
  if (canLead(member)) return true;
  if (member.role !== "contributor") return false;
  return task.ownerMemberId === member.id || task.createdByMemberId === member.id;
}

/** Status and checklist: whoever may edit, plus the accountable owner whatever their role. */
export function canProgressTask(member: Member, task: Pick<Task, "ownerMemberId" | "createdByMemberId">): boolean {
  return canEditTask(member, task) || task.ownerMemberId === member.id;
}

async function loadTask(ctx: Ctx, taskId: string): Promise<{ task: Task; member: Member }> {
  const id = idSchema.safeParse(taskId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, id.data));
  if (!task) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, task.occasionId);
  return { task, member };
}

async function occasionTz(ctx: Ctx, occasionId: string): Promise<string> {
  const [o] = await ctx.db.select({ tz: occasions.timezone }).from(occasions).where(eq(occasions.id, occasionId));
  return o?.tz ?? "Europe/Bucharest";
}

/* ── Detail ─────────────────────────────────────────────────────────────── */

export type TaskLink = { id: string; title: string; status: TaskStatus };
export type TaskDetail = {
  task: TaskItem;
  notes: string | null;
  checklist: Array<{ id: string; label: string; done: boolean }>;
  parent: TaskLink | null;
  children: TaskLink[];
  dependsOn: Array<TaskLink & { linkId: string }>;
  requiredBy: TaskLink[];
  delegations: Array<{
    id: string;
    state: DelegationState;
    fromMemberId: string;
    fromName: string | null;
    toMemberId: string;
    toName: string | null;
    declineReason: string | null;
    createdAt: Date;
    decidedAt: Date | null;
  }>;
  can: { edit: boolean; progress: boolean; delegate: boolean; decideOffer: boolean };
};

export async function getTask(ctx: Ctx, taskId: string): Promise<TaskDetail> {
  const { task, member } = await loadTask(ctx, taskId);
  const [item] = await enrich(ctx, task.occasionId, [task]);
  const names = await memberNames(ctx, task.occasionId);
  const link = { id: tasks.id, title: tasks.title, status: tasks.status };
  const [checklist, parent, children, dependsOn, requiredBy, history] = await Promise.all([
    ctx.db.select().from(taskCheckItems).where(eq(taskCheckItems.taskId, task.id)).orderBy(asc(taskCheckItems.position), asc(taskCheckItems.createdAt)),
    task.parentId ? ctx.db.select(link).from(tasks).where(eq(tasks.id, task.parentId)) : Promise.resolve([]),
    ctx.db.select(link).from(tasks).where(eq(tasks.parentId, task.id)).orderBy(sql`${tasks.dueAt} asc nulls last`).limit(200),
    ctx.db
      .select({ ...link, linkId: taskDependencies.id })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(eq(taskDependencies.taskId, task.id)),
    ctx.db
      .select(link)
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(eq(taskDependencies.dependsOnTaskId, task.id)),
    ctx.db.select().from(delegations).where(eq(delegations.taskId, task.id)).orderBy(desc(delegations.createdAt)).limit(20),
  ]);
  return {
    task: item!,
    notes: task.notes,
    checklist: checklist.map((c) => ({ id: c.id, label: c.label, done: c.done })),
    parent: parent[0] ?? null,
    children,
    dependsOn,
    requiredBy,
    delegations: history.map((d) => ({
      id: d.id,
      state: d.state,
      fromMemberId: d.fromMemberId,
      fromName: names.get(d.fromMemberId) ?? null,
      toMemberId: d.toMemberId,
      toName: names.get(d.toMemberId) ?? null,
      declineReason: d.declineReason,
      createdAt: d.createdAt,
      decidedAt: d.decidedAt,
    })),
    can: {
      edit: canEditTask(member, task),
      progress: canProgressTask(member, task),
      delegate: canDelegate(member, task),
      decideOffer: item!.offer?.toMemberId === member.id,
    },
  };
}

/** Who may offer a task to someone: managers, leads and its current accountable owner (A4). */
export function canDelegate(member: Member, task: Pick<Task, "ownerMemberId">): boolean {
  return canLead(member) || task.ownerMemberId === member.id;
}

/* ── Create / edit ──────────────────────────────────────────────────────── */

const zDueOn = z.preprocess((v) => (v === "" || v === null ? undefined : v), zDay.optional());
const zPriorityIndex = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().int().min(0).max(2).optional(),
);

export const createTaskInput = z.object({
  occasionId: idSchema,
  title: zText(200),
  dueOn: zDueOn,
  notes: zOptionalText(4000),
  parentId: z.preprocess((v) => (v === "" ? undefined : v), idSchema.optional()),
  priorityIndex: zPriorityIndex,
  /** "me" makes the actor accountable. Anyone else is asked through a delegation offer. */
  owner: z.enum(["me", "none"]).default("none"),
});

export async function createTask(ctx: Ctx, input: z.input<typeof createTaskInput>): Promise<Task> {
  requireWriteCapable(ctx);
  const data = createTaskInput.parse(input);
  const member = await requireMember(ctx, data.occasionId);
  if (!canAddTasks(member)) throw new AppError("FORBIDDEN", "tasks.errors.cannotAdd");
  const tz = await occasionTz(ctx, data.occasionId);
  if (data.parentId) await assertSameOccasion(ctx, data.occasionId, data.parentId);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(tasks)
      .values({
        occasionId: data.occasionId,
        title: data.title,
        notes: data.notes ?? null,
        dueAt: data.dueOn ? dayToInstant(data.dueOn, tz) : null,
        parentId: data.parentId ?? null,
        priorityIndex: data.priorityIndex ?? null,
        ownerMemberId: data.owner === "me" ? member.id : null,
        createdByMemberId: member.id,
        createdAt: tx.now,
      })
      .returning();
    await audit(tx, {
      action: "task.created",
      objectType: "task",
      objectId: row!.id,
      after: { title: row!.title, dueAt: row!.dueAt },
      meta: { occasionId: data.occasionId },
    });
    return row!;
  });
}

async function assertSameOccasion(ctx: Ctx, occasionId: string, otherTaskId: string): Promise<Task> {
  const [other] = await ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, otherTaskId), eq(tasks.occasionId, occasionId)));
  if (!other) throw new AppError("VALIDATION", "tasks.errors.otherTaskMissing");
  return other;
}

export const updateTaskInput = z.object({
  taskId: idSchema,
  title: zText(200).optional(),
  /** "" or null clears the date. Leave undefined to keep it. */
  dueOn: z.union([zDay, z.literal(""), z.null()]).optional(),
  notes: z.union([z.string().trim().max(4000, "common.validation.tooLong"), z.null()]).optional(),
  priorityIndex: z.union([z.coerce.number().int().min(0).max(2), z.literal(""), z.null()]).optional(),
  parentId: z.union([idSchema, z.literal(""), z.null()]).optional(),
  /** "me" = take it, "none" = nobody. Offering to someone else is offerTask (A4). */
  owner: z.enum(["me", "none", "keep"]).default("keep"),
});

export async function updateTask(ctx: Ctx, input: z.input<typeof updateTaskInput>): Promise<Task> {
  requireWriteCapable(ctx);
  const data = updateTaskInput.parse(input);
  const { task, member } = await loadTask(ctx, data.taskId);
  if (!canEditTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  const tz = await occasionTz(ctx, task.occasionId);
  const set: Partial<typeof tasks.$inferInsert> = {};
  if (data.title !== undefined) set.title = data.title;
  if (data.dueOn !== undefined) set.dueAt = data.dueOn ? dayToInstant(data.dueOn, tz) : null;
  if (data.notes !== undefined) set.notes = data.notes ? data.notes : null;
  if (data.priorityIndex !== undefined) {
    set.priorityIndex = data.priorityIndex === "" || data.priorityIndex === null ? null : data.priorityIndex;
  }
  if (data.parentId !== undefined) {
    const parentId = data.parentId || null;
    if (parentId) {
      if (parentId === task.id) throw new AppError("VALIDATION", "tasks.errors.selfParent");
      await assertSameOccasion(ctx, task.occasionId, parentId);
      // walking up from the new parent must never reach this task
      let cursor: string | null = parentId;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === task.id) throw new AppError("VALIDATION", "tasks.errors.parentLoop");
        const [up]: Array<{ parentId: string | null }> = await ctx.db
          .select({ parentId: tasks.parentId })
          .from(tasks)
          .where(eq(tasks.id, cursor));
        cursor = up?.parentId ?? null;
      }
    }
    set.parentId = parentId;
  }
  if (data.owner === "me") set.ownerMemberId = member.id;
  if (data.owner === "none") set.ownerMemberId = null;
  if (Object.keys(set).length === 0) return task;
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db.update(tasks).set(set).where(eq(tasks.id, task.id)).returning();
    if (data.owner !== "keep") {
      // taking or clearing the task ends any offer still waiting for an answer
      await tx.db
        .update(delegations)
        .set({ state: "withdrawn", decidedAt: tx.now })
        .where(and(eq(delegations.taskId, task.id), eq(delegations.state, "offered")));
    }
    await audit(tx, {
      action: "task.updated",
      objectType: "task",
      objectId: task.id,
      before: { title: task.title, dueAt: task.dueAt, ownerMemberId: task.ownerMemberId, parentId: task.parentId },
      after: { title: row!.title, dueAt: row!.dueAt, ownerMemberId: row!.ownerMemberId, parentId: row!.parentId },
      meta: { occasionId: task.occasionId },
    });
    return row!;
  });
}

/**
 * Changes the status — from any view; they all show the same row. Never refused for
 * dependency reasons: the returned `violations` say what is out of order so the screen can
 * point it out (A3).
 */
export async function setTaskStatus(
  ctx: Ctx,
  input: { taskId: string; status: TaskStatus },
): Promise<{ task: Task; violations: TaskViolation[] }> {
  requireWriteCapable(ctx);
  const data = z.object({ taskId: idSchema, status: taskStatusSchema }).parse(input);
  const { task, member } = await loadTask(ctx, data.taskId);
  if (!canProgressTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  if (task.status === data.status) {
    const [item] = await enrich(ctx, task.occasionId, [task]);
    return { task, violations: item!.violations };
  }
  const row = await inTx(ctx, async (tx) => {
    const [updated] = await tx.db
      .update(tasks)
      .set({ status: data.status, completedAt: data.status === "done" ? tx.now : null })
      .where(eq(tasks.id, task.id))
      .returning();
    await audit(tx, {
      action: "task.status_changed",
      objectType: "task",
      objectId: task.id,
      before: { status: task.status },
      after: { status: data.status },
      meta: { occasionId: task.occasionId },
    });
    return updated!;
  });
  const [item] = await enrich(ctx, task.occasionId, [row]);
  return { task: row, violations: item!.violations };
}

/** Removes a task. Its child tasks stay, one level up; its checklist and links go with it. */
export async function deleteTask(ctx: Ctx, input: { taskId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { task, member } = await loadTask(ctx, input.taskId);
  if (!canEditTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  await inTx(ctx, async (tx) => {
    await tx.db.update(tasks).set({ parentId: task.parentId }).where(eq(tasks.parentId, task.id));
    await tx.db.delete(tasks).where(eq(tasks.id, task.id));
    await audit(tx, {
      action: "task.deleted",
      objectType: "task",
      objectId: task.id,
      before: { title: task.title, status: task.status, dueAt: task.dueAt },
      meta: { occasionId: task.occasionId },
    });
  });
}

/* ── Checklist ──────────────────────────────────────────────────────────── */

export async function addCheckItem(ctx: Ctx, input: { taskId: string; label: string }): Promise<{ id: string }> {
  requireWriteCapable(ctx);
  const data = z.object({ taskId: idSchema, label: zText(200) }).parse(input);
  const { task, member } = await loadTask(ctx, data.taskId);
  if (!canProgressTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  const [last] = await ctx.db
    .select({ p: sql<number>`coalesce(max(${taskCheckItems.position}), -1)::int` })
    .from(taskCheckItems)
    .where(eq(taskCheckItems.taskId, task.id));
  const [row] = await ctx.db
    .insert(taskCheckItems)
    .values({ taskId: task.id, label: data.label, position: (last?.p ?? -1) + 1, createdAt: ctx.now })
    .returning({ id: taskCheckItems.id });
  return { id: row!.id };
}

async function loadCheckItem(ctx: Ctx, itemId: string) {
  const [item] = await ctx.db.select().from(taskCheckItems).where(eq(taskCheckItems.id, idSchema.parse(itemId)));
  if (!item) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const { task, member } = await loadTask(ctx, item.taskId);
  if (!canProgressTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  return item;
}

export async function setCheckItem(ctx: Ctx, input: { itemId: string; done: boolean }): Promise<void> {
  requireWriteCapable(ctx);
  const item = await loadCheckItem(ctx, input.itemId);
  await ctx.db.update(taskCheckItems).set({ done: Boolean(input.done) }).where(eq(taskCheckItems.id, item.id));
}

export async function removeCheckItem(ctx: Ctx, input: { itemId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const item = await loadCheckItem(ctx, input.itemId);
  await ctx.db.delete(taskCheckItems).where(eq(taskCheckItems.id, item.id));
}

/* ── Dependencies ───────────────────────────────────────────────────────── */

/** `taskId` waits for `dependsOnTaskId`. Loops are refused (they could never be finished). */
export async function addDependency(ctx: Ctx, input: { taskId: string; dependsOnTaskId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ taskId: idSchema, dependsOnTaskId: idSchema }).parse(input);
  const { task, member } = await loadTask(ctx, data.taskId);
  if (!canEditTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  if (data.dependsOnTaskId === task.id) {
    throw new AppError("VALIDATION", "tasks.errors.selfDependency", {
      fieldErrors: { dependsOnTaskId: ["tasks.errors.selfDependency"] },
    });
  }
  await assertSameOccasion(ctx, task.occasionId, data.dependsOnTaskId);
  // would the other task (directly or not) already wait for this one?
  const seen = new Set<string>();
  let frontier = [data.dependsOnTaskId];
  for (let depth = 0; frontier.length > 0 && depth < 100; depth++) {
    const next = await ctx.db
      .select({ on: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .where(inArray(taskDependencies.taskId, frontier));
    frontier = [];
    for (const n of next) {
      if (n.on === task.id) {
        throw new AppError("VALIDATION", "tasks.errors.dependencyLoop", {
          fieldErrors: { dependsOnTaskId: ["tasks.errors.dependencyLoop"] },
        });
      }
      if (!seen.has(n.on)) {
        seen.add(n.on);
        frontier.push(n.on);
      }
    }
  }
  await ctx.db
    .insert(taskDependencies)
    .values({ taskId: task.id, dependsOnTaskId: data.dependsOnTaskId, createdAt: ctx.now })
    .onConflictDoNothing();
}

export async function removeDependency(ctx: Ctx, input: { taskId: string; dependsOnTaskId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ taskId: idSchema, dependsOnTaskId: idSchema }).parse(input);
  const { task, member } = await loadTask(ctx, data.taskId);
  if (!canEditTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  await ctx.db
    .delete(taskDependencies)
    .where(and(eq(taskDependencies.taskId, task.id), eq(taskDependencies.dependsOnTaskId, data.dependsOnTaskId)));
}

/** Titles for pickers (parent, dependency): open tasks first, capped. */
export async function listTaskOptions(ctx: Ctx, occasionId: string, limit = 300): Promise<TaskLink[]> {
  await requireMember(ctx, occasionId);
  return ctx.db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.occasionId, occasionId))
    .orderBy(sql`(${tasks.status} = 'done') asc`, sql`${tasks.dueAt} asc nulls last`)
    .limit(Math.min(Math.max(limit, 1), 500));
}

/** Members a task can be offered to: people who have joined (active, with an account). */
export async function listAssignableMembers(
  ctx: Ctx,
  occasionId: string,
): Promise<Array<{ id: string; name: string; role: OccasionRole; customLabel: string | null; isSelf: boolean }>> {
  const me = await requireMember(ctx, occasionId);
  const rows = await ctx.db
    .select({ m: occasionMembers, email: accounts.email, username: accounts.username })
    .from(occasionMembers)
    .innerJoin(accounts, eq(accounts.id, occasionMembers.accountId))
    .where(and(eq(occasionMembers.occasionId, occasionId), isNull(occasionMembers.removedAt)))
    .orderBy(asc(occasionMembers.createdAt));
  return rows.map((r) => ({
    id: r.m.id,
    name: r.email ?? r.username ?? "",
    role: r.m.role,
    customLabel: r.m.customLabel,
    isSelf: r.m.id === me.id,
  }));
}

/** For core code that already holds checked task rows (overview, digest). */
export const enrichTasksUnchecked = enrich;
