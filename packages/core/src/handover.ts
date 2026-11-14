import {
  accounts,
  and,
  businessMembers,
  businessOccasionSeats,
  businesses,
  eq,
  inArray,
  isNull,
  mcpTokens,
  occasionHandovers,
  occasionMembers,
  occasions,
  sql,
  type WhatIfDeltaRow,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { requireFreshAuth } from "./accounts";
import { audit } from "./audit";
import { businessAccountIds } from "./bizoccasions";
import { requireBusinessMember } from "./business";
import { requireAccount, requireWriteCapable, type Ctx } from "./context";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Handover of a business occasion to the client (P22, MCP7).
//
//   listHandoverCandidates(ctx, { businessId, occasionId })  the client-side members
//   proposeHandover(ctx, { businessId, occasionId, toMemberId })  → What-if preview that
//       lists what ENDS; confirming it (fresh sign-in required, S4) does all of this in one
//       transaction:
//         1. the chosen client member becomes the owner (role, both grants, owner_account_id);
//         2. occasions.business_id is cleared — branding ends, the team path in
//            @ed/core/access stops matching;
//         3. every occasion_members row of a team member is removed and every seat deleted;
//         4. the business's MCP tokens are revoked (reason "handover") and, belt and braces,
//            a business token can never again be a member of this occasion (access.ts reads
//            the handover record);
//         5. an occasion_handovers row + audit entry are written — the history that stays.
//   The plan itself (tasks, guests, suppliers, money, files already shared) is untouched.
//
// Who: the business owner or an admin. A lapsed plan does NOT block a handover (invariant 8).

export const HANDOVER_KIND = "bizoccasion.handover";

type HandoverHook = (tx: Ctx, input: { businessId: string; occasionId: string }) => Promise<void>;
const g = globalThis as unknown as { __edHandoverHooks?: HandoverHook[] };
/** Other domains (drawings, catalogues, enquiries) end their own business-side access here. Runs in the handover transaction. */
export function onOccasionHandover(fn: HandoverHook): void {
  (g.__edHandoverHooks ??= []).push(fn);
}

type Loaded = { occasion: typeof occasions.$inferSelect; businessId: string; businessName: string };

async function loadForHandover(ctx: Ctx, occasionId: string | null): Promise<Loaded> {
  if (!occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db
    .select({ occasion: occasions, name: businesses.name })
    .from(occasions)
    .innerJoin(businesses, eq(businesses.id, occasions.businessId))
    .where(eq(occasions.id, occasionId));
  if (!row?.occasion.businessId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  // NOT_FOUND for anyone outside the business, FORBIDDEN for staff-role members
  await requireBusinessMember(ctx, row.occasion.businessId, { roles: ["owner", "admin"] });
  return { occasion: row.occasion, businessId: row.occasion.businessId, businessName: row.name };
}

export type HandoverCandidate = { memberId: string; name: string; role: string };

/** Joined members of the occasion who are NOT on the business team: the people it can be handed to. */
export async function listHandoverCandidates(ctx: Ctx, input: { occasionId: string }): Promise<HandoverCandidate[]> {
  const { occasion, businessId } = await loadForHandover(ctx, zId.parse(input.occasionId));
  return candidates(ctx, occasion.id, businessId);
}

async function candidates(ctx: Ctx, occasionId: string, businessId: string): Promise<HandoverCandidate[]> {
  const team = await businessAccountIds(ctx, businessId);
  const rows = await ctx.db
    .select({ m: occasionMembers, email: accounts.email, username: accounts.username })
    .from(occasionMembers)
    .innerJoin(accounts, eq(accounts.id, occasionMembers.accountId))
    .where(and(eq(occasionMembers.occasionId, occasionId), isNull(occasionMembers.removedAt), isNull(accounts.deletedAt)));
  return rows
    .filter((r) => r.m.accountId && !team.has(r.m.accountId) && r.m.role !== "guest" && r.m.role !== "supplier")
    .map((r) => ({ memberId: r.m.id, name: r.email ?? r.username ?? "", role: r.m.role }));
}

async function countEnding(ctx: Ctx, businessId: string): Promise<{ team: number; tokens: number }> {
  const [team] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), isNull(businessMembers.removedAt), sql`${businessMembers.accountId} is not null`));
  const [tokens] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.businessId, businessId), isNull(mcpTokens.revokedAt)));
  return { team: Number(team?.n ?? 0), tokens: Number(tokens?.n ?? 0) };
}

const handoverInput = z.object({ toMemberId: zId });

