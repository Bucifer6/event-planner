"use server";

import { proposeCancel, proposeClose, proposePostpone, saveLesson } from "@ed/core/closeout";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Occasion lifecycle actions (B9, B10). Cancel, postpone and close only ever create a What-if
// preview (principle 3); the proposals page shows it and nothing happens until it is confirmed.

const id = z.string().min(1).max(64);
const toProposals = (occasionId: string): never => {
  revalidatePath(`/occasions/${occasionId}`, "layout");
  redirect(`/occasions/${occasionId}/proposals`);
};

export const proposeCancelAction = action(z.object({ occasionId: id }), async (ctx, input) => {
  await proposeCancel(ctx, input);
  toProposals(input.occasionId);
});

export const proposePostponeAction = action(z.object({ occasionId: id, startsOn: z.string().max(10) }), async (ctx, input) => {
  await proposePostpone(ctx, input);
  toProposals(input.occasionId);
});

export const proposeCloseAction = action(z.object({ occasionId: id }), async (ctx, input) => {
  await proposeClose(ctx, input);
  toProposals(input.occasionId);
});

/** Lessons are saved to the signed-in account (B10), one note per occasion. */
export const saveLessonAction = action(z.object({ occasionId: id, body: z.string().max(5000) }), async (ctx, input) => {
  await saveLesson(ctx, input);
  revalidatePath(`/occasions/${input.occasionId}`, "layout");
  return { saved: true };
});
