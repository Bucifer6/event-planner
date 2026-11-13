import {
  accounts,
  and,
  asc,
  businessFactChecks,
  businessMembers,
  businessNotices,
  businessStatusSchema,
  businesses,
  count,
  desc,
  eq,
  factCheckKindSchema,
  isNull,
  listings,
  sql,
  type BusinessRole,
  type BusinessStatus,
  type FactCheckKind,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob, enqueue } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import { addDays, bucharestDateKey } from "@ed/shared/time";
import { zEmail, zId } from "@ed/shared/zod";
import { registerAssetAccess, registerUploadPurpose } from "@ed/storage";
import { z } from "zod";
import { onAccountPurge, requireFreshAuth } from "./accounts";
import { audit } from "./audit";
import { actorAccountId, requireAccount, requireWriteCapable, type Ctx } from "./context";
import { registerDashboardCounter, requireStaffRole } from "./staff";
import { inTx } from "./tx";

// Business accounts and their teams (P1, P18, P23 groundwork, P29 account side, W3, P4).
//
//   createBusiness(ctx, { name })                    an EMAIL account becomes the owner
//   requireBusinessMember(ctx, businessId, { roles? }) THE access guard for everything a
//                                                    business owns (listings, drawings, …)
//   inviteBusinessMember / acceptBusinessInvite / updateBusinessMemberRole / removeBusinessMember
//                                                    team, with the P18 rule (canManageRole)
//   setBusinessStatus(staffCtx, …)                   W3: restrict / suspend / restore, with a
//                                                    recorded reason shown to the business
//   recordFactCheck / withdrawFactCheck(staffCtx, …) P4: the only two badges
//   isBusinessLapsed / assertBusinessCanCreate       P23: a lapse blocks NEW things only
//
// MON1: there is no price, plan, checkout or card anywhere in this module.

export { BUSINESS_ROLES, BUSINESS_STATUSES, FACT_CHECK_KINDS } from "@ed/db";
export type { BusinessRole, BusinessStatus, FactCheckKind } from "@ed/db";

export type Business = typeof businesses.$inferSelect;
export type BusinessMember = typeof businessMembers.$inferSelect;
export type BusinessNotice = typeof businessNotices.$inferSelect;

export const BUSINESS_INVITE_TTL_DAYS = 14;
export const BUSINESS_MODERATION_ROLES = ["listing_moderator", "platform_admin"] as const;
export const BUSINESS_PHOTO_PURPOSE = "business.photo";

const zBusinessName = z.string().trim().min(2, "common.validation.required").max(120, "common.validation.tooLong");
const zReason = z.string().trim().min(10, "moderation.errors.reasonRequired").max(2000, "common.validation.tooLong");

/* ── Lapse (P23, invariant 8) ──────────────────────────────────────────── */

/**
 * True once the (later) billing domain has marked the plan as lapsed. A lapse never blocks
 * what already exists: live listings stay live and can be corrected; only NEW things stop.
 */
export function isBusinessLapsed(business: Pick<Business, "planLapsedAt">): boolean {
  return business.planLapsedAt !== null;
}

/**
 * Gate for creating something new under a business (a listing now; business occasions,
 * branding and library edits later). Throws FORBIDDEN when the business is lapsed or
 * restricted/suspended (W3). Does NOT check membership — call requireBusinessMember first.
 */
