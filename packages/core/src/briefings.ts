import {
  and,
  asc,
  bookings,
  briefingAcks,
  briefingVersions,
  BRIEFING_FIELDS,
  deliveries,
  deliveryItems,
  desc,
  eq,
  inArray,
  occasions,
  orderSnapshots,
  sql,
  suppliers,
  type BookingState,
  type BriefingContent,
  type BriefingField,
  type DeliveryKind,
  type DeliveryState,
  type OrderCounts,
  type OrderItem,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { actingAccount, loadBooking, markSupplierLinkViewed, resolveSupplierLink, type SupplierLink } from "./suppliers";
import { inTx } from "./tx";

// Versioned briefings (B4) and what the supplier sees through the scoped link (S6).
//
// - Publishing creates version n+1. A published version is never edited or removed: the table
//   is immutable at the database level (020_suppliers_guards.sql) and there is no update path
//   here. "Changing the briefing" = publishing the next version.
// - The supplier acknowledges a version ONCE (briefing_acks, unique per version): who, when,
//   which version. Acknowledging again changes nothing.
// - getSupplierLinkView() is everything the link shows: this booking's latest briefing, what
//   changed since the version they acknowledged, the final order and their delivery slots.
//   No money, no guest list, nothing of any other supplier.

export { BRIEFING_FIELDS };
export type { BriefingContent, BriefingField };
export type BriefingVersion = typeof briefingVersions.$inferSelect;
export type BriefingAck = typeof briefingAcks.$inferSelect;

const idSchema = z.string().min(1).max(64);
const field = (max: number) =>
  z
    .string()
    .max(max, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v ?? "").trim());

const contentSchema = z.object({
  what: field(2000),
  when: field(500),
  where: field(500),
  contacts: field(1000),
  specialNotes: field(2000),
  freeText: field(6000),
});

const publishInput = contentSchema.extend({ bookingId: idSchema });

function isEmpty(c: BriefingContent): boolean {
  return BRIEFING_FIELDS.every((f) => c[f] === "");
}

/** Fields whose text differs between two versions (in the fixed field order). */
export function diffBriefing(
  from: BriefingContent | null,
  to: BriefingContent,
): Array<{ field: BriefingField; before: string; after: string }> {
  return BRIEFING_FIELDS.filter((f) => (from?.[f] ?? "") !== to[f]).map((f) => ({
    field: f,
    before: from?.[f] ?? "",
    after: to[f],
  }));
}

/**
 * Publishes the next briefing version of a booking. Managers only. VALIDATION when the
 * briefing is empty; CONFLICT when nothing differs from the latest version (no empty versions).
 */
