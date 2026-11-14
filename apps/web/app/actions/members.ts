"use server";

import { acceptInvite, ASSIGNABLE_ROLES, inviteMember, removeMember, transferOwnership, updateMember } from "@ed/core/members";
import { zFormBoolean } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Team actions (A5, S4). The sensitive ones (roles, grants, removal, ownership) are refused by
// @ed/core without a fresh confirmation; the screens ask for it before showing the control.

const id = z.string().min(1).max(64);
const role = z.enum(ASSIGNABLE_ROLES);
const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");

export const inviteMemberAction = action(
  z.object({
    occasionId: id,
    email: z.string().max(300),
    role,
    customLabel: z.string().max(200).optional(),
    grantFinance: zFormBoolean.optional(),
    grantPrivateRequests: zFormBoolean.optional(),
  }),
  async (ctx, input) => {
    const res = await inviteMember(ctx, {
      occasionId: input.occasionId,
      email: input.email,
      role: input.role,
      customLabel: input.customLabel,
      grantFinance: input.grantFinance ?? false,
      grantPrivateRequests: input.grantPrivateRequests ?? false,
    });
    refresh(input.occasionId);
    return { emailStatus: res.emailStatus };
  },
);

/** Label only — no access change, so no fresh confirmation. */
export const saveMemberLabel = action(z.object({ occasionId: id, memberId: id, customLabel: z.string().max(200).optional() }), async (ctx, input) => {
  await updateMember(ctx, { occasionId: input.occasionId, memberId: input.memberId, customLabel: input.customLabel });
  refresh(input.occasionId);
  return { saved: true };
});

/** S4: role and the two separate grants. `customLabel` rides along unchanged from the form. */
export const saveMemberAccess = action(
  z.object({
    occasionId: id,
    memberId: id,
    role,
    customLabel: z.string().max(200).optional(),
    grantFinance: zFormBoolean.optional(),
    grantPrivateRequests: zFormBoolean.optional(),
  }),
  async (ctx, input) => {
    await updateMember(ctx, {
      occasionId: input.occasionId,
      memberId: input.memberId,
      role: input.role,
      customLabel: input.customLabel,
      grantFinance: input.grantFinance ?? false,
      grantPrivateRequests: input.grantPrivateRequests ?? false,
    });
    refresh(input.occasionId);
    return { saved: true };
  },
);

export const removeMemberAction = action(z.object({ occasionId: id, memberId: id }), async (ctx, input) => {
  await removeMember(ctx, input);
  refresh(input.occasionId);
  redirect(`/occasions/${input.occasionId}/team`);
});

export const transferOwnershipAction = action(z.object({ occasionId: id, toMemberId: id }), async (ctx, input) => {
  await transferOwnership(ctx, input);
  refresh(input.occasionId);
  redirect(`/occasions/${input.occasionId}/team`);
});

/** Accepting an emailed invitation binds the signed-in account to the team. */
export const acceptInviteAction = action(z.object({ token: z.string().min(1).max(200) }), async (ctx, input) => {
  const res = await acceptInvite(ctx, { token: input.token });
  revalidatePath("/occasions", "layout");
  redirect(`/occasions/${res.occasionId}`);
});
