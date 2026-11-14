"use server";

import { requireBusinessMember } from "@ed/core/business";
import { createListing, retireListing, saveListingDraft, setListingHideStats, submitListing, validateListingPayload } from "@ed/core/listings";
import { withdrawRevision } from "@ed/core/moderation";
import { zFormBoolean, zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Listing editor Server Actions (P1–P3). The payload is validated against the seeded
// picklists in @ed/core/listings — the form can only send ids, and core checks every one.

const list = z.preprocess((v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().max(64)).max(60));

const editorInput = z.object({
  businessId: zId,
  listingId: z.string().max(64).optional(),
  intent: z.enum(["draft", "submit"]).default("draft"),
  name: z.string().max(200).default(""),
  descriptionRo: z.string().max(6000).default(""),
  descriptionEn: z.string().max(6000).optional(),
  categoryIds: list,
  countyCodes: list,
  localityIds: list,
  contactPhone: z.string().max(60).optional(),
  contactEmail: z.string().max(400).optional(),
  website: z.string().max(400).optional(),
  photoAssetIds: list,
});

/** One form, two buttons: "Salvează ciorna" (intent=draft) and "Trimite spre verificare" (intent=submit). */
export const saveListing = action(editorInput, async (ctx, input) => {
  const { businessId, listingId, intent, ...payload } = input;
  let id = listingId || null;
  if (!id) {
    if (intent === "submit") {
      // Check everything BEFORE creating, so a failed submit creates nothing and the errors
      // appear beside the fields the person is still looking at.
      await requireBusinessMember(ctx, businessId);
      await validateListingPayload(ctx, payload, { businessId, mode: "submit" });
    }
    const created = await createListing(ctx, { businessId, payload });
    id = created.id;
    if (intent === "draft") redirect(`/business/${businessId}/listings/${id}?saved=draft`);
  } else if (intent === "draft") {
    await saveListingDraft(ctx, { listingId: id, payload });
    revalidatePath(`/business/${businessId}`, "layout");
    redirect(`/business/${businessId}/listings/${id}?saved=draft`);
  }
  await submitListing(ctx, { listingId: id, payload });
  revalidatePath(`/business/${businessId}`, "layout");
  redirect(`/business/${businessId}/listings/${id}?saved=submitted`);
});

export const withdrawListingRevision = action(z.object({ businessId: zId, listingId: zId, revisionId: zId }), async (ctx, input) => {
  await withdrawRevision(ctx, { id: input.revisionId });
  revalidatePath(`/business/${input.businessId}`, "layout");
  return { withdrawn: true };
});

export const retireListingAction = action(z.object({ businessId: zId, listingId: zId }), async (ctx, input) => {
  await retireListing(ctx, { listingId: input.listingId });
  revalidatePath(`/business/${input.businessId}`, "layout");
  redirect(`/business/${input.businessId}?retired=1`);
});

export const setListingStatsVisibility = action(z.object({ businessId: zId, listingId: zId, hide: zFormBoolean }), async (ctx, input) => {
  await setListingHideStats(ctx, { listingId: input.listingId, hide: input.hide });
  revalidatePath(`/business/${input.businessId}/listings/${input.listingId}`);
  return { hide: input.hide };
});
