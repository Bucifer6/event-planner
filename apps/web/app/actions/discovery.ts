"use server";

import "@ed/core/listings"; // registers the "listing" moderation kind used when a draft is approved
import { rejectClaim, submitClaimForApproval } from "@ed/core/claims";
import {
  createDiscoverySource,
  decideDiscoveryDrafts,
  decideObjection,
  requestDiscoveryRun,
  setDiscoveryDraftPlace,
  setDiscoverySourceEnabled,
  updateDiscoverySource,
} from "@ed/core/discovery";
import { zFormBoolean, zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";

// Console Server Actions for discovery (W5, BD1–BD7) and claim verification (P30). Every one
// is a staffAction; the role checks live in @ed/core/discovery and @ed/core/claims.

const refresh = () => revalidatePath("/console/discovery", "layout");

const sourceFields = {
  name: z.string().max(200).default(""),
  termsReference: z.string().max(600).default(""),
  rateLimitPerHour: z.string().max(6).default(""),
  format: z.enum(["csv", "json"]).optional(),
  url: z.string().max(1000).optional(),
  inline: z.string().max(2_200_000).optional(),
  urls: z.string().max(220_000).optional(),
  defaultCategoryId: z.string().max(64).optional(),
  targetCategoryIds: z.string().max(2000).optional(),
  targetCountyCodes: z.string().max(400).optional(),
};

export const createSourceAction = staffAction(z.object({ kind: z.enum(["onrc_public", "business_page", "licensed_dataset"], "common.validation.required"), ...sourceFields }), async (ctx, input) => {
  await createDiscoverySource(ctx, input);
  refresh();
  redirect("/console/discovery?created=1");
});

export const updateSourceAction = staffAction(z.object({ id: zId, ...sourceFields }), async (ctx, input) => {
  await updateDiscoverySource(ctx, { ...input, kind: "licensed_dataset" }); // the kind is read from the row
  refresh();
  return { saved: true };
});

export const setSourceEnabledAction = staffAction(z.object({ id: zId, enabled: zFormBoolean }), async (ctx, input) => {
  await setDiscoverySourceEnabled(ctx, { id: input.id, enabled: input.enabled === true });
  refresh();
  return { enabled: input.enabled === true };
});

export const runSourceAction = staffAction(z.object({ sourceId: zId }), async (ctx, input) => {
  const res = await requestDiscoveryRun(ctx, input);
  refresh();
  return res;
});

export const setDraftPlaceAction = staffAction(z.object({ id: zId, categoryId: z.string().max(64).default(""), localityId: z.string().max(64).default("") }), async (ctx, input) => {
  await setDiscoveryDraftPlace(ctx, input);
  refresh();
  return { saved: true };
});

const ids = z.preprocess((v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().max(64)).max(200));

/** W5: ONE decision and ONE recorded reason for all the selected drafts. */
export const decideDraftsAction = staffAction(
  z.object({ draftIds: ids, action: z.enum(["approve", "reject", "discard"], "common.validation.required"), reason: z.string().max(1200).default(""), state: z.string().max(30).optional() }),
  async (ctx, input) => {
    await decideDiscoveryDrafts(ctx, { draftIds: input.draftIds, action: input.action, reason: input.reason });
    refresh();
    redirect(`/console/discovery?tab=drafts${input.state ? `&state=${input.state}` : ""}&done=${input.action}`);
  },
);

export const decideObjectionAction = staffAction(z.object({ id: zId, decision: z.enum(["honour", "decline"], "common.validation.required"), note: z.string().max(2200).default("") }), async (ctx, input) => {
  await decideObjection(ctx, input);
  refresh();
  return { decided: true };
});

export const submitClaimAction = staffAction(z.object({ claimId: zId, checkNote: z.string().max(2200).default("") }), async (ctx, input) => {
  const res = await submitClaimForApproval(ctx, input);
  refresh();
  revalidatePath("/console/approvals");
  return res;
});

export const rejectClaimAction = staffAction(z.object({ claimId: zId, reason: z.string().max(1200).default("") }), async (ctx, input) => {
  await rejectClaim(ctx, input);
  refresh();
  return { rejected: true };
});