export async function assertBusinessCanCreate(ctx: Ctx, businessId: string): Promise<Business> {
  const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${business.status}`);
  if (isBusinessLapsed(business)) throw new AppError("FORBIDDEN", "business.errors.lapsed");
  return business;
}

/* ── Membership guard ──────────────────────────────────────────────────── */

export type BusinessAccess = { business: Business; member: BusinessMember; role: BusinessRole };

/** The actor's live membership of a business, or null. MCP tokens act as their account. */
export async function getBusinessMember(ctx: Ctx, businessId: string): Promise<BusinessAccess | null> {
  const accountId = actorAccountId(ctx.actor);
  // staff act as staff in the console, never as a member of a business
  if (!accountId || ctx.actor.kind === "staff") return null;
  const [row] = await ctx.db
    .select({ business: businesses, member: businessMembers })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.accountId, accountId), isNull(businessMembers.removedAt)));
  return row ? { ...row, role: row.member.role } : null;
}

/**
 * THE access check for anything a business owns. NOT_FOUND for a non-member (a business's
 * private area does not admit it exists), FORBIDDEN when the role is not in `roles`.
 */
export async function requireBusinessMember(
  ctx: Ctx,
  businessId: string,
  opts: { roles?: readonly BusinessRole[] } = {},
): Promise<BusinessAccess> {
  requireAccount(ctx);
  const access = await getBusinessMember(ctx, businessId);
  if (!access) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (opts.roles && !opts.roles.includes(access.role)) throw new AppError("FORBIDDEN", "business.errors.roleRequired");
  return access;
}

/** True when `accountId` is a live member of the business (used by the moderation rule, P3). */
export async function isAccountBusinessMember(ctx: Pick<Ctx, "db">, businessId: string, accountId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.accountId, accountId), isNull(businessMembers.removedAt)));
  return !!row;
}

/**
 * P18 in one place. May `actorRole` give, change or take away a membership whose role is
 * `currentRole` (null = a new invitation) so that it becomes `newRole` (null = removal)?
 *   owner → anything, except touching the owner role itself;
 *   admin → staff only: an admin cannot create or remove admins;
 *   staff → nothing.
 */
export function canManageRole(actorRole: BusinessRole, currentRole: BusinessRole | null, newRole: BusinessRole | null): boolean {
  if (currentRole === "owner" || newRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return currentRole !== "admin" && newRole !== "admin";
  return false;
}

/* ── Create and read ───────────────────────────────────────────────────── */

export const createBusinessInput = z.object({
  name: zBusinessName,
  onrcRegistration: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(40, "common.validation.tooLong").optional(),
  ),
});

/**
 * Creates the business with the signed-in account as owner. The account must have an email
 * (P29): an anonymous account is told to add one first. One business per owner account.
 */
export async function createBusiness(ctx: Ctx, input: z.input<typeof createBusinessInput>): Promise<Business> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const data = createBusinessInput.parse(input);
  const [account] = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.deletedAt) throw new AppError("UNAUTHENTICATED", "common.errors.UNAUTHENTICATED");
  if (account.kind !== "email" || !account.email) {
    throw new AppError("FORBIDDEN", "business.errors.emailRequired");
  }
  return inTx(ctx, async (tx) => {
    // serialise per account so two submits cannot create two businesses
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${"business.create:" + accountId}))`);
    const [owned] = await tx.db
      .select({ id: businessMembers.businessId })
      .from(businessMembers)
      .where(and(eq(businessMembers.accountId, accountId), eq(businessMembers.role, "owner"), isNull(businessMembers.removedAt)));
    if (owned) throw new AppError("CONFLICT", "business.errors.alreadyOwner");
    const [business] = await tx.db
      .insert(businesses)
      .values({ name: data.name, ownerAccountId: accountId, onrcRegistration: data.onrcRegistration ?? null, createdAt: tx.now })
      .returning();
    await tx.db.insert(businessMembers).values({ businessId: business!.id, accountId, role: "owner", createdAt: tx.now });
    await audit(tx, { action: "business.created", objectType: "business", objectId: business!.id, after: { name: data.name } });
    return business!;
  });
}

export type MyBusiness = { business: Business; role: BusinessRole; lapsed: boolean };

/** Businesses the signed-in account belongs to, the owned one first. */
export async function listMyBusinesses(ctx: Ctx): Promise<MyBusiness[]> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind === "staff") return [];
  const rows = await ctx.db
    .select({ business: businesses, role: businessMembers.role })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.accountId, accountId), isNull(businessMembers.removedAt)))
    .orderBy(asc(businesses.createdAt));
  const order: Record<BusinessRole, number> = { owner: 0, admin: 1, staff: 2 };
  return rows
    .map((r) => ({ ...r, lapsed: isBusinessLapsed(r.business) }))
    .sort((a, b) => order[a.role] - order[b.role]);
}

export type BusinessView = BusinessAccess & { lapsed: boolean; badges: Badge[]; notices: BusinessNotice[] };

/** The business as its members see it, with its status, the recorded reason and recent notices (W3). */
export async function getBusinessView(ctx: Ctx, businessId: string): Promise<BusinessView> {
  const access = await requireBusinessMember(ctx, businessId);
  const notices = await ctx.db
    .select()
    .from(businessNotices)
    .where(eq(businessNotices.businessId, businessId))
    .orderBy(desc(businessNotices.createdAt))
    .limit(20);
  return { ...access, lapsed: isBusinessLapsed(access.business), badges: getBusinessBadges(access.business, ctx.now), notices };
}

export const updateBusinessInput = z.object({
  businessId: zId,
  name: zBusinessName.optional(),
  onrcRegistration: z.string().trim().max(40, "common.validation.tooLong").nullable().optional(),
  /** P32: the 48-hour reminder only — the arrival notice cannot be turned off. */
  nudge48h: z.boolean().optional(),
  /** P31: hide response statistics on all listings. */
  hideStats: z.boolean().optional(),
});

