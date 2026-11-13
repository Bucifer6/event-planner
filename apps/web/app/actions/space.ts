"use server";

import { attachVenueSpace, createOwnSpace, proposeDrawingUpdate, removeSpaceModel, updateSpaceModel } from "@ed/core/seating";
import { parseMetres } from "@ed/core/spacemodel";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// The occasion's space model (P-06 V4): take the venue's plan, or describe a simple own space.

const zMetres = z
  .string()
  .max(20)
  .optional()
  .transform((v, ctx) => {
    const mm = parseMetres(v);
    if (mm !== null && (Number.isNaN(mm) || mm <= 0)) {
      ctx.addIssue({ code: "custom", message: "space.errors.measure" });
      return z.NEVER;
    }
    return mm;
  });

const refresh = (occasionId: string) => {
  revalidatePath(`/occasions/${occasionId}/space`);
  revalidatePath(`/occasions/${occasionId}/seating`);
};

export const attachVenueSpaceAction = action(z.object({ occasionId: zId, spaceId: zId }), async (ctx, input) => {
  await attachVenueSpace(ctx, input);
  refresh(input.occasionId);
  return { attached: true };
});

export const createOwnSpaceAction = action(z.object({ occasionId: zId, name: z.string().max(200), widthMm: zMetres, lengthMm: zMetres }), async (ctx, input) => {
  await createOwnSpace(ctx, input);
  refresh(input.occasionId);
  return { created: true };
});

export const updateOwnSpaceAction = action(
  z.object({
    occasionId: zId,
    name: z.string().max(200).optional(),
    widthMm: zMetres,
    lengthMm: zMetres,
    aisleCm: z
      .string()
      .max(6)
      .optional()
      .transform((v, ctx) => {
        const s = (v ?? "").trim();
        if (!s) return undefined;
        if (!/^\d+$/.test(s) || Number(s) > 500) {
          ctx.addIssue({ code: "custom", message: "common.validation.invalid" });
          return z.NEVER;
        }
        return Number(s) * 10;
      }),
  }),
  async (ctx, input) => {
    await updateSpaceModel(ctx, { occasionId: input.occasionId, name: input.name || undefined, widthMm: input.widthMm, lengthMm: input.lengthMm, aisleMm: input.aisleCm });
    refresh(input.occasionId);
    return { saved: true };
  },
);

export const removeSpaceModelAction = action(z.object({ occasionId: zId }), async (ctx, input) => {
  await removeSpaceModel(ctx, input);
  refresh(input.occasionId);
  redirect(`/occasions/${input.occasionId}/space`);
});

/** "Vezi ce se schimbă": creates (or finds) the What-if preview of the venue's newer drawing. */
export const proposeDrawingUpdateAction = action(z.object({ occasionId: zId }), async (ctx, input) => {
  const preview = await proposeDrawingUpdate(ctx, input.occasionId);
  redirect(preview ? `/occasions/${input.occasionId}/space?preview=${preview.id}` : `/occasions/${input.occasionId}/space`);
});
