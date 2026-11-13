import {
  and,
  businessMembers,
  businessOccasionSeats,
  businessProfiles,
  businesses,
  eq,
  isNull,
  mcpTokens,
  occasionHandovers,
  occasionMembers,
  occasions,
  type OccasionGrant,
  type OccasionRole,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import type { Ctx } from "./context";

// Occasion access (A5, D2). Private by default: every read and write of occasion data goes
// through requireMember. Non-members get NOT_FOUND so the existence of an occasion is never
// revealed; a member lacking the role or grant gets FORBIDDEN.

export type { OccasionGrant, OccasionRole } from "@ed/db";

export type Member = {
  id: string;
  occasionId: string;
  accountId: string;
  role: OccasionRole;
  grants: { finance: boolean; privateRequests: boolean };
  /**
   * RELEASE P (P17): set when the access comes from the BUSINESS TEAM path — the actor is a
   * live member of the business that runs this occasion and has no row of their own in
   * occasion_members. `id` is then synthetic ("bm_<businessMemberId>") and must not be stored
   * in a foreign-key column: ensureBusinessSeat (@ed/core/bizoccasions) gives a real row.
   */
  viaBusiness?: { businessId: string; businessMemberId: string };
};

export type RequireMemberOptions = {
  /** Any of these roles passes. */
  roles?: OccasionRole[];
  /** The member must hold this grant (the owner holds both implicitly). */
  grant?: OccasionGrant;
  /** Shorthand for owner or project manager. */
  manage?: boolean;
};

const idSchema = z.string().min(1).max(64);

/**
 * The actor's membership of an occasion, or null. Only account actors and MCP tokens (acting
 * as their account — MCP writes are only ever What-if proposals) can be members; staff, guest
 * links, the system and anonymous visitors never are.
 */
export async function getMember(ctx: Ctx, occasionId: string): Promise<Member | null> {
  const parsed = idSchema.safeParse(occasionId);
  if (!parsed.success) return null;
  const accountId =
    ctx.actor.kind === "account" || ctx.actor.kind === "mcp" ? ctx.actor.accountId : null;
  if (!accountId) return null;
  // RELEASE P: the two left joins tell whether this row is a business-team seat and, if so,
  // whether the team membership behind it is still live (one query, as before).
  const [found] = await ctx.db
    .select({ row: occasionMembers, seatId: businessOccasionSeats.id, teamRemovedAt: businessMembers.removedAt, businessStatus: businesses.status })
    .from(occasionMembers)
    .leftJoin(businessOccasionSeats, eq(businessOccasionSeats.occasionMemberId, occasionMembers.id))
    .leftJoin(businessMembers, eq(businessMembers.id, businessOccasionSeats.businessMemberId))
    .leftJoin(businesses, eq(businesses.id, businessOccasionSeats.businessId))
    .where(
      and(
        eq(occasionMembers.occasionId, parsed.data),
        eq(occasionMembers.accountId, accountId),
        isNull(occasionMembers.removedAt),
      ),
    );
  const row = found?.row;
  // ── RELEASE P insertion (P17, P22, MCP7): business occasions ──────────────────────────
  const mcpBusinessId = ctx.actor.kind === "mcp" ? await mcpTokenBusiness(ctx, ctx.actor.tokenId) : null;
  if (mcpBusinessId && (await wasHandedOverBy(ctx, parsed.data, mcpBusinessId))) return null; // MCP7
  if (!row || !row.accountId) {
    return businessTeamMember(ctx, parsed.data, accountId, ctx.actor.kind === "mcp" ? { tokenBusinessId: mcpBusinessId } : null);
  }
  // a team member's seat is valid only while the team membership is (and the business is not suspended)
  if (found.seatId && (found.teamRemovedAt !== null || found.businessStatus === "suspended")) return null;
  // ── end of RELEASE P insertion ────────────────────────────────────────────────────────
  const owner = row.role === "owner";
  return {
    id: row.id,
    occasionId: row.occasionId,
    accountId: row.accountId,
    role: row.role,
    grants: {
      finance: owner || row.grantFinance,
      privateRequests: owner || row.grantPrivateRequests,
    },
  };
}

/* ── RELEASE P: the business team path (P17, P22, MCP7) ──────────────────────────────────
 *
 * A business-owned occasion (occasions.business_id set) admits every LIVE member of that
 * business as a project manager, with the grants the business chose (business_profiles).
 * The path ends by construction:
 *   - at HANDOVER (P22): @ed/core/handover clears occasions.business_id and removes every
 *     team seat, so nothing here matches any more; a business MCP token additionally fails
 *     for an occasion its business handed over (MCP7), whatever rows exist;
 *   - when the person leaves the business, or the business is SUSPENDED (W3).
 * A plan LAPSE does not end it (invariant 8: a lapse never blocks an event).
 * MCP tokens use the path only when they were created for that business (MCP7 team scope).
 */

async function mcpTokenBusiness(ctx: Ctx, tokenId: string): Promise<string | null> {
  const [t] = await ctx.db.select({ businessId: mcpTokens.businessId }).from(mcpTokens).where(eq(mcpTokens.id, tokenId));
  return t?.businessId ?? null;
}

async function wasHandedOverBy(ctx: Ctx, occasionId: string, businessId: string): Promise<boolean> {
  const [h] = await ctx.db
    .select({ id: occasionHandovers.id })
    .from(occasionHandovers)
    .where(and(eq(occasionHandovers.occasionId, occasionId), eq(occasionHandovers.businessId, businessId)));
  return !!h;
}

async function businessTeamMember(
  ctx: Ctx,
  occasionId: string,
  accountId: string,
  mcp: { tokenBusinessId: string | null } | null,
): Promise<Member | null> {
  const [occ] = await ctx.db.select({ businessId: occasions.businessId }).from(occasions).where(eq(occasions.id, occasionId));
  if (!occ?.businessId) return null;
  if (mcp && mcp.tokenBusinessId !== occ.businessId) return null;
  const [team] = await ctx.db
    .select({ memberId: businessMembers.id, status: businesses.status, finance: businessProfiles.teamGrantFinance, privateRequests: businessProfiles.teamGrantPrivateRequests })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .leftJoin(businessProfiles, eq(businessProfiles.businessId, businessMembers.businessId))
    .where(and(eq(businessMembers.businessId, occ.businessId), eq(businessMembers.accountId, accountId), isNull(businessMembers.removedAt)));
  if (!team || team.status === "suspended") return null;
  return {
    id: `bm_${team.memberId}`,
    occasionId,
    accountId,
    role: "pm",
    // defaults when the business never chose: money yes, private requests no (D2)
    grants: { finance: team.finance ?? true, privateRequests: team.privateRequests ?? false },
    viaBusiness: { businessId: occ.businessId, businessMemberId: team.memberId },
  };
}

/** Owner or project manager. */
export function isManager(member: Pick<Member, "role">): boolean {
  return member.role === "owner" || member.role === "pm";
}

export function hasGrant(member: Member, grant: OccasionGrant): boolean {
  return member.grants[grant] === true;
}

/**
 * Returns the actor's membership or throws: NOT_FOUND for non-members (never reveals that the
 * occasion exists), FORBIDDEN when the member lacks the required role, grant or manage right.
 */
export async function requireMember(
  ctx: Ctx,
  occasionId: string,
  opts: RequireMemberOptions = {},
): Promise<Member> {
  const member = await getMember(ctx, occasionId);
  if (!member) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (opts.roles && !opts.roles.includes(member.role)) {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
  if (opts.manage && !isManager(member)) {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
  if (opts.grant && !hasGrant(member, opts.grant)) {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
  return member;
}
