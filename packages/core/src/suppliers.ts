import {
  and,
  asc,
  bookingEvents,
  bookings,
  briefingAcks,
  briefingVersions,
  eq,
  inArray,
  isNull,
  orderSnapshots,
  paymentDeadlines,
  sql,
  supplierLinks,
  suppliers,
  type BookingState,
  type OccasionRole,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared";
import { z } from "zod";
import { requireMember, isManager, type Member } from "./access";
import { audit } from "./audit";
import { actorAccountId, actorRef, requireWriteCapable, type Ctx } from "./context";
import { registerExport, toCsv } from "./exports";
import { onOccasionPurge } from "./occasions";
import { enforceRateLimit } from "./ratelimit";
import { inTx } from "./tx";

// Supplier records (B4, P10) and the scoped supplier link (S6, SEC2).
//
// - A supplier belongs to one occasion and has exactly ONE booking (see ./bookings): the state
//   of the agreement, the agreed amount, the quote.
// - Who sees what: owner, project manager, workstream leads and contributors read suppliers;
//   owner and project manager change them. Money (agreed amount, payment deadlines) is only
//   ever returned to members holding the finance grant (D2) — for everyone else the fields
//   are `undefined`, which the screens render as nothing at all (not as "unknown").
// - The supplier link is a ≥128-bit random token, stored hashed, revocable, rate-limited; an
//   unknown and a revoked token get the same answer (null). It opens ONE booking and nothing
//   else of the occasion (see getSupplierLinkView in ./briefings).

export type Supplier = typeof suppliers.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type SupplierLinkRow = typeof supplierLinks.$inferSelect;

/** Roles that work on the plan (the `supplier` and `guest` roles never see supplier data). */
export const PLANNING_ROLES: OccasionRole[] = ["owner", "pm", "workstream_lead", "contributor"];

const idSchema = z.string().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .max(max, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const optionalEmail = z
  .string()
  .max(254, "common.validation.tooLong")
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim().toLowerCase() : null))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "suppliers.errors.email");
const optionalPhone = z
  .string()
  .max(40, "common.validation.tooLong")
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
  .refine((v) => v === null || /^[+0-9 ()./-]{3,40}$/.test(v), "suppliers.errors.phone");

const supplierFields = {
  name: z.string().trim().min(1, "suppliers.errors.nameRequired").max(160, "common.validation.tooLong"),
  categoryLabel: optionalText(80),
  contactName: optionalText(160),
  contactEmail: optionalEmail,
  contactPhone: optionalPhone,
  notes: optionalText(2000),
};

/**
 * Money typed in a form ("1500", "1.500", "1.500,50", "1500.5") → minor units, or null for an
 * empty field (= unknown). Throws nothing: returns undefined for text that is not an amount.
 */
export function parseMoneyText(value: string | null | undefined): number | null | undefined {
  const raw = (value ?? "").replace(/\s|lei|ron/gi, "");
  if (raw === "") return null;
  let normal = raw;
  if (raw.includes(",")) normal = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) normal = raw.replace(/\./g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normal)) return undefined;
  return Math.round(Number(normal) * 100);
}

/** zod field for an optional amount typed as text; error key is the caller's. */
export const zMoneyText = (errorKey = "suppliers.errors.amount") =>
  z
    .string()
    .max(30)
    .nullish()
    .transform((v, c) => {
      const minor = parseMoneyText(v);
      if (minor === undefined) {
        c.addIssue({ code: "custom", message: errorKey });
        return z.NEVER;
      }
      return minor;
    });

export type SupplierAccess = { member: Member; canManage: boolean; canSeeMoney: boolean };

/** The actor's rights on the supplier area of an occasion (throws for non-members). */
export async function supplierAccess(ctx: Ctx, occasionId: string): Promise<SupplierAccess> {
  const member = await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  return { member, canManage: isManager(member), canSeeMoney: member.grants.finance };
}

