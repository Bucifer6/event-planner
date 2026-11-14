import { accounts, and, businessMembers, businesses, desc, eq, inArray, isNull, listingCategories, listingLocalities, listings, noticeAudienceSchema, platformNoticeSends, platformNotices, sql } from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob, enqueue } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { audit } from "./audit";
import { addBusinessNotice } from "./business";
import type { Ctx } from "./context";
import { requireStaffRole } from "./staff";
import { inTx } from "./tx";

// Communications (W7): platform notices to BUSINESSES — never to planner-entered contacts.
//
// ENFORCED BY CONSTRUCTION: the only place a recipient address comes from is
// `business_members ⨝ accounts` (the owner and the admins of a business, by their own login
// email). This module imports no table that holds people a planner typed in, and its test
// scans this file to keep it so. A notice is always addressed to a business; the audience
// can only be "all businesses", "businesses listed in a category" or "… in a county".

export const COMMS_ROLES = ["commercial_manager", "content_editor"] as const;
export const PLATFORM_NOTICE_KIND = "platform.notice";
export const NOTICE_EMAIL_JOB = "comms.notice-email";

export type PlatformNotice = typeof platformNotices.$inferSelect;

const noticeInput = z
  .object({
    subject: z.string().trim().min(3, "common.validation.required").max(140, "common.validation.tooLong"),
    body: z.string().trim().min(10, "comms.errors.bodyRequired").max(4000, "common.validation.tooLong"),
    audience: noticeAudienceSchema,
    categoryId: z.preprocess((v) => (v === "" ? undefined : v), zId.optional()),
    countyCode: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).max(3).optional()),
  })
  .superRefine((v, c) => {
    if (v.audience === "category" && !v.categoryId) c.addIssue({ code: "custom", path: ["categoryId"], message: "common.validation.required" });
    if (v.audience === "county" && !v.countyCode) c.addIssue({ code: "custom", path: ["countyCode"], message: "common.validation.required" });
  });
export type NoticeInput = z.input<typeof noticeInput>;

/** Business ids in an audience. Suspended businesses are included: they are still our businesses. */
async function audienceBusinessIds(ctx: Pick<Ctx, "db">, a: { audience: "all" | "category" | "county"; categoryId?: string; countyCode?: string }): Promise<string[]> {
  if (a.audience === "all") return (await ctx.db.select({ id: businesses.id }).from(businesses)).map((r) => r.id);
  const base = ctx.db.selectDistinct({ id: listings.businessId }).from(listings);
  const rows =
    a.audience === "category"
      ? await base.innerJoin(listingCategories, eq(listingCategories.listingId, listings.id)).where(and(eq(listingCategories.categoryId, a.categoryId!), sql`${listings.businessId} is not null`, inArray(listings.status, ["live", "pending"])))
      : await base.innerJoin(listingLocalities, eq(listingLocalities.listingId, listings.id)).where(and(eq(listingLocalities.countyCode, a.countyCode!), sql`${listings.businessId} is not null`, inArray(listings.status, ["live", "pending"])));
  return rows.map((r) => r.id).filter((x): x is string => !!x);
}

/** THE recipient query: owners and admins of the given businesses, by their own account email. */
async function recipients(ctx: Pick<Ctx, "db">, businessIds: string[]): Promise<Array<{ businessId: string; accountId: string }>> {
  if (businessIds.length === 0) return [];
  return ctx.db
    .select({ businessId: businessMembers.businessId, accountId: accounts.id })
    .from(businessMembers)
    .innerJoin(accounts, eq(accounts.id, businessMembers.accountId))
    .where(and(inArray(businessMembers.businessId, businessIds), inArray(businessMembers.role, ["owner", "admin"]), isNull(businessMembers.removedAt), isNull(accounts.deletedAt), sql`${accounts.email} is not null`));
}

/** How many businesses and addresses a notice would reach — shown before sending. */
export async function previewAudience(ctx: Ctx, input: { audience: "all" | "category" | "county"; categoryId?: string; countyCode?: string }): Promise<{ businesses: number; emails: number }> {
  requireStaffRole(ctx, ...COMMS_ROLES);
  const ids = await audienceBusinessIds(ctx, input);
  return { businesses: ids.length, emails: (await recipients(ctx, ids)).length };
}

