"use server";

import {
  COMPLIANCE_ACCESS_DEFAULT_HOURS,
  COMPLIANCE_ACCESS_MAX_HOURS,
  findComplianceSubject,
  requestComplianceAccess,
  revokeComplianceAccess,
} from "@ed/core/complianceaccess";
import { zEmail } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";

// Compliance access (W8, three-person rule). Roles and rules are checked in
// @ed/core/complianceaccess; these actions only translate the form.

function refresh(): void {
  revalidatePath("/console", "layout");
}

export const requestComplianceAccessAction = staffAction(
  z.object({
    email: zEmail,
    legalReason: z.string().trim().min(10, "deploys.compliance.errors.reason").max(1000, "common.validation.tooLong"),
    hours: z.coerce.number("common.validation.invalid").int("common.validation.invalid").min(1, "common.validation.tooSmall").max(COMPLIANCE_ACCESS_MAX_HOURS, "common.validation.tooBig").default(COMPLIANCE_ACCESS_DEFAULT_HOURS),
  }),
  async (ctx, input) => {
    const subject = await findComplianceSubject(ctx, { email: input.email });
    const res = await requestComplianceAccess(ctx, { ...subject, legalReason: input.legalReason, hours: input.hours });
    refresh();
    return res;
  },
);

export const revokeComplianceAccessAction = staffAction(z.object({ id: z.string().min(1).max(64) }), async (ctx, input) => {
  await revokeComplianceAccess(ctx, input);
  refresh();
  return { revoked: true };
});
