"use server";

import { PROMOTION_TEXT_KEYS, savePromotionTexts } from "@ed/core/promotion";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Promotion exports (C-12): the only write is keeping the planner's own wording. Nothing here
// posts, sends or spends; the assets are GET downloads (promotion/download/[asset]).

const text = z.object({ value: z.string().max(2000), aiOriginal: z.string().max(2000).nullish() });

export const savePromotionTextsAction = action(z.object({ occasionId: zId, texts: z.partialRecord(z.enum(PROMOTION_TEXT_KEYS), text) }), async (ctx, input) => {
  await savePromotionTexts(ctx, input);
  revalidatePath(`/occasions/${input.occasionId}/promotion`);
  return { saved: true };
});
