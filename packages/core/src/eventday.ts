import { and, eq, inArray, isNotNull, occasions, sql, suppliers, taskDayState, tasks, type TaskStatus } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember, isManager } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { listDeliveriesForDayUnchecked, type DeliveryView } from "./deliveries";
import { latestReadinessUnchecked, type ReadinessDecision } from "./readiness";
import { PLANNING_ROLES } from "./suppliers";
import { canEditTask, canProgressTask, createTask, queryTasksUnchecked, setTaskStatus, type TaskItem } from "./tasks";
import { instantToDay, shiftDay, zDay } from "./templates";
import { inTx } from "./tx";

// Event-day view (B7, principle 2: one record, many views).
//
// The day view owns NO status. Its four states are the task statuses of the SAME task rows the
// List / Board / Calendar show:
//
//     Pregătit (ready) = todo · În desfășurare (running) = doing
//     În așteptare (waiting) = waiting · Gata (done) = done
//
// setDayState() is setTaskStatus() — a change made here is the change the Tasks views show, and
// the other way round. What a day adds is only a time of day and a phone number per task
// (task_day_state), and exactly ONE "Acum" row: the running item (earliest), or, when nothing
// runs, the next item that is not done.

export const DAY_STATES = ["ready", "running", "waiting", "done"] as const;
export type DayState = (typeof DAY_STATES)[number];

const TO_STATUS: Record<DayState, TaskStatus> = { ready: "todo", running: "doing", waiting: "waiting", done: "done" };
const FROM_STATUS: Record<TaskStatus, DayState> = { todo: "ready", doing: "running", waiting: "waiting", done: "done" };
export const dayStateOf = (status: TaskStatus): DayState => FROM_STATUS[status];
export const taskStatusOf = (state: DayState): TaskStatus => TO_STATUS[state];

const idSchema = z.string().min(1).max(64);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const zTime = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
  .refine((v) => v === null || TIME_RE.test(v), "eventday.errors.time");
const zPhone = z
  .string()
  .max(40, "common.validation.tooLong")
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
  .refine((v) => v === null || /^[+0-9 ()./-]{3,40}$/.test(v), "eventday.errors.phone");

export type DayItem = {
  taskId: string;
  title: string;
  state: DayState;
  /** "HH:MM" in the occasion's zone; null = no fixed time. */
  startTime: string | null;
  contactPhone: string | null;
  ownerName: string | null;
  /** Exactly one item of the day has this set (none when everything is done). */
  isNow: boolean;
  canProgress: boolean;
  canEdit: boolean;
  completedAt: Date | null;
};

export type DayContact = { key: string; name: string; label: string | null; phone: string };

export type DayView = {
  occasion: { id: string; title: string; timezone: string; venueName: string | null; venueAddress: string | null; status: string };
  /** The day shown ("YYYY-MM-DD"), or null when the occasion has no date yet. */
  day: string | null;
  /** Every day of the occasion (one for a single date, several for a range). */
  days: string[];
  isToday: boolean;
  items: DayItem[];
  nowTaskId: string | null;
  counts: Record<DayState, number>;
  deliveries: DeliveryView[];
  contacts: DayContact[];
  readiness: ReadinessDecision | null;
  canManage: boolean;
  canAdd: boolean;
};

/** Which item is "Acum": the earliest running one, else the next ready one, else a waiting one. */
export function pickNow(items: Array<Pick<DayItem, "taskId" | "state">>): string | null {
  return (
    items.find((i) => i.state === "running")?.taskId ??
    items.find((i) => i.state === "ready")?.taskId ??
    items.find((i) => i.state === "waiting")?.taskId ??
    null
  );
}

function occasionDays(o: { startsAt: Date | null; endsAt: Date | null; timezone: string }): string[] {
  if (!o.startsAt) return [];
  const first = instantToDay(o.startsAt, o.timezone);
  const last = o.endsAt ? instantToDay(o.endsAt, o.timezone) : first;
  const days = [first];
  while (days[days.length - 1]! < last && days.length < 31) days.push(shiftDay(days[days.length - 1]!, { days: 1 }));
  return days;
}

/**
 * The event day: the tasks due on that day (through the one task query), in time order, with
 * the day's deliveries, the phone numbers to call and the standing readiness decision.
 * `day` defaults to today when today is a day of the occasion, else its first day.
 */
