import {
  accounts,
  and,
  approvalDecisions,
  billingAcceptances,
  businesses,
  desc,
  eq,
  monetizationHistory,
  monetizationReminders,
  monetizationSwitch,
  MONETIZATION_SWITCH_ID,
  ne,
  type MonetizationState,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob, enqueue } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { addDays } from "@ed/shared/time";
import { z } from "zod";
import { registerApprovalAction, requestApproval, type ApprovalRequest } from "./approvals";
import { audit } from "./audit";
import { addBusinessNotice } from "./business";
import type { Ctx } from "./context";
import { isSingleOperatorMode, requireStaffRole } from "./staff";
import { inTx } from "./tx";

// The monetization switch (MON1–MON5, P28).
//
//   isMonetizationOn(ctx)            THE gate. False unless the switch is ON *and* its
//                                    effective date has come. Every pricing, checkout, plan
//                                    purchase and Featured code path asks this first.
//   getMonetizationState(ctx)        { state, phase: "off" | "notice" | "on", dates }
//   recordBillingAcceptance(staff)   MON4: the test-mode acceptance of the billing stack
//   requestMonetizationEnable / requestMonetizationDisable(staff, { reason })
//                                    approval actions "monetization.enable" / ".disable":
//                                    a commercial manager asks, a platform admin approves.
//
// Turning it ON is REFUSED without a recorded acceptance and while fewer than two people
// hold a staff role (W9, M4). When approved it records the 60-day notice (noticeStartsAt,
// effectiveAt = +60 days), tells every business now and again 30 and 7 days before, and only
// takes effect at effectiveAt. Nothing is ever charged automatically (P28).

export const NOTICE_DAYS = 60;
export const REMINDER_DAYS = [60, 30, 7] as const;
export const MONETIZATION_ENABLE_ACTION = "monetization.enable";
export const MONETIZATION_DISABLE_ACTION = "monetization.disable";
export const MONETIZATION_ROLES = ["commercial_manager", "platform_admin"] as const;

/**
 * P23 / P28 — THE PERMANENT FREE TIER. What every business keeps for good, whether or not it
 * ever buys anything, and what a lapsed Business plan stops. Code that gates a capability
 * names it from these lists; nothing else may be taken away by a lapse (invariant 8).
 */
export const PERMANENT_FREE_TIER = [
  "account", // the business account and its team
  "listing", // existing listings stay live and can be corrected
  "enquiries", // receiving and answering enquiries
  "assets", // drawings and catalogues already published; files already shared
  "ownStatistics", // its own listing and response statistics
  "existingOccasions", // every business occasion that exists stays fully usable, team access included
  "handover", // an occasion can always be handed to the client
] as const;
export const BUSINESS_PLAN_CAPABILITIES = [
  "newBusinessOccasions", // creating a business occasion
  "brandingChanges", // changing name / logo / accent on guest pages (what is set stays)
  "libraryEdits", // adding, changing or sharing library items (applying existing ones stays)
  "newListings", // guarded in @ed/core/listings (assertBusinessCanCreate)
] as const;
export type FreeTierCapability = (typeof PERMANENT_FREE_TIER)[number];
export type BusinessPlanCapability = (typeof BUSINESS_PLAN_CAPABILITIES)[number];

export type MonetizationPhase = "off" | "notice" | "on";
export type MonetizationView = { state: MonetizationState; phase: MonetizationPhase; noticeStartsAt: Date | null; effectiveAt: Date | null };

export async function getMonetizationState(ctx: Pick<Ctx, "db" | "now">): Promise<MonetizationView> {
  const [row] = await ctx.db.select().from(monetizationSwitch).where(eq(monetizationSwitch.id, MONETIZATION_SWITCH_ID));
  if (!row || row.state !== "on" || !row.effectiveAt) return { state: "off", phase: "off", noticeStartsAt: null, effectiveAt: null };
  return { state: "on", phase: row.effectiveAt.getTime() <= ctx.now.getTime() ? "on" : "notice", noticeStartsAt: row.noticeStartsAt, effectiveAt: row.effectiveAt };
}

