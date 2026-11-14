"use server";

import { sendPlatformNotice } from "@ed/core/comms";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";

// W7: notices to BUSINESSES only. Who receives one is decided in @ed/core/comms from the
// business team table — there is no field here in which an address could be typed.

export const sendNoticeAction = staffAction(
  z.object({
    subject: z.string().max(200),
    body: z.string().max(5000),
    audience: z.enum(["all", "category", "county"], "common.validation.required"),
    categoryId: z.string().max(64).optional(),
    countyCode: z.string().max(3).optional(),
  }),
  async (ctx, input) => {
    const notice = await sendPlatformNotice(ctx, input);
    revalidatePath("/console/communications");
    return { businesses: notice.businessCount, emails: notice.emailCount };
  },
);