export async function updateBusiness(ctx: Ctx, input: z.input<typeof updateBusinessInput>): Promise<Business> {
  requireWriteCapable(ctx);
  const { businessId, ...patch } = updateBusinessInput.parse(input);
  const { business } = await requireBusinessMember(ctx, businessId, { roles: ["owner", "admin"] });
  const set: Partial<typeof businesses.$inferInsert> = { ...patch };
  if (patch.onrcRegistration !== undefined) {
    set.onrcRegistration = patch.onrcRegistration || null;
    // the badge speaks about the number that was checked: a different number is unchecked
    if ((patch.onrcRegistration || null) !== business.onrcRegistration) set.onrcVerifiedAt = null;
  }
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db.update(businesses).set(set).where(eq(businesses.id, businessId)).returning();
    await audit(tx, {
      action: "business.updated",
      objectType: "business",
      objectId: businessId,
      before: { name: business.name, onrcRegistration: business.onrcRegistration, nudge48h: business.nudge48h, hideStats: business.hideStats },
      after: { name: row!.name, onrcRegistration: row!.onrcRegistration, nudge48h: row!.nudge48h, hideStats: row!.hideStats },
    });
    return row!;
  });
}

/* ── Notices (in-app messages to the business) ─────────────────────────── */

/** Internal: called from checked code (moderation decisions, W3). */
export async function addBusinessNotice(
  ctx: Ctx,
  input: { businessId: string; kind: string; listingId?: string | null; reason?: string | null },
): Promise<void> {
  await ctx.db.insert(businessNotices).values({
    businessId: input.businessId,
    kind: input.kind,
    listingId: input.listingId ?? null,
    reason: input.reason ?? null,
    createdAt: ctx.now,
  });
}

export async function markBusinessNoticesRead(ctx: Ctx, businessId: string): Promise<void> {
  await requireBusinessMember(ctx, businessId);
  await ctx.db
    .update(businessNotices)
    .set({ readAt: ctx.now })
    .where(and(eq(businessNotices.businessId, businessId), isNull(businessNotices.readAt)));
}

type NoticeEmailParams = { businessName: string; headlineKey: string; reason: string | null; url: string };

registerTemplate<NoticeEmailParams>("business.notice", (p, { t }) => ({
  subject: t(p.headlineKey, { business: p.businessName }),
  blocks: [
    { kind: "text", text: t(p.headlineKey, { business: p.businessName }) },
    ...(p.reason ? [{ kind: "note" as const, text: t("business.email.reason", { reason: p.reason }) }] : []),
    { kind: "button", label: t("business.email.open"), url: p.url },
  ],
}));

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export const BUSINESS_NOTICE_EMAIL_JOB = "business.notice-email";
const noticeEmailPayload = z.object({ businessId: z.string(), headlineKey: z.string(), reason: z.string().nullable().optional() });

/**
 * Queues the email that tells the owner about a notice (W3, moderation decisions). It is a
 * job row written on ctx.db, so it joins the caller's transaction: the email goes out only
 * if the decision is committed, and a failing mail provider never undoes the decision.
 */
export async function queueBusinessEmail(
  ctx: Ctx,
  input: { businessId: string; headlineKey: string; reason?: string | null },
): Promise<void> {
  await enqueue(ctx, BUSINESS_NOTICE_EMAIL_JOB, { businessId: input.businessId, headlineKey: input.headlineKey, reason: input.reason ?? null });
}

/** Sends the notice email now (the job handler). */
export async function emailBusinessOwner(
  ctx: Ctx,
  input: { businessId: string; headlineKey: string; reason?: string | null },
): Promise<void> {
  try {
    const [row] = await ctx.db
      .select({ name: businesses.name, email: accounts.email, locale: accounts.locale })
      .from(businesses)
      .innerJoin(accounts, eq(accounts.id, businesses.ownerAccountId))
      .where(eq(businesses.id, input.businessId));
    if (!row?.email) return;
    await sendEmail(ctx, {
      to: row.email,
      template: "business.notice",
      params: { businessName: row.name, headlineKey: input.headlineKey, reason: input.reason ?? null, url: `${appUrl()}/business` } satisfies NoticeEmailParams,
      locale: row.locale,
    });
  } catch (e) {
    // the in-app notice is the record; a suppressed or failing address must not loop the job
    console.error("[business] notice email failed", e instanceof Error ? e.message : e);
  }
}

/* ── Team (P18) ────────────────────────────────────────────────────────── */

export type BusinessTeamMember = {
  id: string;
  /** Email of the member (members see their colleagues' sign-in email) or the invited address. */
  name: string;
  role: BusinessRole;
  pending: boolean;
  inviteExpired: boolean;
  isSelf: boolean;
};

