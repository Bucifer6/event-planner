import { zId, zOptionalText, zText } from "@ed/shared/zod";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { offerTask } from "./delegations";
import { assertOccasionWritable } from "./lifecycle";
import { canAddTasks, createTask, listAssignableMembers } from "./tasks";
import { zDay } from "./templates";
import { createPreview, registerWhatIf, type WhatIfDeltaRow, type WhatIfPreview } from "./whatif";

// What-if kind "tasks.proposeList" (MCP tool propose_task_list, MCP3, SEC15): a list of new
// tasks proposed for an occasion. Nothing exists until a person who may add tasks confirms the
// preview in the app; then each task is created through createTask — the same function, the
// same rules and the same audit trail as a task typed by hand.

export const PROPOSE_TASK_LIST_KIND = "tasks.proposeList";
export const MAX_PROPOSED_TASKS = 100;

const proposedTask = z.object({
  title: zText(200),
  /** Calendar day "YYYY-MM-DD" in the occasion's time zone. */
  dueOn: zDay.optional(),
  notes: zOptionalText(4000),
  /** A member who has joined the team (ids from listAssignableMembers). */
  ownerMemberId: zId.optional(),
});
const proposeListInput = z.object({ tasks: z.array(proposedTask).min(1).max(MAX_PROPOSED_TASKS) });
export type ProposeTaskListInput = z.input<typeof proposeListInput>;

/** SEC15: proposing is bounded by the right to ADD tasks — a guest- or supplier-role member cannot. */
async function requireTaskWriter(ctx: Ctx, occasionId: string | null) {
  const member = await requireMember(ctx, occasionId ?? "");
  if (!canAddTasks(member)) throw new AppError("FORBIDDEN", "tasks.errors.cannotAdd");
  return member;
}

const day = (d: string) => d.split("-").reverse().join(".");

registerWhatIf<z.output<typeof proposeListInput>>(PROPOSE_TASK_LIST_KIND, {
  input: proposeListInput,
  authorize: async (ctx, subject, action) => {
    if (action === "read") await requireMember(ctx, subject.occasionId ?? "");
    else await requireTaskWriter(ctx, subject.occasionId);
  },
  compute: async (ctx, input, subject) => {
    const members = await listAssignableMembers(ctx, subject.occasionId!);
    const names = new Map(members.map((m) => [m.id, m.name]));
    const delta: WhatIfDeltaRow[] = input.tasks.map((t, i) => {
      if (t.ownerMemberId && !names.has(t.ownerMemberId)) {
        throw new AppError("VALIDATION", "tasks.errors.offerTargetMissing");
      }
      return {
        key: `task:${i}`,
        what: t.title,
        kindLabelKey: "mcp.whatif.taskList.newTask",
        before: undefined,
        after: t.dueOn ? { key: "mcp.whatif.taskList.due", params: { date: day(t.dueOn) } } : { key: "mcp.whatif.taskList.noDate" },
        ...(t.ownerMemberId ? { noteKey: "mcp.whatif.taskList.owner", noteParams: { name: names.get(t.ownerMemberId) ?? "" } } : {}),
      };
    });
    return { title: { key: "mcp.whatif.taskList.title", params: { count: input.tasks.length } }, delta };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId!;
    const member = await requireTaskWriter(tx, occasionId);
    await assertOccasionWritable(tx, occasionId);
    let offered = 0;
    for (const t of preview.input.tasks) {
      const mine = t.ownerMemberId === member.id;
      const task = await createTask(tx, { occasionId, title: t.title, dueOn: t.dueOn, notes: t.notes, owner: mine ? "me" : "none" });
      if (t.ownerMemberId && !mine) {
        // A4: nobody is made accountable without being asked — the proposed owner gets the
        // usual offer. If the confirming person may not delegate, or the member has left
        // since, the task is still created, without an owner.
        try {
          await offerTask(tx, { taskId: task.id, toMemberId: t.ownerMemberId });
          offered++;
        } catch (e) {
          if (!(e instanceof AppError) || (e.code !== "FORBIDDEN" && e.code !== "VALIDATION")) throw e;
        }
      }
    }
    await audit(tx, {
      action: "tasks.list_applied",
      objectType: "occasion",
      objectId: occasionId,
      meta: { tasks: preview.input.tasks.length, offered, proposedByKind: preview.proposedByKind, previewId: preview.id },
    });
  },
});

/** A What-if preview of adding these tasks. For members who may add tasks; applies nothing. */
export async function proposeTaskList(ctx: Ctx, input: { occasionId: string; tasks: ProposeTaskListInput["tasks"]; source?: string }): Promise<WhatIfPreview> {
  const occasionId = zId.parse(input.occasionId);
  await requireTaskWriter(ctx, occasionId);
  return createPreview(ctx, {
    kind: PROPOSE_TASK_LIST_KIND,
    occasionId,
    subjectType: "occasion",
    subjectId: occasionId,
    input: { tasks: input.tasks },
    source: input.source,
  });
}
