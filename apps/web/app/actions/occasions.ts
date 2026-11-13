"use server";

import {
  createOccasion,
  proposeMoveDate,
  requestOccasionDeletion,
  undoOccasionDeletion,
  updateOccasion,
} from "@ed/core/occasions";
import { proposeTemplate } from "@ed/core/templates";
import { occasionKindSchema } from "@ed/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Occasion actions (A1, A2, A11, D6). Rules and access checks live in @ed/core; these only
// translate forms into core calls. There is no payment step anywhere (MON1).

const id = z.string().min(1).max(64);
const text = z.string().max(2000).optional();
const dates = {
  dateMode: z.enum(["date", "range", "poll"]),
  startsOn: z.string().max(10).optional(),
  endsOn: z.string().max(10).optional(),
};
const brief = { purpose: text, priority0: text, priority1: text, priority2: text };
const priorities = (i: { priority0?: string; priority1?: string; priority2?: string }) =>
  [i.priority0 ?? "", i.priority1 ?? "", i.priority2 ?? ""];

/** A1: create and activate — free, no payment step. Lands on the new occasion. */
export const createOccasionAction = action(
  z.object({ title: z.string().max(500), kind: occasionKindSchema, ...dates, venueName: text, venueAddress: text, ...brief }),
  async (ctx, input) => {
    const occasion = await createOccasion(ctx, {
      title: input.title,
      kind: input.kind,
      dateMode: input.dateMode,
      startsOn: input.dateMode === "poll" ? undefined : input.startsOn,
      endsOn: input.dateMode === "range" ? input.endsOn : undefined,
      venueName: input.venueName,
      venueAddress: input.venueAddress,
      purpose: input.purpose,
      priorities: priorities(input),
    });
    revalidatePath("/occasions");
    redirect(`/occasions/${occasion.id}`);
  },
);

export const saveOccasionDetails = action(
  z.object({ occasionId: id, title: z.string().max(500), venueName: text, venueAddress: text, purpose: text, priority0: text, priority1: text, priority2: text }),
  async (ctx, input) => {
    await updateOccasion(ctx, {
      occasionId: input.occasionId,
      title: input.title,
      venueName: input.venueName,
      venueAddress: input.venueAddress,
      purpose: input.purpose,
      priorities: priorities(input),
    });
    revalidatePath(`/occasions/${input.occasionId}`, "layout");
    return { saved: true };
  },
);

/** A2: moving the date only ever creates a What-if preview; the proposals page shows it. */
export const proposeMoveDateAction = action(z.object({ occasionId: id, ...dates }), async (ctx, input) => {
  await proposeMoveDate(ctx, {
    occasionId: input.occasionId,
    dateMode: input.dateMode,
    startsOn: input.dateMode === "poll" ? undefined : input.startsOn,
    endsOn: input.dateMode === "range" ? input.endsOn : undefined,
  });
  revalidatePath(`/occasions/${input.occasionId}`, "layout");
  redirect(`/occasions/${input.occasionId}/proposals`);
});

/** A2: applying or re-running a template is previewed as a diff first. */
export const proposeTemplateAction = action(z.object({ occasionId: id, kind: occasionKindSchema }), async (ctx, input) => {
  await proposeTemplate(ctx, input);
  revalidatePath(`/occasions/${input.occasionId}`, "layout");
  redirect(`/occasions/${input.occasionId}/proposals`);
});

/** D6: starts the seven-day undo window (owner, fresh confirmation). */
export const deleteOccasionAction = action(z.object({ occasionId: id }), async (ctx, input) => {
  const res = await requestOccasionDeletion(ctx, input);
  revalidatePath("/occasions", "layout");
  return { undoUntil: res.undoUntil.toISOString() };
});

export const undoDeleteOccasionAction = action(z.object({ occasionId: id }), async (ctx, input) => {
  await undoOccasionDeletion(ctx, input);
  revalidatePath("/occasions", "layout");
  return { restored: true };
});