export type SupplierListItem = {
  id: string;
  name: string;
  categoryLabel: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  listingId: string | null;
  booking: {
    id: string;
    state: BookingState;
    /** undefined = the viewer has no finance grant; null = unknown. */
    agreedMinor: number | null | undefined;
    currency: string;
    hasQuote: boolean;
  };
  /** undefined without the finance grant; null = no unpaid deadline. */
  nextPayment: { id: string; dueOn: string; amountMinor: number | null; currency: string; overdue: boolean } | null | undefined;
  briefing: { latestVersion: number | null; acknowledgedVersion: number | null };
  hasFinalOrder: boolean;
};

export type SupplierList = { items: SupplierListItem[]; canManage: boolean; canSeeMoney: boolean };

async function ensureBookingRow(ctx: Ctx, supplier: Pick<Supplier, "id" | "occasionId">): Promise<Booking> {
  const [existing] = await ctx.db.select().from(bookings).where(eq(bookings.supplierId, supplier.id));
  if (existing) return existing;
  const [created] = await ctx.db
    .insert(bookings)
    .values({ supplierId: supplier.id, occasionId: supplier.occasionId, state: "enquired" })
    .onConflictDoNothing({ target: bookings.supplierId })
    .returning();
  if (!created) {
    const [row] = await ctx.db.select().from(bookings).where(eq(bookings.supplierId, supplier.id));
    return row!;
  }
  const ref = actorRef(ctx.actor);
  await ctx.db.insert(bookingEvents).values({
    bookingId: created.id,
    occasionId: created.occasionId,
    fromState: null,
    toState: "enquired",
    actorKind: ref.kind,
    actorId: ref.id,
    at: ctx.now,
  });
  await audit(ctx, {
    action: "booking.created",
    objectType: "booking",
    objectId: created.id,
    after: { state: "enquired", supplierId: supplier.id },
    meta: { occasionId: created.occasionId },
  });
  return created;
}

/** Today's calendar day in Bucharest ("YYYY-MM-DD"), the day payment deadlines are compared to. */
export function todayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Suppliers of the occasion with their booking state, next payment (finance) and briefing status. */
export async function listSuppliers(ctx: Ctx, occasionId: string): Promise<SupplierList> {
  const { canManage, canSeeMoney } = await supplierAccess(ctx, occasionId);
  const rows = await ctx.db
    .select({ s: suppliers, b: bookings })
    .from(suppliers)
    .innerJoin(bookings, eq(bookings.supplierId, suppliers.id))
    .where(eq(suppliers.occasionId, occasionId))
    .orderBy(asc(sql`lower(${suppliers.name})`), asc(suppliers.id));
  const bookingIds = rows.map((r) => r.b.id);
  const [versions, acks, snaps, dues] = bookingIds.length
    ? await Promise.all([
        ctx.db
          .select({ bookingId: briefingVersions.bookingId, v: sql<number>`max(${briefingVersions.version})::int` })
          .from(briefingVersions)
          .where(inArray(briefingVersions.bookingId, bookingIds))
          .groupBy(briefingVersions.bookingId),
        ctx.db
          .select({ bookingId: briefingAcks.bookingId, v: sql<number>`max(${briefingVersions.version})::int` })
          .from(briefingAcks)
          .innerJoin(briefingVersions, eq(briefingVersions.id, briefingAcks.briefingVersionId))
          .where(inArray(briefingAcks.bookingId, bookingIds))
          .groupBy(briefingAcks.bookingId),
        ctx.db
          .select({ bookingId: orderSnapshots.bookingId })
          .from(orderSnapshots)
          .where(inArray(orderSnapshots.bookingId, bookingIds))
          .groupBy(orderSnapshots.bookingId),
        canSeeMoney
          ? ctx.db
              .select()
              .from(paymentDeadlines)
              .where(and(inArray(paymentDeadlines.bookingId, bookingIds), isNull(paymentDeadlines.paidAt)))
              .orderBy(asc(paymentDeadlines.dueOn), asc(paymentDeadlines.id))
          : Promise.resolve([]),
      ])
    : [[], [], [], []];
  const today = todayKey(ctx.now);
  const items: SupplierListItem[] = rows.map(({ s, b }) => {
    const due = dues.find((d) => d.bookingId === b.id);
    return {
      id: s.id,
      name: s.name,
      categoryLabel: s.categoryLabel,
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      listingId: s.listingId,
      booking: {
        id: b.id,
        state: b.state,
        agreedMinor: canSeeMoney ? b.agreedMinor : undefined,
        currency: b.currency,
        hasQuote: !!b.quoteAssetId,
      },
      nextPayment: canSeeMoney
        ? due
          ? { id: due.id, dueOn: due.dueOn, amountMinor: due.amountMinor, currency: due.currency, overdue: due.dueOn < today }
          : null
        : undefined,
      briefing: {
        latestVersion: versions.find((v) => v.bookingId === b.id)?.v ?? null,
        acknowledgedVersion: acks.find((a) => a.bookingId === b.id)?.v ?? null,
      },
      hasFinalOrder: snaps.some((x) => x.bookingId === b.id),
    };
  });
  return { items, canManage, canSeeMoney };
}

