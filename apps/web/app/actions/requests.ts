"use server";

import { DIET_TAGS } from "@ed/core/menus";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD } from "@ed/core/ratelimit";
import { setRequestStatus, shareRequestCounts, submitGuestRequest, submitRegistrantRequest } from "@ed/core/requests";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runPublicAction } from "@/app/e/_lib/public";
import { action } from "@/lib/action";
import type { ActionResult } from "@/lib/action-core";
import { guestFormFields, runGuestAction } from "@/lib/guest";

// Private requests (C-07, D2). Reading and handling need the `privateRequests` grant — the
// check is in @ed/core/requests, never here.

const path = (occasionId: string) => `/occasions/${occasionId}/requests`;
const flag = z.string().max(5).optional();

export const setRequestStatusAction = action(
  z.object({ occasionId: zId, requestId: zId, status: z.enum(["open", "handled"]), note: z.string().max(2000).optional() }),
  async (ctx, input) => {
    await setRequestStatus(ctx, { requestId: input.requestId, status: input.status, note: input.note });
    revalidatePath(path(input.occasionId));
    return { status: input.status };
  },
);

const tagFlags = Object.fromEntries(DIET_TAGS.map((t) => [`tag_${t}`, flag])) as Record<`tag_${(typeof DIET_TAGS)[number]}`, typeof flag>;

export const shareRequestCountsAction = action(z.object({ occasionId: zId, bookingId: zId, access: flag, ...tagFlags }), async (ctx, input) => {
  const res = await shareRequestCounts(ctx, {
    occasionId: input.occasionId,
    bookingId: input.bookingId,
    access: input.access === "on",
    tags: DIET_TAGS.filter((t) => input[`tag_${t}`] === "on"),
  });
  revalidatePath(path(input.occasionId));
  return res;
});

const requestFields = {
  kind: z.string().max(20),
  dietTag: z.string().max(30).optional(),
  body: z.string().max(2000).optional(),
  childDetailsAcknowledged: z.string().max(5).optional(),
};

/** A household's private request, from its guest link. */
export async function submitGuestRequestAction(...args: [unknown, FormData] | [unknown]): Promise<ActionResult<{ requestId: string }>> {
  return runGuestAction(args, {
    schema: z.object({ ...guestFormFields, ...requestFields }),
    formKey: "private.request",
    handler: (ctx, input) => submitGuestRequest(ctx, { kind: input.kind as never, dietTag: input.dietTag, body: input.body, childDetailsAcknowledged: input.childDetailsAcknowledged }),
  });
}

/** A public registrant's private request, from their manage link (bot guard inside core). */
export async function submitRegistrantRequestAction(...args: [unknown, FormData] | [unknown]): Promise<ActionResult<{ requestId: string }>> {
  return runPublicAction(args, {
    schema: z.object({
      slug: z.string().max(80),
      token: z.string().max(128),
      lang: z.enum(["ro", "en"]).optional(),
      ...requestFields,
      [HONEYPOT_FIELD]: z.string().max(500).optional(),
      [FORM_STAMP_FIELD]: z.string().max(200).optional(),
    }),
    handler: (ctx, input) =>
      submitRegistrantRequest(ctx, {
        slug: input.slug,
        token: input.token,
        kind: input.kind as never,
        dietTag: input.dietTag,
        body: input.body,
        childDetailsAcknowledged: input.childDetailsAcknowledged,
        honeypot: input[HONEYPOT_FIELD] ?? "",
        renderedAt: input[FORM_STAMP_FIELD] ?? null,
      }),
  });
}
