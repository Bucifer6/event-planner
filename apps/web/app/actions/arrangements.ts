"use server";

import { archiveArrangementDesign, ARRANGEMENT_FORMS, requestArrangementQuote, saveArrangementDesign } from "@ed/core/arrangements";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Flower arrangement designer (C-13). Saving makes a new immutable version; "Cere ofertă"
// goes through the enquiry flow of @ed/core/enquiries (F5) — same limits, same consent.

const path = (occasionId: string) => `/occasions/${occasionId}/flowers`;

export const saveArrangementAction = action(
  z.object({
    occasionId: zId,
    designId: zId.nullish(),
    name: z.string().trim().min(1, "common.validation.required").max(80, "common.validation.tooLong"),
    form: z.enum(ARRANGEMENT_FORMS),
    items: z.array(z.object({ catalogueItemId: zId, stems: z.number().int().min(1).max(500), colour: z.string().max(24).nullish() })).max(24),
    note: z.string().trim().max(600, "common.validation.tooLong").nullish(),
  }),
  async (ctx, input) => {
    const res = await saveArrangementDesign(ctx, input);
    revalidatePath(path(input.occasionId));
    return res;
  },
);

export const archiveArrangementAction = action(z.object({ occasionId: zId, designId: zId }), async (ctx, input) => {
  await archiveArrangementDesign(ctx, { designId: input.designId });
  revalidatePath(path(input.occasionId));
  return { archived: true };
});

export const requestArrangementQuoteAction = action(
  z.object({
    occasionId: zId,
    designId: zId,
    listingId: zId,
    message: z.string().trim().max(4000, "common.validation.tooLong").default(""),
    shareEmail: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).optional(),
    idempotencyKey: z.string().min(8).max(100),
  }),
  async (ctx, input) => {
    const { occasionId, ...rest } = input;
    const res = await requestArrangementQuote(ctx, rest);
    revalidatePath(path(occasionId));
    return res;
  },
);
