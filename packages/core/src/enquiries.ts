import {
  accounts,
  and,
  asc,
  assets,
  bookingEvents,
  bookings,
  BUDGET_BANDS,
  businesses,
  categories,
  count,
  counties,
  desc,
  enquiries,
  enquiryMessages,
  enquiryStatEvents,
  ENQUIRY_KINDS,
  ENQUIRY_STATES,
  eq,
  gte,
  inArray,
  isNull,
  listingCategories,
  listings,
  localities,
  lte,
  occasions,
  OCCASION_KINDS,
  quoteLinks,
  sql,
  type BudgetBand,
  type DesignRef,
  type EnquiryKind,
  type EnquiryShared,
  type EnquirySide,
  type EnquiryState,
  type QuoteRequestShared,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob, enqueue } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { addDays, addHours, startOfZonedDay } from "@ed/shared/time";
import { getAsset, getAssetUrl, registerUploadPurpose, uploadAsset } from "@ed/storage";
import { z } from "zod";
import { getMember, isManager, requireMember } from "./access";
import { audit } from "./audit";
import { attachQuote, setBookingState, updateBookingTerms } from "./bookings";
import { getBusinessMember, requireBusinessMember } from "./business";
import { requireAccount, requireWriteCapable, type Ctx } from "./context";
import { localName } from "./geography";
import { assertOccasionWritable } from "./lifecycle";
import { setEnquiryStatsProvider, type EnquiryNumbers } from "./listingstats";
import { onOccasionPurge } from "./occasions";
import { submitContentReport } from "./reports";
import { recordEvent } from "./stats";
import { ensureBooking, findOrCreateSupplierForListing, PLANNING_ROLES, zMoneyText } from "./suppliers";
import { inTx } from "./tx";

// Enquiries and flower quote requests (P8–P12, P29, P32, P33, F5, F6, D3).
//
// A planner writes to a business from a listing. The thread lives in the plan: sending
// creates or reuses the supplier record and its booking (P10), and the booking id is kept on
// the enquiry so the supplier page shows the correspondence.
//
// D3 — WHAT THE BUSINESS SEES. The business-side reads (listBusinessEnquiries,
// getBusinessThread) are built from the `shared` snapshot and the messages only. They never
// select the occasion, the sender or any account: the business learns who the planner is
// only from what the planner chose to send. The email appears only when the box was ticked.
//
// P11 — LIMITS, counted on the rows themselves inside the sending transaction (advisory
// locks per occasion and per account): 10 threads per occasion, 30 per account per day.
// Quote requests count against both. A re-send (P33) is not a new thread and is not counted.
//
// P33 — STATES. sent: delivered, no reply yet (shown as "trimisă <data>"); answered: the
// latest message is the business's; awaiting: the planner wrote after an answer; closed:
// either side ended it. After 7 days without any answer the planner may re-send ONCE; the
// thread, the booking and the limits are untouched.
//
// P32 — the business is told on arrival (job, email in the listing's language) and once more
// after 48 hours if nothing was answered; `businesses.nudge48h` turns off the reminder only.

export { BUDGET_BANDS, ENQUIRY_KINDS, ENQUIRY_STATES };
export type { BudgetBand, DesignRef, EnquiryKind, EnquiryShared, EnquirySide, EnquiryState, QuoteRequestShared };
export type Enquiry = typeof enquiries.$inferSelect;
export type EnquiryMessage = typeof enquiryMessages.$inferSelect;
export type QuoteLinkRow = typeof quoteLinks.$inferSelect;

export const MAX_ENQUIRIES_PER_OCCASION = 10;
export const MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY = 30;
export const RESEND_AFTER_DAYS = 7;
export const NUDGE_AFTER_HOURS = 48;
export const MAX_MESSAGES_PER_THREAD = 200;

/** Planner upload for a quote request: a photo or sketch of the arrangement (F4). Images only. */
export const ENQUIRY_ATTACHMENT_PURPOSE = "enquiry.attachment";
/** Florist / styling categories whose listings take flower quote requests and publish catalogues. */
export const FLORAL_CATEGORY_SLUGS = ["floristi", "decoratiuni-si-styling"] as const;

export const ARRIVAL_JOB = "enquiries.notify-arrival";
export const NUDGE_JOB = "enquiries.nudge-48h";

const idSchema = z.string().min(1).max(64);
const zDay = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "enquiries.errors.date")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)), "enquiries.errors.date")
    .nullable()
    .optional(),
);
const zGuests = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.trim()) : v),
  z.number("enquiries.errors.guests").int("enquiries.errors.guests").min(1, "enquiries.errors.guests").max(20000, "enquiries.errors.guests").nullable(),
);
const zBlank = <T extends z.ZodType>(inner: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), inner.nullable().optional());
const zBool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());
const zKey = z.string().min(8).max(100);

const enquiryInput = z.strictObject({
  occasionId: idSchema,
  listingId: idSchema,
  occasionKind: z.enum(OCCASION_KINDS, "common.validation.required"),
  date: zDay,
  guests: zGuests,
  countyCode: zBlank(z.string().max(4)),
  localityId: zBlank(z.string().max(64)),
  budgetBand: zBlank(z.enum(BUDGET_BANDS, "common.validation.invalid")),
  message: z.string().trim().min(1, "enquiries.errors.messageRequired").max(4000, "common.validation.tooLong"),
  shareEmail: zBool.optional(),
  idempotencyKey: zKey,
});
export type SendEnquiryInput = z.input<typeof enquiryInput>;

const designRefSchema = z.strictObject({ designId: z.string().min(1).max(64), version: z.number().int().min(1).max(100000) });

const quoteRequestInput = z.strictObject({
  occasionId: idSchema,
  listingId: idSchema,
  arrangement: z.strictObject({
    description: z.string().trim().min(1, "enquiries.errors.arrangementRequired").max(4000, "common.validation.tooLong"),
    /** F4: an uploaded photo or sketch (purpose "enquiry.attachment", owned by the occasion). */
    imageAssetId: zBlank(z.string().max(64)),
    /** F3/F5 (release C designer): opaque `{ designId, version }`. */
    designRef: designRefSchema.nullable().optional(),
  }),
  date: zDay,
  guests: zGuests,
  message: z.preprocess((v) => (v === undefined || v === null ? "" : v), z.string().trim().max(4000, "common.validation.tooLong")),
  shareEmail: zBool.optional(),
  idempotencyKey: zKey,
});
export type SendQuoteRequestInput = z.input<typeof quoteRequestInput>;

const asSystem = (ctx: Ctx): Ctx => ({ ...ctx, actor: { kind: "system" } });
const fieldError = (field: string, key: string) => new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { [field]: [key] } });

/* ── Sending ───────────────────────────────────────────────────────────── */

type Target = { listing: typeof listings.$inferSelect; businessId: string; categoryLabel: string | null; floral: boolean };

/** The listing an enquiry goes to: live, claimed, its business not suspended (P29). */
async function loadTarget(ctx: Ctx, listingId: string): Promise<Target> {
  const [row] = await ctx.db
    .select({ listing: listings, businessStatus: businesses.status })
    .from(listings)
    .leftJoin(businesses, eq(businesses.id, listings.businessId))
    .where(eq(listings.id, listingId));
  if (!row || row.listing.status !== "live") throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  // P29: an unclaimed listing accepts no enquiries and no quote requests
  if (!row.listing.claimed || !row.listing.businessId) throw new AppError("FORBIDDEN", "enquiries.errors.unclaimed");
  if (row.businessStatus === "suspended") throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const cats = await ctx.db
    .select({ slug: categories.slug, nameRo: categories.nameRo, nameEn: categories.nameEn })
    .from(listingCategories)
    .innerJoin(categories, eq(categories.id, listingCategories.categoryId))
    .where(eq(listingCategories.listingId, listingId))
    .orderBy(asc(categories.sortOrder));
  return {
    listing: row.listing,
    businessId: row.listing.businessId,
    categoryLabel: cats[0] ? localName(cats[0], "ro").slice(0, 80) : null,
    floral: cats.some((c) => (FLORAL_CATEGORY_SLUGS as readonly string[]).includes(c.slug)),
  };
}