/** True only when paid tiers are in force: switch ON and the notice period over. Default: false. */
export async function isMonetizationOn(ctx: Pick<Ctx, "db" | "now">): Promise<boolean> {
  return (await getMonetizationState(ctx)).phase === "on";
}

/** MON1: while off, a billing code path does not exist — NOT_FOUND, not "forbidden". */
export async function assertMonetizationOn(ctx: Pick<Ctx, "db" | "now">): Promise<void> {
  if (!(await isMonetizationOn(ctx))) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
}

/* ── Billing acceptance (MON4) ─────────────────────────────────────────── */

export type BillingAcceptance = typeof billingAcceptances.$inferSelect;
const acceptanceInput = z.object({
  evidenceRef: z.string().trim().min(3, "common.validation.required").max(300, "common.validation.tooLong"),
  notes: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(2000, "common.validation.tooLong").optional()),
});

/** Records that the billing stack passed its acceptance run in TEST mode (P24–P26, PAY1–PAY5). */
export async function recordBillingAcceptance(ctx: Ctx, input: z.input<typeof acceptanceInput>): Promise<BillingAcceptance> {
  const staffId = requireStaffRole(ctx, ...MONETIZATION_ROLES);
  const data = acceptanceInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db.insert(billingAcceptances).values({ recordedByStaffId: staffId, evidenceRef: data.evidenceRef, notes: data.notes ?? null, at: tx.now }).returning();
    await audit(tx, { action: "billing.acceptance_recorded", objectType: "billing_acceptance", objectId: row!.id, after: { evidenceRef: data.evidenceRef } });
    return row!;
  });
}

export async function getLatestAcceptance(ctx: Pick<Ctx, "db">): Promise<BillingAcceptance | null> {
  const [row] = await ctx.db.select().from(billingAcceptances).orderBy(desc(billingAcceptances.at)).limit(1);
  return row ?? null;
}

/* ── The switch ────────────────────────────────────────────────────────── */

async function assertCanEnable(ctx: Ctx): Promise<BillingAcceptance> {
  const acceptance = await getLatestAcceptance(ctx);
  if (!acceptance) throw new AppError("CONFLICT", "billing.errors.acceptanceMissing");
  if (await isSingleOperatorMode(ctx)) throw new AppError("FORBIDDEN", "billing.errors.singleOperator");
  if ((await getMonetizationState(ctx)).state === "on") throw new AppError("CONFLICT", "billing.errors.alreadyOn");
  return acceptance;
}

async function approversOf(tx: Ctx, requestId: string): Promise<string[]> {
  const rows = await tx.db
    .select({ staffId: approvalDecisions.staffId })
    .from(approvalDecisions)
    .where(and(eq(approvalDecisions.requestId, requestId), eq(approvalDecisions.decision, "approved")));
  return rows.map((r) => r.staffId);
}

registerApprovalAction<Record<string, never>>(MONETIZATION_ENABLE_ACTION, {
  roles: ["commercial_manager"],
  approverRoles: ["platform_admin"],
  input: z.object({}).strict() as z.ZodType<Record<string, never>>,
  describe: () => ({ key: "billing.approvals.enable", params: { days: NOTICE_DAYS } }),
  execute: async (tx, _payload, request) => {
    // re-checked at approval time: the acceptance and the second person must still be there
    const acceptance = await assertCanEnable(tx);
    const noticeStartsAt = tx.now;
    const effectiveAt = addDays(tx.now, NOTICE_DAYS);
    await tx.db
      .insert(monetizationSwitch)
      .values({ id: MONETIZATION_SWITCH_ID, state: "on", noticeStartsAt, effectiveAt })
      .onConflictDoUpdate({ target: monetizationSwitch.id, set: { state: "on", noticeStartsAt, effectiveAt, updatedAt: tx.now } });
    await tx.db.insert(monetizationHistory).values({
      change: "enable",
      requestedByStaffId: request.requesterStaffId,
      approverStaffIds: await approversOf(tx, request.id),
      approvalRequestId: request.id,
      acceptanceId: acceptance.id,
      noticeStartsAt,
      effectiveAt,
      at: tx.now,
    });
    // P28: the notice now, reminders 30 and 7 days before. Jobs join this transaction.
    for (const days of REMINDER_DAYS) {
      await enqueue(
        tx,
        NOTICE_REMINDER_JOB,
        { effectiveAt: effectiveAt.toISOString(), daysBefore: days },
        { runAt: addDays(effectiveAt, -days), uniqueKey: `monetization.notice:${effectiveAt.toISOString()}:${days}` },
      );
    }
    await audit(tx, {
      action: "monetization.enabled",
      objectType: "monetization_switch",
      objectId: MONETIZATION_SWITCH_ID,
      before: { state: "off" },
      after: { state: "on", noticeStartsAt, effectiveAt },
      meta: { requesterStaffId: request.requesterStaffId, approvalRequestId: request.id, acceptanceId: acceptance.id },
    });
  },
});

