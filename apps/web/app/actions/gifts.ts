"use server";

import { deleteGiftEstimate, estimateGift, getGiftGuide, GIFT_DISTANCES, GIFT_RELATIONSHIPS, GIFT_VENUES, resetGiftGuide, saveGiftEstimate, saveGiftGuide, type GiftGuideTable } from "@ed/core/gifts";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Gift estimator (C-11). Everything here acts on the caller's OWN account only.

const path = (occasionId: string) => `/occasions/${occasionId}/gifts`;
const answers = {
  relationship: z.enum(GIFT_RELATIONSHIPS, "common.validation.required"),
  distance: z.enum(GIFT_DISTANCES, "common.validation.required"),
  venue: z.enum(GIFT_VENUES, "common.validation.required"),
  adults: z.coerce.number().int().min(1).max(12),
};

/** The range for these answers, from the caller's own table. Stores nothing. */
export const estimateGiftAction = action(z.object(answers), async (ctx, input) => {
  const { guide } = await getGiftGuide(ctx);
  return { ...estimateGift(guide, input), answers: input };
});

export const saveGiftEstimateAction = action(
  z.object({ occasionId: zId, ...answers, householdId: z.preprocess((v) => (v === "" ? null : v), z.string().max(64).nullish()), label: z.string().trim().max(80).optional() }),
  async (ctx, input) => {
    const res = await saveGiftEstimate(ctx, input);
    revalidatePath(path(input.occasionId));
    return { id: res.id };
  },
);

export const deleteGiftEstimateAction = action(z.object({ occasionId: zId, id: z.string().min(1).max(64) }), async (ctx, input) => {
  await deleteGiftEstimate(ctx, { id: input.id });
  revalidatePath(path(input.occasionId));
  return { removed: true };
});

const lei = z.preprocess((v) => (typeof v === "string" ? v.trim().replace(/\s|\./g, "") : v), z.coerce.number("gifts.errors.number").int("gifts.errors.number").min(0, "gifts.errors.number").max(100_000, "common.validation.tooBig"));
const pct = z.coerce.number("gifts.errors.number").int("gifts.errors.number").min(10, "common.validation.tooSmall").max(400, "common.validation.tooBig");
const guideForm = z.object({
  occasionId: zId,
  ...Object.fromEntries(GIFT_VENUES.flatMap((v) => [[`low_${v}`, lei], [`high_${v}`, lei]])),
  ...Object.fromEntries(GIFT_RELATIONSHIPS.map((r) => [`rel_${r}`, pct])),
  ...Object.fromEntries(GIFT_DISTANCES.map((d) => [`dist_${d}`, pct])),
});

export const saveGiftGuideAction = action(guideForm, async (ctx, raw) => {
  const input = raw as Record<string, number> & { occasionId: string };
  const guide: GiftGuideTable = {
    currency: "RON",
    base: Object.fromEntries(GIFT_VENUES.map((v) => [v, { lowMinor: input[`low_${v}`]! * 100, highMinor: input[`high_${v}`]! * 100 }])) as GiftGuideTable["base"],
    relationshipPct: Object.fromEntries(GIFT_RELATIONSHIPS.map((r) => [r, input[`rel_${r}`]!])) as GiftGuideTable["relationshipPct"],
    distancePct: Object.fromEntries(GIFT_DISTANCES.map((d) => [d, input[`dist_${d}`]!])) as GiftGuideTable["distancePct"],
  };
  for (const v of GIFT_VENUES) {
    if (guide.base[v].highMinor < guide.base[v].lowMinor) {
      const { AppError } = await import("@ed/shared/errors");
      throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { [`high_${v}`]: ["gifts.errors.rangeOrder"] } });
    }
  }
  await saveGiftGuide(ctx, guide);
  revalidatePath(path(input.occasionId));
  return { saved: true };
});

export const resetGiftGuideAction = action(z.object({ occasionId: zId }), async (ctx, input) => {
  await resetGiftGuide(ctx);
  revalidatePath(path(input.occasionId));
  return { reset: true };
});