export async function getDayView(ctx: Ctx, occasionId: string, opts: { day?: string } = {}): Promise<DayView> {
  const member = await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const days = occasionDays(o);
  const today = instantToDay(ctx.now, o.timezone);
  const asked = zDay.safeParse(opts.day);
  const day = days.length === 0 ? null : asked.success && days.includes(asked.data) ? asked.data : days.includes(today) ? today : days[0]!;

  const base = {
    occasion: { id: o.id, title: o.title, timezone: o.timezone, venueName: o.venueName, venueAddress: o.venueAddress, status: o.status },
    day,
    days,
    isToday: day === today,
    canManage: isManager(member),
    canAdd: true,
  };
  const [readiness, supplierRows] = await Promise.all([
    latestReadinessUnchecked(ctx, occasionId),
    ctx.db
      .select({ id: suppliers.id, name: suppliers.name, label: suppliers.categoryLabel, contact: suppliers.contactName, phone: suppliers.contactPhone })
      .from(suppliers)
      .where(and(eq(suppliers.occasionId, occasionId), isNotNull(suppliers.contactPhone)))
      .orderBy(sql`lower(${suppliers.name})`),
  ]);
  const contacts: DayContact[] = supplierRows.map((s) => ({
    key: `supplier:${s.id}`,
    name: s.contact ? `${s.name} · ${s.contact}` : s.name,
    label: s.label,
    phone: s.phone!,
  }));
  if (!day) {
    return { ...base, items: [], nowTaskId: null, counts: { ready: 0, running: 0, waiting: 0, done: 0 }, deliveries: [], contacts, readiness };
  }

  const [page, dayDeliveries] = await Promise.all([
    queryTasksUnchecked(ctx, occasionId, { dueFrom: day, dueTo: day, limit: 500 }),
    listDeliveriesForDayUnchecked(ctx, occasionId, day, o.timezone),
  ]);
  const ids = page.rows.map((t) => t.id);
  const [extras, creators] = ids.length
    ? await Promise.all([
        ctx.db.select().from(taskDayState).where(inArray(taskDayState.taskId, ids)),
        ctx.db.select({ id: tasks.id, createdByMemberId: tasks.createdByMemberId }).from(tasks).where(inArray(tasks.id, ids)),
      ])
    : [[], []];
  const items: DayItem[] = page.rows
    .map((t: TaskItem) => {
      const x = extras.find((e) => e.taskId === t.id);
      const perm = { ownerMemberId: t.ownerMemberId, createdByMemberId: creators.find((c) => c.id === t.id)?.createdByMemberId ?? null };
      return {
        taskId: t.id,
        title: t.title,
        state: dayStateOf(t.status),
        startTime: x?.startTime ?? null,
        contactPhone: x?.contactPhone ?? null,
        ownerName: t.ownerName,
        isNow: false,
        canProgress: canProgressTask(member, perm),
        canEdit: canEditTask(member, perm),
        completedAt: t.completedAt,
        createdAt: t.createdAt,
      };
    })
    // timed items in time order, then the untimed ones in the order they were added
    .sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.createdAt.getTime() - b.createdAt.getTime();
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .map(({ createdAt: _createdAt, ...rest }) => rest);
  const nowTaskId = pickNow(items);
  for (const i of items) i.isNow = i.taskId === nowTaskId;
  const counts: Record<DayState, number> = { ready: 0, running: 0, waiting: 0, done: 0 };
  for (const i of items) counts[i.state] += 1;
  for (const d of dayDeliveries) {
    if (d.supplierPhone && !contacts.some((c) => c.key === `supplier:${d.supplierId}`)) {
      contacts.push({ key: `supplier:${d.supplierId}`, name: d.supplierName ?? d.title, label: null, phone: d.supplierPhone });
    }
  }
  return { ...base, items, nowTaskId, counts, deliveries: dayDeliveries, contacts, readiness };
}

/**
 * Sets the event-day state of a task — by setting the status of the task row itself
 * (setTaskStatus: same permission, same audit entry). Idempotent: the same state again
 * changes nothing. The Tasks list, board and calendar show the change at once.
 */
export async function setDayState(ctx: Ctx, input: { taskId: string; state: DayState }): Promise<{ taskId: string; state: DayState }> {
  const data = z.object({ taskId: idSchema, state: z.enum(DAY_STATES) }).parse(input);
  const { task } = await setTaskStatus(ctx, { taskId: data.taskId, status: taskStatusOf(data.state) });
  return { taskId: task.id, state: dayStateOf(task.status) };
}

const timeInput = z.object({ taskId: idSchema, startTime: zTime, contactPhone: zPhone });

/** Time of day and phone number of a task on the event day. Who may edit the task may set them. */
export async function setDayDetails(ctx: Ctx, input: z.input<typeof timeInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = timeInput.parse(input);
  const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, data.taskId));
  if (!task) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, task.occasionId, { roles: PLANNING_ROLES });
  if (!canEditTask(member, task)) throw new AppError("FORBIDDEN", "tasks.errors.cannotEdit");
  await inTx(ctx, async (tx) => {
    await tx.db
      .insert(taskDayState)
      .values({ taskId: task.id, occasionId: task.occasionId, startTime: data.startTime, contactPhone: data.contactPhone })
      .onConflictDoUpdate({ target: taskDayState.taskId, set: { startTime: data.startTime, contactPhone: data.contactPhone, updatedAt: tx.now } });
    await audit(tx, {
      action: "task.day_details_set",
      objectType: "task",
      objectId: task.id,
      after: { startTime: data.startTime },
      meta: { occasionId: task.occasionId },
    });
  });
}

const addInput = z.object({
  occasionId: idSchema,
  day: zDay,
  title: z.string().trim().min(1, "eventday.errors.titleRequired").max(200, "common.validation.tooLong"),
  startTime: zTime,
  contactPhone: zPhone,
});

/**
 * Adds a moment to the day's programme: an ordinary task due that day (createTask) with its
 * time of day. It appears in the Tasks views like any other task.
 */
export async function addDayItem(ctx: Ctx, input: z.input<typeof addInput>): Promise<{ taskId: string }> {
  requireWriteCapable(ctx);
  const data = addInput.parse(input);
  await requireMember(ctx, data.occasionId, { roles: PLANNING_ROLES });
  return inTx(ctx, async (tx) => {
    const task = await createTask(tx, { occasionId: data.occasionId, title: data.title, dueOn: data.day });
    if (data.startTime || data.contactPhone) {
      await tx.db
        .insert(taskDayState)
        .values({ taskId: task.id, occasionId: data.occasionId, startTime: data.startTime, contactPhone: data.contactPhone });
    }
    return { taskId: task.id };
  });
}
