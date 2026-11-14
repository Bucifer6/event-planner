"use server";

import { questionField, submitRsvp, type RsvpResult } from "@ed/core/rsvp";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-core";
import { guestFormFields, runGuestAction } from "@/lib/guest";

// The RSVP sent from a guest link (A6, A8, SEC11, Q4). Public: the link token decides whose
// answer it is. Idempotent — the household has one answer and one capacity claim, so a double
// tap or a retry applies once.

const rsvpForm = z.looseObject({
  ...guestFormFields,
  attending: z.enum(["yes", "no", "maybe"], "rsvp.errors.chooseAttending"),
  adultsCount: z.string().max(4).optional(),
  childrenCount: z.string().max(4).optional(),
  email: z.string().max(254).optional(),
  childAck: z.string().max(4).optional(),
});

const QUESTION_PREFIX = questionField("");

export async function submitRsvpAction(
  ...args: [unknown, FormData] | [unknown]
): Promise<ActionResult<RsvpResult>> {
  return runGuestAction(args, {
    schema: rsvpForm,
    formKey: "rsvp",
    handler: async (ctx, input) => {
      const answers: Record<string, string> = {};
      for (const [key, value] of Object.entries(input)) {
        if (key.startsWith(QUESTION_PREFIX) && typeof value === "string") {
          answers[key.slice(QUESTION_PREFIX.length)] = value;
        }
      }
      return submitRsvp(ctx, {
        attending: input.attending,
        adultsCount: Number(input.adultsCount ?? 0),
        childrenCount: Number(input.childrenCount ?? 0),
        answers,
        email: input.email,
        childDetailsAcknowledged: input.childAck === "1",
      });
    },
  });
}
