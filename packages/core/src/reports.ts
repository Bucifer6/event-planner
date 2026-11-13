import {
  and,
  contentReportReasonSchema,
  contentReports,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  type ContentReportState,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import { z } from "zod";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { checkPublicForm } from "./ratelimit";
import { registerRetentionRule } from "./retention";
import { requireStaffRole } from "./staff";
import { inTx } from "./tx";

// DSA notice-and-action (LAU8, Regulation (EU) 2022/2065 art. 16–17): anyone can report
// illegal content or an unlawful listing; every report and every decision is logged, and the
// decision carries the reason that is given to the affected party.
//
//   public form  → submitContentReport(ctx, …)                 state "received"
//   console      → startContentReportReview(staffCtx, id)      state "reviewing"
//                → decideContentReport(staffCtx, { id, decision, reasonGivenToAffected })
//                                                              state "actioned" | "dismissed"
//
// Acting on the content itself (restricting a listing or business, W3) and telling the
// affected business belong to the business-moderation domain: it registers
// onContentReportDecided(fn) and receives every decision inside the deciding transaction.
//
// Reporter contact (SEC8 spirit): kept as a hash (to spot repeat reports) AND in plain text,
// because the reporter must be told the outcome (art. 16(5)) and a hash cannot be written to.
// It is visible only to the moderating roles, never written to the audit log, and erased six
// months after the decision (the art. 20 complaint window) by a retention rule.

export { CONTENT_REPORT_REASONS, CONTENT_REPORT_STATES } from "@ed/db";
export type { ContentReportReason, ContentReportState } from "@ed/db";

export type ContentReport = typeof contentReports.$inferSelect;

const MODERATION_ROLES = ["listing_moderator", "platform_admin"] as const;
export const REPORT_CONTACT_RETENTION_DAYS = 183;
export const REPORT_FORM_KEY = "content_report";

const submitInput = z.object({
  /** URL or listing reference, as the reporter wrote it. */
  targetRef: z.string().trim().min(3, "common.validation.required").max(500, "common.validation.tooLong"),
  /** Set by in-app "report" links that know the object (e.g. "listing" + its id). */
  targetType: z.string().trim().max(60).regex(/^[a-z][a-z_]*$/).optional(),
  targetId: z.string().trim().max(64).optional(),
  reasonCategory: contentReportReasonSchema,
  description: z
    .string()
    .trim()
    .min(10, "report.errors.descriptionTooShort")
    .max(4000, "common.validation.tooLong"),
  /** Optional email address for the answer. */
  reporterContact: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.email("common.validation.invalidEmail").trim().toLowerCase().max(320).optional(),
  ),
  honeypot: z.string().nullish(),
  renderedAt: z.union([z.string(), z.number(), z.date()]).nullish(),
});
export type SubmitContentReportInput = z.input<typeof submitInput>;

function newReference(): string {
  return `R-${randomToken(16).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase().padEnd(8, "X")}`;
}

/**
 * Public intake. No account needed. Guarded by the bot check and a per-IP limit (SEC11);
 * creates the case and its audit row. Returns the reference to show the reporter.
 */
export async function submitContentReport(
  ctx: Ctx,
  input: SubmitContentReportInput,
): Promise<{ id: string; reference: string }> {
  const data = submitInput.parse(input);
  const hasTarget = !!data.targetType && !!data.targetId;
  // Before the transaction, so the counters stay counted even when the insert fails.
  await checkPublicForm(ctx, {
    formKey: REPORT_FORM_KEY,
    linkKey: hasTarget ? `${data.targetType}:${data.targetId}` : null,
    honeypot: data.honeypot,
    renderedAt: data.renderedAt,
    perIpPerHour: 5,
    perLinkPerHour: 30,
  });
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(contentReports)
      .values({
        reference: newReference(),
        targetRef: data.targetRef,
        targetType: hasTarget ? data.targetType! : null,
        targetId: hasTarget ? data.targetId! : null,
        reasonCategory: data.reasonCategory,
        description: data.description,
        reporterContactHash: data.reporterContact ? hashToken(data.reporterContact) : null,
        reporterContact: data.reporterContact ?? null,
        locale: tx.locale,
        state: "received",
        createdAt: tx.now,
      })
      .returning({ id: contentReports.id, reference: contentReports.reference });
    await audit(tx, {
      action: "content_report.received",
      objectType: "content_report",
      objectId: row!.id,
      after: {
        reference: row!.reference,
        targetRef: data.targetRef,
        targetType: hasTarget ? data.targetType : null,
        targetId: hasTarget ? data.targetId : null,
        reasonCategory: data.reasonCategory,
        hasReporterContact: !!data.reporterContact,
      },
    });
    return row!;
  });
}

export type ContentReportListItem = ContentReport & {
  /** Other reports sent from the same contact (0 when anonymous). */
  otherReportsBySameReporter: number;
};

