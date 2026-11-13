"use server";

import { addDayItem, setDayDetails, setDayState } from "@ed/core/eventday";
import { recordReadinessDecision, type ReadinessEvidenceInput } from "@ed/core/readiness";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Event-day actions (B7, B8). A day state IS the task's status: setDayStateAction changes the
// same task row the Tasks views show, so those views are refreshed too.

const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");
const text = (max: number) => z.string().max(max).optional();

/** Idempotent: tapping twice, or two people tapping the same state, changes nothing more. */
export const setDayStateAction = action(
  z.object({ occasionId: zId, taskId: zId, state: z.enum(["ready", "running", "waiting", "done"]) }),
  async (ctx, input) => {
    const res = await setDayState(ctx, { taskId: input.taskId, state: input.state });
    refresh(input.occasionId);
    return res;
  },
);

export const addDayItemAction = action(
  z.object({ occasionId: zId, day: z.string().max(10), title: z.string().max(240), startTime: text(5), contactPhone: text(60) }),
  async (ctx, input) => {
    const res = await addDayItem(ctx, input);
    refresh(input.occasionId);
    return res;
  },
);

export const setDayDetailsAction = action(
  z.object({ occasionId: zId, taskId: zId, startTime: text(5), contactPhone: text(60) }),
  async (ctx, input) => {
    await setDayDetails(ctx, { taskId: input.taskId, startTime: input.startTime, contactPhone: input.contactPhone });
    refresh(input.occasionId);
    return { saved: true };
  },
);

/**
 * Hold / Proceed / Proceed with conditions. Evidence arrives as repeated `evidence` values
 * ("task:<id>", "delivery:<id>", "briefing_ack:<id>") plus an optional note with a link.
 * Core refuses a decision without at least one piece of evidence.
 */
export const recordReadinessAction = action(
  z.object({
    occasionId: zId,
    decision: z.enum(["hold", "proceed", "conditions"]).optional(),
    conditions: text(1200),
    note: text(1200),
    evidence: z.union([z.string().max(100), z.array(z.string().max(100)).max(40)]).optional(),
    noteLabel: text(400),
    noteUrl: text(600),
  }),
  async (ctx, input) => {
    const refs = input.evidence === undefined ? [] : Array.isArray(input.evidence) ? input.evidence : [input.evidence];
    const evidence: ReadinessEvidenceInput[] = [];
    for (const ref of refs) {
      const [type, refId] = ref.split(":");
      if ((type === "task" || type === "delivery" || type === "briefing_ack") && refId) evidence.push({ type, refId });
    }
    const label = (input.noteLabel ?? "").trim();
    const url = (input.noteUrl ?? "").trim();
    if (label !== "" || url !== "") evidence.push({ type: "note", label, url });
    const res = await recordReadinessDecision(ctx, {
      occasionId: input.occasionId,
      decision: input.decision as "hold",
      conditions: input.conditions,
      note: input.note,
      evidence,
    });
    refresh(input.occasionId);
    return res;
  },
);
