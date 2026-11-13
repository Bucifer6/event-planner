import {
  accounts,
  and,
  asc,
  contributionClaims,
  contributionNeeds,
  eq,
  households,
  sql,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { isManager, requireMember } from "./access";
import { audit } from "./audit";
import { requireAccount, type Ctx } from "./context";
import { registerGuestSection, requireGuest } from "./invitations";
import { inTx } from "./tx";

// Contributions, "Cine ce aduce" (A9): a stated need with units ("Sticle de vin", 12);
// households (on their guest link) and members (in the app) claim, change and release units.
//
// Two claims cannot take the same last units:
//
//   UPDATE contribution_needs SET units_claimed = units_claimed + n
//    WHERE id = $1 AND units_claimed + n <= units_needed
//
// decides by row count; the loser gets AppError("TAKEN", "contributions.errors.taken") with
// `details.params.left`. Each holder has one claim row per need (unique), locked while it
// changes, so a double tap applies once and a change moves only the difference.

const idSchema = z.string().min(1).max(64);
const zUnits = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.number().int("common.validation.invalid").min(0, "common.validation.tooSmall").max(10_000, "common.validation.tooBig"),
);

export type Need = typeof contributionNeeds.$inferSelect;

/* ── Planner: the needs ──────────────────────────────────────────────────── */

const needInput = z.object({
  occasionId: idSchema,
  needId: z.preprocess((v) => (v === "" ? undefined : v), idSchema.optional()),
  title: zText(120),
  note: zOptionalText(300),
  unitsNeeded: zUnits.pipe(z.number().min(1, "common.validation.tooSmall")),
});

/** Adds or edits a need (owner / PM). Units cannot drop below what is already claimed. */
export async function saveNeed(ctx: Ctx, input: z.input<typeof needInput>): Promise<{ needId: string }> {
  const data = needInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  return inTx(ctx, async (tx) => {
    if (data.needId) {
      const rows = await tx.db
        .update(contributionNeeds)
        .set({ title: data.title, note: data.note ?? null, unitsNeeded: data.unitsNeeded })
        .where(
          and(
            eq(contributionNeeds.id, data.needId),
            eq(contributionNeeds.occasionId, data.occasionId),
            sql`${contributionNeeds.unitsClaimed} <= ${data.unitsNeeded}`,
          ),
        )
        .returning({ id: contributionNeeds.id });
      if (!rows[0]) {
        const [exists] = await tx.db
          .select()
          .from(contributionNeeds)
          .where(and(eq(contributionNeeds.id, data.needId), eq(contributionNeeds.occasionId, data.occasionId)));
        if (!exists) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
        throw new AppError("VALIDATION", "contributions.errors.belowClaimed", {
          fieldErrors: { unitsNeeded: ["contributions.errors.belowClaimed"] },
          params: { claimed: exists.unitsClaimed },
        });
      }
      await audit(tx, { action: "contribution.need_updated", objectType: "contribution_need", objectId: data.needId });
      return { needId: data.needId };
    }
    const [{ next } = { next: 0 }] = await tx.db
      .select({ next: sql<number>`COALESCE(MAX(${contributionNeeds.position}), -1) + 1` })
      .from(contributionNeeds)
      .where(eq(contributionNeeds.occasionId, data.occasionId));
    const [row] = await tx.db
      .insert(contributionNeeds)
      .values({
        occasionId: data.occasionId,
        title: data.title,
        note: data.note ?? null,
        unitsNeeded: data.unitsNeeded,
        position: Number(next),
      })
      .returning({ id: contributionNeeds.id });
    await audit(tx, { action: "contribution.need_added", objectType: "contribution_need", objectId: row!.id });
    return { needId: row!.id };
  });
}

/** Removes a need and every claim on it (owner / PM). */
export async function removeNeed(ctx: Ctx, input: { needId: string }): Promise<void> {
  const id = idSchema.parse(input.needId);
  const [need] = await ctx.db.select().from(contributionNeeds).where(eq(contributionNeeds.id, id));
  if (!need) return;
  await requireMember(ctx, need.occasionId, { manage: true });
  await inTx(ctx, async (tx) => {
    await tx.db.delete(contributionNeeds).where(eq(contributionNeeds.id, id));
    await audit(tx, {
      action: "contribution.need_removed",
      objectType: "contribution_need",
      objectId: id,
      before: { title: need.title, unitsNeeded: need.unitsNeeded, unitsClaimed: need.unitsClaimed },
    });
  });
}

