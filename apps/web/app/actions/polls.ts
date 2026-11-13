"use server";

import { addPollDates, castPollVotes, closePoll, confirmPollDate, removePollDate } from "@ed/core/polls";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import type { ActionResult } from "@/lib/action-core";
import { guestFormFields, runGuestAction } from "@/lib/guest";

// Date polls (A7). Planner actions need an account; the vote comes from a guest link.

const pollsPath = (occasionId: string) => `/occasions/${occasionId}/polls`;

export const addPollDatesAction = action(
  z.object({ occasionId: zId, dates: z.union([z.string().max(400), z.array(z.string().max(20)).max(12)]) }),
  async (ctx, input) => {
    const res = await addPollDates(ctx, input);
    revalidatePath(pollsPath(input.occasionId));
    return res;
  },
);

export const removePollDateAction = action(z.object({ occasionId: zId, optionId: zId }), async (ctx, input) => {
  await removePollDate(ctx, { optionId: input.optionId });
  revalidatePath(pollsPath(input.occasionId));
  return { removed: true };
});

export const closePollAction = action(z.object({ occasionId: zId, pollId: zId }), async (ctx, input) => {
  await closePoll(ctx, { pollId: input.pollId });
  revalidatePath(pollsPath(input.occasionId));
  return { closed: true };
});

/** The host picks a day: returns the id of the move-date What-if preview to review. */
export const confirmPollDateAction = action(
  z.object({ occasionId: zId, pollId: zId, optionId: zId }),
  async (ctx, input) => {
    const preview = await confirmPollDate(ctx, { pollId: input.pollId, optionId: input.optionId });
    revalidatePath(pollsPath(input.occasionId));
    return { previewId: preview.id };
  },
);

const voteForm = z.looseObject({ ...guestFormFields, pollId: zId });
const VOTE_PREFIX = "vote_";

/** A household votes Da / Poate / Nu per day on its guest link. Votes never hold places. */
export async function castPollVotesAction(
  ...args: [unknown, FormData] | [unknown]
): Promise<ActionResult<{ saved: number }>> {
  return runGuestAction(args, {
    schema: voteForm,
    formKey: "poll_vote",
    minSeconds: 1,
    handler: async (ctx, input) => {
      const votes: Record<string, "yes" | "maybe" | "no"> = {};
      for (const [key, value] of Object.entries(input)) {
        if (key.startsWith(VOTE_PREFIX) && (value === "yes" || value === "maybe" || value === "no")) {
          votes[key.slice(VOTE_PREFIX.length)] = value;
        }
      }
      return castPollVotes(ctx, { pollId: input.pollId, votes });
    },
  });
}
