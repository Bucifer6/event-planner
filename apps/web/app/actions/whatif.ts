"use server";

import { confirmPreview, discardPreview } from "@ed/core/whatif";
import { z } from "zod";
import { action } from "@/lib/action";

// What-if decisions (principle 3). Access is checked in @ed/core/whatif through the kind's
// authorize(); only a signed-in person can confirm or discard. Both are idempotent (Q4).

const input = z.object({ previewId: z.string().min(1).max(64) });

export type WhatIfDecision = { previewId: string; state: "applied" | "discarded"; appliedNow: boolean };

/** Applies the previewed change — once, however often it is submitted. */
export const confirmWhatIf = action(input, async (ctx, { previewId }): Promise<WhatIfDecision> => {
  const res = await confirmPreview(ctx, previewId);
  return { previewId: res.preview.id, state: "applied", appliedNow: res.appliedNow };
});

/** Drops the previewed change; nothing is modified. */
export const discardWhatIf = action(input, async (ctx, { previewId }): Promise<WhatIfDecision> => {
  const p = await discardPreview(ctx, previewId);
  return { previewId: p.id, state: "discarded", appliedNow: false };
});