export type NeedView = {
  id: string;
  title: string;
  note: string | null;
  unitsNeeded: number;
  unitsClaimed: number;
  unitsLeft: number;
  /** units the viewer (member account) has claimed */
  mine: number;
  claims: Array<{ id: string; by: string; kind: "household" | "member"; units: number }>;
};

/** Needs with who brings what (members who may read the guest list). */
export async function listNeeds(
  ctx: Ctx,
  occasionId: string,
): Promise<{ needs: NeedView[]; canManage: boolean }> {
  const member = await requireMember(ctx, occasionId, { roles: ["owner", "pm", "workstream_lead", "contributor"] });
  const [needs, claims] = await Promise.all([
    ctx.db
      .select()
      .from(contributionNeeds)
      .where(eq(contributionNeeds.occasionId, occasionId))
      .orderBy(asc(contributionNeeds.position), asc(contributionNeeds.createdAt)),
    ctx.db
      .select({
        claim: contributionClaims,
        householdName: households.name,
        accountEmail: accounts.email,
        accountUsername: accounts.username,
      })
      .from(contributionClaims)
      .leftJoin(households, eq(households.id, contributionClaims.householdId))
      .leftJoin(accounts, eq(accounts.id, contributionClaims.accountId))
      .where(eq(contributionClaims.occasionId, occasionId))
      .orderBy(asc(contributionClaims.createdAt)),
  ]);
  return {
    canManage: isManager(member),
    needs: needs.map((n) => ({
      id: n.id,
      title: n.title,
      note: n.note,
      unitsNeeded: n.unitsNeeded,
      unitsClaimed: n.unitsClaimed,
      unitsLeft: n.unitsNeeded - n.unitsClaimed,
      mine: claims.find((c) => c.claim.needId === n.id && c.claim.accountId === member.accountId)?.claim.units ?? 0,
      claims: claims
        .filter((c) => c.claim.needId === n.id)
        .map((c) => ({
          id: c.claim.id,
          kind: c.claim.householdId ? ("household" as const) : ("member" as const),
          // a member is shown by the part of the login before "@", never the full address (D2)
          by: c.claim.householdId
            ? (c.householdName ?? "")
            : (c.accountEmail?.split("@")[0] ?? c.accountUsername ?? ""),
          units: c.claim.units,
        })),
    })),
  };
}

/* ── Claiming (atomic) ───────────────────────────────────────────────────── */

type Holder = { householdId: string; accountId?: undefined } | { accountId: string; householdId?: undefined };

export type ClaimUnitsResult = { needId: string; units: number; unitsLeft: number; changed: boolean };

