"use server";

import { createBusinessOccasion, ensureBusinessSeat, saveBranding, saveTeamGrants } from "@ed/core/bizoccasions";
import { proposeHandover } from "@ed/core/handover";
import { archiveLibraryItem, createLibraryItem, proposeLibraryApply, shareLibraryFile, updateLibraryItem, type LibraryItemInput } from "@ed/core/library";
import { occasionKindSchema } from "@ed/db";
import { zFormBoolean, zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Business occasions, library, branding and handover (P17–P23). Every rule — who may, the
// plan-lapse guard, the What-if step — lives in @ed/core/{bizoccasions,library,handover}.

const text = z.string().max(20_000).optional();

/** P17: any member creates an occasion the business runs for a client. Lands on the new occasion. */
export const createBusinessOccasionAction = action(
  z.object({ businessId: zId, title: z.string().max(500), kind: occasionKindSchema, startsOn: z.string().max(10).optional() }),
  async (ctx, input) => {
    const startsOn = input.startsOn?.trim() || undefined;
    const occasion = await createBusinessOccasion(ctx, {
      businessId: input.businessId,
      occasion: { title: input.title, kind: input.kind, dateMode: startsOn ? "date" : "poll", startsOn },
    });
    revalidatePath(`/business/${input.businessId}/occasions`);
    redirect(`/occasions/${occasion.id}`);
  },
);

/** A team member takes a real place in the occasion (so tasks can be theirs). */
export const takeBusinessSeatAction = action(z.object({ occasionId: zId }), async (ctx, input) => {
  await ensureBusinessSeat(ctx, input.occasionId);
  revalidatePath(`/occasions/${input.occasionId}`, "layout");
  return { joined: true };
});

export const saveBrandingAction = action(
  z.object({
    businessId: zId,
    displayName: z.string().max(200).optional(),
    accentColor: z.string().max(20).optional(),
    useAccent: zFormBoolean.optional(),
    logoAssetId: z.string().max(64).optional(),
    removeLogo: zFormBoolean.optional(),
  }),
  async (ctx, input) => {
    await saveBranding(ctx, {
      businessId: input.businessId,
      displayName: input.displayName ?? "",
      accentColor: input.useAccent ? (input.accentColor ?? "") : null,
      logoAssetId: input.removeLogo ? null : input.logoAssetId ? input.logoAssetId : undefined,
    });
    revalidatePath(`/business/${input.businessId}/branding`);
    return { saved: true };
  },
);

export const saveTeamGrantsAction = action(z.object({ businessId: zId, finance: zFormBoolean.optional(), privateRequests: zFormBoolean.optional() }), async (ctx, input) => {
  await saveTeamGrants(ctx, { businessId: input.businessId, finance: input.finance === true, privateRequests: input.privateRequests === true });
  revalidatePath(`/business/${input.businessId}/occasions`);
  return { saved: true };
});

const itemFields = {
  kind: z.enum(["template", "checklist", "contact", "asset"]),
  title: z.string().max(500),
  lines: text,
  category: text,
  person: text,
  email: text,
  phone: text,
  notes: text,
  assetId: z.string().max(64).optional(),
};
type ItemFields = z.infer<z.ZodObject<typeof itemFields>>;

function toItem(i: ItemFields): LibraryItemInput {
  switch (i.kind) {
    case "template":
    case "checklist":
      return { kind: i.kind, title: i.title, lines: i.lines ?? "" };
    case "contact":
      return { kind: "contact", title: i.title, category: i.category, person: i.person, email: i.email, phone: i.phone, notes: i.notes };
    case "asset":
      return { kind: "asset", title: i.title, assetId: i.assetId ?? "" };
  }
}

export const addLibraryItemAction = action(z.object({ businessId: zId, ...itemFields }), async (ctx, input) => {
  const item = await createLibraryItem(ctx, { businessId: input.businessId, item: toItem(input) });
  revalidatePath(`/business/${input.businessId}/library`);
  return { id: item.id };
});

export const updateLibraryItemAction = action(z.object({ businessId: zId, itemId: zId, ...itemFields }), async (ctx, input) => {
  await updateLibraryItem(ctx, { itemId: input.itemId, item: toItem(input) });
  revalidatePath(`/business/${input.businessId}/library`);
  return { saved: true };
});

export const archiveLibraryItemAction = action(z.object({ businessId: zId, itemId: zId }), async (ctx, input) => {
  await archiveLibraryItem(ctx, { itemId: input.itemId });
  revalidatePath(`/business/${input.businessId}/library`);
  return { archived: true };
});

/** Applying a library item is a What-if: this only creates the preview and shows it. */
export const applyLibraryItemAction = action(z.object({ businessId: zId, occasionId: zId, itemId: z.string().min(1, "common.validation.required").max(64) }), async (ctx, input) => {
  const preview = await proposeLibraryApply(ctx, { itemId: input.itemId, occasionId: input.occasionId });
  redirect(`/business/${input.businessId}/occasions/${input.occasionId}?preview=${preview.id}`);
});

export const shareLibraryFileAction = action(z.object({ businessId: zId, occasionId: zId, itemId: z.string().min(1, "common.validation.required").max(64) }), async (ctx, input) => {
  await shareLibraryFile(ctx, { itemId: input.itemId, occasionId: input.occasionId });
  revalidatePath(`/business/${input.businessId}/occasions/${input.occasionId}`);
  return { shared: true };
});

/** P22: creates the handover preview (what ends, what stays). Nothing changes until it is confirmed. */
export const proposeHandoverAction = action(z.object({ businessId: zId, occasionId: zId, toMemberId: z.string().min(1, "common.validation.required").max(64) }), async (ctx, input) => {
  const preview = await proposeHandover(ctx, { occasionId: input.occasionId, toMemberId: input.toMemberId });
  redirect(`/business/${input.businessId}/occasions/${input.occasionId}?preview=${preview.id}#handover`);
});