export async function listBusinessMembers(ctx: Ctx, businessId: string): Promise<BusinessTeamMember[]> {
  const me = await requireBusinessMember(ctx, businessId);
  const rows = await ctx.db
    .select({ m: businessMembers, email: accounts.email, username: accounts.username })
    .from(businessMembers)
    .leftJoin(accounts, eq(accounts.id, businessMembers.accountId))
    .where(and(eq(businessMembers.businessId, businessId), isNull(businessMembers.removedAt)))
    .orderBy(asc(businessMembers.createdAt));
  const order: Record<BusinessRole, number> = { owner: 0, admin: 1, staff: 2 };
  return rows
    .map(({ m, email, username }) => {
      const pending = m.accountId === null;
      return {
        id: m.id,
        name: pending ? (m.inviteEmail ?? "") : (email ?? username ?? ""),
        role: m.role,
        pending,
        inviteExpired: pending && addDays(m.invitedAt ?? m.createdAt, BUSINESS_INVITE_TTL_DAYS).getTime() <= ctx.now.getTime(),
        isSelf: m.id === me.member.id,
      };
    })
    .sort((a, b) => Number(a.pending) - Number(b.pending) || order[a.role] - order[b.role]);
}

type InviteEmailParams = { businessName: string; roleKey: string; acceptUrl: string; days: number };

registerTemplate<InviteEmailParams>("business.invite", (p, { t }) => ({
  subject: t("business.email.inviteSubject", { business: p.businessName }),
  blocks: [
    { kind: "text", text: t("business.email.inviteIntro", { business: p.businessName, role: t(p.roleKey) }) },
    { kind: "button", label: t("business.email.inviteButton"), url: p.acceptUrl },
    { kind: "note", text: t("business.email.inviteValidity", { days: p.days }) },
    { kind: "note", text: t("business.email.inviteNotExpected") },
  ],
}));

const assignableRole = z.enum(["admin", "staff"], "common.validation.required");

export const inviteBusinessMemberInput = z.object({ businessId: zId, email: zEmail, role: assignableRole.default("staff") });

/**
 * Invites a colleague by email (same pattern as occasion invitations). P18: the owner may
 * invite admins and staff; an admin may invite staff only. Needs a fresh confirmation (S4).
 */
