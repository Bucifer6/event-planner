"use server";

import { FORM_STAMP_FIELD, HONEYPOT_FIELD } from "@ed/core/ratelimit";
import { CONTENT_REPORT_REASONS, submitContentReport } from "@ed/core/reports";
import { z } from "zod";
import { action } from "@/lib/action";

/**
 * LAU8 notice-and-action intake. Public: no account needed. The bot guard (honeypot, render
 * stamp, per-IP limit) runs inside submitContentReport.
 */
export const submitReport = action(
  z.object({
    targetRef: z.string().trim().min(3, "common.validation.required").max(500, "common.validation.tooLong"),
    targetType: z.string().max(60).optional(),
    targetId: z.string().max(64).optional(),
    reasonCategory: z.enum(CONTENT_REPORT_REASONS, "common.validation.required"),
    description: z.string().trim().min(10, "report.errors.descriptionTooShort").max(4000, "common.validation.tooLong"),
    reporterContact: z.string().max(320).optional(),
    [HONEYPOT_FIELD]: z.string().max(500).optional(),
    [FORM_STAMP_FIELD]: z.string().max(200).optional(),
  }),
  async (ctx, input) => {
    const { reference } = await submitContentReport(ctx, {
      targetRef: input.targetRef,
      targetType: input.targetType || undefined,
      targetId: input.targetId || undefined,
      reasonCategory: input.reasonCategory,
      description: input.description,
      reporterContact: input.reporterContact,
      honeypot: input[HONEYPOT_FIELD],
      renderedAt: input[FORM_STAMP_FIELD],
    });
    return { reference };
  },
  { auth: "public" },
);
