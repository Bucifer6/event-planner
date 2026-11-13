"use server";

import { acceptOffer, declineOffer, offerTask, withdrawOffer } from "@ed/core/delegations";
import {
  addCheckItem,
  addDependency,
  createTask,
  deleteTask,
  removeCheckItem,
  removeDependency,
  setCheckItem,
  setTaskStatus,
  updateTask,
} from "@ed/core/tasks";
import { taskStatusSchema } from "@ed/db";
import { zFormBoolean } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Task actions (A3, A4). One record, many views: every action revalidates the whole occasion,
// so List, Board, Calendar and the overview show the change at once.

const id = z.string().min(1).max(64);
const text = z.string().max(5000).optional();
const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");

/**
 * `owner`: "none", "me", or a member id. Making yourself accountable is direct; anyone else is
 * asked through a delegation offer (A4) and becomes the owner only when they accept.
 */
export const addTask = action(
  z.object({
    occasionId: id,
    title: z.string().max(500),
    dueOn: z.string().max(10).optional(),
    notes: text,
    parentId: z.string().max(64).optional(),
    priorityIndex: z.string().max(2).optional(),
    owner: z.string().max(64).optional(),
    /** "detail" opens the new task afterwards (the full form); default stays on the list. */
    then: z.enum(["stay", "detail"]).optional(),
  }),
  async (ctx, input) => {
    const owner = input.owner ?? "none";
    const task = await createTask(ctx, {
      occasionId: input.occasionId,
      title: input.title,
      dueOn: input.dueOn,
      notes: input.notes,
      parentId: input.parentId,
      priorityIndex: input.priorityIndex,
      owner: owner === "me" ? "me" : "none",
    });
    if (owner !== "me" && owner !== "none" && owner !== "") {
      await offerTask(ctx, { taskId: task.id, toMemberId: owner });
    }
    refresh(input.occasionId);
    if (input.then === "detail") redirect(`/occasions/${input.occasionId}/tasks/${task.id}`);
    return { taskId: task.id };
  },
);

export const saveTask = action(
  z.object({
    occasionId: id,
    taskId: id,
    title: z.string().max(500),
    dueOn: z.string().max(10).optional(),
    notes: text,
    priorityIndex: z.string().max(2).optional(),
    parentId: z.string().max(64).optional(),
    owner: z.enum(["keep", "me", "none"]).optional(),
  }),
  async (ctx, input) => {
    await updateTask(ctx, {
      taskId: input.taskId,
      title: input.title,
      dueOn: (input.dueOn ?? "") as "",
      notes: input.notes ?? "",
      priorityIndex: (input.priorityIndex ?? "") as "",
      parentId: input.parentId ?? "",
      owner: input.owner ?? "keep",
    });
    refresh(input.occasionId);
    return { saved: true };
  },
);

/** The tap path for moving a task between board columns — and the same call from every view. */
export const changeTaskStatus = action(z.object({ occasionId: id, taskId: id, status: taskStatusSchema }), async (ctx, input) => {
  const res = await setTaskStatus(ctx, { taskId: input.taskId, status: input.status });
  refresh(input.occasionId);
  return { status: res.task.status, violations: res.violations };
});

export const removeTask = action(z.object({ occasionId: id, taskId: id }), async (ctx, input) => {
  await deleteTask(ctx, { taskId: input.taskId });
  refresh(input.occasionId);
  redirect(`/occasions/${input.occasionId}/tasks`);
});

export const addChecklistItem = action(z.object({ occasionId: id, taskId: id, label: z.string().max(500) }), async (ctx, input) => {
  const res = await addCheckItem(ctx, { taskId: input.taskId, label: input.label });
  refresh(input.occasionId);
  return res;
});

export const toggleChecklistItem = action(z.object({ occasionId: id, itemId: id, done: zFormBoolean }), async (ctx, input) => {
  await setCheckItem(ctx, { itemId: input.itemId, done: input.done });
  refresh(input.occasionId);
  return { done: input.done };
});

export const removeChecklistItem = action(z.object({ occasionId: id, itemId: id }), async (ctx, input) => {
  await removeCheckItem(ctx, { itemId: input.itemId });
  refresh(input.occasionId);
  return { removed: true };
});

export const addTaskDependency = action(z.object({ occasionId: id, taskId: id, dependsOnTaskId: z.string().min(1, "common.validation.required").max(64) }), async (ctx, input) => {
  await addDependency(ctx, { taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId });
  refresh(input.occasionId);
  return { added: true };
});

export const removeTaskDependency = action(z.object({ occasionId: id, taskId: id, dependsOnTaskId: id }), async (ctx, input) => {
  await removeDependency(ctx, { taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId });
  refresh(input.occasionId);
  return { removed: true };
});

/* ── Delegation (A4) ────────────────────────────────────────────────────── */

export const offerTaskAction = action(z.object({ occasionId: id, taskId: id, toMemberId: z.string().min(1, "common.validation.required").max(64) }), async (ctx, input) => {
  const offer = await offerTask(ctx, { taskId: input.taskId, toMemberId: input.toMemberId });
  refresh(input.occasionId);
  return { delegationId: offer.id };
});

export const acceptOfferAction = action(z.object({ occasionId: id, delegationId: id }), async (ctx, input) => {
  await acceptOffer(ctx, { delegationId: input.delegationId });
  refresh(input.occasionId);
  return { state: "accepted" as const };
});

/** Declining needs a short reason; the task goes back to whoever offered it. */
export const declineOfferAction = action(z.object({ occasionId: id, delegationId: id, reason: z.string().max(1000) }), async (ctx, input) => {
  await declineOffer(ctx, { delegationId: input.delegationId, reason: input.reason });
  refresh(input.occasionId);
  return { state: "declined" as const };
});

export const withdrawOfferAction = action(z.object({ occasionId: id, delegationId: id }), async (ctx, input) => {
  await withdrawOffer(ctx, { delegationId: input.delegationId });
  refresh(input.occasionId);
  return { state: "withdrawn" as const };
});
