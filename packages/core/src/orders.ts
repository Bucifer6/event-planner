import {
  and,
  asc,
  desc,
  eq,
  households,
  isNull,
  orderDeltas,
  orderSnapshots,
  sql,
  type OrderCounts,
  type OrderItem,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { getRsvpSummary } from "./rsvp";
import { actingAccount, loadBooking } from "./suppliers";
import { inTx } from "./tx";

// Final-order snapshots and deltas (B5, principle 4).
//
// - A snapshot is the order as agreed with the supplier at one moment: the items and the
//   guest counts it was based on. It is immutable (DB guard). Changing the order = fixing a
//   NEW version, explicitly.
// - After a snapshot exists, every guest answer that changes the attending counts leaves an
//   `order_deltas` row for that booking, linked to the household whose answer changed. Those
//   rows are written by the database trigger on rsvp_responses (020_suppliers_guards.sql), so
//   no code path — RSVP link, a manager recording an answer, an import, a removed household —
//   can change the numbers without the delta appearing. Nothing here edits the agreed order.
// - Fixing a new version folds the open deltas into it (they stay on record, marked folded).

export type { OrderCounts, OrderItem };
export type OrderSnapshot = typeof orderSnapshots.$inferSelect;
export type OrderDelta = typeof orderDeltas.$inferSelect;

const idSchema = z.string().min(1).max(64);
export const ORDER_MAX_ITEMS = 60;

const itemSchema = z.object({
  label: z.string().trim().min(1, "suppliers.errors.itemLabel").max(200, "common.validation.tooLong"),
  quantity: z.coerce
    .number("suppliers.errors.itemQuantity")
    .int("suppliers.errors.itemQuantity")
    .min(0, "suppliers.errors.itemQuantity")
    .max(1_000_000, "suppliers.errors.itemQuantity"),
  unit: z
    .string()
    .max(30, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  note: z
    .string()
    .max(300, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
});

const snapshotInput = z.object({
  bookingId: idSchema,
  items: z.array(itemSchema).min(1, "suppliers.errors.itemsRequired").max(ORDER_MAX_ITEMS, "suppliers.errors.itemsTooMany"),
});

/**
 * Fixes the final order: version 1, or the next version. Takes the guest counts of this
 * moment (getRsvpSummary) as what the order is based on, and folds the open deltas of the
 * booking into the new version. Managers only. Old versions stay exactly as they were.
 */
export async function createOrderSnapshot(
  ctx: Ctx,
  input: z.input<typeof snapshotInput>,
): Promise<{ snapshotId: string; version: number; folded: number }> {
  requireWriteCapable(ctx);
  const parsed = snapshotInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError("VALIDATION", first?.message.includes(".") ? first.message : "common.errors.VALIDATION", {
      fieldErrors: { items: [first?.message ?? "common.errors.VALIDATION"] },
    });
  }
  const data = parsed.data;
  const { booking, canManage } = await loadBooking(ctx, data.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  // read on the request connection (the summary runs its queries side by side)
  const summary = await getRsvpSummary(ctx, booking.occasionId);
  return inTx(ctx, async (tx) => {
    await tx.db.execute(sql`select id from bookings where id = ${booking.id} for update`);
    const basedOn: OrderCounts = { ...summary.attending };
    const [latest] = await tx.db
      .select({ version: orderSnapshots.version })
      .from(orderSnapshots)
      .where(eq(orderSnapshots.bookingId, booking.id))
      .orderBy(desc(orderSnapshots.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx.db
      .insert(orderSnapshots)
      .values({
        bookingId: booking.id,
        occasionId: booking.occasionId,
        version,
        items: data.items,
        basedOn,
        createdByAccountId: actingAccount(tx),
        createdAt: tx.now,
      })
      .returning({ id: orderSnapshots.id });
    const folded = await tx.db
      .update(orderDeltas)
      .set({ foldedIntoSnapshotId: row!.id })
      .where(and(eq(orderDeltas.bookingId, booking.id), isNull(orderDeltas.foldedIntoSnapshotId)))
      .returning({ id: orderDeltas.id });
    await audit(tx, {
      action: "order.snapshot_created",
      objectType: "order_snapshot",
      objectId: row!.id,
      after: { version, basedOn, items: data.items.length, foldedDeltas: folded.length },
      meta: { occasionId: booking.occasionId, bookingId: booking.id },
    });
    return { snapshotId: row!.id, version, folded: folded.length };
  });
}

export type OrderDeltaView = {
  id: string;
  householdId: string;
  /** null = the household has since been removed from the guest list. */
  householdName: string | null;
  before: { adults: number; children: number };
  after: { adults: number; children: number };
  createdAt: Date;
  snapshotVersion: number | null;
};

export type OrderState = {
  /** Newest first. */
  versions: OrderSnapshot[];
  latest: OrderSnapshot | null;
  /** Guest changes since the latest version was fixed, oldest first. */
  openDeltas: OrderDeltaView[];
  /** Counts confirmed right now. */
  current: OrderCounts;
  /** current − latest.basedOn (null when there is no order yet). */
  drift: { adults: number; children: number; total: number } | null;
};

/** The booking's final order, its history and what changed since (for the planner). */
export async function getOrderState(ctx: Ctx, bookingId: string): Promise<OrderState> {
  const { booking } = await loadBooking(ctx, bookingId);
  const [versions, deltas, summary] = await Promise.all([
    ctx.db.select().from(orderSnapshots).where(eq(orderSnapshots.bookingId, booking.id)).orderBy(desc(orderSnapshots.version)),
    ctx.db
      .select({ d: orderDeltas, name: households.name })
      .from(orderDeltas)
      .leftJoin(households, eq(households.id, orderDeltas.householdId))
      .where(and(eq(orderDeltas.bookingId, booking.id), isNull(orderDeltas.foldedIntoSnapshotId)))
      .orderBy(asc(orderDeltas.createdAt), asc(orderDeltas.id)),
    getRsvpSummary(ctx, booking.occasionId),
  ]);
  const latest = versions[0] ?? null;
  const current: OrderCounts = { ...summary.attending };
  return {
    versions,
    latest,
    openDeltas: deltas.map(({ d, name }) => ({
      id: d.id,
      householdId: d.householdId,
      householdName: name,
      before: d.before,
      after: d.after,
      createdAt: d.createdAt,
      snapshotVersion: versions.find((v) => v.id === d.snapshotId)?.version ?? null,
    })),
    current,
    drift: latest
      ? {
          adults: current.adults - latest.basedOn.adults,
          children: current.children - latest.basedOn.children,
          total: current.total - latest.basedOn.total,
        }
      : null,
  };
}

/** Bookings of the occasion with guest changes not yet folded into a new order version. */
export async function countOpenOrderDeltas(ctx: Ctx, occasionId: string): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ bookingId: orderDeltas.bookingId, n: sql<number>`count(*)::int` })
    .from(orderDeltas)
    .where(and(eq(orderDeltas.occasionId, occasionId), isNull(orderDeltas.foldedIntoSnapshotId)))
    .groupBy(orderDeltas.bookingId);
  return new Map(rows.map((r) => [r.bookingId, r.n]));
}
