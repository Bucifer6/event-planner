"use server";

import { acceptQuote, closeEnquiry, replyAsPlanner, reportEnquiry, resendEnquiry, sendEnquiry, sendQuoteRequest } from "@ed/core/enquiries";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";

// Enquiry Server Actions (P8–P12, P33, F5, F6). Limits, the unclaimed rule, access and what
// is shared are all decided in @ed/core/enquiries; these only shape the form input.

const text = (max: number) => z.string().max(max, "common.validation.tooLong").default("");
const fieldError = (field: string, key: string) => new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { [field]: [key] } });

/**
 * The enquiry form (both kinds). `mode=quote` is the flower quote request: it sends ONLY the
 * arrangement, date, guests and message — the other fields are not even read.
 */
export const sendEnquiryAction = action(
  z.object({
    occasionId: zId,
    listingId: zId,
    mode: z.enum(["enquiry", "quote"]).default("enquiry"),
    occasionKind: text(40),
    date: text(10),
    guests: text(8),
    countyCode: text(4),
    localityId: text(64),
    budgetBand: text(30),
    message: text(4000),
    description: text(4000),
    imageAssetId: text(64),
    shareEmail: z.string().max(5).optional(),
    idempotencyKey: z.string().min(8).max(100),
  }),
  async (ctx, input) => {
    const shareEmail = input.shareEmail === "on";
    let result: { enquiryId: string };
    if (input.mode === "quote") {
      if (input.description.trim() === "") throw fieldError("description", "enquiries.errors.arrangementRequired");
      result = await sendQuoteRequest(ctx, {
        occasionId: input.occasionId,
        listingId: input.listingId,
        arrangement: { description: input.description, imageAssetId: input.imageAssetId },
        date: input.date,
        guests: input.guests,
        message: input.message,
        shareEmail,
        idempotencyKey: input.idempotencyKey,
      });
    } else {
      if (input.message.trim() === "") throw fieldError("message", "enquiries.errors.messageRequired");
      result = await sendEnquiry(ctx, {
        occasionId: input.occasionId,
        listingId: input.listingId,
        occasionKind: input.occasionKind as never,
        date: input.date,
        guests: input.guests,
        countyCode: input.countyCode,
        localityId: input.localityId,
        budgetBand: input.budgetBand as never,
        message: input.message,
        shareEmail,
        idempotencyKey: input.idempotencyKey,
      });
    }
    revalidatePath(`/occasions/${input.occasionId}/suppliers`, "layout");
    redirect(`/occasions/${input.occasionId}/suppliers/enquiries/${result.enquiryId}?sent=1`);
  },
);

const threadRef = z.object({ enquiryId: zId, occasionId: zId.optional(), businessId: zId.optional() });
function refresh(input: { occasionId?: string; businessId?: string }): void {
  if (input.occasionId) revalidatePath(`/occasions/${input.occasionId}/suppliers`, "layout");
  if (input.businessId) revalidatePath(`/business/${input.businessId}/enquiries`, "layout");
}

export const replyPlannerAction = action(threadRef.extend({ body: z.string().trim().min(1, "enquiries.errors.messageRequired").max(4000, "common.validation.tooLong") }), async (ctx, input) => {
  await replyAsPlanner(ctx, { enquiryId: input.enquiryId, body: input.body });
  refresh(input);
  return { sent: true };
});

/** Either side closes the thread (core decides which side the actor is on). */
export const closeEnquiryAction = action(threadRef, async (ctx, input) => {
  const res = await closeEnquiry(ctx, { enquiryId: input.enquiryId });
  refresh(input);
  return res;
});

export const resendEnquiryAction = action(threadRef, async (ctx, input) => {
  await resendEnquiry(ctx, { enquiryId: input.enquiryId });
  refresh(input);
  return { resent: true };
});

export const reportEnquiryAction = action(
  threadRef.extend({
    reasonCategory: z.enum(["illegal_content", "fraud", "intellectual_property", "privacy", "false_information", "offensive", "other"], "common.validation.required"),
    description: z.string().trim().min(10, "report.errors.descriptionTooShort").max(4000, "common.validation.tooLong"),
  }),
  async (ctx, input) => {
    const res = await reportEnquiry(ctx, { enquiryId: input.enquiryId, reasonCategory: input.reasonCategory, description: input.description });
    refresh(input);
    return res;
  },
);

export const acceptQuoteAction = action(threadRef.extend({ messageId: zId, agreedAmount: z.string().max(30).optional() }), async (ctx, input) => {
  const res = await acceptQuote(ctx, { enquiryId: input.enquiryId, messageId: input.messageId, agreedAmount: input.agreedAmount });
  refresh(input);
  if (input.occasionId) revalidatePath(`/occasions/${input.occasionId}/budget`);
  return res;
});
