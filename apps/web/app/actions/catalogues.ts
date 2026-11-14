"use server";

import {
  createCatalogue,
  discardCatalogueDraft,
  removeCatalogueItem,
  renameCatalogue,
  retireCatalogue,
  saveCatalogueItem,
  submitCatalogue,
} from "@ed/core/catalogues";
import { parseMoneyText } from "@ed/core/suppliers";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Flower catalogue Server Actions (F1). Everything typed here lands in the working copy;
// only "Trimite spre verificare" queues it, and only an approval makes it public.

const list = z.preprocess((v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().max(20)).max(20));
const refresh = (businessId: string) => revalidatePath(`/business/${businessId}/catalogues`, "layout");

export const createCatalogueAction = action(z.object({ businessId: zId, listingId: z.string().max(64), name: z.string().max(200) }), async (ctx, input) => {
  if (!input.listingId) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { listingId: ["common.validation.required"] } });
  const row = await createCatalogue(ctx, input);
  refresh(input.businessId);
  redirect(`/business/${input.businessId}/catalogues/${row.id}`);
});

export const renameCatalogueAction = action(z.object({ businessId: zId, catalogueId: zId, name: z.string().max(200) }), async (ctx, input) => {
  await renameCatalogue(ctx, { catalogueId: input.catalogueId, name: input.name });
  refresh(input.businessId);
  return { saved: true };
});

/** Money typed as text → minor units; "" → unknown (null). A wrong amount is an error beside its field. */
function price(field: string, value: string | undefined): number | null {
  const minor = parseMoneyText(value);
  if (minor === undefined) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { [field]: ["catalogues.errors.price"] } });
  if (minor === 0) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { [field]: ["catalogues.errors.priceZero"] } });
  return minor;
}

export const saveCatalogueItemAction = action(
  z.object({
    businessId: zId,
    catalogueId: zId,
    itemId: z.string().max(64).optional(),
    kind: z.enum(["flower", "foliage"]).default("flower"),
    varietyName: z.string().max(200).default(""),
    imageAssetId: z.string().max(64).optional(),
    /** The picture already on the variety: kept when no new one was uploaded. */
    currentImageAssetId: z.string().max(64).optional(),
    seasonMonths: list,
    priceStem: z.string().max(30).optional(),
    priceBunch: z.string().max(30).optional(),
    colours: list,
    notes: z.string().max(600).optional(),
  }),
  async (ctx, input) => {
    const res = await saveCatalogueItem(ctx, {
      catalogueId: input.catalogueId,
      item: {
        id: input.itemId || undefined,
        kind: input.kind,
        varietyName: input.varietyName,
        imageAssetId: input.imageAssetId || input.currentImageAssetId || null,
        seasonMonths: input.seasonMonths,
        pricePerStemMinor: price("priceStem", input.priceStem),
        pricePerBunchMinor: price("priceBunch", input.priceBunch),
        colours: input.colours as never,
        notes: input.notes,
      },
    });
    refresh(input.businessId);
    return res;
  },
);

const ref = z.object({ businessId: zId, catalogueId: zId });

export const removeCatalogueItemAction = action(ref.extend({ itemId: z.string().min(1).max(64) }), async (ctx, input) => {
  await removeCatalogueItem(ctx, { catalogueId: input.catalogueId, itemId: input.itemId });
  refresh(input.businessId);
  return { removed: true };
});

export const submitCatalogueAction = action(ref, async (ctx, input) => {
  await submitCatalogue(ctx, { catalogueId: input.catalogueId });
  refresh(input.businessId);
  redirect(`/business/${input.businessId}/catalogues/${input.catalogueId}?saved=submitted`);
});

export const discardCatalogueDraftAction = action(ref, async (ctx, input) => {
  await discardCatalogueDraft(ctx, { catalogueId: input.catalogueId });
  refresh(input.businessId);
  return { discarded: true };
});

export const retireCatalogueAction = action(ref, async (ctx, input) => {
  await retireCatalogue(ctx, { catalogueId: input.catalogueId });
  refresh(input.businessId);
  redirect(`/business/${input.businessId}/catalogues?retired=1`);
});