async function sharedEmailFor(ctx: Ctx, accountId: string, share: boolean): Promise<string | null> {
  if (!share) return null;
  const [a] = await ctx.db.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, accountId));
  if (!a?.email) throw fieldError("shareEmail", "enquiries.errors.noEmailToShare");
  return a.email;
}

async function createThread(
  ctx: Ctx,
  input: {
    kind: EnquiryKind;
    occasionId: string;
    target: Target;
    shared: EnquiryShared | QuoteRequestShared;
    message: string;
    shareEmail: boolean;
    idempotencyKey: string;
  },
): Promise<{ enquiryId: string; bookingId: string; supplierId: string; replayed: boolean }> {
  const accountId = requireAccount(ctx);
  const { target } = input;
  const email = await sharedEmailFor(ctx, accountId, input.shareEmail);
  return inTx(ctx, async (tx) => {
    // serialise per occasion and per account so the limits cannot be passed by two submits at once
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${"enquiry.occasion:" + input.occasionId}))`);
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${"enquiry.account:" + accountId}))`);

    const [again] = await tx.db
      .select()
      .from(enquiries)
      .where(and(eq(enquiries.occasionId, input.occasionId), eq(enquiries.idempotencyKey, input.idempotencyKey)));
    if (again) {
      const [b] = again.bookingId ? await tx.db.select().from(bookings).where(eq(bookings.id, again.bookingId)) : [];
      return { enquiryId: again.id, bookingId: again.bookingId ?? "", supplierId: b?.supplierId ?? "", replayed: true };
    }

    const [perOccasion] = await tx.db.select({ n: count() }).from(enquiries).where(eq(enquiries.occasionId, input.occasionId));
    if ((perOccasion?.n ?? 0) >= MAX_ENQUIRIES_PER_OCCASION) {
      throw new AppError("LIMIT", "enquiries.errors.occasionLimit", { params: { max: MAX_ENQUIRIES_PER_OCCASION } });
    }
    const [perDay] = await tx.db
      .select({ n: count() })
      .from(enquiries)
      .where(and(eq(enquiries.senderAccountId, accountId), gte(enquiries.sentAt, startOfZonedDay(tx.now))));
    if ((perDay?.n ?? 0) >= MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY) {
      throw new AppError("LIMIT", "enquiries.errors.dailyLimit", { params: { max: MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY } });
    }
    if (input.kind === "enquiry") {
      const [open] = await tx.db
        .select({ id: enquiries.id })
        .from(enquiries)
        .where(
          and(
            eq(enquiries.occasionId, input.occasionId),
            eq(enquiries.listingId, target.listing.id),
            eq(enquiries.kind, "enquiry"),
            sql`${enquiries.state} <> 'closed'`,
          ),
        );
      if (open) throw new AppError("CONFLICT", "enquiries.errors.alreadyOpen", { params: { enquiryId: open.id } });
    }

    // P10: the thread sits in the plan — one supplier record per listing, never a duplicate
    const supplier = await findOrCreateSupplierForListing(tx, {
      occasionId: input.occasionId,
      listingId: target.listing.id,
      name: target.listing.name.slice(0, 160),
      categoryLabel: target.categoryLabel,
    });
    const booking = await ensureBooking(tx, supplier.id);

    const [event] = await tx.db.insert(enquiryStatEvents).values({ listingId: target.listing.id, receivedAt: tx.now }).returning({ id: enquiryStatEvents.id });
    const [row] = await tx.db
      .insert(enquiries)
      .values({
        kind: input.kind,
        state: "sent",
        occasionId: input.occasionId,
        listingId: target.listing.id,
        businessId: target.businessId,
        bookingId: booking.id,
        senderAccountId: accountId,
        shared: input.shared,
        emailShared: email !== null,
        sharedEmail: email,
        idempotencyKey: input.idempotencyKey,
        sentAt: tx.now,
        lastMessageAt: tx.now,
        statEventId: event!.id,
        createdAt: tx.now,
      })
      .returning();
    if (input.message !== "") {
      await tx.db.insert(enquiryMessages).values({ enquiryId: row!.id, side: "planner", authorAccountId: accountId, body: input.message, createdAt: tx.now });
    }
    await enqueue(tx, ARRIVAL_JOB, { enquiryId: row!.id, resend: false }, { uniqueKey: `enquiry-arrival:${row!.id}` });
    await enqueue(tx, NUDGE_JOB, { enquiryId: row!.id }, { runAt: addHours(tx.now, NUDGE_AFTER_HOURS), uniqueKey: `enquiry-nudge:${row!.id}` });
    await audit(tx, {
      action: "enquiry.sent",
      objectType: "enquiry",
      objectId: row!.id,
      after: { kind: input.kind, listingId: target.listing.id, emailShared: email !== null },
      meta: { occasionId: input.occasionId },
    });
    await recordEvent(tx, "enquiries.sent", { kind: input.kind });
    return { enquiryId: row!.id, bookingId: booking.id, supplierId: supplier.id, replayed: false };
  });
}

async function validateArea(ctx: Ctx, countyCode: string | null, localityId: string | null): Promise<{ countyCode: string | null; localityId: string | null }> {
  let county = countyCode ? countyCode.toUpperCase() : null;
  if (localityId) {
    const [loc] = await ctx.db.select().from(localities).where(eq(localities.id, localityId));
    if (!loc) throw fieldError("localityId", "enquiries.errors.locality");
    if (county && loc.countyCode !== county) throw fieldError("localityId", "enquiries.errors.localityOutsideCounty");
    county = loc.countyCode;
  }
  if (county) {
    const [c] = await ctx.db.select({ code: counties.code }).from(counties).where(eq(counties.code, county));
    if (!c) throw fieldError("countyCode", "enquiries.errors.county");
  }
  return { countyCode: county, localityId: localityId ?? null };
}

async function requireSender(ctx: Ctx, occasionId: string): Promise<void> {
  requireWriteCapable(ctx);
  requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await requireMember(ctx, occasionId, { manage: true });
  await assertOccasionWritable(ctx, occasionId);
}

/**
 * P8–P11: sends a free enquiry to a claimed, live listing. The planner must manage the
 * occasion. Shares exactly: occasion kind, date, approximate guests, county/locality,
 * optional budget band and the message — and the planner's email only when `shareEmail`.
 */
export async function sendEnquiry(ctx: Ctx, input: SendEnquiryInput): Promise<{ enquiryId: string; bookingId: string; supplierId: string }> {
  const data = enquiryInput.parse(input);
  await requireSender(ctx, data.occasionId);
  const target = await loadTarget(ctx, data.listingId);
  const area = await validateArea(ctx, data.countyCode ?? null, data.localityId ?? null);
  const shared: EnquiryShared = {
    occasionKind: data.occasionKind,
    date: data.date ?? null,
    guests: data.guests,
    countyCode: area.countyCode,
    localityId: area.localityId,
    budgetBand: data.budgetBand ?? null,
  };
  return createThread(ctx, {
    kind: "enquiry",
    occasionId: data.occasionId,
    target,
    shared,
    message: data.message,
    shareEmail: data.shareEmail === true,
    idempotencyKey: data.idempotencyKey,
  });
}

