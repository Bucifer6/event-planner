"use server";

import { setDisplayName } from "@ed/core/accounts";
import { setInvitationText } from "@ed/core/invitationtext";
import { deletePlanNote } from "@ed/core/plannotes";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Small actions of the integration pass: the optional display name of an account, the
// invitation wording of an occasion, and removing a plan note. Access is decided in core.

/** The name shown to the people the account plans with (blank = email / username). */
export const saveDisplayName = action(z.object({ displayName: z.string().trim().max(60, "common.validation.tooLong").optional() }), async (ctx, input) => {
  const saved = await setDisplayName(ctx, { displayName: input.displayName || null });
  revalidatePath("/account");
  return saved;
});

/** The wording shown on the guest plate (managers only; blank removes it). */
export const saveInvitationText = action(
  z.object({ occasionId: zId, invitationText: z.string().trim().max(1200, "common.validation.tooLong").optional() }),
  async (ctx, input) => {
    await setInvitationText(ctx, { occasionId: input.occasionId, text: input.invitationText || null });
    revalidatePath(`/occasions/${input.occasionId}/guests/settings`);
    return { saved: true };
  },
);

/** Removes a plan note (a shortlist note or a budget note). */
export const removePlanNote = action(z.object({ occasionId: zId, noteId: zId }), async (ctx, input) => {
  await deletePlanNote(ctx, { noteId: input.noteId });
  revalidatePath(`/occasions/${input.occasionId}/proposals`);
  return { removed: true };
});
