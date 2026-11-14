import { and, capacityClaims, eq, occasionCapacity, sql } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { inTx } from "./tx";

// Shared capacity (A8, Q4): ONE count per occasion, used by invited households (RSVP) and by
// public registrations (a later release). Two people cannot take the last place:
//
//   UPDATE occasion_capacity SET taken = taken + n
//    WHERE occasion_id = $1 AND (total IS NULL OR taken + n <= total)
//
// and the row count decides. The loser gets AppError("TAKEN", "rsvp.errors.lastPlaceTaken")
// with `details.params.left` = places still free.
//
// Every holder has a claim row keyed by a stable `key` ("rsvp:<householdId>",
// "public:<registrationId>"), which makes the three calls idempotent (a double tap applies
// once) and lets a change of party size move only the difference.
//
// claimPlaces / adjustPlaces / releasePlaces do NO access check: call them from core code that
// has already decided the actor may hold places (the RSVP of its own household, a public
// registration). They join the caller's transaction when given an inTx ctx.

export const LAST_PLACE_TAKEN_KEY = "rsvp.errors.lastPlaceTaken";

const occasionIdSchema = z.string().min(1).max(64);
const claimSchema = z.object({
  key: z.string().min(1).max(200),
  places: z.number().int().min(0).max(100_000),
});
export type ClaimInput = z.input<typeof claimSchema>;

export type CapacityState = {
  occasionId: string;
  /** null = unlimited */
  total: number | null;
  taken: number;
  /** null = unlimited */
  left: number | null;
};

export type ClaimResult = {
  key: string;
  /** Places this key holds after the call. */
  places: number;
  /** false when the call changed nothing (a repeat). */
  changed: boolean;
  capacity: CapacityState;
};

function toState(row: { occasionId: string; total: number | null; taken: number }): CapacityState {
  return {
    occasionId: row.occasionId,
    total: row.total,
    taken: row.taken,
    left: row.total === null ? null : Math.max(0, row.total - row.taken),
  };
}

async function ensureRow(ctx: Ctx, occasionId: string): Promise<void> {
  await ctx.db.insert(occasionCapacity).values({ occasionId }).onConflictDoNothing();
}

/** Current count. No access check (see the header). */
export async function readCapacity(ctx: Ctx, occasionId: string): Promise<CapacityState> {
  const id = occasionIdSchema.parse(occasionId);
  const [row] = await ctx.db.select().from(occasionCapacity).where(eq(occasionCapacity.occasionId, id));
  return toState(row ?? { occasionId: id, total: null, taken: 0 });
}

/** Members read the occasion's capacity. */
export async function getCapacity(ctx: Ctx, occasionId: string): Promise<CapacityState> {
  await requireMember(ctx, occasionId);
  return readCapacity(ctx, occasionId);
}

/** Owner / PM sets the total (null = unlimited). It cannot go below what is already taken. */
export async function setCapacityTotal(
  ctx: Ctx,
  input: { occasionId: string; total: number | null },
): Promise<CapacityState> {
  const data = z
    .object({ occasionId: occasionIdSchema, total: z.number().int().min(0).max(100_000).nullable() })
    .parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  return inTx(ctx, async (tx) => {
    await ensureRow(tx, data.occasionId);
    const before = await readCapacity(tx, data.occasionId);
    const rows = await tx.db
      .update(occasionCapacity)
      .set({ total: data.total })
      .where(
        and(
          eq(occasionCapacity.occasionId, data.occasionId),
          data.total === null ? sql`true` : sql`${occasionCapacity.taken} <= ${data.total}`,
        ),
      )
      .returning();
    if (!rows[0]) {
      throw new AppError("VALIDATION", "guests.errors.capacityBelowTaken", {
        fieldErrors: { total: ["guests.errors.capacityBelowTaken"] },
        params: { taken: before.taken },
      });
    }
    if (before.total !== data.total) {
      await audit(tx, {
        action: "capacity.total_set",
        objectType: "occasion",
        objectId: data.occasionId,
        before: { total: before.total },
        after: { total: data.total },
      });
    }
    return toState(rows[0]);
  });
}

/**
 * Sets the places held by `key` to exactly `places`, moving only the difference — atomically.
 * The claim row is locked first, so two calls for the same key run one after the other.
 */
