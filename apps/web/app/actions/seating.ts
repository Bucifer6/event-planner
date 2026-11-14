"use server";

import {
  addDefaultStages,
  addFixture,
  addMealStage,
  addTable,
  assignSeats,
  moveItem,
  moveMealStage,
  publishSeating,
  removeItem,
  removeMealStage,
  renameMealStage,
  setSeatNumber,
  setStageItem,
  unassignSeats,
  unpublishSeating,
  updateItem,
} from "@ed/core/seating";
import { TABLE_SHAPE_VALUES } from "@ed/core/spacemodel";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Seating editor actions (C-01, C-02, C-08). The editor calls them with plain objects in
// millimetres; every one is idempotent, so a retried autosave never doubles anything.

const mm = z.number().int();
const optMm = mm.nullable().optional();
const group = z.object({ householdId: zId, kind: z.enum(["extra", "children"]) });
const custom = z.object({ name: z.string().max(200), shape: z.enum(TABLE_SHAPE_VALUES), diameterMm: optMm, widthMm: optMm, lengthMm: optMm, seats: z.number().int() });
const done = (occasionId: string) => revalidatePath(`/occasions/${occasionId}/seating`);

export const addTableAction = action(
  z.object({ occasionId: zId, id: zId.optional(), tableTypeId: z.string().max(40).optional(), custom: custom.optional(), label: z.string().max(24).optional(), x: mm.optional(), y: mm.optional() }),
  async (ctx, input) => {
    const item = await addTable(ctx, input);
    done(input.occasionId);
    return item;
  },
);

export const addFixtureAction = action(z.object({ occasionId: zId, id: zId.optional(), name: z.string().max(200), widthMm: optMm, lengthMm: optMm, x: mm.optional(), y: mm.optional() }), async (ctx, input) => {
  const item = await addFixture(ctx, input);
  done(input.occasionId);
  return item;
});

export const moveItemAction = action(z.object({ itemId: zId, x: mm, y: mm, rotation: mm.optional(), version: z.number().int().optional() }), async (ctx, input) => moveItem(ctx, input));

export const updateItemAction = action(z.object({ itemId: zId, label: z.string().max(60).optional(), custom: custom.partial().optional(), version: z.number().int().optional() }), async (ctx, input) => updateItem(ctx, input));

export const removeItemAction = action(z.object({ occasionId: zId, itemId: zId }), async (ctx, input) => {
  await removeItem(ctx, input);
  done(input.occasionId);
  return { removed: true };
});

export const setStageItemAction = action(z.object({ stageId: zId, itemId: zId, present: z.boolean(), x: mm.nullable().optional(), y: mm.nullable().optional(), rotation: mm.nullable().optional() }), async (ctx, input) => {
  await setStageItem(ctx, input);
  return { saved: true };
});

export const addMealStageAction = action(z.object({ occasionId: zId, name: z.string().max(200) }), async (ctx, input) => {
  const stage = await addMealStage(ctx, input);
  done(input.occasionId);
  return { id: stage.id };
});

export const addDefaultStagesAction = action(z.object({ occasionId: zId }), async (ctx, input) => {
  await addDefaultStages(ctx, input);
  done(input.occasionId);
  return { added: true };
});

export const renameMealStageAction = action(z.object({ occasionId: zId, stageId: zId, name: z.string().max(200) }), async (ctx, input) => {
  await renameMealStage(ctx, input);
  done(input.occasionId);
  return { saved: true };
});

export const moveMealStageAction = action(z.object({ occasionId: zId, stageId: zId, direction: z.enum(["up", "down"]) }), async (ctx, input) => {
  await moveMealStage(ctx, input);
  done(input.occasionId);
  return { saved: true };
});

export const removeMealStageAction = action(z.object({ occasionId: zId, stageId: zId }), async (ctx, input) => {
  await removeMealStage(ctx, input);
  done(input.occasionId);
  return { removed: true };
});

export const assignSeatsAction = action(z.object({ occasionId: zId, tableItemId: zId, guestIds: z.array(zId).default([]), groups: z.array(group).default([]) }), async (ctx, input) => {
  const res = await assignSeats(ctx, input);
  done(input.occasionId);
  return res;
});

export const unassignSeatsAction = action(z.object({ occasionId: zId, guestIds: z.array(zId).default([]), groups: z.array(group).default([]) }), async (ctx, input) => {
  await unassignSeats(ctx, input);
  done(input.occasionId);
  return { removed: true };
});

export const setSeatNumberAction = action(z.object({ occasionId: zId, guestId: zId, seatNo: z.number().int().nullable() }), async (ctx, input) => {
  await setSeatNumber(ctx, input);
  done(input.occasionId);
  return { saved: true };
});

export const publishSeatingAction = action(z.object({ occasionId: zId }), async (ctx, input) => {
  await publishSeating(ctx, input);
  done(input.occasionId);
  return { published: true };
});

export const unpublishSeatingAction = action(z.object({ occasionId: zId }), async (ctx, input) => {
  await unpublishSeating(ctx, input);
  done(input.occasionId);
  return { published: false };
});
