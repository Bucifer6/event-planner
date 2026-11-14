"use server";

import { AI_TEXT_PURPOSES, AI_TEXT_TONES, markAiTextAccepted, suggestText } from "@ed/core/aitext";
import { z } from "zod";
import { action } from "@/lib/action";

// AI text feature (INF7): one wording suggestion per call, returned to the person who asked
// and to nobody else. Nothing is applied here — the form shows it in an edit box first.

export const suggestTextAction = action(
  z.object({
    purpose: z.enum(AI_TEXT_PURPOSES),
    occasionKind: z.string().max(40),
    tone: z.enum(AI_TEXT_TONES),
    language: z.enum(["ro", "en"]),
    names: z.string().max(120).optional(),
    hint: z.string().max(200).optional(),
  }),
  async (ctx, input) => {
    const s = await suggestText(ctx, input);
    return { resultId: s.resultId, text: s.text, remaining: s.remaining, resetsAt: s.resetsAt.toISOString() };
  },
);

export const acceptAiTextAction = action(z.object({ resultId: z.string().min(1).max(64) }), async (ctx, input) => {
  await markAiTextAccepted(ctx, input.resultId);
  return { accepted: true };
});