async function setClaim(
  ctx: Ctx,
  occasionId: string,
  key: string,
  places: number,
  mode: "claim" | "adjust",
): Promise<ClaimResult> {
  return inTx(ctx, async (tx) => {
    await ensureRow(tx, occasionId);
    // Create-or-lock the claim row. ON CONFLICT DO NOTHING waits for a concurrent insert of
    // the same key to commit, then FOR UPDATE takes the row.
    await tx.db
      .insert(capacityClaims)
      .values({ occasionId, claimKey: key, places: 0 })
      .onConflictDoNothing({ target: [capacityClaims.occasionId, capacityClaims.claimKey] });
    const [claim] = await tx.db
      .select()
      .from(capacityClaims)
      .where(and(eq(capacityClaims.occasionId, occasionId), eq(capacityClaims.claimKey, key)))
      .for("update");
    if (!claim) throw new AppError("CONFLICT", "common.errors.CONFLICT");

    // claimPlaces is "take once": a key that already holds places keeps them (Q4).
    const target = mode === "claim" && claim.places > 0 ? claim.places : places;
    const delta = target - claim.places;

    if (delta > 0) {
      const won = await tx.db
        .update(occasionCapacity)
        .set({ taken: sql`${occasionCapacity.taken} + ${delta}` })
        .where(
          and(
            eq(occasionCapacity.occasionId, occasionId),
            sql`(${occasionCapacity.total} IS NULL OR ${occasionCapacity.taken} + ${delta} <= ${occasionCapacity.total})`,
          ),
        )
        .returning();
      if (!won[0]) {
        const now = await readCapacity(tx, occasionId);
        // what this key could hold at most: its own places plus what is free
        const left = now.left ?? 0;
        throw new AppError("TAKEN", LAST_PLACE_TAKEN_KEY, {
          params: { left },
          left,
          holding: claim.places,
        });
      }
    } else if (delta < 0) {
      await tx.db
        .update(occasionCapacity)
        .set({ taken: sql`GREATEST(0, ${occasionCapacity.taken} + ${delta})` })
        .where(eq(occasionCapacity.occasionId, occasionId));
    }

    if (target === 0) {
      await tx.db.delete(capacityClaims).where(eq(capacityClaims.id, claim.id));
    } else if (delta !== 0) {
      await tx.db.update(capacityClaims).set({ places: target }).where(eq(capacityClaims.id, claim.id));
    }
    return { key, places: target, changed: delta !== 0, capacity: await readCapacity(tx, occasionId) };
  });
}

/**
 * Takes `places` for `key`. Idempotent per key: a repeat (double tap, retry) holds the same
 * places and changes nothing. Throws TAKEN when not enough places are left — nothing is held.
 */
export async function claimPlaces(ctx: Ctx, occasionId: string, input: ClaimInput): Promise<ClaimResult> {
  const data = claimSchema.parse(input);
  return setClaim(ctx, occasionIdSchema.parse(occasionId), data.key, data.places, "claim");
}

/**
 * Changes what `key` holds to exactly `places` (0 releases). Growing takes only the extra
 * places and throws TAKEN (keeping the old claim) when they are not available.
 */
export async function adjustPlaces(ctx: Ctx, occasionId: string, input: ClaimInput): Promise<ClaimResult> {
  const data = claimSchema.parse(input);
  return setClaim(ctx, occasionIdSchema.parse(occasionId), data.key, data.places, "adjust");
}

/** Gives back everything `key` holds. Releasing twice is harmless. */
export async function releasePlaces(ctx: Ctx, occasionId: string, input: { key: string }): Promise<ClaimResult> {
  const key = z.string().min(1).max(200).parse(input.key);
  return setClaim(ctx, occasionIdSchema.parse(occasionId), key, 0, "adjust");
}

/** Places held by one key (0 when none). */
export async function getClaim(ctx: Ctx, occasionId: string, key: string): Promise<number> {
  const [row] = await ctx.db
    .select({ places: capacityClaims.places })
    .from(capacityClaims)
    .where(and(eq(capacityClaims.occasionId, occasionId), eq(capacityClaims.claimKey, key)));
  return row?.places ?? 0;
}