/**
 * F5: a flower quote request, through the same flow. Carries ONLY the arrangement
 * (description + optional photo/sketch or a design reference), the occasion date, the
 * approximate guest count and a message; the email only when ticked. Counts against both
 * P11 limits. The listing must be in a florist or styling category.
 *
 * FOR THE ARRANGEMENT DESIGNER (release C): pass `arrangement.designRef = { designId, version }`;
 * it is stored as given and comes back from getQuoteLink once a quote is accepted.
 */
export async function sendQuoteRequest(ctx: Ctx, input: SendQuoteRequestInput): Promise<{ enquiryId: string; bookingId: string; supplierId: string }> {
  const data = quoteRequestInput.parse(input);
  await requireSender(ctx, data.occasionId);
  const target = await loadTarget(ctx, data.listingId);
  if (!target.floral) throw new AppError("VALIDATION", "enquiries.errors.notFloral");
  const imageAssetId = data.arrangement.imageAssetId ?? null;
  if (imageAssetId) {
    const [asset] = await ctx.db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, imageAssetId),
          eq(assets.ownerType, "occasion"),
          eq(assets.ownerId, data.occasionId),
          eq(assets.kind, "image"),
          eq(assets.scanState, "clean"),
          isNull(assets.deletedAt),
        ),
      );
    if (!asset) throw fieldError("imageAssetId", "enquiries.errors.imageNotYours");
  }
  const shared = buildQuoteRequestPayload({
    description: data.arrangement.description,
    imageAssetId,
    designRef: data.arrangement.designRef ?? null,
    date: data.date ?? null,
    guests: data.guests,
  });
  return createThread(ctx, {
    kind: "quote_request",
    occasionId: data.occasionId,
    target,
    shared,
    message: data.message,
    shareEmail: data.shareEmail === true,
    idempotencyKey: data.idempotencyKey,
  });
}

/** The F5 payload, in one place: exactly `arrangement`, `date`, `guests` (the message travels as the first message). */
export function buildQuoteRequestPayload(input: {
  description: string;
  imageAssetId: string | null;
  designRef: DesignRef | null;
  date: string | null;
  guests: number | null;
}): QuoteRequestShared {
  return {
    arrangement: { description: input.description, imageAssetId: input.imageAssetId, designRef: input.designRef },
    date: input.date,
    guests: input.guests,
  };
}

/* ── Prefill (P8: editable, pre-filled) ────────────────────────────────── */

export type EnquiryPrefill = {
  occasionId: string;
  occasionTitle: string;
  occasionKind: string;
  date: string | null;
  guests: number | null;
  /** Threads this occasion may still open, and this account today (P11). */
  leftForOccasion: number;
  leftToday: number;
  /** An open plain enquiry to this listing already exists (it would be refused). */
  openEnquiryId: string | null;
  hasEmail: boolean;
};

/** What the form starts from. Managers of the occasion only. Every field stays editable. */
export async function getEnquiryPrefill(ctx: Ctx, input: { occasionId: string; listingId?: string | null }): Promise<EnquiryPrefill> {
  const accountId = requireAccount(ctx);
  await requireMember(ctx, input.occasionId, { manage: true });
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, input.occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const g = (
    await ctx.db.execute<{ n: string | null }>(sql`select sum(h.expected_party_size)::text as n from households h where h.occasion_id = ${o.id}`)
  ).rows[0];
  const guests = g?.n ? Number(g.n) : null;
  const [perOccasion] = await ctx.db.select({ n: count() }).from(enquiries).where(eq(enquiries.occasionId, o.id));
  const [perDay] = await ctx.db
    .select({ n: count() })
    .from(enquiries)
    .where(and(eq(enquiries.senderAccountId, accountId), gte(enquiries.sentAt, startOfZonedDay(ctx.now))));
  const [open] = input.listingId
    ? await ctx.db
        .select({ id: enquiries.id })
        .from(enquiries)
        .where(and(eq(enquiries.occasionId, o.id), eq(enquiries.listingId, input.listingId), eq(enquiries.kind, "enquiry"), sql`${enquiries.state} <> 'closed'`))
    : [];
  const [a] = await ctx.db.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, accountId));
  return {
    occasionId: o.id,
    occasionTitle: o.title,
    occasionKind: o.kind,
    date: o.startsAt ? new Intl.DateTimeFormat("en-CA", { timeZone: o.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(o.startsAt) : null,
    guests: guests && guests > 0 ? guests : null,
    leftForOccasion: Math.max(0, MAX_ENQUIRIES_PER_OCCASION - (perOccasion?.n ?? 0)),
    leftToday: Math.max(0, MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY - (perDay?.n ?? 0)),
    openEnquiryId: open?.id ?? null,
    hasEmail: !!a?.email,
  };
}

/** Occasions the account manages and can still write to — for choosing one on the enquiry form. */
export async function listEnquiryOccasions(ctx: Ctx): Promise<Array<{ id: string; title: string }>> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") return [];
  const rows = await ctx.db.execute<{ id: string; title: string }>(sql`
    select o.id, o.title from occasions o
    join occasion_members m on m.occasion_id = o.id
    where m.account_id = ${accountId} and m.removed_at is null and m.role in ('owner', 'pm') and o.status <> 'closed'
    order by o.starts_at asc nulls last, o.created_at desc
    limit 50`);
  return rows.rows;
}

/** True when the listing is in a florist/styling category (it takes quote requests, F5). */
export async function listingTakesQuoteRequests(ctx: Pick<Ctx, "db">, listingId: string): Promise<boolean> {
  const rows = await ctx.db
    .select({ slug: categories.slug })
    .from(listingCategories)
    .innerJoin(categories, eq(categories.id, listingCategories.categoryId))
    .where(eq(listingCategories.listingId, listingId));
  return rows.some((c) => (FLORAL_CATEGORY_SLUGS as readonly string[]).includes(c.slug));
}

/* ── Views ─────────────────────────────────────────────────────────────── */

export type ThreadMessage = {
  id: string;
  side: EnquirySide;
  body: string;
  at: Date;
  /** P12: a PDF the business marked as its quote. */
  quote: { assetId: string; name: string; url: string } | null;
};

/** The shared fields with their names resolved, as both sides read them. */
export type SharedView =
  | {
      kind: "enquiry";
      occasionKind: string;
      date: string | null;
      guests: number | null;
      county: string | null;
      locality: string | null;
      budgetBand: BudgetBand | null;
    }
  | {
      kind: "quote_request";
      description: string;
      imageUrl: string | null;
      designRef: DesignRef | null;
      date: string | null;
      guests: number | null;
    };

async function sharedView(ctx: Ctx, row: Pick<Enquiry, "kind" | "shared">): Promise<SharedView> {
  if (row.kind === "quote_request") {
    const s = row.shared as QuoteRequestShared;
    let imageUrl: string | null = null;
    if (s.arrangement.imageAssetId) {
      // access was decided by the caller (thread access); the file link is made as the system
      imageUrl = await getAssetUrl(asSystem(ctx), s.arrangement.imageAssetId, { ttlSeconds: 3600 }).catch(() => null);
    }
    return { kind: "quote_request", description: s.arrangement.description, imageUrl, designRef: s.arrangement.designRef, date: s.date, guests: s.guests };
  }
  const s = row.shared as EnquiryShared;
  const [county] = s.countyCode ? await ctx.db.select().from(counties).where(eq(counties.code, s.countyCode)) : [];
  const [locality] = s.localityId ? await ctx.db.select().from(localities).where(eq(localities.id, s.localityId)) : [];
  return {
    kind: "enquiry",
    occasionKind: s.occasionKind,
    date: s.date,
    guests: s.guests,
    county: county ? localName(county, ctx.locale) : null,
    locality: locality ? localName(locality, ctx.locale) : null,
    budgetBand: s.budgetBand,
  };
}

