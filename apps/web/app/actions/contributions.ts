"use server";

import { removeNeed, saveNeed, setContribution, type ClaimUnitsResult } from "@ed/core/contributions";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import type { ActionResult } from "@/lib/action-core";
import { guestFormFields, runGuestAction } from "@/lib/guest";

// Contributions, "Cine ce aduce" (A9). Claims are atomic in @ed/core/contributions.

const path = (occasionId: string) => `/occasions/${occasionId}/contributions`;

export const saveNeedAction = action(
  z.object({
    occasionId: zId,
    needId: z.string().max(64).optional(),
    title: z.string().max(200),
    note: z.string().max(400).optional(),
    unitsNeeded: z.string().max(6),
  }),
  async (ctx, input) => {
    const res = await saveNeed(ctx, input);
    revalidatePath(path(input.occasionId));
    return res;
  },
);

export const removeNeedAction = action(z.object({ occasionId: zId, needId: zId }), async (ctx, input) => {
  await removeNeed(ctx, { needId: input.needId });
  revalidatePath(path(input.occasionId));
  return { removed: true };
});

/** A member claims, changes or releases (units = 0) in the app. */
export const setMyContributionAction = action(
  z.object({ occasionId: zId, needId: zId, units: z.string().max(6) }),
  async (ctx, input): Promise<ClaimUnitsResult> => {
    const res = await setContribution(ctx, { needId: input.needId, units: input.units });
    revalidatePath(path(input.occasionId));
    return res;
  },
);

const guestClaimForm = z.object({ ...guestFormFields, needId: zId, units: z.string().max(6) });

/** A household claims, changes or releases on its guest link. */
export async function setGuestContributionAction(
  ...args: [unknown, FormData] | [unknown]
): Promise<ActionResult<ClaimUnitsResult>> {
  return runGuestAction(args, {
    schema: guestClaimForm,
    formKey: "contribution",
    minSeconds: 1,
    handler: (ctx, input) => setContribution(ctx, { needId: input.needId, units: input.units }),
  });
}