export type SupplierDetail = {
  supplier: Supplier;
  booking: Omit<Booking, "agreedMinor"> & { agreedMinor: number | null | undefined };
  canManage: boolean;
  canSeeMoney: boolean;
};

/** Loads a supplier with its booking and the actor's rights. NOT_FOUND for non-members. */
export async function loadSupplier(ctx: Ctx, supplierId: string): Promise<{ supplier: Supplier; booking: Booking } & SupplierAccess> {
  const id = idSchema.safeParse(supplierId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [supplier] = await ctx.db.select().from(suppliers).where(eq(suppliers.id, id.data));
  if (!supplier) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const access = await supplierAccess(ctx, supplier.occasionId);
  const booking = await ensureBookingRow(ctx, supplier);
  return { supplier, booking, ...access };
}

/** Loads a booking with its supplier and the actor's rights. NOT_FOUND for non-members. */
export async function loadBooking(ctx: Ctx, bookingId: string): Promise<{ supplier: Supplier; booking: Booking } & SupplierAccess> {
  const id = idSchema.safeParse(bookingId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db
    .select({ b: bookings, s: suppliers })
    .from(bookings)
    .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
    .where(eq(bookings.id, id.data));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const access = await supplierAccess(ctx, row.b.occasionId);
  return { supplier: row.s, booking: row.b, ...access };
}

export async function getSupplier(ctx: Ctx, supplierId: string): Promise<SupplierDetail> {
  const { supplier, booking, canManage, canSeeMoney } = await loadSupplier(ctx, supplierId);
  return {
    supplier,
    booking: { ...booking, agreedMinor: canSeeMoney ? booking.agreedMinor : undefined },
    canManage,
    canSeeMoney,
  };
}

const createInput = z.object({ occasionId: idSchema, ...supplierFields });

/** Adds a supplier (and its booking, state "enquired"). Managers only. */
export async function createSupplier(
  ctx: Ctx,
  input: z.input<typeof createInput>,
): Promise<{ supplierId: string; bookingId: string }> {
  requireWriteCapable(ctx);
  const data = createInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  return inTx(ctx, async (tx) => {
    const { occasionId, ...fields } = data;
    const [row] = await tx.db
      .insert(suppliers)
      .values({ occasionId, ...fields })
      .returning();
    await audit(tx, {
      action: "supplier.created",
      objectType: "supplier",
      objectId: row!.id,
      after: { name: row!.name, categoryLabel: row!.categoryLabel },
      meta: { occasionId },
    });
    const booking = await ensureBookingRow(tx, row!);
    return { supplierId: row!.id, bookingId: booking.id };
  });
}

const updateInput = z.object({ supplierId: idSchema, ...supplierFields });

export async function updateSupplier(ctx: Ctx, input: z.input<typeof updateInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = updateInput.parse(input);
  const { supplier, canManage } = await loadSupplier(ctx, data.supplierId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const { supplierId, ...fields } = data;
  await inTx(ctx, async (tx) => {
    await tx.db.update(suppliers).set(fields).where(eq(suppliers.id, supplierId));
    await audit(tx, {
      action: "supplier.updated",
      objectType: "supplier",
      objectId: supplierId,
      before: { name: supplier.name, categoryLabel: supplier.categoryLabel, contactName: supplier.contactName },
      after: { name: fields.name, categoryLabel: fields.categoryLabel, contactName: fields.contactName },
      meta: { occasionId: supplier.occasionId },
    });
  });
}

/**
 * Removes a supplier added by mistake. Refused (CONFLICT) once anything on record depends on
 * it — a published briefing, a final order or a payment made: cancel the booking instead.
 */
export async function deleteSupplier(ctx: Ctx, input: { supplierId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { supplier, booking, canManage } = await loadSupplier(ctx, input.supplierId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const [used] = await ctx.db
    .select({
      briefings: sql<number>`(select count(*)::int from briefing_versions where booking_id = ${booking.id})`,
      orders: sql<number>`(select count(*)::int from order_snapshots where booking_id = ${booking.id})`,
      paid: sql<number>`(select count(*)::int from payment_deadlines where booking_id = ${booking.id} and paid_at is not null)`,
    })
    .from(bookings)
    .where(eq(bookings.id, booking.id));
  if (used && (used.briefings > 0 || used.orders > 0 || used.paid > 0)) {
    throw new AppError("CONFLICT", "suppliers.errors.cannotDelete");
  }
  await inTx(ctx, async (tx) => {
    await tx.db.delete(suppliers).where(eq(suppliers.id, supplier.id));
    await audit(tx, {
      action: "supplier.deleted",
      objectType: "supplier",
      objectId: supplier.id,
      before: { name: supplier.name },
      meta: { occasionId: supplier.occasionId },
    });
  });
}

/* ── P10: the directory creates or reuses the supplier record of a listing ─────────── */

const forListingInput = z.object({
  occasionId: idSchema,
  listingId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  categoryLabel: optionalText(80),
});

/**
 * The supplier record of a directory listing in this occasion: reused when it exists, created
 * otherwise (never a duplicate — unique per occasion + listing). Called by the directory when
 * a planner sends an enquiry (P10); the actor must be a planning member of the occasion.
 * Follow it with ensureBooking(ctx, supplier.id) and keep the booking id on the enquiry.
 */
export async function findOrCreateSupplierForListing(
  ctx: Ctx,
  input: z.input<typeof forListingInput>,
): Promise<Supplier> {
  requireWriteCapable(ctx);
  const data = forListingInput.parse(input);
  await requireMember(ctx, data.occasionId, { roles: PLANNING_ROLES });
  const find = async (db: Ctx["db"]) => {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.occasionId, data.occasionId), eq(suppliers.listingId, data.listingId)));
    return row;
  };
  const existing = await find(ctx.db);
  if (existing) return existing;
  return inTx(ctx, async (tx) => {
    const [created] = await tx.db
      .insert(suppliers)
      .values({ occasionId: data.occasionId, listingId: data.listingId, name: data.name, categoryLabel: data.categoryLabel })
      .onConflictDoNothing()
      .returning();
    if (!created) return (await find(tx.db))!;
    await audit(tx, {
      action: "supplier.created",
      objectType: "supplier",
      objectId: created.id,
      after: { name: created.name, listingId: created.listingId },
      meta: { occasionId: data.occasionId, source: "directory" },
    });
    await ensureBookingRow(tx, created);
    return created;
  });
}

/** The supplier's one booking, created (state "enquired", event recorded) when missing. */
export async function ensureBooking(ctx: Ctx, supplierId: string): Promise<Booking> {
  requireWriteCapable(ctx);
  const { booking } = await loadSupplier(ctx, supplierId);
  return booking;
}

/* ── Scoped supplier link (S6, SEC2) ───────────────────────────────────────────────── */

/** 32 bytes = 256 bits (SEC2 asks for at least 128). */
export const SUPPLIER_TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,128}$/;
export const SUPPLIER_LINK_LIMITS = { perIpPerHour: 300, missesPerIpPerHour: 30, perLinkPerHour: 600 } as const;

export function supplierLinkPath(token: string): string {
  return `/s/${token}`;
}

export type SupplierLinkMeta = {
  id: string;
  language: "ro" | "en";
  state: "active" | "revoked";
  lastViewedAt: Date | null;
  createdAt: Date;
};

/** Link state for the planner (never the token: only its hash is stored). Null = none yet. */
export async function getSupplierLinkMeta(ctx: Ctx, bookingId: string): Promise<SupplierLinkMeta | null> {
  await loadBooking(ctx, bookingId);
  const [row] = await ctx.db.select().from(supplierLinks).where(eq(supplierLinks.bookingId, bookingId));
  if (!row) return null;
  return {
    id: row.id,
    language: row.language,
    state: row.revokedAt ? "revoked" : "active",
    lastViewedAt: row.lastViewedAt,
    createdAt: row.createdAt,
  };
}

const linkInput = z.object({ bookingId: idSchema, language: z.enum(["ro", "en"]).optional() });

/**
 * Creates the booking's supplier link, or replaces it: the old link stops working at once and
 * a revocation is lifted. The raw token is returned ONCE. Managers only.
 */
export async function createSupplierLink(
  ctx: Ctx,
  input: z.input<typeof linkInput>,
): Promise<{ linkId: string; token: string; path: string }> {
  requireWriteCapable(ctx);
  const data = linkInput.parse(input);
  const { booking, canManage } = await loadBooking(ctx, data.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const token = randomToken(SUPPLIER_TOKEN_BYTES);
  const tokenHash = hashToken(token);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(supplierLinks)
      .values({ bookingId: booking.id, occasionId: booking.occasionId, tokenHash, language: data.language ?? "ro" })
      .onConflictDoUpdate({
        target: supplierLinks.bookingId,
        set: { tokenHash, revokedAt: null, lastViewedAt: null, ...(data.language ? { language: data.language } : {}) },
      })
      .returning();
    await audit(tx, {
      action: "supplier_link.generated",
      objectType: "supplier_link",
      objectId: row!.id,
      meta: { occasionId: booking.occasionId, bookingId: booking.id },
    });
    return { linkId: row!.id, token, path: supplierLinkPath(token) };
  });
}