async function loadMessages(ctx: Ctx, enquiryId: string): Promise<ThreadMessage[]> {
  const rows = await ctx.db
    .select({ id: enquiryMessages.id, side: enquiryMessages.side, body: enquiryMessages.body, at: enquiryMessages.createdAt, quoteAssetId: enquiryMessages.quoteAssetId })
    .from(enquiryMessages)
    .where(eq(enquiryMessages.enquiryId, enquiryId))
    .orderBy(asc(enquiryMessages.createdAt), asc(enquiryMessages.id));
  const out: ThreadMessage[] = [];
  for (const m of rows) {
    let quote: ThreadMessage["quote"] = null;
    if (m.quoteAssetId) {
      try {
        const asset = await getAsset(asSystem(ctx), m.quoteAssetId);
        quote = { assetId: asset.id, name: asset.name, url: await getAssetUrl(asSystem(ctx), asset.id) };
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // a removed file simply does not show
      }
    }
    out.push({ id: m.id, side: m.side, body: m.body, at: m.at, quote });
  }
  return out;
}

export type PlannerThreadSummary = {
  id: string;
  kind: EnquiryKind;
  state: EnquiryState;
  listingId: string;
  listingName: string;
  supplierId: string | null;
  bookingId: string | null;
  sentAt: Date;
  resentAt: Date | null;
  firstAnsweredAt: Date | null;
  lastMessageAt: Date;
  closedBy: EnquirySide | null;
};

export type PlannerThread = PlannerThreadSummary & {
  occasionId: string;
  shared: SharedView;
  emailShared: boolean;
  sharedEmail: string | null;
  messages: ThreadMessage[];
  reportedAt: Date | null;
  /** Owner / project manager: may reply, close, re-send, accept a quote. */
  canManage: boolean;
  /** P33: the one re-send is available now. */
  canResend: boolean;
  /** When the re-send becomes available (null once used or once answered). */
  resendFrom: Date | null;
  /** F6: the accepted quote and what changed against the previous acceptance. */
  quoteLink: QuoteLinkView | null;
  /** May the viewer see amounts (finance grant, D2)? */
  canSeeMoney: boolean;
};

function summaryOf(row: Enquiry, listingName: string, supplierId: string | null): PlannerThreadSummary {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    listingId: row.listingId,
    listingName,
    supplierId,
    bookingId: row.bookingId,
    sentAt: row.sentAt,
    resentAt: row.resentAt,
    firstAnsweredAt: row.firstAnsweredAt,
    lastMessageAt: row.lastMessageAt,
    closedBy: row.closedBy,
  };
}

function resendState(ctx: Ctx, row: Enquiry): { canResend: boolean; resendFrom: Date | null } {
  if (row.state !== "sent" || row.resentAt || row.firstAnsweredAt) return { canResend: false, resendFrom: null };
  const from = addDays(row.sentAt, RESEND_AFTER_DAYS);
  return { canResend: ctx.now.getTime() >= from.getTime(), resendFrom: from };
}

/** Threads of an occasion, newest first. Planning members. */
export async function listOccasionEnquiries(ctx: Ctx, occasionId: string): Promise<PlannerThreadSummary[]> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const rows = await ctx.db
    .select({ e: enquiries, listingName: listings.name, supplierId: bookings.supplierId })
    .from(enquiries)
    .innerJoin(listings, eq(listings.id, enquiries.listingId))
    .leftJoin(bookings, eq(bookings.id, enquiries.bookingId))
    .where(eq(enquiries.occasionId, occasionId))
    .orderBy(desc(enquiries.lastMessageAt));
  return rows.map((r) => summaryOf(r.e, r.listingName, r.supplierId));
}

async function plannerThread(ctx: Ctx, row: Enquiry): Promise<PlannerThread> {
  const member = await requireMember(ctx, row.occasionId, { roles: PLANNING_ROLES });
  const [l] = await ctx.db.select({ name: listings.name }).from(listings).where(eq(listings.id, row.listingId));
  const [b] = row.bookingId ? await ctx.db.select({ supplierId: bookings.supplierId }).from(bookings).where(eq(bookings.id, row.bookingId)) : [];
  const canManage = isManager(member);
  return {
    ...summaryOf(row, l?.name ?? "", b?.supplierId ?? null),
    occasionId: row.occasionId,
    shared: await sharedView(ctx, row),
    emailShared: row.emailShared,
    sharedEmail: row.sharedEmail,
    messages: await loadMessages(ctx, row.id),
    reportedAt: row.reportedAt,
    canManage,
    ...resendState(ctx, row),
    quoteLink: await quoteLinkFor(ctx, row.id, member.grants.finance),
    canSeeMoney: member.grants.finance,
  };
}

async function loadEnquiry(ctx: Ctx, enquiryId: string): Promise<Enquiry> {
  const id = idSchema.safeParse(enquiryId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db.select().from(enquiries).where(eq(enquiries.id, id.data));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** One thread as the planner reads it. NOT_FOUND for anyone outside the occasion's planning team. */
export async function getPlannerThread(ctx: Ctx, enquiryId: string): Promise<PlannerThread> {
  return plannerThread(ctx, await loadEnquiry(ctx, enquiryId));
}

/** P10: the threads sitting in a supplier record (by its booking), oldest first. */
export async function listThreadsForBooking(ctx: Ctx, bookingId: string): Promise<PlannerThread[]> {
  const [b] = await ctx.db.select({ occasionId: bookings.occasionId }).from(bookings).where(eq(bookings.id, bookingId));
  if (!b) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, b.occasionId, { roles: PLANNING_ROLES });
  const rows = await ctx.db.select().from(enquiries).where(eq(enquiries.bookingId, bookingId)).orderBy(asc(enquiries.sentAt));
  const out: PlannerThread[] = [];
  for (const row of rows) out.push(await plannerThread(ctx, row));
  return out;
}

export type BusinessThreadSummary = {
  id: string;
  kind: EnquiryKind;
  state: EnquiryState;
  listingId: string;
  listingName: string;
  sentAt: Date;
  resentAt: Date | null;
  lastMessageAt: Date;
  /** Minutes the planner has been waiting for a reply; null when nothing is waiting. */
  waitingMinutes: number | null;
  closedBy: EnquirySide | null;
};

/** D3: built from the snapshot and the messages only — no occasion, no account, no name. */
export type BusinessThread = BusinessThreadSummary & {
  shared: SharedView;
  /** P9: present only when the planner ticked the box. */
  sharedEmail: string | null;
  messages: ThreadMessage[];
  reportedAt: Date | null;
  canReply: boolean;
};

// The ONLY columns the business side may read from an enquiry (D3). occasion_id, booking_id
// and sender_account_id are deliberately absent.
const businessColumns = {
  id: enquiries.id,
  kind: enquiries.kind,
  state: enquiries.state,
  listingId: enquiries.listingId,
  businessId: enquiries.businessId,
  shared: enquiries.shared,
  emailShared: enquiries.emailShared,
  sharedEmail: enquiries.sharedEmail,
  sentAt: enquiries.sentAt,
  resentAt: enquiries.resentAt,
  firstAnsweredAt: enquiries.firstAnsweredAt,
  lastMessageAt: enquiries.lastMessageAt,
  closedBy: enquiries.closedBy,
  reportedAt: enquiries.reportedAt,
};
type BusinessRow = {
  id: string;
  kind: EnquiryKind;
  state: EnquiryState;
  listingId: string;
  businessId: string;
  shared: EnquiryShared | QuoteRequestShared;
  emailShared: boolean;
  sharedEmail: string | null;
  sentAt: Date;
  resentAt: Date | null;
  firstAnsweredAt: Date | null;
  lastMessageAt: Date;
  closedBy: EnquirySide | null;
  reportedAt: Date | null;
};

function businessSummary(ctx: Ctx, row: BusinessRow, listingName: string): BusinessThreadSummary {
  const waitingSince = row.state === "sent" ? row.sentAt : row.state === "awaiting" ? row.lastMessageAt : null;
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    listingId: row.listingId,
    listingName,
    sentAt: row.sentAt,
    resentAt: row.resentAt,
    lastMessageAt: row.lastMessageAt,
    waitingMinutes: waitingSince ? Math.max(0, Math.floor((ctx.now.getTime() - waitingSince.getTime()) / 60_000)) : null,
    closedBy: row.closedBy,
  };
}

