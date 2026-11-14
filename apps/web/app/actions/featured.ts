"use server";

import { createFeaturedSlot, endFeaturedSlot } from "@ed/core/featured";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";

// Featured slots placed by staff in TEST mode (W6, P13). Both refuse while monetization is
// off (MON5): Featured does not exist then.

const PATH = "/console/commercial";

export const createFeaturedSlotAction = staffAction(
  z.object({
    listingId: z.string().trim().min(1, "common.validation.required").max(64),
    categoryId: z.string().min(1, "common.validation.required").max(64),
    countyCode: z.string().max(3).optional(),
    days: z.string().regex(/^\d{1,3}$/, "common.validation.invalid").optional(),
  }),
  async (ctx, input) => {
    await createFeaturedSlot(ctx, { listingId: input.listingId, categoryId: input.categoryId, countyCode: input.countyCode || null, days: input.days ? Number(input.days) : undefined });
    revalidatePath(PATH);
    return { created: true };
  },
);

export const endFeaturedSlotAction = staffAction(z.object({ slotId: z.string().min(1).max(64) }), async (ctx, input) => {
  await endFeaturedSlot(ctx, input);
  revalidatePath(PATH);
  return { ended: true };
});