export async function inviteBusinessMember(
  ctx: Ctx,
  input: z.input<typeof inviteBusinessMemberInput>,
): Promise<{ memberId: string; emailStatus: "sent" | "suppressed" }> {
  requireWriteCapable(ctx);
  const data = inviteBusinessMemberInput.parse(input);
  const me = await requireBusinessMember(ctx, data.businessId);
  if (!canManageRole(me.role, null, data.role)) {
    throw new AppError("FORBIDDEN", me.role === "admin" ? "business.errors.adminCannotManageAdmins" : "business.errors.roleRequired");
  }
  await requireFreshAuth(ctx);
  if (me.business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${me.business.status}`);

  const [existing] = await ctx.db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .innerJoin(accounts, eq(accounts.id, businessMembers.accountId))
    .where(and(eq(businessMembers.businessId, data.businessId), eq(accounts.email, data.email), isNull(businessMembers.removedAt)));
  if (existing) {
    throw new AppError("TAKEN", "business.errors.alreadyMember", { fieldErrors: { email: ["business.errors.alreadyMember"] } });
  }

  const token = randomToken();
  const memberId = await inTx(ctx, async (tx) => {
    const [pending] = await tx.db
      .select()
      .from(businessMembers)
      .where(
        and(
          eq(businessMembers.businessId, data.businessId),
          eq(businessMembers.inviteEmail, data.email),
          isNull(businessMembers.accountId),
          isNull(businessMembers.removedAt),
        ),
      );
    // re-inviting may not quietly raise a pending invitation above what the actor may grant
    if (pending && !canManageRole(me.role, pending.role, data.role)) {
      throw new AppError("FORBIDDEN", "business.errors.adminCannotManageAdmins");
    }
    const values = { role: data.role as BusinessRole, inviteTokenHash: hashToken(token), invitedAt: tx.now };
    let id: string;
    if (pending) {
      await tx.db.update(businessMembers).set(values).where(eq(businessMembers.id, pending.id));
      id = pending.id;
    } else {
      const [row] = await tx.db
        .insert(businessMembers)
        .values({ businessId: data.businessId, inviteEmail: data.email, createdAt: tx.now, ...values })
        .returning({ id: businessMembers.id });
      id = row!.id;
    }
    await audit(tx, {
      action: pending ? "business.member.invite_resent" : "business.member.invited",
      objectType: "business_member",
      objectId: id,
      after: { role: data.role },
      meta: { businessId: data.businessId },
    });
    return id;
  });

  const sent = await sendEmail(ctx, {
    to: data.email,
    template: "business.invite",
    params: {
      businessName: me.business.name,
      roleKey: `business.roles.${data.role}`,
      acceptUrl: `${appUrl()}/business/invite/${token}`,
      days: BUSINESS_INVITE_TTL_DAYS,
    } satisfies InviteEmailParams,
    locale: ctx.locale,
  });
  return { memberId, emailStatus: sent.status };
}

export type BusinessInviteView = { businessId: string; businessName: string; role: BusinessRole; state: "open" | "expired" };

async function findInvite(ctx: Ctx, token: string) {
  const parsed = z.string().min(20).max(200).safeParse(token);
  if (!parsed.success) return null;
  const [row] = await ctx.db
    .select({ m: businessMembers, b: businesses })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.inviteTokenHash, hashToken(parsed.data)), isNull(businessMembers.accountId), isNull(businessMembers.removedAt)));
  return row ?? null;
}

const inviteExpired = (ctx: Ctx, m: BusinessMember) =>
  addDays(m.invitedAt ?? m.createdAt, BUSINESS_INVITE_TTL_DAYS).getTime() <= ctx.now.getTime();

/** What the invitation is for. Null = unknown, used or withdrawn. */
export async function getBusinessInvite(ctx: Ctx, token: string): Promise<BusinessInviteView | null> {
  const row = await findInvite(ctx, token);
  if (!row) return null;
  return { businessId: row.b.id, businessName: row.b.name, role: row.m.role, state: inviteExpired(ctx, row.m) ? "expired" : "open" };
}

/**
 * Binds the signed-in account to the invitation, once. The account must be an email account
 * signed in with the invited address, so a forwarded link is useless to anyone else.
 */
export async function acceptBusinessInvite(ctx: Ctx, input: { token: string }): Promise<{ businessId: string }> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const row = await findInvite(ctx, input.token);
  if (!row) throw new AppError("NOT_FOUND", "business.errors.inviteGone");
  if (inviteExpired(ctx, row.m)) throw new AppError("CONFLICT", "business.errors.inviteExpired");
  const [account] = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account?.email || account.email !== row.m.inviteEmail) throw new AppError("FORBIDDEN", "business.errors.inviteOtherEmail");
  return inTx(ctx, async (tx) => {
    if (await isAccountBusinessMember(tx, row.b.id, accountId)) {
      await tx.db.update(businessMembers).set({ removedAt: tx.now, inviteTokenHash: null }).where(eq(businessMembers.id, row.m.id));
      return { businessId: row.b.id };
    }
    const bound = await tx.db
      .update(businessMembers)
      .set({ accountId, inviteTokenHash: null })
      .where(and(eq(businessMembers.id, row.m.id), isNull(businessMembers.accountId), isNull(businessMembers.removedAt)))
      .returning({ id: businessMembers.id });
    if (bound.length === 0) throw new AppError("NOT_FOUND", "business.errors.inviteGone");
    await audit(tx, { action: "business.member.joined", objectType: "business_member", objectId: row.m.id, meta: { businessId: row.b.id, role: row.m.role } });
    return { businessId: row.b.id };
  });
}

async function loadMemberRow(ctx: Ctx, businessId: string, memberId: string): Promise<BusinessMember> {
  const [row] = await ctx.db
    .select()
    .from(businessMembers)
    .where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, businessId), isNull(businessMembers.removedAt)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

export const updateBusinessMemberRoleInput = z.object({ businessId: zId, memberId: zId, role: assignableRole });

/** Changes a member's role. P18 + fresh confirmation (S4). */
export async function updateBusinessMemberRole(ctx: Ctx, input: z.input<typeof updateBusinessMemberRoleInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = updateBusinessMemberRoleInput.parse(input);
  const me = await requireBusinessMember(ctx, data.businessId);
  const target = await loadMemberRow(ctx, data.businessId, data.memberId);
  if (!canManageRole(me.role, target.role, data.role)) {
    throw new AppError("FORBIDDEN", me.role === "admin" ? "business.errors.adminCannotManageAdmins" : "business.errors.roleRequired");
  }
  await requireFreshAuth(ctx);
  if (target.role === data.role) return;
  await inTx(ctx, async (tx) => {
    await tx.db.update(businessMembers).set({ role: data.role }).where(eq(businessMembers.id, target.id));
    await audit(tx, {
      action: "business.member.role_changed",
      objectType: "business_member",
      objectId: target.id,
      before: { role: target.role },
      after: { role: data.role },
      meta: { businessId: data.businessId },
    });
  });
}

/** Removes a member or withdraws an invitation. P18 + fresh confirmation (S4). A member may leave by themselves (not the owner). */
export async function removeBusinessMember(ctx: Ctx, input: { businessId: string; memberId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ businessId: zId, memberId: zId }).parse(input);
  const me = await requireBusinessMember(ctx, data.businessId);
  const target = await loadMemberRow(ctx, data.businessId, data.memberId);
  const self = target.id === me.member.id;
  if (self ? target.role === "owner" : !canManageRole(me.role, target.role, null)) {
    throw new AppError(
      "FORBIDDEN",
      target.role === "owner" ? "business.errors.ownerStays" : me.role === "admin" ? "business.errors.adminCannotManageAdmins" : "business.errors.roleRequired",
    );
  }
  await requireFreshAuth(ctx);
  await inTx(ctx, async (tx) => {
    await tx.db.update(businessMembers).set({ removedAt: tx.now, inviteTokenHash: null }).where(eq(businessMembers.id, target.id));
    await audit(tx, {
      action: target.accountId ? "business.member.removed" : "business.member.invite_withdrawn",
      objectType: "business_member",
      objectId: target.id,
      before: { role: target.role },
      meta: { businessId: data.businessId, self },
    });
  });
}

/* ── W3: restrict / suspend / restore ──────────────────────────────────── */

export const setBusinessStatusInput = z.object({
  businessId: zId,
  status: businessStatusSchema,
  /** Given to the business. Mandatory for restricted/suspended. */
  reason: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), zReason.optional()),
});

/**
 * W3. Changes a business's status with a recorded reason that the business sees in its
 * area and receives by email. It is DATA: it outlives the staff session that set it.
 * Runs inside the caller's transaction when there is one (the content-report hook).
 */
export async function setBusinessStatus(
  ctx: Ctx,
  input: { businessId: string; status: BusinessStatus; reason?: string },
): Promise<Business> {
  requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const data = setBusinessStatusInput.parse(input);
  if (data.status !== "active" && !data.reason) {
    throw new AppError("VALIDATION", "moderation.errors.reasonRequired", { fieldErrors: { reason: ["moderation.errors.reasonRequired"] } });
  }
  return inTx(ctx, async (tx) => {
    const row = await applyBusinessStatus(tx, { businessId: data.businessId, status: data.status, reason: data.reason ?? null });
    await queueBusinessEmail(tx, { businessId: data.businessId, headlineKey: `business.email.status.${data.status}`, reason: data.reason ?? null });
    return row;
  });
}

/** Internal (no role check, no email): the write + audit + in-app notice. Joins the caller's transaction. */
export async function applyBusinessStatus(
  ctx: Ctx,
  input: { businessId: string; status: BusinessStatus; reason: string | null },
): Promise<Business> {
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db.select().from(businesses).where(eq(businesses.id, input.businessId)).for("update");
    if (!before) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [row] = await tx.db
      .update(businesses)
      .set({
        status: input.status,
        restrictionReason: input.status === "active" ? null : input.reason,
        restrictedAt: input.status === "active" ? null : tx.now,
      })
      .where(eq(businesses.id, input.businessId))
      .returning();
    await audit(tx, {
      action: `business.${input.status === "active" ? "restored" : input.status}`,
      objectType: "business",
      objectId: input.businessId,
      before: { status: before.status, reason: before.restrictionReason },
      after: { status: input.status, reason: input.reason },
    });
    await addBusinessNotice(tx, {
      businessId: input.businessId,
      kind: `business.${input.status === "active" ? "restored" : input.status}`,
      reason: input.reason,
    });
    return row!;
  });
}

/* ── P4: the two factual badges ────────────────────────────────────────── */

/** The ONLY badges that can exist (P4). There is no generic "verified" badge and no score. */
export type Badge = { kind: "onrc" } | { kind: "insurance"; validUntil: string };

/**
 * The badges a business's listings may show today. The insurance badge disappears by itself
 * the day after the date the moderator saw.
 */
export function getBusinessBadges(
  business: Pick<Business, "onrcVerifiedAt" | "insuranceValidUntil" | "insuranceSeenAt">,
  now: Date,
): Badge[] {
  const out: Badge[] = [];
  if (business.onrcVerifiedAt) out.push({ kind: "onrc" });
  if (business.insuranceSeenAt && business.insuranceValidUntil && business.insuranceValidUntil >= bucharestDateKey(now)) {
    out.push({ kind: "insurance", validUntil: business.insuranceValidUntil });
  }
  return out;
}

export const recordFactCheckInput = z
  .object({
    businessId: zId,
    kind: factCheckKindSchema,
    /** What the moderator saw: register extract, policy number and insurer… */
    seen: z.string().trim().min(5, "moderation.errors.seenRequired").max(1000, "common.validation.tooLong"),
    /** Insurance only: "YYYY-MM-DD". */
    validUntil: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "common.validation.invalid").optional(),
    ),
  })
  .superRefine((v, c) => {
    if (v.kind === "insurance" && !v.validUntil) c.addIssue({ code: "custom", path: ["validUntil"], message: "common.validation.required" });
  });

/**
 * P4: a listing moderator who is not a member of the business records what was checked; the
 * badge follows from the record. The check is free — there is nothing to pay anywhere.
 */
export async function recordFactCheck(ctx: Ctx, input: z.input<typeof recordFactCheckInput>): Promise<void> {
  const staffId = requireStaffRole(ctx, "listing_moderator");
  const data = recordFactCheckInput.parse(input);
  await inTx(ctx, async (tx) => {
    const [business] = await tx.db.select().from(businesses).where(eq(businesses.id, data.businessId)).for("update");
    if (!business) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const accountId = actorAccountId(tx.actor);
    if (accountId && (await isAccountBusinessMember(tx, business.id, accountId))) {
      throw new AppError("FORBIDDEN", "moderation.errors.ownBusiness");
    }
    if (data.kind === "onrc" && !business.onrcRegistration) {
      throw new AppError("CONFLICT", "moderation.errors.noOnrcNumber");
    }
    if (data.kind === "insurance" && data.validUntil! < bucharestDateKey(tx.now)) {
      throw new AppError("VALIDATION", "moderation.errors.insuranceExpired", { fieldErrors: { validUntil: ["moderation.errors.insuranceExpired"] } });
    }
    await tx.db.insert(businessFactChecks).values({
      businessId: business.id,
      kind: data.kind,
      outcome: "verified",
      staffId,
      seen: data.seen,
      validUntil: data.kind === "insurance" ? data.validUntil! : null,
      checkedAt: tx.now,
    });
    await tx.db
      .update(businesses)
      .set(data.kind === "onrc" ? { onrcVerifiedAt: tx.now } : { insuranceValidUntil: data.validUntil!, insuranceSeenAt: tx.now })
      .where(eq(businesses.id, business.id));
    await audit(tx, {
      action: `business.fact_check.${data.kind}`,
      objectType: "business",
      objectId: business.id,
      after: { kind: data.kind, seen: data.seen, validUntil: data.validUntil ?? null },
    });
  });
}

/** Removes a badge, with the reason recorded. */
export async function withdrawFactCheck(ctx: Ctx, input: { businessId: string; kind: FactCheckKind; seen: string }): Promise<void> {
  const staffId = requireStaffRole(ctx, "listing_moderator");
  const data = z.object({ businessId: zId, kind: factCheckKindSchema, seen: zReason }).parse(input);
  await inTx(ctx, async (tx) => {
    const [business] = await tx.db.select().from(businesses).where(eq(businesses.id, data.businessId)).for("update");
    if (!business) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    await tx.db.insert(businessFactChecks).values({ businessId: business.id, kind: data.kind, outcome: "withdrawn", staffId, seen: data.seen, checkedAt: tx.now });
    await tx.db
      .update(businesses)
      .set(data.kind === "onrc" ? { onrcVerifiedAt: null } : { insuranceValidUntil: null, insuranceSeenAt: null })
      .where(eq(businesses.id, business.id));
    await audit(tx, { action: `business.fact_check.${data.kind}_withdrawn`, objectType: "business", objectId: business.id, after: { reason: data.seen } });
  });
}

/* ── Console reads (W3) ────────────────────────────────────────────────── */

export type ConsoleBusinessRow = { business: Business; listings: number; liveListings: number };

export async function listBusinessesForConsole(ctx: Ctx, input: { status?: BusinessStatus | "all"; q?: string } = {}): Promise<ConsoleBusinessRow[]> {
  requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const q = (input.q ?? "").trim().slice(0, 80);
  const rows = await ctx.db
    .select({
      business: businesses,
      listings: sql<number>`(select count(*)::int from listings l where l.business_id = ${businesses.id} and l.status <> 'retired')`,
      liveListings: sql<number>`(select count(*)::int from listings l where l.business_id = ${businesses.id} and l.status = 'live')`,
    })
    .from(businesses)
    .where(
      and(
        input.status && input.status !== "all" ? eq(businesses.status, input.status) : undefined,
        q ? sql`${businesses.name} ilike ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"}` : undefined,
      ),
    )
    .orderBy(desc(businesses.createdAt))
    .limit(200);
  return rows.map((r) => ({ business: r.business, listings: Number(r.listings), liveListings: Number(r.liveListings) }));
}