/** The business's inbox: waiting threads first (longest wait first), then the rest by latest message. */
export async function listBusinessEnquiries(
  ctx: Ctx,
  businessId: string,
  filter: { state?: "open" | "closed" | "all" } = {},
): Promise<BusinessThreadSummary[]> {
  await requireBusinessMember(ctx, businessId);
  const state = filter.state ?? "open";
  const rows = await ctx.db
    .select({ ...businessColumns, listingName: listings.name })
    .from(enquiries)
    .innerJoin(listings, eq(listings.id, enquiries.listingId))
    .where(
      and(
        eq(enquiries.businessId, businessId),
        state === "open" ? sql`${enquiries.state} <> 'closed'` : state === "closed" ? eq(enquiries.state, "closed") : undefined,
      ),
    )
    .orderBy(desc(enquiries.lastMessageAt))
    .limit(300);
  const items = rows.map((r) => businessSummary(ctx, r, r.listingName));
  return items.sort((a, b) => (b.waitingMinutes ?? -1) - (a.waitingMinutes ?? -1) || b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
}

async function loadBusinessRow(ctx: Ctx, enquiryId: string): Promise<BusinessRow & { listingName: string }> {
  const id = idSchema.safeParse(enquiryId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db
    .select({ ...businessColumns, listingName: listings.name })
    .from(enquiries)
    .innerJoin(listings, eq(listings.id, enquiries.listingId))
    .where(eq(enquiries.id, id.data));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireBusinessMember(ctx, row.businessId);
  return row;
}

/** One thread as the business reads it (any active member). Contains only what the planner shared. */
export async function getBusinessThread(ctx: Ctx, enquiryId: string): Promise<BusinessThread> {
  const row = await loadBusinessRow(ctx, enquiryId);
  return {
    ...businessSummary(ctx, row, row.listingName),
    shared: await sharedView(ctx, row),
    sharedEmail: row.emailShared ? row.sharedEmail : null,
    messages: await loadMessages(ctx, row.id),
    reportedAt: row.reportedAt,
    canReply: row.state !== "closed",
  };
}

/** Open threads waiting for this business, for its navigation. */
export async function countWaitingEnquiries(ctx: Ctx, businessId: string): Promise<number> {
  await requireBusinessMember(ctx, businessId);
  const [n] = await ctx.db
    .select({ n: count() })
    .from(enquiries)
    .where(and(eq(enquiries.businessId, businessId), inArray(enquiries.state, ["sent", "awaiting"])));
  return n?.n ?? 0;
}

/* ── Writing in a thread ───────────────────────────────────────────────── */

const zBody = z.string().trim().min(1, "enquiries.errors.messageRequired").max(4000, "common.validation.tooLong");

async function assertRoom(tx: Ctx, enquiryId: string): Promise<void> {
  const [n] = await tx.db.select({ n: count() }).from(enquiryMessages).where(eq(enquiryMessages.enquiryId, enquiryId));
  if ((n?.n ?? 0) >= MAX_MESSAGES_PER_THREAD) throw new AppError("LIMIT", "enquiries.errors.threadFull", { params: { max: MAX_MESSAGES_PER_THREAD } });
}

/** The planner writes in the thread (owner / project manager). An answered thread becomes "awaiting". */
export async function replyAsPlanner(ctx: Ctx, input: { enquiryId: string; body: string }): Promise<{ messageId: string }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const data = z.object({ enquiryId: idSchema, body: zBody }).parse(input);
  const row = await loadEnquiry(ctx, data.enquiryId);
  await requireMember(ctx, row.occasionId, { manage: true });
  return inTx(ctx, async (tx) => {
    const [fresh] = await tx.db.select().from(enquiries).where(eq(enquiries.id, row.id)).for("update");
    if (!fresh || fresh.state === "closed") throw new AppError("CONFLICT", "enquiries.errors.closed");
    await assertRoom(tx, row.id);
    const [m] = await tx.db
      .insert(enquiryMessages)
      .values({ enquiryId: row.id, side: "planner", authorAccountId: accountId, body: data.body, createdAt: tx.now })
      .returning({ id: enquiryMessages.id });
    await tx.db
      .update(enquiries)
      .set({ lastMessageAt: tx.now, state: fresh.state === "answered" ? "awaiting" : fresh.state })
      .where(eq(enquiries.id, row.id));
    return { messageId: m!.id };
  });
}

const replyInput = z.object({
  enquiryId: idSchema,
  body: z.preprocess((v) => (v === undefined || v === null ? "" : v), z.string().trim().max(4000, "common.validation.tooLong")),
  /** P12: a PDF marked as the quote. */
  quoteFile: z.object({ name: z.string().max(500), bytes: z.instanceof(Buffer), mime: z.string().max(200).optional() }).nullable().optional(),
});

/**
 * The business answers (any active member): text, and optionally a PDF marked as its quote
 * (P12). The PDF goes through the storage pipeline and is kept with the occasion's files, so
 * it is deleted with the occasion (INF6); the booking moves from "enquired" to "quoted".
 * The first answer is what the response statistics measure (P31).
 */
export async function replyAsBusiness(
  ctx: Ctx,
  input: z.input<typeof replyInput>,
): Promise<{ messageId: string; quoteAssetId: string | null }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const data = replyInput.parse(input);
  if (data.body === "" && !data.quoteFile) throw fieldError("body", "enquiries.errors.messageRequired");
  const [row] = await ctx.db.select().from(enquiries).where(eq(enquiries.id, data.enquiryId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const { business } = await requireBusinessMember(ctx, row.businessId);
  if (business.status === "suspended") throw new AppError("FORBIDDEN", "business.errors.suspended");
  if (row.state === "closed") throw new AppError("CONFLICT", "enquiries.errors.closed");

  let quoteAssetId: string | null = null;
  if (data.quoteFile) {
    if (!data.quoteFile.bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw fieldError("quoteFile", "enquiries.errors.quotePdf");
    // Access was decided above (member of the business the thread belongs to); the file is
    // stored for the occasion, which the business is not a member of — hence the system actor.
    const asset = await uploadAsset(asSystem(ctx), { ownerType: "occasion", ownerId: row.occasionId, file: data.quoteFile, allowPdf: true }).catch((e: unknown) => {
      // storage reports problems on its own field name ("file"); the form's field is "quoteFile"
      if (e instanceof AppError) throw new AppError(e.code, e.code === "LIMIT" ? "enquiries.errors.quoteNoRoom" : e.messageKey, { ...e.details, fieldErrors: { quoteFile: [e.code === "LIMIT" ? "enquiries.errors.quoteNoRoom" : (e.messageKey ?? "enquiries.errors.quotePdf")] } });
      throw e;
    });
    if (asset.kind !== "pdf") throw fieldError("quoteFile", "enquiries.errors.quotePdf");
    quoteAssetId = asset.id;
  }

  return inTx(ctx, async (tx) => {
    const [fresh] = await tx.db.select().from(enquiries).where(eq(enquiries.id, row.id)).for("update");
    if (!fresh || fresh.state === "closed") throw new AppError("CONFLICT", "enquiries.errors.closed");
    await assertRoom(tx, row.id);
    const [m] = await tx.db
      .insert(enquiryMessages)
      .values({ enquiryId: row.id, side: "business", authorAccountId: accountId, body: data.body, quoteAssetId, createdAt: tx.now })
      .returning({ id: enquiryMessages.id });
    const first = fresh.firstAnsweredAt === null;
    await tx.db
      .update(enquiries)
      .set({ state: "answered", lastMessageAt: tx.now, ...(first ? { firstAnsweredAt: tx.now } : {}) })
      .where(eq(enquiries.id, row.id));
    if (first && fresh.statEventId) {
      await tx.db
        .update(enquiryStatEvents)
        .set({ answeredAt: tx.now, replyMinutes: Math.max(0, Math.round((tx.now.getTime() - fresh.sentAt.getTime()) / 60_000)) })
        .where(and(eq(enquiryStatEvents.id, fresh.statEventId), isNull(enquiryStatEvents.answeredAt)));
      await recordEvent(tx, "enquiries.answered", { kind: fresh.kind });
    }
    if (quoteAssetId && fresh.bookingId) await markBookingQuoted(tx, fresh.bookingId, quoteAssetId);
    await audit(tx, {
      action: quoteAssetId ? "enquiry.quote_sent" : "enquiry.answered",
      objectType: "enquiry",
      objectId: row.id,
      meta: { businessId: row.businessId, first },
    });
    return { messageId: m!.id, quoteAssetId };
  });
}

/**
 * P12: the business's PDF marks the booking as quoted. Same effect as bookings.attachQuote —
 * which only a manager of the occasion can call — recorded as a system transition so that no
 * business member's identity enters the planner's booking history.
 */
async function markBookingQuoted(tx: Ctx, bookingId: string, assetId: string): Promise<void> {
  const [b] = await tx.db.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
  if (!b) return;
  const next = b.state === "enquired" ? "quoted" : b.state;
  await tx.db.update(bookings).set({ quoteAssetId: assetId, state: next }).where(eq(bookings.id, b.id));
  if (next !== b.state) {
    await tx.db.insert(bookingEvents).values({ bookingId: b.id, occasionId: b.occasionId, fromState: b.state, toState: next, actorKind: "system", actorId: null, at: tx.now });
  }
  await audit(asSystem(tx), {
    action: "booking.quote_attached",
    objectType: "booking",
    objectId: b.id,
    after: { quoteAssetId: assetId, state: next },
    meta: { occasionId: b.occasionId, source: "enquiry" },
  });
}

/** Which side of the thread the actor is on; NOT_FOUND when on neither. */
async function sideOf(ctx: Ctx, row: Enquiry): Promise<EnquirySide> {
  const member = await getMember(ctx, row.occasionId);
  if (member && isManager(member)) return "planner";
  if (await getBusinessMember(ctx, row.businessId)) return "business";
  throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
}

/** P11: either side closes the thread. Idempotent. Nothing is deleted. */
export async function closeEnquiry(ctx: Ctx, input: { enquiryId: string }): Promise<{ closedBy: EnquirySide }> {
  requireWriteCapable(ctx);
  const row = await loadEnquiry(ctx, input.enquiryId);
  const side = await sideOf(ctx, row);
  if (row.state === "closed") return { closedBy: row.closedBy ?? side };
  await inTx(ctx, async (tx) => {
    const updated = await tx.db
      .update(enquiries)
      .set({ state: "closed", closedAt: tx.now, closedBy: side })
      .where(and(eq(enquiries.id, row.id), sql`${enquiries.state} <> 'closed'`))
      .returning({ id: enquiries.id });
    if (!updated[0]) return;
    await audit(tx, { action: "enquiry.closed", objectType: "enquiry", objectId: row.id, after: { closedBy: side }, meta: side === "planner" ? { occasionId: row.occasionId } : { businessId: row.businessId } });
    await recordEvent(tx, "enquiries.closed", { side });
  });
  return { closedBy: side };
}

const reportInput = z.object({
  enquiryId: idSchema,
  reasonCategory: z.enum(["illegal_content", "fraud", "intellectual_property", "privacy", "false_information", "offensive", "other"], "common.validation.required"),
  description: z.string().trim().min(10, "report.errors.descriptionTooShort").max(4000, "common.validation.tooLong"),
});

/**
 * P11: either side reports the thread. It becomes a content report in the moderators' queue
 * (LAU8): a planner's report targets the listing, a business's report targets the thread.
 * The thread is flagged and stays readable; closing it is a separate choice.
 */
export async function reportEnquiry(ctx: Ctx, input: z.input<typeof reportInput>): Promise<{ reference: string }> {
  requireWriteCapable(ctx);
  const data = reportInput.parse(input);
  const row = await loadEnquiry(ctx, data.enquiryId);
  const side = await sideOf(ctx, row);
  const [l] = await ctx.db.select({ name: listings.name }).from(listings).where(eq(listings.id, row.listingId));
  const { reference } = await submitContentReport(ctx, {
    targetRef: side === "planner" ? `${l?.name ?? "listing"} (enquiry thread)` : `enquiry thread ${row.id}`,
    targetType: side === "planner" ? "listing" : "enquiry",
    targetId: side === "planner" ? row.listingId : row.id,
    reasonCategory: data.reasonCategory,
    description: data.description,
    honeypot: null,
    // a signed-in member, not an anonymous form: the time-to-submit floor does not apply
    renderedAt: new Date(ctx.now.getTime() - 60_000),
  });
  await ctx.db.update(enquiries).set({ reportedAt: ctx.now, reportedBy: side }).where(eq(enquiries.id, row.id));
  await audit(ctx, { action: "enquiry.reported", objectType: "enquiry", objectId: row.id, after: { reportedBy: side, reference } });
  return { reference };
}

/**
 * P33: after 7 days without any answer the planner may re-send ONCE. The same thread — no
 * new supplier record, no new booking, nothing counted against the limits. The business is
 * notified again.
 */
export async function resendEnquiry(ctx: Ctx, input: { enquiryId: string }): Promise<{ resentAt: Date }> {
  requireWriteCapable(ctx);
  const row = await loadEnquiry(ctx, input.enquiryId);
  await requireMember(ctx, row.occasionId, { manage: true });
  await assertOccasionWritable(ctx, row.occasionId);
  return inTx(ctx, async (tx) => {
    const [fresh] = await tx.db.select().from(enquiries).where(eq(enquiries.id, row.id)).for("update");
    if (!fresh) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (fresh.state === "closed") throw new AppError("CONFLICT", "enquiries.errors.closed");
    if (fresh.firstAnsweredAt || fresh.state !== "sent") throw new AppError("CONFLICT", "enquiries.errors.resendAnswered");
    if (fresh.resentAt) throw new AppError("CONFLICT", "enquiries.errors.resendOnce");
    if (tx.now.getTime() < addDays(fresh.sentAt, RESEND_AFTER_DAYS).getTime()) {
      throw new AppError("CONFLICT", "enquiries.errors.resendTooEarly", { params: { days: RESEND_AFTER_DAYS } });
    }
    await tx.db.update(enquiries).set({ resentAt: tx.now, lastMessageAt: tx.now }).where(eq(enquiries.id, row.id));
    await enqueue(tx, ARRIVAL_JOB, { enquiryId: row.id, resend: true }, { uniqueKey: `enquiry-resend:${row.id}` });
    await audit(tx, { action: "enquiry.resent", objectType: "enquiry", objectId: row.id, meta: { occasionId: row.occasionId } });
    await recordEvent(tx, "enquiries.resent", { kind: fresh.kind });
    return { resentAt: tx.now };
  });
}

/* ── Accepting a quote (P12, F6) ───────────────────────────────────────── */

export type QuoteLinkVersion = {
  version: number;
  designRef: DesignRef | null;
  arrangementDescription: string | null;
  quoteAssetId: string;
  quoteMessageId: string;
  /** undefined = the viewer has no finance grant (D2); null = unknown. */
  agreedMinor: number | null | undefined;
  currency: string;
  acceptedAt: Date;
};
/** One changed fact between two acceptances. `before`/`after` null = unknown / none. */
export type QuoteLinkChange = { field: "design" | "quote" | "amount"; before: string | null; after: string | null };
export type QuoteLinkView = {
  enquiryId: string;
  bookingId: string | null;
  current: QuoteLinkVersion;
  /** Every acceptance, oldest first. */
  versions: QuoteLinkVersion[];
  /** What differs between the current acceptance and the one before it (empty for the first). */
  changes: QuoteLinkChange[];
  /**
   * F6: the design moved on since the quote was accepted — the request now carries a newer
   * design version than the accepted quote answers. The designer sets this by sending a new
   * quote request version; null when there is no design.
   */
  designChangedSinceQuote: boolean | null;
};

const designText = (d: DesignRef | null) => (d ? `${d.designId} v${d.version}` : null);

async function quoteLinkFor(ctx: Ctx, enquiryId: string, canSeeMoney: boolean): Promise<QuoteLinkView | null> {
  const rows = await ctx.db.select().from(quoteLinks).where(eq(quoteLinks.enquiryId, enquiryId)).orderBy(asc(quoteLinks.version));
  if (rows.length === 0) return null;
  const versions: QuoteLinkVersion[] = rows.map((r) => ({
    version: r.version,
    designRef: r.designRef,
    arrangementDescription: r.arrangementDescription,
    quoteAssetId: r.quoteAssetId,
    quoteMessageId: r.quoteMessageId,
    agreedMinor: canSeeMoney ? r.agreedMinor : undefined,
    currency: r.currency,
    acceptedAt: r.acceptedAt,
  }));
  const current = versions[versions.length - 1]!;
  const prev = versions[versions.length - 2];
  const changes: QuoteLinkChange[] = [];
  if (prev) {
    if (designText(prev.designRef) !== designText(current.designRef) || prev.arrangementDescription !== current.arrangementDescription) {
      changes.push({ field: "design", before: designText(prev.designRef) ?? prev.arrangementDescription, after: designText(current.designRef) ?? current.arrangementDescription });
    }
    if (prev.quoteAssetId !== current.quoteAssetId) changes.push({ field: "quote", before: prev.quoteAssetId, after: current.quoteAssetId });
    if (canSeeMoney && prev.agreedMinor !== current.agreedMinor) {
      changes.push({ field: "amount", before: prev.agreedMinor == null ? null : String(prev.agreedMinor), after: current.agreedMinor == null ? null : String(current.agreedMinor) });
    }
  }
  const [e] = await ctx.db.select({ kind: enquiries.kind, shared: enquiries.shared }).from(enquiries).where(eq(enquiries.id, enquiryId));
  const asked = e?.kind === "quote_request" ? (e.shared as QuoteRequestShared).arrangement.designRef : null;
  return {
    enquiryId,
    bookingId: rows[rows.length - 1]!.bookingId,
    current,
    versions,
    changes,
    designChangedSinceQuote: asked && current.designRef ? asked.designId !== current.designRef.designId || asked.version !== current.designRef.version : null,
  };
}

/**
 * FOR THE DESIGNER / C-13: the accepted quote of a thread (by `enquiryId`) or of a supplier
 * record (by `bookingId` — the latest acceptance among its threads), with every version and
 * the delta against the previous one. Null when nothing was accepted. Planning members.
 */
export async function getQuoteLink(ctx: Ctx, input: { enquiryId?: string; bookingId?: string }): Promise<QuoteLinkView | null> {
  let enquiryId = input.enquiryId ?? null;
  if (!enquiryId && input.bookingId) {
    const [latest] = await ctx.db.select({ enquiryId: quoteLinks.enquiryId }).from(quoteLinks).where(eq(quoteLinks.bookingId, input.bookingId)).orderBy(desc(quoteLinks.acceptedAt)).limit(1);
    enquiryId = latest?.enquiryId ?? null;
    if (!enquiryId) {
      const [b] = await ctx.db.select({ occasionId: bookings.occasionId }).from(bookings).where(eq(bookings.id, input.bookingId));
      if (!b) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
      await requireMember(ctx, b.occasionId, { roles: PLANNING_ROLES });
      return null;
    }
  }
  if (!enquiryId) throw new AppError("VALIDATION", "common.validation.required");
  const row = await loadEnquiry(ctx, enquiryId);
  const member = await requireMember(ctx, row.occasionId, { roles: PLANNING_ROLES });
  return quoteLinkFor(ctx, row.id, member.grants.finance);
}

const acceptInput = z.object({
  enquiryId: idSchema,
  messageId: idSchema,
  /** Text from the form ("1.500", "1500,50"); empty = unknown. Read only with the finance grant. */
  agreedAmount: zMoneyText("enquiries.errors.amount").optional(),
});

/**
 * "Acceptă oferta" (P12, F6): the PDF becomes the booking's quote (bookings.attachQuote), the
 * booking moves to "booked", and the agreed amount entered by the planner is stored on the
 * booking — which is where the budget reads supplier commitments from, so nothing is counted
 * twice (no separate expense). The link between what was asked (design version or sketch)
 * and the accepted quote is stored as a new version.
 * Owner / project manager; the amount is written only with the finance grant (D2).
 */
export async function acceptQuote(ctx: Ctx, input: z.input<typeof acceptInput>): Promise<{ version: number; bookingId: string }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const data = acceptInput.parse(input);
  const row = await loadEnquiry(ctx, data.enquiryId);
  const member = await requireMember(ctx, row.occasionId, { manage: true });
  await assertOccasionWritable(ctx, row.occasionId);
  const [message] = await ctx.db.select().from(enquiryMessages).where(and(eq(enquiryMessages.id, data.messageId), eq(enquiryMessages.enquiryId, row.id)));
  if (!message || message.side !== "business" || !message.quoteAssetId) throw new AppError("VALIDATION", "enquiries.errors.noQuote");
  if (!row.bookingId) throw new AppError("CONFLICT", "enquiries.errors.noBooking");
  const bookingId = row.bookingId;
  const amount = member.grants.finance ? data.agreedAmount : undefined;
  return inTx(ctx, async (tx) => {
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${"enquiry.accept:" + row.id}))`);
    const [last] = await tx.db.select().from(quoteLinks).where(eq(quoteLinks.enquiryId, row.id)).orderBy(desc(quoteLinks.version)).limit(1);
    const shared = row.kind === "quote_request" ? (row.shared as QuoteRequestShared) : null;
    const designRef = shared?.arrangement.designRef ?? null;
    // the same quote accepted again with nothing changed is a repeat, not a new version (Q4)
    if (last && last.quoteMessageId === message.id && designText(last.designRef) === designText(designRef) && (amount === undefined || amount === last.agreedMinor)) {
      return { version: last.version, bookingId };
    }
    await attachQuote(tx, { bookingId, assetId: message.quoteAssetId! });
    const [b] = await tx.db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (amount !== undefined) await updateBookingTerms(tx, { bookingId, agreedAmount: amount === null ? "" : (amount / 100).toFixed(2), notes: b?.notes ?? null });
    if (b && (b.state === "enquired" || b.state === "quoted")) await setBookingState(tx, { bookingId, state: "booked" });
    const version = (last?.version ?? 0) + 1;
    const [after] = await tx.db.select({ agreedMinor: bookings.agreedMinor, currency: bookings.currency }).from(bookings).where(eq(bookings.id, bookingId));
    await tx.db.insert(quoteLinks).values({
      enquiryId: row.id,
      occasionId: row.occasionId,
      bookingId,
      version,
      designRef,
      arrangementDescription: shared?.arrangement.description ?? null,
      quoteAssetId: message.quoteAssetId!,
      quoteMessageId: message.id,
      agreedMinor: after?.agreedMinor ?? null,
      currency: after?.currency ?? "RON",
      acceptedAt: tx.now,
      acceptedByAccountId: accountId,
    });
    await audit(tx, { action: "enquiry.quote_accepted", objectType: "enquiry", objectId: row.id, after: { version, bookingId }, meta: { occasionId: row.occasionId } });
    await recordEvent(tx, "enquiries.quoteAccepted", { kind: row.kind });
    return { version, bookingId };
  });
}

/* ── Notifications (P32) ───────────────────────────────────────────────── */

type NoticeParams = { listingName: string; kind: EnquiryKind; url: string };

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Where a listing's notifications go: its published contact address, else the owner's. */
async function notifyTarget(ctx: Ctx, enquiryId: string) {
  const [row] = await ctx.db
    .select({
      id: enquiries.id,
      kind: enquiries.kind,
      state: enquiries.state,
      businessId: enquiries.businessId,
      nudgedAt: enquiries.nudgedAt,
      firstAnsweredAt: enquiries.firstAnsweredAt,
      listingName: listings.name,
      listingEmail: listings.contactEmail,
      hasEnglish: sql<boolean>`${listings.descriptionEn} is not null`,
      nudge48h: businesses.nudge48h,
      businessStatus: businesses.status,
      ownerEmail: accounts.email,
    })
    .from(enquiries)
    .innerJoin(listings, eq(listings.id, enquiries.listingId))
    .innerJoin(businesses, eq(businesses.id, enquiries.businessId))
    .innerJoin(accounts, eq(accounts.id, businesses.ownerAccountId))
    .where(eq(enquiries.id, enquiryId));
  if (!row) return null;
  return { ...row, to: row.listingEmail ?? row.ownerEmail };
}

async function sendNotice(ctx: Ctx, template: string, t: NonNullable<Awaited<ReturnType<typeof notifyTarget>>>): Promise<void> {
  if (!t.to) return;
  await sendEmail(ctx, {
    to: t.to,
    template,
    // L4: listings are written in Romanian; English is added only when the listing has it
    locale: "ro",
    bilingual: t.hasEnglish,
    params: { listingName: t.listingName, kind: t.kind, url: `${appUrl()}/business/${t.businessId}/enquiries/${t.id}` } satisfies NoticeParams,
  });
}

/** P32: the arrival notice. Cannot be switched off. Carries nothing about the planner. */
export async function notifyEnquiryArrival(ctx: Ctx, input: { enquiryId: string; resend?: boolean }): Promise<boolean> {
  const t = await notifyTarget(ctx, input.enquiryId);
  if (!t || t.state === "closed" || t.businessStatus === "suspended") return false;
  await sendNotice(ctx, input.resend ? "enquiries.resent" : "enquiries.arrival", t);
  return true;
}

/**
 * P32: the ONE reminder, 48 hours after arrival, only while nothing was answered and only
 * when the business left `nudge48h` on. The conditional update makes it exactly-once.
 */
export async function sendEnquiryNudge(ctx: Ctx, input: { enquiryId: string }): Promise<boolean> {
  const t = await notifyTarget(ctx, input.enquiryId);
  if (!t || t.state !== "sent" || t.firstAnsweredAt || t.nudgedAt || !t.nudge48h || t.businessStatus === "suspended") return false;
  const claimed = await ctx.db
    .update(enquiries)
    .set({ nudgedAt: ctx.now })
    .where(and(eq(enquiries.id, t.id), isNull(enquiries.nudgedAt), eq(enquiries.state, "sent")))
    .returning({ id: enquiries.id });
  if (!claimed[0]) return false;
  await sendNotice(ctx, "enquiries.nudge", t);
  return true;
}

/* ── Statistics (P31, INF11) ───────────────────────────────────────────── */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Cumulative response numbers per listing up to `until`, from enquiry events only. */
export async function enquiryNumbers(ctx: Pick<Ctx, "db">, input: { listingIds: string[]; until: Date }): Promise<Map<string, EnquiryNumbers>> {
  const out = new Map<string, EnquiryNumbers>();
  if (input.listingIds.length === 0) return out;
  const rows = await ctx.db
    .select({ listingId: enquiryStatEvents.listingId, answeredAt: enquiryStatEvents.answeredAt, replyMinutes: enquiryStatEvents.replyMinutes })
    .from(enquiryStatEvents)
    .where(and(inArray(enquiryStatEvents.listingId, input.listingIds), lte(enquiryStatEvents.receivedAt, input.until)));
  const by = new Map<string, { received: number; replies: number[] }>();
  for (const r of rows) {
    const acc = by.get(r.listingId) ?? { received: 0, replies: [] };
    acc.received++;
    if (r.answeredAt && r.answeredAt.getTime() <= input.until.getTime() && r.replyMinutes !== null) acc.replies.push(r.replyMinutes);
    by.set(r.listingId, acc);
  }
  for (const [listingId, acc] of by) out.set(listingId, { received: acc.received, answered: acc.replies.length, medianReplyMinutes: median(acc.replies) });
  return out;
}

/* ── Registrations ─────────────────────────────────────────────────────── */

function registerRules(): void {
  setEnquiryStatsProvider((ctx, input) => enquiryNumbers(ctx, input));
  registerUploadPurpose(ENQUIRY_ATTACHMENT_PURPOSE, { ownerType: "occasion", allowPdf: false });

  for (const name of ["arrival", "resent", "nudge"] as const) {
    registerTemplate<NoticeParams>(`enquiries.${name}`, (p, { t }) => ({
      subject: t(`enquiries.email.${name}.subject`, { listing: p.listingName }),
      blocks: [
        { kind: "text", text: t(`enquiries.email.${name}.body`, { listing: p.listingName }) },
        { kind: "text", text: t(`enquiries.email.kind.${p.kind}`) },
        { kind: "button", label: t("enquiries.email.open"), url: p.url },
        { kind: "note", text: t("enquiries.email.footer") },
      ],
    }));
  }

  // INF6: enquiry and quote threads are kept with the occasion and deleted with it. The
  // identity-free stat events stay (P31 numbers must not change when a planner leaves).
  onOccasionPurge(async (tx, occasionId) => {
    await tx.db.delete(quoteLinks).where(eq(quoteLinks.occasionId, occasionId));
    await tx.db.delete(enquiries).where(eq(enquiries.occasionId, occasionId)); // messages cascade
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker. */
export function registerJobs(): void {
  registerRules();
  defineJob(ARRIVAL_JOB, z.object({ enquiryId: z.string(), resend: z.boolean().optional() }), async (ctx, p) => {
    await notifyEnquiryArrival(ctx, p);
  });
  defineJob(NUDGE_JOB, z.object({ enquiryId: z.string() }), async (ctx, p) => {
    await sendEnquiryNudge(ctx, p);
  });
}
