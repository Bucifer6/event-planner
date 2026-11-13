"use server";

import { attachDrawing, calibrateSpace, createSpace, retireSpace, saveMarkings, submitParking, submitSpace, updateSpaceDetails } from "@ed/core/drawings";
import { withdrawRevision } from "@ed/core/moderation";
import { parseMetres, zSpaceMarkings } from "@ed/core/spacemodel";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Venue drawings — business side (P-06). Measures arrive as people type them ("12", "1,8",
// "180 cm") and are turned into integer millimetres here; an empty field means UNKNOWN.

/** Text → mm | null (empty). Anything that is not a measure is an error beside the field. */
const zMetres = z
  .string()
  .max(20)
  .optional()
  .transform((v, ctx) => {
    const mm = parseMetres(v);
    if (mm !== null && (Number.isNaN(mm) || mm <= 0)) {
      ctx.addIssue({ code: "custom", message: "drawings.errors.measure" });
      return z.NEVER;
    }
    return mm;
  });

const base = (businessId: string, listingId: string) => `/business/${businessId}/listings/${listingId}/spaces`;

export const createSpaceAction = action(z.object({ businessId: zId, listingId: zId, name: z.string().max(200), widthMm: zMetres, lengthMm: zMetres }), async (ctx, input) => {
  const space = await createSpace(ctx, { listingId: input.listingId, name: input.name, widthMm: input.widthMm, lengthMm: input.lengthMm });
  revalidatePath(base(input.businessId, input.listingId), "layout");
  return { id: space.id };
});

export const updateSpaceDetailsAction = action(
  z.object({ businessId: zId, listingId: zId, spaceId: zId, name: z.string().max(200), widthMm: zMetres, lengthMm: zMetres }),
  async (ctx, input) => {
    await updateSpaceDetails(ctx, { spaceId: input.spaceId, name: input.name, widthMm: input.widthMm, lengthMm: input.lengthMm });
    revalidatePath(base(input.businessId, input.listingId), "layout");
    return { saved: true };
  },
);

export const attachDrawingAction = action(z.object({ businessId: zId, listingId: zId, spaceId: zId, assetId: zId }), async (ctx, input) => {
  const row = await attachDrawing(ctx, { spaceId: input.spaceId, assetId: input.assetId });
  revalidatePath(base(input.businessId, input.listingId), "layout");
  return { pdfWithoutPicture: row.pdfWithoutPicture };
});

export const calibrateSpaceAction = action(
  z.object({
    spaceId: zId,
    ax: z.coerce.number(),
    ay: z.coerce.number(),
    bx: z.coerce.number(),
    by: z.coerce.number(),
    distance: z.string().max(20),
    version: z.coerce.number().int().optional(),
  }),
  async (ctx, input) => {
    const mm = parseMetres(input.distance);
    if (mm === null || Number.isNaN(mm)) {
      const { AppError } = await import("@ed/shared/errors");
      throw new AppError("VALIDATION", "drawings.errors.measure", { fieldErrors: { distance: [mm === null ? "common.validation.required" : "drawings.errors.measure"] } });
    }
    const row = await calibrateSpace(ctx, { spaceId: input.spaceId, ax: input.ax, ay: input.ay, bx: input.bx, by: input.by, distanceMm: mm, version: input.version });
    return { version: row.version, mmPerPx: row.mmPerPx, markings: row.markings };
  },
);

export const saveMarkingsAction = action(z.object({ spaceId: zId, markings: zSpaceMarkings, version: z.number().int().optional() }), async (ctx, input) => {
  const row = await saveMarkings(ctx, input);
  return { version: row.version, markings: row.markings };
});

export const submitSpaceAction = action(z.object({ businessId: zId, listingId: zId, spaceId: zId }), async (ctx, input) => {
  await submitSpace(ctx, { spaceId: input.spaceId });
  revalidatePath(base(input.businessId, input.listingId), "layout");
  redirect(`${base(input.businessId, input.listingId)}/${input.spaceId}?sent=1`);
});

export const withdrawSpaceRevisionAction = action(z.object({ businessId: zId, listingId: zId, revisionId: zId }), async (ctx, input) => {
  await withdrawRevision(ctx, { id: input.revisionId });
  revalidatePath(base(input.businessId, input.listingId), "layout");
  return { withdrawn: true };
});

export const retireSpaceAction = action(z.object({ businessId: zId, listingId: zId, spaceId: zId }), async (ctx, input) => {
  await retireSpace(ctx, { spaceId: input.spaceId });
  revalidatePath(base(input.businessId, input.listingId), "layout");
  redirect(`${base(input.businessId, input.listingId)}?removed=1`);
});

const tri = z.enum(["yes", "no", "unknown"]).default("unknown").transform((v) => (v === "unknown" ? null : v === "yes"));
const optInt = (max: number) =>
  z
    .string()
    .max(12)
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? "").trim();
      if (!s) return null;
      if (!/^\d+$/.test(s) || Number(s) > max) {
        ctx.addIssue({ code: "custom", message: "common.validation.invalid" });
        return z.NEVER;
      }
      return Number(s);
    });

export const submitParkingAction = action(
  z.object({
    businessId: zId,
    listingId: zId,
    onSite: tri,
    spaceCount: optInt(100_000),
    onStreet: tri,
    paid: tri,
    accessibleSpaces: tri,
    walkingDistanceM: optInt(20_000),
    confirmCount: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  }),
  async (ctx, input) => {
    const { businessId, ...facts } = input;
    await submitParking(ctx, facts);
    revalidatePath(base(businessId, input.listingId), "layout");
    return { sent: true };
  },
);