export async function publishBriefing(ctx: Ctx, input: z.input<typeof publishInput>): Promise<{ versionId: string; version: number }> {
  requireWriteCapable(ctx);
  const data = publishInput.parse(input);
  const { booking, canManage } = await loadBooking(ctx, data.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const { bookingId, ...content } = data;
  if (isEmpty(content)) {
    throw new AppError("VALIDATION", "briefing.errors.empty", { fieldErrors: { what: ["briefing.errors.empty"] } });
  }
  return inTx(ctx, async (tx) => {
    // serialise publishers of the same booking so version numbers never collide
    await tx.db.execute(sql`select id from bookings where id = ${bookingId} for update`);
    const [latest] = await tx.db
      .select()
      .from(briefingVersions)
      .where(eq(briefingVersions.bookingId, bookingId))
      .orderBy(desc(briefingVersions.version))
      .limit(1);
    if (latest && diffBriefing(latest.content, content).length === 0) {
      throw new AppError("CONFLICT", "briefing.errors.unchanged");
    }
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx.db
      .insert(briefingVersions)
      .values({ bookingId, occasionId: booking.occasionId, version, content, createdByAccountId: actingAccount(tx), createdAt: tx.now })
      .returning({ id: briefingVersions.id });
    await audit(tx, {
      action: "briefing.published",
      objectType: "briefing_version",
      objectId: row!.id,
      after: { version },
      meta: { occasionId: booking.occasionId, bookingId },
    });
    return { versionId: row!.id, version };
  });
}

export type BriefingVersionView = {
  id: string;
  version: number;
  content: BriefingContent;
  createdAt: Date;
  /** null = not acknowledged (yet). */
  ack: { name: string; at: Date } | null;
};

/** All versions of a booking's briefing, newest first, each with its acknowledgement. */
export async function listBriefingVersions(ctx: Ctx, bookingId: string): Promise<BriefingVersionView[]> {
  const { booking } = await loadBooking(ctx, bookingId);
  return versionsOf(ctx, booking.id);
}

async function versionsOf(ctx: Ctx, bookingId: string): Promise<BriefingVersionView[]> {
  const rows = await ctx.db
    .select({ v: briefingVersions, a: briefingAcks })
    .from(briefingVersions)
    .leftJoin(briefingAcks, eq(briefingAcks.briefingVersionId, briefingVersions.id))
    .where(eq(briefingVersions.bookingId, bookingId))
    .orderBy(desc(briefingVersions.version));
  return rows.map(({ v, a }) => ({
    id: v.id,
    version: v.version,
    content: v.content,
    createdAt: v.createdAt,
    ack: a ? { name: a.ackName, at: a.ackAt } : null,
  }));
}

/* ── The supplier's side: the scoped link ─────────────────────────────────────────── */

export type SupplierLinkView = {
  link: SupplierLink;
  occasion: {
    title: string;
    startsAt: Date | null;
    endsAt: Date | null;
    timezone: string;
    venueName: string | null;
    venueAddress: string | null;
    status: string;
  };
  supplier: { name: string; contactName: string | null };
  booking: { id: string; state: BookingState };
  /** Latest published briefing, or null when none was published yet. */
  briefing: BriefingVersionView | null;
  /** The newest version this supplier acknowledged, if any. */
  acknowledged: { version: number; name: string; at: Date } | null;
  /** What differs between the acknowledged version and the latest one ([] when up to date). */
  changes: Array<{ field: BriefingField; before: string; after: string }>;
  /** The agreed final order (latest snapshot). */
  order: { version: number; items: OrderItem[]; basedOn: OrderCounts; createdAt: Date } | null;
  deliveries: Array<{
    id: string;
    title: string;
    kind: DeliveryKind;
    state: DeliveryState;
    expectedFrom: Date | null;
    expectedTo: Date | null;
    place: string | null;
    items: Array<{ label: string; expectedQty: number; unit: string | null }>;
  }>;
};

/**
 * Everything the supplier link shows — for the ONE booking the token opens. Returns null for
 * an unknown or revoked token (the page answers both the same way). `ctx` is the anonymous
 * request ctx; the token is the only credential.
 */
export async function getSupplierLinkView(
  ctx: Ctx,
  token: string,
  opts: { rateLimit?: boolean; markViewed?: boolean } = {},
): Promise<SupplierLinkView | null> {
  const link = await resolveSupplierLink(ctx, token, { rateLimit: opts.rateLimit });
  if (!link) return null;
  const [row] = await ctx.db
    .select({ b: bookings, s: suppliers, o: occasions })
    .from(bookings)
    .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
    .innerJoin(occasions, eq(occasions.id, bookings.occasionId))
    .where(eq(bookings.id, link.bookingId));
  if (!row) return null;
  const [versions, [snapshot], slots] = await Promise.all([
    versionsOf(ctx, link.bookingId),
    ctx.db.select().from(orderSnapshots).where(eq(orderSnapshots.bookingId, link.bookingId)).orderBy(desc(orderSnapshots.version)).limit(1),
    ctx.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.occasionId, link.occasionId), eq(deliveries.supplierId, row.s.id)))
      .orderBy(sql`${deliveries.expectedFrom} asc nulls last`, asc(deliveries.createdAt)),
  ]);
  const items = slots.length
    ? await ctx.db
        .select()
        .from(deliveryItems)
        .where(inArray(deliveryItems.deliveryId, slots.map((d) => d.id)))
        .orderBy(asc(deliveryItems.position), asc(deliveryItems.createdAt), asc(deliveryItems.id))
    : [];
  const latest = versions[0] ?? null;
  const acked = versions.find((v) => v.ack) ?? null;
  if (opts.markViewed) await markSupplierLinkViewed(ctx, link);
  return {
    link,
    occasion: {
      title: row.o.title,
      startsAt: row.o.startsAt,
      endsAt: row.o.endsAt,
      timezone: row.o.timezone,
      venueName: row.o.venueName,
      venueAddress: row.o.venueAddress,
      status: row.o.status,
    },
    supplier: { name: row.s.name, contactName: row.s.contactName },
    booking: { id: row.b.id, state: row.b.state },
    briefing: latest,
    acknowledged: acked?.ack ? { version: acked.version, name: acked.ack.name, at: acked.ack.at } : null,
    changes: latest && acked && acked.id !== latest.id ? diffBriefing(acked.content, latest.content) : [],
    order: snapshot ? { version: snapshot.version, items: snapshot.items, basedOn: snapshot.basedOn, createdAt: snapshot.createdAt } : null,
    deliveries: slots.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      state: d.state,
      expectedFrom: d.expectedFrom,
      expectedTo: d.expectedTo,
      place: d.place,
      items: items.filter((i) => i.deliveryId === d.id).map((i) => ({ label: i.label, expectedQty: i.expectedQty, unit: i.unit })),
    })),
  };
}