export type ConsoleBusiness = {
  business: Business;
  badges: Badge[];
  ownerEmail: string | null;
  members: number;
  factChecks: Array<typeof businessFactChecks.$inferSelect>;
  listings: Array<Pick<typeof listings.$inferSelect, "id" | "name" | "status" | "claimed" | "suspensionReason">>;
};

export async function getBusinessForConsole(ctx: Ctx, businessId: string): Promise<ConsoleBusiness> {
  requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const [row] = await ctx.db
    .select({ business: businesses, ownerEmail: accounts.email })
    .from(businesses)
    .leftJoin(accounts, eq(accounts.id, businesses.ownerAccountId))
    .where(eq(businesses.id, businessId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [members] = await ctx.db
    .select({ n: count() })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), isNull(businessMembers.removedAt)));
  const factChecks = await ctx.db
    .select()
    .from(businessFactChecks)
    .where(eq(businessFactChecks.businessId, businessId))
    .orderBy(desc(businessFactChecks.checkedAt))
    .limit(50);
  const ls = await ctx.db
    .select({ id: listings.id, name: listings.name, status: listings.status, claimed: listings.claimed, suspensionReason: listings.suspensionReason })
    .from(listings)
    .where(eq(listings.businessId, businessId))
    .orderBy(asc(listings.createdAt));
  return { business: row.business, badges: getBusinessBadges(row.business, ctx.now), ownerEmail: row.ownerEmail, members: members?.n ?? 0, factChecks, listings: ls };
}