/** Sets the holder's claim on a need to exactly `units` (0 releases) — atomically. */
async function setUnits(ctx: Ctx, need: Need, holder: Holder, units: number): Promise<ClaimUnitsResult> {
  const holderWhere = holder.householdId
    ? eq(contributionClaims.householdId, holder.householdId)
    : eq(contributionClaims.accountId, holder.accountId!);
  return inTx(ctx, async (tx) => {
    // serialise calls of the same holder on this need (double tap, two phones)
    await tx.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`contribution:${need.id}:${holder.householdId ?? holder.accountId}`}, 0))`,
    );
    const [claim] = await tx.db
      .select()
      .from(contributionClaims)
      .where(and(eq(contributionClaims.needId, need.id), holderWhere));
    const held = claim?.units ?? 0;
    const delta = units - held;

    if (delta > 0) {
      const won = await tx.db
        .update(contributionNeeds)
        .set({ unitsClaimed: sql`${contributionNeeds.unitsClaimed} + ${delta}` })
        .where(
          and(
            eq(contributionNeeds.id, need.id),
            sql`${contributionNeeds.unitsClaimed} + ${delta} <= ${contributionNeeds.unitsNeeded}`,
          ),
        )
        .returning({ id: contributionNeeds.id });
      if (!won[0]) {
        const [now] = await tx.db.select().from(contributionNeeds).where(eq(contributionNeeds.id, need.id));
        if (!now) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
        const left = now.unitsNeeded - now.unitsClaimed;
        throw new AppError("TAKEN", "contributions.errors.taken", { params: { left }, left, holding: held });
      }
    } else if (delta < 0) {
      await tx.db
        .update(contributionNeeds)
        .set({ unitsClaimed: sql`GREATEST(0, ${contributionNeeds.unitsClaimed} + ${delta})` })
        .where(eq(contributionNeeds.id, need.id));
    }

    if (delta !== 0) {
      if (units === 0 && claim) {
        await tx.db.delete(contributionClaims).where(eq(contributionClaims.id, claim.id));
      } else if (claim) {
        await tx.db.update(contributionClaims).set({ units }).where(eq(contributionClaims.id, claim.id));
      } else {
        await tx.db.insert(contributionClaims).values({
          needId: need.id,
          occasionId: need.occasionId,
          householdId: holder.householdId ?? null,
          accountId: holder.accountId ?? null,
          units,
        });
      }
      await audit(tx, {
        action: units === 0 ? "contribution.released" : held === 0 ? "contribution.claimed" : "contribution.changed",
        objectType: "contribution_need",
        objectId: need.id,
        before: { units: held },
        after: { units },
      });
    }
    const [after] = await tx.db.select().from(contributionNeeds).where(eq(contributionNeeds.id, need.id));
    return {
      needId: need.id,
      units,
      unitsLeft: after ? after.unitsNeeded - after.unitsClaimed : 0,
      changed: delta !== 0,
    };
  });
}

const claimInput = z.object({ needId: idSchema, units: zUnits });

/**
 * Claim, change or release (units = 0) — as the household behind a guest link, or as a member
 * of the occasion. The holder is taken from the actor, never from the input.
 */
export async function setContribution(ctx: Ctx, input: z.input<typeof claimInput>): Promise<ClaimUnitsResult> {
  const data = claimInput.parse(input);
  const [need] = await ctx.db.select().from(contributionNeeds).where(eq(contributionNeeds.id, data.needId));
  if (!need) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (ctx.actor.kind === "guest") {
    const actor = requireGuest(ctx);
    if (need.occasionId !== actor.occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    return setUnits(ctx, need, { householdId: actor.householdId }, data.units);
  }
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await requireMember(ctx, need.occasionId, { roles: ["owner", "pm", "workstream_lead", "contributor"] });
  return setUnits(ctx, need, { accountId }, data.units);
}

/** Gives every claimed unit back. Releasing twice is harmless. */
export async function releaseContribution(ctx: Ctx, input: { needId: string }): Promise<ClaimUnitsResult> {
  return setContribution(ctx, { needId: input.needId, units: 0 });
}

/* ── Guest side ──────────────────────────────────────────────────────────── */

export type GuestNeeds = {
  needs: Array<{ id: string; title: string; note: string | null; unitsNeeded: number; unitsLeft: number; mine: number }>;
};

registerGuestSection<GuestNeeds>({
  key: "contributions",
  order: 40,
  load: async (ctx) => {
    const actor = requireGuest(ctx);
    const [needs, mine] = await Promise.all([
      ctx.db
        .select()
        .from(contributionNeeds)
        .where(eq(contributionNeeds.occasionId, actor.occasionId))
        .orderBy(asc(contributionNeeds.position), asc(contributionNeeds.createdAt)),
      ctx.db.select().from(contributionClaims).where(eq(contributionClaims.householdId, actor.householdId)),
    ]);
    if (needs.length === 0) return null;
    return {
      // totals and this household's own claim — never who else brings what (SEC2)
      needs: needs.map((n) => ({
        id: n.id,
        title: n.title,
        note: n.note,
        unitsNeeded: n.unitsNeeded,
        unitsLeft: n.unitsNeeded - n.unitsClaimed,
        mine: mine.find((c) => c.needId === n.id)?.units ?? 0,
      })),
    };
  },
});
