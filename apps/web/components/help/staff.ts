import "server-only";
import { actorAccountId, type Ctx } from "@ed/core/context";
import { accounts, and, eq, isNull, staffMembers } from "@ed/db";

/**
 * Is the signed-in account on the staff? Read-only on purpose: `getConsoleAccess` would open
 * (and audit) a console session, whose 30-minute idle clock must not start just because
 * someone opened the help centre. This decides only whether the staff help section is
 * listed — it grants nothing, and those articles hold no secrets. Any failure reads as "no".
 */
export async function isStaffReader(ctx: Ctx): Promise<boolean> {
  const accountId = actorAccountId(ctx.actor);
  if (!accountId) return false;
  try {
    const [row] = await ctx.db
      .select({ roles: staffMembers.roles })
      .from(staffMembers)
      .innerJoin(accounts, eq(accounts.id, staffMembers.accountId))
      .where(and(eq(staffMembers.accountId, accountId), eq(staffMembers.active, true), isNull(accounts.deletedAt)));
    return (row?.roles?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