/* ── Registrations ─────────────────────────────────────────────────────── */

function registerRules(): void {
  // Business files (Q9: 200 MiB per business, images only here). Members add and remove;
  // anyone may read a photo that is part of a LIVE public listing (through a signed link
  // generated on the server) — everything else is members only.
  registerAssetAccess("business", {
    canRead: async (ctx, asset) => {
      if (await getBusinessMember(ctx, asset.ownerId)) return true;
      const [live] = await ctx.db
        .select({ id: listings.id })
        .from(listings)
        .innerJoin(businesses, eq(businesses.id, listings.businessId))
        .where(
          and(
            eq(listings.businessId, asset.ownerId),
            eq(listings.status, "live"),
            sql`${businesses.status} <> 'suspended'`,
            sql`${listings.photoAssetIds} @> ${JSON.stringify([asset.id])}::jsonb`,
          ),
        )
        .limit(1);
      if (live) return true;
      // moderators see what they are asked to approve
      return ctx.actor.kind === "staff" && ctx.actor.roles.some((r) => (BUSINESS_MODERATION_ROLES as readonly string[]).includes(r));
    },
    canWrite: async (ctx, owner) => {
      if (ctx.actor.kind !== "account") return false;
      const access = await getBusinessMember(ctx, owner.ownerId);
      // P29/W3: no uploads for a restricted or suspended business
      return access !== null && access.business.status === "active";
    },
  });
  registerUploadPurpose(BUSINESS_PHOTO_PURPOSE, { ownerType: "business", allowPdf: false });

  registerDashboardCounter({
    key: "businesses",
    count: async (ctx) => {
      const rows = await ctx.db.select({ status: businesses.status, n: count() }).from(businesses).groupBy(businesses.status);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
      return { total: rows.reduce((a, r) => a + r.n, 0), byStatus };
    },
  });

  // A purged account leaves every team. If it owned a business, the longest-serving admin
  // becomes the owner; with nobody left to run it, its listings are withdrawn.
  onAccountPurge(async (ctx, accountId) => {
    const memberships = await ctx.db
      .select()
      .from(businessMembers)
      .where(and(eq(businessMembers.accountId, accountId), isNull(businessMembers.removedAt)));
    for (const m of memberships) {
      await ctx.db.update(businessMembers).set({ removedAt: ctx.now }).where(eq(businessMembers.id, m.id));
      if (m.role !== "owner") continue;
      const [heir] = await ctx.db
        .select()
        .from(businessMembers)
        .where(and(eq(businessMembers.businessId, m.businessId), eq(businessMembers.role, "admin"), isNull(businessMembers.removedAt), sql`${businessMembers.accountId} is not null`))
        .orderBy(asc(businessMembers.createdAt))
        .limit(1);
      if (heir?.accountId) {
        await ctx.db.update(businessMembers).set({ role: "owner" }).where(eq(businessMembers.id, heir.id));
        await ctx.db.update(businesses).set({ ownerAccountId: heir.accountId }).where(eq(businesses.id, m.businessId));
      } else {
        await ctx.db
          .update(listings)
          .set({ status: "retired" })
          .where(and(eq(listings.businessId, m.businessId), sql`${listings.status} <> 'retired'`));
      }
      await audit(ctx, { action: "business.owner_purged", objectType: "business", objectId: m.businessId, meta: { handedOver: !!heir } });
    }
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker. */
export function registerJobs(): void {
  registerRules();
  defineJob(BUSINESS_NOTICE_EMAIL_JOB, noticeEmailPayload, async (ctx, p) => {
    await emailBusinessOwner(ctx, p);
  });
}
