"use server";

import { includeProgrammeInBriefing, removeProgrammeItem, saveCueList, saveProgrammeItem, setProgrammeVisibility } from "@ed/core/programme";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Programme, cue lists and performer briefings (C-03). All rules live in @ed/core/programme.

const path = (occasionId: string) => `/occasions/${occasionId}/programme`;
const many = z.union([z.string().max(64), z.array(z.string().max(64)).max(2000)]).optional();

export const saveProgrammeItemAction = action(
  z.object({
    occasionId: zId,
    itemId: z.string().max(64).optional(),
    title: z.string().max(400),
    kind: z.string().max(20).optional(),
    time: z.string().max(8),
    nextDay: z.string().max(5).optional(),
    durationMin: z.string().max(6).optional(),
    place: z.string().max(400).optional(),
    visibleToGuests: z.string().max(5).optional(),
    concerns: z.string().max(5).optional(),
    householdIds: many,
    supplierId: z.string().max(64).optional(),
    notes: z.string().max(4000).optional(),
  }),
  async (ctx, input) => {
    const res = await saveProgrammeItem(ctx, {
      ...input,
      kind: (input.kind || "moment") as never,
      concerns: input.concerns === "some" ? "some" : "all",
    });
    revalidatePath(path(input.occasionId));
    return res;
  },
);

export const removeProgrammeItemAction = action(z.object({ occasionId: zId, itemId: zId }), async (ctx, input) => {
  const res = await removeProgrammeItem(ctx, { itemId: input.itemId });
  revalidatePath(path(input.occasionId));
  return res;
});

export const setProgrammeVisibilityAction = action(z.object({ occasionId: zId, itemId: zId, visible: z.enum(["true", "false"]) }), async (ctx, input) => {
  const res = await setProgrammeVisibility(ctx, { itemId: input.itemId, visible: input.visible === "true" });
  revalidatePath(path(input.occasionId));
  return res;
});

const cueRow = z.object({ offsetMin: z.union([z.string().max(8), z.number()]), instruction: z.string().max(2000), who: z.string().max(400).nullish() });

/** `cues` arrives as a JSON string (the editor keeps its rows in state so nothing typed is lost). */
export const saveCueListAction = action(z.object({ occasionId: zId, itemId: zId, cues: z.string().max(100_000) }), async (ctx, input) => {
  let rows: unknown;
  try {
    rows = JSON.parse(input.cues);
  } catch {
    rows = null;
  }
  const cues = z.array(cueRow).max(200).parse(rows);
  const res = await saveCueList(ctx, { itemId: input.itemId, cues });
  revalidatePath(path(input.occasionId));
  return res;
});

export const includeProgrammeInBriefingAction = action(z.object({ occasionId: zId, supplierId: zId }), async (ctx, input) => {
  const res = await includeProgrammeInBriefing(ctx, input);
  revalidatePath(path(input.occasionId));
  revalidatePath(`/occasions/${input.occasionId}/suppliers/${input.supplierId}`);
  return res;
});