/** Revokes the link (it answers like an unknown link from now on). Idempotent. */
export async function revokeSupplierLink(ctx: Ctx, input: { bookingId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { booking, canManage } = await loadBooking(ctx, input.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await inTx(ctx, async (tx) => {
    const rows = await tx.db
      .update(supplierLinks)
      .set({ revokedAt: ctx.now })
      .where(and(eq(supplierLinks.bookingId, booking.id), isNull(supplierLinks.revokedAt)))
      .returning({ id: supplierLinks.id });
    if (rows[0]) {
      await audit(tx, {
        action: "supplier_link.revoked",
        objectType: "supplier_link",
        objectId: rows[0].id,
        meta: { occasionId: booking.occasionId, bookingId: booking.id },
      });
    }
  });
}

export type SupplierLink = {
  linkId: string;
  bookingId: string;
  occasionId: string;
  language: "ro" | "en";
  /** Stable, non-secret key of this link for rate limits (the token hash). */
  linkKey: string;
};

/**
 * Token from the URL → the ONE booking it opens, or null. Unknown, malformed and revoked
 * tokens, and links of cancelled-and-purged bookings, all return null (same answer, SEC2).
 * Throws RATE_LIMITED when an IP keeps guessing or a link is hammered.
 */
export async function resolveSupplierLink(
  ctx: Ctx,
  token: string,
  opts: { rateLimit?: boolean } = {},
): Promise<SupplierLink | null> {
  const limit = opts.rateLimit ?? true;
  const wellFormed = typeof token === "string" && TOKEN_RE.test(token);
  const tokenHash = wellFormed ? hashToken(token) : null;
  let row: SupplierLinkRow | undefined;
  if (tokenHash) {
    [row] = await ctx.db.select().from(supplierLinks).where(eq(supplierLinks.tokenHash, tokenHash));
  }
  const ok = !!row && !row.revokedAt;
  if (limit) {
    if (!ok) {
      await enforceRateLimit(ctx, {
        scope: "supplier.link.miss",
        rules: [{ axis: "ip", key: ctx.ip, limit: SUPPLIER_LINK_LIMITS.missesPerIpPerHour, windowSeconds: 3600 }],
      });
    } else {
      await enforceRateLimit(ctx, {
        scope: "supplier.link",
        rules: [
          { axis: "ip", key: ctx.ip, limit: SUPPLIER_LINK_LIMITS.perIpPerHour, windowSeconds: 3600 },
          { axis: "key", key: tokenHash, limit: SUPPLIER_LINK_LIMITS.perLinkPerHour, windowSeconds: 3600 },
        ],
      });
    }
  }
  if (!ok || !row || !tokenHash) return null;
  return { linkId: row.id, bookingId: row.bookingId, occasionId: row.occasionId, language: row.language, linkKey: tokenHash };
}

/** Notes that the supplier opened the link (shown to the planner as "last viewed"). */
export async function markSupplierLinkViewed(ctx: Ctx, link: Pick<SupplierLink, "linkId">): Promise<void> {
  await ctx.db.update(supplierLinks).set({ lastViewedAt: ctx.now }).where(eq(supplierLinks.id, link.linkId));
}

/** Account id of the acting planner, for "created by" columns. */
export function actingAccount(ctx: Ctx): string | null {
  return actorAccountId(ctx.actor);
}

/* ── Purge and export ────────────────────────────────────────────────────────────── */

// When an occasion is purged, everything this release holds for it goes with it. The immutable
// tables only let rows go inside a transaction that declared the purge (ed.purge).
onOccasionPurge(async (tx, occasionId) => {
  await tx.db.execute(sql`select set_config('ed.purge', 'on', true)`);
  await tx.db.execute(sql`delete from readiness_decisions where occasion_id = ${occasionId}`);
  await tx.db.execute(sql`delete from task_day_state where occasion_id = ${occasionId}`);
  await tx.db.execute(sql`delete from deliveries where occasion_id = ${occasionId}`);
  await tx.db.execute(sql`delete from order_deltas where occasion_id = ${occasionId}`);
  // bookings, events, links, briefing versions + acknowledgements, snapshots, deadlines cascade
  await tx.db.execute(sql`delete from suppliers where occasion_id = ${occasionId}`);
});

registerExport({
  key: "suppliers",
  titleKey: "suppliers.exports.suppliers.title",
  descriptionKey: "suppliers.exports.suppliers.description",
  manageOnly: true,
  run: async (ctx, occasionId) => {
    const list = await listSuppliers(ctx, occasionId);
    const header = ["name", "category", "contact", "email", "phone", "state", "briefing_version", "acknowledged_version"];
    // the agreed amount is finance data: the column exists only for finance-grant holders (D2)
    if (list.canSeeMoney) header.push("agreed_amount", "currency");
    const rows = list.items.map((s) => {
      const row: Array<string | number | null> = [
        s.name,
        s.categoryLabel,
        s.contactName,
        s.contactEmail,
        s.contactPhone,
        s.booking.state,
        s.briefing.latestVersion,
        s.briefing.acknowledgedVersion,
      ];
      if (list.canSeeMoney) {
        row.push(s.booking.agreedMinor == null ? "" : (s.booking.agreedMinor / 100).toFixed(2), s.booking.currency);
      }
      return row;
    });
    return { filename: "furnizori.csv", mime: "text/csv; charset=utf-8", content: toCsv(header, rows) };
  },
});