const ackInput = z.object({
  token: z.string().min(22).max(128),
  /** The version shown on the page when they pressed the button. */
  versionId: idSchema,
  name: z.string().trim().min(2, "briefing.errors.ackName").max(160, "common.validation.tooLong"),
});

/**
 * "Am primit și am înțeles briefingul" — through the supplier link. Stores who, when and which
 * version, once: acknowledging the same version again returns the stored acknowledgement and
 * changes nothing. Call checkPublicForm() with the request ctx BEFORE this (SEC11).
 * NOT_FOUND for an unknown / revoked link or a version of another booking (same answer).
 */
export async function acknowledgeBriefing(
  ctx: Ctx,
  input: z.input<typeof ackInput>,
): Promise<{ version: number; name: string; at: Date; alreadyAcknowledged: boolean }> {
  const parsed = ackInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "common.errors.VALIDATION", {
      fieldErrors: { name: parsed.error.issues.filter((i) => i.path[0] === "name").map((i) => i.message) },
    });
  }
  const data = parsed.data;
  const link = await resolveSupplierLink(ctx, data.token);
  if (!link) throw new AppError("NOT_FOUND", "briefing.errors.linkGone");
  const [version] = await ctx.db
    .select()
    .from(briefingVersions)
    .where(and(eq(briefingVersions.id, data.versionId), eq(briefingVersions.bookingId, link.bookingId)));
  if (!version) throw new AppError("NOT_FOUND", "briefing.errors.linkGone");
  return inTx(ctx, async (tx) => {
    const [created] = await tx.db
      .insert(briefingAcks)
      .values({
        briefingVersionId: version.id,
        bookingId: link.bookingId,
        occasionId: link.occasionId,
        ackName: data.name,
        linkId: link.linkId,
        ackAt: tx.now,
      })
      .onConflictDoNothing({ target: briefingAcks.briefingVersionId })
      .returning();
    if (!created) {
      const [existing] = await tx.db.select().from(briefingAcks).where(eq(briefingAcks.briefingVersionId, version.id));
      return { version: version.version, name: existing!.ackName, at: existing!.ackAt, alreadyAcknowledged: true };
    }
    await audit(tx, {
      action: "briefing.acknowledged",
      objectType: "briefing_version",
      objectId: version.id,
      after: { version: version.version, name: data.name },
      meta: { occasionId: link.occasionId, bookingId: link.bookingId, linkId: link.linkId },
    });
    return { version: version.version, name: created.ackName, at: created.ackAt, alreadyAcknowledged: false };
  });
}
