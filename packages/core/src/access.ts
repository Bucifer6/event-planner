import { and, eq, isNull, occasionMembers, type OccasionGrant, type OccasionRole } from "@ed/db";
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
  const [row] = await ctx.db
    .select()
    .from(occasionMembers)
    .where(
      and(
        eq(occasionMembers.occasionId, parsed.data),
        eq(occasionMembers.accountId, accountId),
        isNull(occasionMembers.removedAt),
      ),
    );
  if (!row || !row.accountId) return null;
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
