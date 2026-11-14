import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";
import { occasionMembers, occasions } from "./occasions";

// Tasks, checklists, dependencies, delegations and the digest log (A2–A4, A10).
// A task exists once (principle 2): List, Board and Calendar are queries over these rows.

export const TASK_STATUSES = ["todo", "doing", "waiting", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);

/** Planning stage a task belongs to (template stages; free tasks may have none). */
export const TASK_STAGES = ["m12", "m9", "m6", "m3", "m1", "week", "after"] as const;
export type TaskStage = (typeof TASK_STAGES)[number];
export const taskStageSchema = z.enum(TASK_STAGES);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    /** The one accountable member. NULL = nobody yet. */
    ownerMemberId: ref("owner_member_id").references(() => occasionMembers.id, {
      onDelete: "set null",
    }),
    /** Due day, stored as 12:00 local time of that day in the occasion's zone. NULL = no date. */
    dueAt: timestamptz("due_at"),
    stage: text("stage").$type<TaskStage>(),
    /** Child task of this task. */
    parentId: ref("parent_id"),
    /** Index into occasions.priorities (A11): the priority this task serves. */
    priorityIndex: integer("priority_index"),
    /** Set for tasks created from a template: stable key, so a re-run never duplicates. */
    templateTaskKey: text("template_task_key"),
    /** Offsets the template scheduled this task with (relative to the occasion date). */
    offsetMonths: integer("offset_months"),
    offsetDays: integer("offset_days"),
    createdByMemberId: ref("created_by_member_id"),
    completedAt: timestamptz("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_occasion_status_idx").on(t.occasionId, t.status, t.dueAt),
    index("tasks_occasion_due_idx").on(t.occasionId, t.dueAt),
    index("tasks_owner_idx").on(t.ownerMemberId),
    index("tasks_parent_idx").on(t.parentId),
    uniqueIndex("tasks_template_key_uq")
      .on(t.occasionId, t.templateTaskKey)
      .where(sql`${t.templateTaskKey} is not null`),
  ],
);

export const taskCheckItems = pgTable(
  "task_check_items",
  {
    id: id(),
    taskId: ref("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("task_check_items_task_idx").on(t.taskId, t.position)],
);

/** `taskId` cannot sensibly be finished before `dependsOnTaskId` is. */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: id(),
    taskId: ref("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: ref("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("task_dependencies_pair_uq").on(t.taskId, t.dependsOnTaskId),
    index("task_dependencies_on_idx").on(t.dependsOnTaskId),
  ],
);

export const DELEGATION_STATES = ["offered", "accepted", "declined", "withdrawn"] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];
export const delegationStateSchema = z.enum(DELEGATION_STATES);

/** A4: a task is offered, then accepted or declined (declining returns it to the delegator). */
export const delegations = pgTable(
  "delegations",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    taskId: ref("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    fromMemberId: ref("from_member_id").notNull(),
    toMemberId: ref("to_member_id").notNull(),
    state: text("state").$type<DelegationState>().notNull().default("offered"),
    declineReason: text("decline_reason"),
    createdAt: createdAt(),
    decidedAt: timestamptz("decided_at"),
  },
  (t) => [
    index("delegations_occasion_state_idx").on(t.occasionId, t.state),
    index("delegations_to_idx").on(t.toMemberId, t.state),
    // one open offer per task
    uniqueIndex("delegations_open_task_uq").on(t.taskId).where(sql`${t.state} = 'offered'`),
  ],
);

/** A10: one digest per member per Bucharest day — the unique index is the once-a-day gate. */
export const reminderDigests = pgTable(
  "reminder_digests",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    memberId: ref("member_id").notNull(),
    /** "2026-06-14" (Europe/Bucharest). */
    dateKey: text("date_key").notNull(),
    /** sent | suppressed | empty (nothing to report) | no_email | capped */
    outcome: text("outcome").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reminder_digests_member_day_uq").on(t.memberId, t.dateKey)],
);
