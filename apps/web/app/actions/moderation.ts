"use server";

import "@ed/core/listings"; // registers the "listing" moderation kind and the content-report hook
import { recordFactCheck, setBusinessStatus, withdrawFactCheck } from "@ed/core/business";
import { restoreListing, suspendListing } from "@ed/core/listings";
import { decideRevision, setModerationTargetHours } from "@ed/core/moderation";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";

// Console Server Actions for moderation (W2), business management (W3) and the two factual
// badges (P4). Every one is a staffAction; roles and the "not a member of that business"
// rule are enforced in @ed/core.

const zReason = z.string().trim().max(2000, "common.validation.tooLong");
const refresh = () => revalidatePath("/console", "layout");

export const decideRevisionAction = staffAction(
  z.object({ id: zId, decision: z.enum(["approve", "reject"], "common.validation.required"), reason: zReason.optional() }),
  async (ctx, input) => {
    await decideRevision(ctx, input);
    refresh();
    redirect(`/console/moderation?decided=${input.decision}`);
  },
);

export const saveModerationTarget = staffAction(z.object({ hours: z.string().trim().min(1, "common.validation.required").max(4) }), async (ctx, input) => {
  await setModerationTargetHours(ctx, { hours: Number(input.hours) });
  refresh();
  return { saved: true };
});

export const setBusinessStatusAction = staffAction(
  z.object({ businessId: zId, status: z.enum(["active", "restricted", "suspended"], "common.validation.required"), reason: zReason.optional() }),
  async (ctx, input) => {
    await setBusinessStatus(ctx, input);
    refresh();
    return { status: input.status };
  },
);

export const suspendListingAction = staffAction(z.object({ listingId: zId, reason: zReason }), async (ctx, input) => {
  await suspendListing(ctx, input);
  refresh();
  return { suspended: true };
});

export const restoreListingAction = staffAction(z.object({ listingId: zId }), async (ctx, input) => {
  await restoreListing(ctx, input);
  refresh();
  return { suspended: false };
});

export const recordFactCheckAction = staffAction(
  z.object({ businessId: zId, kind: z.enum(["onrc", "insurance"]), seen: z.string().trim().max(1000, "common.validation.tooLong"), validUntil: z.string().max(10).optional() }),
  async (ctx, input) => {
    await recordFactCheck(ctx, input);
    refresh();
    return { recorded: true };
  },
);

export const withdrawFactCheckAction = staffAction(z.object({ businessId: zId, kind: z.enum(["onrc", "insurance"]), seen: zReason }), async (ctx, input) => {
  await withdrawFactCheck(ctx, input);
  refresh();
  return { withdrawn: true };
});