registerApprovalAction<Record<string, never>>(MONETIZATION_DISABLE_ACTION, {
  roles: ["commercial_manager"],
  approverRoles: ["platform_admin"],
  input: z.object({}).strict() as z.ZodType<Record<string, never>>,
  describe: () => ({ key: "billing.approvals.disable" }),
  execute: async (tx, _payload, request) => {
    const before = await getMonetizationState(tx);
    if (before.state === "off") throw new AppError("CONFLICT", "billing.errors.alreadyOff");
    await tx.db.update(monetizationSwitch).set({ state: "off", noticeStartsAt: null, effectiveAt: null, updatedAt: tx.now }).where(eq(monetizationSwitch.id, MONETIZATION_SWITCH_ID));
    // MON1: with the switch off everything is free again — no business stays lapsed
    await tx.db.update(businesses).set({ planLapsedAt: null }).where(ne(businesses.id, ""));
    await tx.db.insert(monetizationHistory).values({
      change: "disable",
      requestedByStaffId: request.requesterStaffId,
      approverStaffIds: await approversOf(tx, request.id),
      approvalRequestId: request.id,
      at: tx.now,
    });
    await audit(tx, {
      action: "monetization.disabled",
      objectType: "monetization_switch",
      objectId: MONETIZATION_SWITCH_ID,
      before: { state: "on", noticeStartsAt: before.noticeStartsAt, effectiveAt: before.effectiveAt },
      after: { state: "off" },
      meta: { requesterStaffId: request.requesterStaffId, approvalRequestId: request.id },
    });
  },
});

const reasonInput = z.object({ reason: z.string().trim().min(10, "billing.errors.reasonRequired").max(1000, "common.validation.tooLong") });

/** Asks for the switch to be turned ON. Refused outright without an acceptance or a second person. */
export async function requestMonetizationEnable(ctx: Ctx, input: z.input<typeof reasonInput>): Promise<ApprovalRequest> {
  requireStaffRole(ctx, "commercial_manager");
  const data = reasonInput.parse(input);
  await assertCanEnable(ctx);
  return requestApproval(ctx, { action: MONETIZATION_ENABLE_ACTION, payload: {}, reason: data.reason });
}

export async function requestMonetizationDisable(ctx: Ctx, input: z.input<typeof reasonInput>): Promise<ApprovalRequest> {
  requireStaffRole(ctx, "commercial_manager");
  const data = reasonInput.parse(input);
  if ((await getMonetizationState(ctx)).state === "off") throw new AppError("CONFLICT", "billing.errors.alreadyOff");
  return requestApproval(ctx, { action: MONETIZATION_DISABLE_ACTION, payload: {}, reason: data.reason });
}

export type MonetizationHistoryRow = typeof monetizationHistory.$inferSelect;

/** W6: the switch, its history and the acceptance record. Commercial manager or platform admin. */
export async function getMonetizationConsole(ctx: Ctx): Promise<{
  view: MonetizationView;
  history: MonetizationHistoryRow[];
  acceptance: BillingAcceptance | null;
  singleOperator: boolean;
  reminders: Array<{ daysBefore: number; at: Date; sentAt: Date | null; businesses: number | null }>;
}> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  const view = await getMonetizationState(ctx);
  const history = await ctx.db.select().from(monetizationHistory).orderBy(desc(monetizationHistory.at)).limit(50);
  const sent = view.effectiveAt ? await ctx.db.select().from(monetizationReminders).where(eq(monetizationReminders.effectiveAt, view.effectiveAt)) : [];
  return {
    view,
    history,
    acceptance: await getLatestAcceptance(ctx),
    singleOperator: await isSingleOperatorMode(ctx),
    reminders: view.effectiveAt
      ? REMINDER_DAYS.map((d) => {
          const s = sent.find((x) => x.daysBefore === d);
          return { daysBefore: d, at: addDays(view.effectiveAt!, -d), sentAt: s?.sentAt ?? null, businesses: s?.businesses ?? null };
        })
      : [],
  };
}