/**
 * Sends a notice: an in-app notice in each business's area and an email to its owner and
 * admins. One transaction writes the notice, the send log and the email jobs; the emails
 * themselves leave from the worker.
 */
export async function sendPlatformNotice(ctx: Ctx, input: NoticeInput): Promise<PlatformNotice> {
  const staffId = requireStaffRole(ctx, ...COMMS_ROLES);
  const data = noticeInput.parse(input);
  const ids = await audienceBusinessIds(ctx, data);
  if (ids.length === 0) throw new AppError("CONFLICT", "comms.errors.nobody");
  const to = await recipients(ctx, ids);
  return inTx(ctx, async (tx) => {
    const [notice] = await tx.db
      .insert(platformNotices)
      .values({
        subject: data.subject,
        body: data.body,
        audience: data.audience,
        categoryId: data.audience === "category" ? data.categoryId! : null,
        countyCode: data.audience === "county" ? data.countyCode! : null,
        createdByStaffId: staffId,
        sentAt: tx.now,
        businessCount: ids.length,
        emailCount: to.length,
        createdAt: tx.now,
      })
      .returning();
    for (const businessId of ids) {
      const mine = to.filter((r) => r.businessId === businessId);
      await tx.db.insert(platformNoticeSends).values({ noticeId: notice!.id, businessId, emailsQueued: mine.length, at: tx.now });
      await addBusinessNotice(tx, { businessId, kind: PLATFORM_NOTICE_KIND, reason: `${data.subject}\n\n${data.body}` });
      for (const r of mine) {
        await enqueue(tx, NOTICE_EMAIL_JOB, { noticeId: notice!.id, businessId, accountId: r.accountId }, { uniqueKey: `comms.notice:${notice!.id}:${r.accountId}:${businessId}` });
      }
    }
    await audit(tx, { action: "platform_notice.sent", objectType: "platform_notice", objectId: notice!.id, after: { subject: data.subject, audience: data.audience, categoryId: data.categoryId ?? null, countyCode: data.countyCode ?? null }, meta: { businesses: ids.length, emails: to.length } });
    return notice!;
  });
}

/** The send log, newest first. */
export async function listPlatformNotices(ctx: Ctx): Promise<PlatformNotice[]> {
  requireStaffRole(ctx, ...COMMS_ROLES);
  return ctx.db.select().from(platformNotices).orderBy(desc(platformNotices.sentAt)).limit(100);
}

type NoticeEmailParams = { subject: string; body: string; businessName: string; url: string };
registerTemplate<NoticeEmailParams>("comms.notice", (p, { t }) => ({
  subject: p.subject,
  blocks: [
    { kind: "text", text: t("comms.email.intro", { business: p.businessName }) },
    { kind: "text", text: p.body },
    { kind: "button", label: t("comms.email.open"), url: p.url },
    { kind: "note", text: t("comms.email.why") },
  ],
}));

export function registerJobs(): void {
  defineJob(NOTICE_EMAIL_JOB, z.object({ noticeId: z.string(), businessId: z.string(), accountId: z.string() }), async (ctx, p) => {
    const [notice] = await ctx.db.select().from(platformNotices).where(eq(platformNotices.id, p.noticeId));
    // the address is read again at send time, from the same join: still a live owner/admin
    const [to] = await ctx.db
      .select({ email: accounts.email, locale: accounts.locale, name: businesses.name })
      .from(businessMembers)
      .innerJoin(accounts, eq(accounts.id, businessMembers.accountId))
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(and(eq(businessMembers.businessId, p.businessId), eq(businessMembers.accountId, p.accountId), inArray(businessMembers.role, ["owner", "admin"]), isNull(businessMembers.removedAt), isNull(accounts.deletedAt)));
    if (!notice || !to?.email) return;
    const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
    await sendEmail(ctx, {
      to: to.email,
      template: "comms.notice",
      params: { subject: notice.subject, body: notice.body, businessName: to.name, url: `${base}/business/${p.businessId}` } satisfies NoticeEmailParams,
      locale: to.locale,
    });
  });
}