registerWhatIf<z.infer<typeof handoverInput>>(HANDOVER_KIND, {
  input: handoverInput,
  authorize: async (ctx, subject) => {
    await loadForHandover(ctx, subject.occasionId);
  },
  compute: async (ctx, input, subject) => {
    const { occasion, businessId, businessName } = await loadForHandover(ctx, subject.occasionId);
    const target = (await candidates(ctx, occasion.id, businessId)).find((c) => c.memberId === input.toMemberId);
    if (!target) throw new AppError("VALIDATION", "bizoccasions.errors.handoverTarget", { fieldErrors: { toMemberId: ["bizoccasions.errors.handoverTarget"] } });
    const ending = await countEnding(ctx, businessId);
    const delta: WhatIfDeltaRow[] = [
      { key: "owner", what: { key: "bizoccasions.whatif.owner" }, kindLabelKey: "whatif.kinds.changed", before: businessName, after: target.name },
      { key: "team", what: { key: "bizoccasions.whatif.teamAccess" }, kindLabelKey: "bizoccasions.whatif.ends", before: { key: "bizoccasions.whatif.teamCount", params: { count: ending.team } }, after: { key: "bizoccasions.whatif.none" } },
      { key: "branding", what: { key: "bizoccasions.whatif.branding" }, kindLabelKey: "bizoccasions.whatif.ends", before: businessName, after: { key: "bizoccasions.whatif.none" } },
      { key: "mcp", what: { key: "bizoccasions.whatif.assistants" }, kindLabelKey: "bizoccasions.whatif.ends", before: { key: "bizoccasions.whatif.assistantCount", params: { count: ending.tokens } }, after: { key: "bizoccasions.whatif.none" } },
      { key: "plan", what: { key: "bizoccasions.whatif.planStays" }, kindLabelKey: "bizoccasions.whatif.stays" },
    ];
    return { title: { key: "bizoccasions.whatif.handoverTitle", params: { title: occasion.title } }, delta };
  },
  apply: async (tx, preview) => {
    await requireFreshAuth(tx); // S4: ownership transfer
    const accountId = requireAccount(tx);
    const { occasion, businessId } = await loadForHandover(tx, preview.occasionId);
    // serialise with seat-taking and a concurrent second handover
    await tx.db.execute(sql`select 1 from occasions where id = ${occasion.id} for update`);
    const target = (await candidates(tx, occasion.id, businessId)).find((c) => c.memberId === preview.input.toMemberId);
    if (!target) throw new AppError("CONFLICT", "bizoccasions.errors.handoverTarget");
    const [targetRow] = await tx.db.select().from(occasionMembers).where(eq(occasionMembers.id, target.memberId));

    // 3. every row of a team member goes (seats, the creator's owner row, anything else)
    const team = [...(await businessAccountIds(tx, businessId))];
    const seatRows = await tx.db.select({ id: businessOccasionSeats.occasionMemberId }).from(businessOccasionSeats).where(eq(businessOccasionSeats.occasionId, occasion.id));
    const ended = await tx.db
      .update(occasionMembers)
      .set({ removedAt: tx.now, role: "contributor", grantFinance: false, grantPrivateRequests: false })
      .where(
        and(
          eq(occasionMembers.occasionId, occasion.id),
          isNull(occasionMembers.removedAt),
          sql`${occasionMembers.id} <> ${target.memberId}`,
          sql`(${team.length > 0 ? inArray(occasionMembers.accountId, team) : sql`false`} or ${seatRows.length > 0 ? inArray(occasionMembers.id, seatRows.map((s) => s.id)) : sql`false`} or ${occasionMembers.role} = 'owner')`,
        ),
      )
      .returning({ id: occasionMembers.id });
    await tx.db.delete(businessOccasionSeats).where(eq(businessOccasionSeats.occasionId, occasion.id));

    // 1 + 2. the client owns it; the business no longer runs it
    await tx.db.update(occasionMembers).set({ role: "owner", grantFinance: true, grantPrivateRequests: true }).where(eq(occasionMembers.id, target.memberId));
    await tx.db.update(occasions).set({ ownerAccountId: targetRow!.accountId!, businessId: null }).where(eq(occasions.id, occasion.id));

    // 4. MCP7 — same statement as @ed/mcp revokeBusinessMcpTokens, inside this transaction
    //    (core cannot import @ed/mcp: the dependency points the other way)
    const revoked = await tx.db
      .update(mcpTokens)
      .set({ revokedAt: tx.now, revokedReason: "handover", tokenHash: sql`'revoked:' || ${mcpTokens.id}` })
      .where(and(eq(mcpTokens.businessId, businessId), isNull(mcpTokens.revokedAt)))
      .returning({ id: mcpTokens.id });

    for (const hook of g.__edHandoverHooks ?? []) await hook(tx, { businessId, occasionId: occasion.id });

    // 5. history
    await tx.db.insert(occasionHandovers).values({
      occasionId: occasion.id,
      businessId,
      occasionTitle: occasion.title,
      occasionStartsAt: occasion.startsAt,
      toAccountId: targetRow!.accountId,
      byAccountId: accountId,
      teamAccessEnded: ended.length,
      mcpTokensRevoked: revoked.length,
      at: tx.now,
    });
    await audit(tx, {
      action: "occasion.handed_over",
      objectType: "occasion",
      objectId: occasion.id,
      before: { businessId, ownerAccountId: occasion.ownerAccountId },
      after: { businessId: null, ownerAccountId: targetRow!.accountId },
      meta: { teamRowsEnded: ended.length, mcpTokensRevoked: revoked.length },
    });
  },
});

/** The preview of a handover: what ends, what stays. Nothing changes until it is confirmed. */
export async function proposeHandover(ctx: Ctx, input: { occasionId: string; toMemberId: string }): Promise<WhatIfPreview> {
  requireWriteCapable(ctx);
  const data = z.object({ occasionId: zId, toMemberId: zId }).parse(input);
  await loadForHandover(ctx, data.occasionId);
  return createPreview(ctx, { kind: HANDOVER_KIND, occasionId: data.occasionId, subjectType: "occasion", subjectId: data.occasionId, input: { toMemberId: data.toMemberId } });
}