/* ── Notice and reminders to businesses (P28) ──────────────────────────── */

export const NOTICE_REMINDER_JOB = "monetization.notice-reminder";
export const NOTICE_EMAIL_JOB = "monetization.notice-email";

type NoticeEmailParams = { businessName: string; daysBefore: number; date: string; url: string };
registerTemplate<NoticeEmailParams>("monetization.notice", (p, { t }) => ({
  subject: t("billing.email.subject", { date: p.date }),
  blocks: [
    { kind: "text", text: t(`billing.email.intro${p.daysBefore}`, { business: p.businessName, date: p.date }) },
    { kind: "text", text: t("billing.email.keep") },
    { kind: "note", text: t("billing.email.nothingAutomatic") },
    { kind: "button", label: t("billing.email.open"), url: p.url },
  ],
}));

function dateText(d: Date): string {
  const p = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

/** Sends one round (60, 30 or 7 days before) to every business — once, however often the job runs. */
export async function sendNoticeRound(ctx: Ctx, input: { effectiveAt: Date; daysBefore: number }): Promise<number> {
  const view = await getMonetizationState(ctx);
  // the switch was turned off, or re-enabled with other dates: this round is void
  if (view.state !== "on" || view.effectiveAt?.getTime() !== input.effectiveAt.getTime()) return 0;
  return inTx(ctx, async (tx) => {
    const claimed = await tx.db
      .insert(monetizationReminders)
      .values({ effectiveAt: input.effectiveAt, daysBefore: input.daysBefore, sentAt: tx.now })
      .onConflictDoNothing()
      .returning({ id: monetizationReminders.id });
    if (!claimed[0]) return 0;
    const rows = await tx.db.select({ id: businesses.id }).from(businesses);
    for (const b of rows) {
      await addBusinessNotice(tx, { businessId: b.id, kind: `monetization.notice${input.daysBefore}`, reason: dateText(input.effectiveAt) });
      await enqueue(
        tx,
        NOTICE_EMAIL_JOB,
        { businessId: b.id, daysBefore: input.daysBefore, effectiveAt: input.effectiveAt.toISOString() },
        { uniqueKey: `monetization.email:${input.effectiveAt.toISOString()}:${input.daysBefore}:${b.id}` },
      );
    }
    await tx.db.update(monetizationReminders).set({ businesses: rows.length }).where(eq(monetizationReminders.id, claimed[0].id));
    return rows.length;
  });
}

export function registerJobs(): void {
  defineJob(NOTICE_REMINDER_JOB, z.object({ effectiveAt: z.string(), daysBefore: z.number().int() }), async (ctx, p) => {
    await sendNoticeRound(ctx, { effectiveAt: new Date(p.effectiveAt), daysBefore: p.daysBefore });
  });
  defineJob(NOTICE_EMAIL_JOB, z.object({ businessId: z.string(), daysBefore: z.number().int(), effectiveAt: z.string() }), async (ctx, p) => {
    const [row] = await ctx.db
      .select({ name: businesses.name, email: accounts.email, locale: accounts.locale })
      .from(businesses)
      .innerJoin(accounts, eq(accounts.id, businesses.ownerAccountId))
      .where(eq(businesses.id, p.businessId));
    if (!row?.email) return;
    const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
    await sendEmail(ctx, {
      to: row.email,
      template: "monetization.notice",
      params: { businessName: row.name, daysBefore: p.daysBefore, date: dateText(new Date(p.effectiveAt)), url: `${base}/business/${p.businessId}/plan` } satisfies NoticeEmailParams,
      locale: row.locale,
    });
  });
}