export async function listContentReports(
  ctx: Ctx,
  input: { state?: ContentReportState | "open" | "all"; limit?: number } = {},
): Promise<ContentReportListItem[]> {
  requireStaffRole(ctx, ...MODERATION_ROLES);
  const state = input.state ?? "open";
  const rows = await ctx.db
    .select()
    .from(contentReports)
    .where(
      state === "all"
        ? undefined
        : state === "open"
          ? inArray(contentReports.state, ["received", "reviewing"])
          : eq(contentReports.state, state),
    )
    .orderBy(desc(contentReports.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
  const hashes = [...new Set(rows.map((r) => r.reporterContactHash).filter((h): h is string => !!h))];
  const counts = hashes.length
    ? await ctx.db
        .select({ hash: contentReports.reporterContactHash, n: count() })
        .from(contentReports)
        .where(inArray(contentReports.reporterContactHash, hashes))
        .groupBy(contentReports.reporterContactHash)
    : [];
  const byHash = new Map(counts.map((c) => [c.hash, c.n]));
  return rows.map((r) => ({
    ...r,
    otherReportsBySameReporter: r.reporterContactHash
      ? Math.max(0, (byHash.get(r.reporterContactHash) ?? 1) - 1)
      : 0,
  }));
}

export async function getContentReport(ctx: Ctx, id: string): Promise<ContentReport> {
  requireStaffRole(ctx, ...MODERATION_ROLES);
  const [row] = await ctx.db.select().from(contentReports).where(eq(contentReports.id, id));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** Open reports about one object — for the business-moderation screens. */
export async function listContentReportsForTarget(
  ctx: Ctx,
  input: { targetType: string; targetId: string },
): Promise<ContentReport[]> {
  requireStaffRole(ctx, ...MODERATION_ROLES);
  return ctx.db
    .select()
    .from(contentReports)
    .where(and(eq(contentReports.targetType, input.targetType), eq(contentReports.targetId, input.targetId)))
    .orderBy(desc(contentReports.createdAt));
}

/** Marks a received report as being looked at. Idempotent. */
export async function startContentReportReview(ctx: Ctx, id: string): Promise<void> {
  requireStaffRole(ctx, ...MODERATION_ROLES);
  const updated = await ctx.db
    .update(contentReports)
    .set({ state: "reviewing" })
    .where(and(eq(contentReports.id, id), eq(contentReports.state, "received")))
    .returning({ id: contentReports.id });
  if (updated[0]) {
    await audit(ctx, {
      action: "content_report.review_started",
      objectType: "content_report",
      objectId: id,
      before: { state: "received" },
      after: { state: "reviewing" },
    });
  }
}

export type ContentReportDecision = {
  report: ContentReport;
  decision: "actioned" | "dismissed";
  reasonGivenToAffected: string;
};
export type ContentReportDecidedHook = (ctx: Ctx, decision: ContentReportDecision) => Promise<void>;

const g = globalThis as unknown as { __edReportDecidedHooks?: ContentReportDecidedHook[] };
function hooks(): ContentReportDecidedHook[] {
  return (g.__edReportDecidedHooks ??= []);
}

/**
 * Runs inside the deciding transaction for every decision. The business-moderation domain
 * registers here to apply the W3 restriction when `decision` is "actioned" and to deliver
 * `reasonGivenToAffected` to the affected business; a notifier may answer the reporter
 * (report.reporterContact). A hook that throws rolls the decision back.
 */
export function onContentReportDecided(fn: ContentReportDecidedHook): void {
  if (!hooks().includes(fn)) hooks().push(fn);
}

const decideInput = z.object({
  id: z.string().min(1).max(64),
  decision: z.enum(["actioned", "dismissed"]),
  reasonGivenToAffected: z
    .string()
    .trim()
    .min(10, "console.errors.reasonRequired")
    .max(2000, "common.validation.tooLong"),
  internalNote: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(2000).optional(),
  ),
});

/**
 * Closes a report. `reasonGivenToAffected` is mandatory for BOTH outcomes: it is the
 * statement of reasons the affected party receives (LAU8) and it is written to the audit log.
 */
export async function decideContentReport(
  ctx: Ctx,
  input: z.input<typeof decideInput>,
): Promise<ContentReport> {
  const staffId = requireStaffRole(ctx, ...MODERATION_ROLES);
  const data = decideInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db
      .select()
      .from(contentReports)
      .where(eq(contentReports.id, data.id))
      .for("update");
    if (!before) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (before.state === "actioned" || before.state === "dismissed") {
      throw new AppError("CONFLICT", "console.errors.alreadyDecided");
    }
    const [row] = await tx.db
      .update(contentReports)
      .set({
        state: data.decision,
        reasonGivenToAffected: data.reasonGivenToAffected,
        internalNote: data.internalNote ?? before.internalNote,
        decidedByStaffId: staffId,
        decidedAt: tx.now,
      })
      .where(eq(contentReports.id, data.id))
      .returning();
    await audit(tx, {
      action: "content_report.decided",
      objectType: "content_report",
      objectId: data.id,
      before: { state: before.state },
      after: { state: data.decision, reasonGivenToAffected: data.reasonGivenToAffected },
      meta: { reference: before.reference, targetType: before.targetType, targetId: before.targetId },
    });
    for (const hook of hooks()) {
      await hook(tx, { report: row!, decision: data.decision, reasonGivenToAffected: data.reasonGivenToAffected });
    }
    return row!;
  });
}

/** Counts by state — for the console dashboard and the annual transparency report (LAU8). */
export async function countContentReports(ctx: Ctx): Promise<Record<ContentReportState, number>> {
  requireStaffRole(ctx);
  const rows = await ctx.db
    .select({ state: contentReports.state, n: count() })
    .from(contentReports)
    .groupBy(contentReports.state);
  const out: Record<ContentReportState, number> = { received: 0, reviewing: 0, actioned: 0, dismissed: 0 };
  for (const r of rows) out[r.state] = r.n;
  return out;
}

export function registerJobs(): void {
  registerRetentionRule({
    name: "content-report-contacts",
    run: async (ctx) => {
      const cutoff = new Date(ctx.now.getTime() - REPORT_CONTACT_RETENTION_DAYS * 24 * 60 * 60_000);
      const rows = await ctx.db
        .update(contentReports)
        .set({ reporterContact: null })
        .where(and(isNotNull(contentReports.reporterContact), lt(contentReports.decidedAt, cutoff)))
        .returning({ id: contentReports.id });
      return rows.length;
    },
  });
}
