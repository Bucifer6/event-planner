"use server";

import {
  acceptBusinessInvite,
  createBusiness,
  inviteBusinessMember,
  markBusinessNoticesRead,
  removeBusinessMember,
  updateBusiness,
  updateBusinessMemberRole,
} from "@ed/core/business";
import { zFormBoolean, zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Business area Server Actions (P1, P18). Access and the P18 role rule live in @ed/core/business.
// MON1: nothing here (or anywhere) charges, prices or asks for a card.

const zName = z.string().trim().min(2, "common.validation.required").max(120, "common.validation.tooLong");

export const createBusinessAction = action(z.object({ name: zName, onrcRegistration: z.string().max(40).optional() }), async (ctx, input) => {
  const business = await createBusiness(ctx, input);
  redirect(`/business/${business.id}`);
});

export const saveBusinessSettings = action(
  z.object({
    businessId: zId,
    name: zName,
    onrcRegistration: z.string().trim().max(40, "common.validation.tooLong").optional(),
    nudge48h: zFormBoolean.optional(),
    hideStats: zFormBoolean.optional(),
  }),
  async (ctx, input) => {
    await updateBusiness(ctx, {
      businessId: input.businessId,
      name: input.name,
      onrcRegistration: input.onrcRegistration ?? "",
      nudge48h: input.nudge48h === true,
      hideStats: input.hideStats === true,
    });
    revalidatePath(`/business/${input.businessId}`, "layout");
    return { saved: true };
  },
);

export const inviteBusinessMemberAction = action(
  z.object({ businessId: zId, email: z.string().trim().min(1, "common.validation.required").max(320), role: z.enum(["admin", "staff"], "common.validation.required") }),
  async (ctx, input) => {
    const res = await inviteBusinessMember(ctx, input);
    revalidatePath(`/business/${input.businessId}/team`);
    return { emailStatus: res.emailStatus };
  },
);

export const changeBusinessMemberRole = action(
  z.object({ businessId: zId, memberId: zId, role: z.enum(["admin", "staff"], "common.validation.required") }),
  async (ctx, input) => {
    await updateBusinessMemberRole(ctx, input);
    revalidatePath(`/business/${input.businessId}/team`);
    return { saved: true };
  },
);

export const removeBusinessMemberAction = action(z.object({ businessId: zId, memberId: zId }), async (ctx, input) => {
  await removeBusinessMember(ctx, input);
  revalidatePath(`/business/${input.businessId}/team`);
  return { removed: true };
});

export const acceptBusinessInviteAction = action(z.object({ token: z.string().min(20).max(200) }), async (ctx, input) => {
  const { businessId } = await acceptBusinessInvite(ctx, input);
  redirect(`/business/${businessId}`);
});

export const dismissBusinessNotices = action(z.object({ businessId: zId }), async (ctx, input) => {
  await markBusinessNoticesRead(ctx, input.businessId);
  revalidatePath(`/business/${input.businessId}`);
  return { read: true };
});
