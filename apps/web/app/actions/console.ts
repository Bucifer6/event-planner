"use server";

import {
  approveRequest,
  cancelRequest,
  rejectRequest,
  requestApproval,
  SIGN_IN_LIMITS_ACTION,
  STAFF_SET_ROLES_ACTION,
} from "@ed/core/approvals";
import { LAUNCH_ITEMS, LAUNCH_STATUSES, setLaunchItem, setLaunchRecords, setLegalPublished } from "@ed/core/compliance";
import { createIncident, resolveIncident } from "@ed/core/incidents";
import { SIGN_IN_LIMIT_DEFAULTS } from "@ed/core/ratelimit";
import { decideContentReport, startContentReportReview } from "@ed/core/reports";
import { endConsoleSession, findAccountForStaff, requireStaffRole, STAFF_ROLES, type StaffRole } from "@ed/core/staff";
import { zEmail, zFormBoolean, zId, zOptionalText } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";

// Console Server Actions. Every one is a staffAction: it runs only for an active staff
// member with two-step sign-in and a live console session (S5); roles are checked in
// @ed/core. There is deliberately NO action here that edits or deletes audit entries.

const zReason = z.string().trim().min(3, "common.validation.required").max(1000, "common.validation.tooLong");
const none = z.object({});

function refresh(): void {
  revalidatePath("/console", "layout");
}

/* ── Approvals (W9) ─────────────────────────────────────────────────────── */

export const approveApproval = staffAction(z.object({ id: zId }), async (ctx, input) => {
  const res = await approveRequest(ctx, input.id);
  refresh();
  return { executed: res.executed, remaining: res.remaining };
});

export const rejectApproval = staffAction(z.object({ id: zId, reason: zReason }), async (ctx, input) => {
  await rejectRequest(ctx, input.id, { reason: input.reason });
  refresh();
  return { rejected: true };
});

export const cancelApproval = staffAction(z.object({ id: zId }), async (ctx, input) => {
  await cancelRequest(ctx, input.id);
  refresh();
  return { cancelled: true };
});

/* ── Access (W8): role changes always go through a second platform admin ── */

const roleFields = Object.fromEntries(STAFF_ROLES.map((r) => [`role_${r}`, zFormBoolean.optional()])) as Record<
  `role_${StaffRole}`,
  z.ZodOptional<typeof zFormBoolean>
>;

export const requestStaffRoles = staffAction(
  z.object({ email: zEmail, reason: zReason, ...roleFields }),
  async (ctx, input) => {
    const roles = STAFF_ROLES.filter((r) => input[`role_${r}`] === true);
    const account = await findAccountForStaff(ctx, { email: input.email });
    const request = await requestApproval(ctx, {
      action: STAFF_SET_ROLES_ACTION,
      payload: { accountId: account.accountId, label: account.label, roles },
      reason: input.reason,
    });
    refresh();
    return { requestId: request.id, singleOperatorMode: request.singleOperatorMode };
  },
);

/* ── Operations: sign-in limits change through a second security administrator ── */

const limitKeys = Object.keys(SIGN_IN_LIMIT_DEFAULTS) as Array<keyof typeof SIGN_IN_LIMIT_DEFAULTS>;
const zLimit = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number("common.validation.invalid").int("common.validation.invalid").min(1, "common.validation.tooSmall").max(100_000, "common.validation.tooBig").optional(),
);

export const requestSignInLimits = staffAction(
  z.object({ reason: zReason, ...(Object.fromEntries(limitKeys.map((k) => [k, zLimit])) as Record<(typeof limitKeys)[number], typeof zLimit>) }),
  async (ctx, input) => {
    const payload: Record<string, number> = {};
    for (const key of limitKeys) {
      const value = input[key];
      // only what differs from the built-in default is stored as an override
      if (typeof value === "number" && value !== SIGN_IN_LIMIT_DEFAULTS[key]) payload[key] = value;
    }
    const request = await requestApproval(ctx, { action: SIGN_IN_LIMITS_ACTION, payload, reason: input.reason });
    refresh();
    return { requestId: request.id, singleOperatorMode: request.singleOperatorMode };
  },
);

/* ── Incidents (LAU5) ───────────────────────────────────────────────────── */

export const openIncident = staffAction(
  z.object({ messageRo: zOptionalText(500), messageEn: zOptionalText(500), internalNote: zOptionalText(2000) }),
  async (ctx, input) => {
    requireStaffRole(ctx, "security_administrator");
    const incident = await createIncident(ctx, input);
    refresh();
    return { id: incident.id };
  },
);

export const closeIncident = staffAction(z.object({ id: zId }), async (ctx, input) => {
  requireStaffRole(ctx, "security_administrator");
  await resolveIncident(ctx, input.id);
  refresh();
  return { resolved: true };
});

/* ── Launch checklist and legal records (LAU1–LAU9) ─────────────────────── */

export const saveLaunchItem = staffAction(
  z.object({
    item: z.enum(LAUNCH_ITEMS),
    status: z.enum(LAUNCH_STATUSES),
    evidenceRef: z.string().max(500, "common.validation.tooLong").optional(),
    note: z.string().max(2000, "common.validation.tooLong").optional(),
  }),
  async (ctx, input) => {
    await setLaunchItem(ctx, input);
    refresh();
    return { saved: true };
  },
);

const zLooseText = z.string().max(2000, "common.validation.tooLong").optional();
const zDay = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "common.validation.invalid")]).optional(),
);

export const saveLaunchRecords = staffAction(
  z.object({
    anspdcpReference: zLooseText,
    anspdcpDate: zDay,
    processingRegistryRef: zLooseText,
    dpiaReference: zLooseText,
    dpiaSignedOn: zDay,
    dpiaSignedBy: zLooseText,
    dpiaLastReviewedOn: zDay,
    ancomReference: zLooseText,
    ancomDate: zDay,
    dsaContactPoint: zLooseText,
    accessibilityStatementDate: zDay,
    accessibilityEvaluationMethod: zLooseText,
  }),
  async (ctx, input) => {
    await setLaunchRecords(ctx, input);
    refresh();
    return { saved: true };
  },
);

export const saveLegalPublished = staffAction(
  z.object({
    termsVersion: zLooseText,
    termsPublishedOn: zDay,
    businessTermsVersion: zLooseText,
    businessTermsPublishedOn: zDay,
    privacyVersion: zLooseText,
    privacyPublishedOn: zDay,
    cookiesVersion: zLooseText,
    cookiesPublishedOn: zDay,
  }),
  async (ctx, input) => {
    await setLegalPublished(ctx, input);
    refresh();
    revalidatePath("/sign-in", "layout");
    return { saved: true };
  },
);

/* ── Content reports (LAU8) ─────────────────────────────────────────────── */

export const beginReportReview = staffAction(z.object({ id: zId }), async (ctx, input) => {
  await startContentReportReview(ctx, input.id);
  refresh();
  return { started: true };
});

export const decideReport = staffAction(
  z.object({
    id: zId,
    decision: z.enum(["actioned", "dismissed"], "common.validation.required"),
    reasonGivenToAffected: z.string().trim().min(10, "console.errors.reasonRequired").max(2000, "common.validation.tooLong"),
    internalNote: zOptionalText(2000),
  }),
  async (ctx, input) => {
    await decideContentReport(ctx, input);
    refresh();
    redirect("/console/reports?decided=1");
  },
);

/* ── Session ────────────────────────────────────────────────────────────── */

/** Ends the console session on purpose; the ordinary app session stays signed in. */
export const leaveConsole = staffAction(none, async (ctx) => {
  await endConsoleSession(ctx);
  redirect("/occasions");
});
