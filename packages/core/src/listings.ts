import {
  and,
  asc,
  assets,
  businesses,
  categories,
  count,
  counties,
  desc,
  eq,
  inArray,
  isNull,
  listingCategories,
  listingLocalities,
  listingRevisions,
  listings,
  localities,
  ne,
  sql,
  type ListingPayload,
  type ListingStatus,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { audit } from "./audit";
import {
  addBusinessNotice,
  applyBusinessStatus,
  assertBusinessCanCreate,
  BUSINESS_MODERATION_ROLES,
  queueBusinessEmail,
  requireBusinessMember,
  type Business,
} from "./business";
import { requireWriteCapable, type Ctx } from "./context";
import { localName, resolveMergedIds } from "./geography";
import {
  listRevisionsForSubject,
  registerModerationKind,
  submitForModeration,
  type ModerationField,
  type ModerationRevision,
} from "./moderation";
import { onContentReportDecided } from "./reports";
import { registerDashboardCounter, requireStaffRole } from "./staff";
import { inTx } from "./tx";

// Listings (P1, P2, P3, P29, W3).
//
// A listing's PUBLIC content lives in the `listings` row and its two join tables, and only
// approval of a revision writes them (applyListingRevision). What a business types goes to
// `listings.draft`, then — on "Trimite spre verificare" — into the moderation queue
// (@ed/core/moderation, kind "listing"). Until a moderator approves, the live version stays
// exactly as it was.
//
// Picklists only: categories, counties and localities are ids of seeded rows, checked in the
// database on every save. There is no way to type a category or a place.

export { LISTING_STATUSES } from "@ed/db";
export type { ListingPayload, ListingStatus } from "@ed/db";
export type Listing = typeof listings.$inferSelect;

export const LISTING_KIND = "listing";
export const MAX_LISTINGS_PER_BUSINESS = 5;
export const MAX_CATEGORIES = 5;
export const MAX_COUNTIES = 5;
export const MAX_LOCALITIES = 20;
export const MAX_PHOTOS = 8;

/* ── Payload shape ─────────────────────────────────────────────────────── */

const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const zList = (max: number, tooMany: string) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]),
    z.array(z.string().min(1).max(64)).max(max, tooMany),
  );

/** https only, a real host name, no credentials. Rendered with <ExternalLink>. */
export function parseWebsite(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
  return url.toString();
}

const shape = {
  name: z.string().trim().min(2, "common.validation.required").max(120, "common.validation.tooLong"),
  descriptionRo: z.preprocess((v) => (v === undefined || v === null ? "" : v), z.string().trim().max(4000, "common.validation.tooLong")),
  descriptionEn: z.preprocess(empty, z.string().trim().max(4000, "common.validation.tooLong").nullable().optional()),
  categoryIds: zList(MAX_CATEGORIES, "listings.errors.tooManyCategories"),
  countyCodes: zList(MAX_COUNTIES, "listings.errors.tooManyCounties"),
  localityIds: zList(MAX_LOCALITIES, "listings.errors.tooManyLocalities"),
  contactPhone: z.preprocess(empty, z.string().trim().regex(/^[+0-9 ()./-]{6,30}$/, "listings.errors.phoneInvalid").nullable().optional()),
  contactEmail: z.preprocess(empty, z.email("common.validation.invalidEmail").trim().toLowerCase().max(320).nullable().optional()),
  website: z.preprocess(empty, z.string().trim().max(300, "common.validation.tooLong").nullable().optional()),
  photoAssetIds: zList(MAX_PHOTOS, "listings.errors.tooManyPhotos"),
};
/** Unknown keys are refused: nothing outside the picklist-backed shape can be stored. */
export const listingPayloadInput = z.strictObject(shape);
export type ListingPayloadInput = z.input<typeof listingPayloadInput>;

type FieldErrors = Record<string, string[]>;
const addError = (errors: FieldErrors, field: string, key: string) => {
  const list = (errors[field] ??= []);
  if (!list.includes(key)) list.push(key);
};
const unique = (ids: string[]) => [...new Set(ids)];

/**
 * Validates a listing payload against the seeded picklists and returns it normalised.
 *   mode "draft"  — may be incomplete, but whatever is filled in must be valid;
 *   mode "submit" — complete: 1–5 categories, ≤5 counties, 1–20 localities, each locality
 *                   inside a chosen county and each chosen county with a locality.
 * Retired entries are accepted only when the listing already had them (`existing`).
 * `businessId` null = unclaimed listing (no photos allowed, P29).
 */
export async function validateListingPayload(
  ctx: Ctx,
  raw: unknown,
  opts: { businessId: string | null; mode: "draft" | "submit"; existing?: ListingPayload | null },
): Promise<ListingPayload> {
  const parsed = listingPayloadInput.safeParse(raw);
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.length ? String(issue.path[0]) : "_form";
      const custom = /^[a-z]+(\.[A-Za-z0-9_]+)+$/.test(issue.message);
      addError(errors, field, custom ? issue.message : issue.code === "unrecognized_keys" ? "listings.errors.unknownField" : "common.validation.invalid");
    }
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: errors });
  }
  const p = parsed.data;
  const submit = opts.mode === "submit";
  const had = opts.existing ?? null;

  const categoryIds = await resolveMergedIds(ctx, "category", unique(p.categoryIds));
  const localityIds = await resolveMergedIds(ctx, "locality", unique(p.localityIds));
  const countyCodes = unique(p.countyCodes.map((c) => c.toUpperCase()));
  if (categoryIds.length > MAX_CATEGORIES) addError(errors, "categoryIds", "listings.errors.tooManyCategories");
  if (localityIds.length > MAX_LOCALITIES) addError(errors, "localityIds", "listings.errors.tooManyLocalities");

  const catRows = categoryIds.length ? await ctx.db.select().from(categories).where(inArray(categories.id, categoryIds)) : [];
  for (const id of categoryIds) {
    const row = catRows.find((r) => r.id === id);
    if (!row || (!row.active && !had?.categoryIds.includes(id))) addError(errors, "categoryIds", "listings.errors.unknownCategory");
  }
  const countyRows = countyCodes.length ? await ctx.db.select().from(counties).where(inArray(counties.code, countyCodes)) : [];
  for (const code of countyCodes) {
    const row = countyRows.find((r) => r.code === code);
    if (!row || (!row.active && !had?.countyCodes.includes(code))) addError(errors, "countyCodes", "listings.errors.unknownCounty");
  }
  const locRows = localityIds.length ? await ctx.db.select().from(localities).where(inArray(localities.id, localityIds)) : [];
  for (const id of localityIds) {
    const row = locRows.find((r) => r.id === id);
    if (!row || (!row.active && !had?.localityIds.includes(id))) addError(errors, "localityIds", "listings.errors.unknownLocality");
    else if (!countyCodes.includes(row.countyCode)) addError(errors, "localityIds", "listings.errors.localityOutsideCounties");
  }

  if (submit) {
    if (categoryIds.length === 0) addError(errors, "categoryIds", "listings.errors.noCategory");
    if (countyCodes.length === 0) addError(errors, "countyCodes", "listings.errors.noCounty");
    if (localityIds.length === 0) addError(errors, "localityIds", "listings.errors.noLocality");
    else if (countyCodes.some((code) => !locRows.some((l) => l.countyCode === code))) addError(errors, "localityIds", "listings.errors.countyWithoutLocality");
    if (p.descriptionRo.length < 20) addError(errors, "descriptionRo", "listings.errors.descriptionTooShort");
  }

  let website: string | null = null;
  if (p.website) {
    website = parseWebsite(p.website);
    if (!website) addError(errors, "website", "listings.errors.websiteHttps");
  }

  const photoAssetIds = unique(p.photoAssetIds);
  if (photoAssetIds.length > 0) {
    if (!opts.businessId) addError(errors, "photoAssetIds", "listings.errors.photoNotYours");
    else {
      const rows = await ctx.db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            inArray(assets.id, photoAssetIds),
            eq(assets.ownerType, "business"),
            eq(assets.ownerId, opts.businessId),
            eq(assets.kind, "image"),
            eq(assets.scanState, "clean"),
            isNull(assets.deletedAt),
          ),
        );
      if (rows.length !== photoAssetIds.length) addError(errors, "photoAssetIds", "listings.errors.photoNotYours");
    }
  }

  if (Object.keys(errors).length > 0) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: errors });
  return {
    name: p.name,
    descriptionRo: p.descriptionRo,
    descriptionEn: p.descriptionEn ?? null,
    categoryIds,
    countyCodes,
    localityIds,
    contactPhone: p.contactPhone ?? null,
    contactEmail: p.contactEmail ?? null,
    website,
    photoAssetIds,
  };
}

/* ── Reading a listing's content ───────────────────────────────────────── */

/** The LIVE content of a listing in payload shape, or null when it has never been live. */
export async function getLivePayload(ctx: Pick<Ctx, "db">, listing: Listing): Promise<ListingPayload | null> {
  if (!listing.liveRevisionId) return null;
  const cats = await ctx.db.select({ id: listingCategories.categoryId }).from(listingCategories).where(eq(listingCategories.listingId, listing.id));
  const locs = await ctx.db
    .select({ id: listingLocalities.localityId, county: listingLocalities.countyCode })
    .from(listingLocalities)
    .where(eq(listingLocalities.listingId, listing.id));
  return {
    name: listing.name,
    descriptionRo: listing.descriptionRo ?? "",
    descriptionEn: listing.descriptionEn,
    categoryIds: cats.map((c) => c.id),
    countyCodes: unique(locs.map((l) => l.county)),
    localityIds: locs.map((l) => l.id),
    contactPhone: listing.contactPhone,
    contactEmail: listing.contactEmail,
    website: listing.website,
    photoAssetIds: listing.photoAssetIds,
  };
}

async function loadListing(ctx: Ctx, listingId: string): Promise<Listing> {
  const [row] = await ctx.db.select().from(listings).where(eq(listings.id, listingId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** Loads a claimed listing and checks the actor is a member of its business. */
export async function requireListingMember(ctx: Ctx, listingId: string, opts: { roles?: readonly ("owner" | "admin" | "staff")[] } = {}) {
  const parsed = zId.safeParse(listingId);
  if (!parsed.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const listing = await loadListing(ctx, parsed.data);
  if (!listing.businessId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const access = await requireBusinessMember(ctx, listing.businessId, opts);
  return { listing, ...access };
}

function assertBusinessMayEdit(business: Business): void {
  // W3: a restricted or suspended business cannot change its content. A lapsed plan can:
  // existing listings stay editable for corrections (P23).
  if (business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${business.status}`);
}

export type BusinessListingRow = {
  listing: Listing;
  /** An edit is waiting for a moderator (the live version stays up meanwhile). */
  pendingRevisionId: string | null;
  pendingSince: Date | null;
  /** The latest decision was a rejection: the reason given. */
  lastRejectionReason: string | null;
};

export async function listBusinessListings(ctx: Ctx, businessId: string): Promise<BusinessListingRow[]> {
  await requireBusinessMember(ctx, businessId);
  const rows = await ctx.db
    .select()
    .from(listings)
    .where(and(eq(listings.businessId, businessId), ne(listings.status, "retired")))
    .orderBy(asc(listings.createdAt));
  const out: BusinessListingRow[] = [];
  for (const listing of rows) {
    const revs = await listRevisionsForSubject(ctx, { kind: LISTING_KIND, subjectId: listing.id, limit: 3 });
    const pending = revs.find((r) => r.state === "pending") ?? null;
    const lastDecided = revs.find((r) => r.state === "approved" || r.state === "rejected") ?? null;
    out.push({
      listing,
      pendingRevisionId: pending?.id ?? null,
      pendingSince: pending?.createdAt ?? null,
      lastRejectionReason: !pending && lastDecided?.state === "rejected" ? lastDecided.decisionReason : null,
    });
  }
  return out;
}

export type ListingEditor = {
  listing: Listing;
  business: Business;
  role: "owner" | "admin" | "staff";
  /** What is public now (null = never approved). */
  live: ListingPayload | null;
  /** What waits for a moderator. */
  pending: { revisionId: string; payload: ListingPayload; submittedAt: Date } | null;
  /** The saved working copy. */
  draft: ListingPayload | null;
  /** What the form starts from: draft, else what is waiting, else what is live. */
  working: ListingPayload | null;
  lastRejection: { reason: string | null; decidedAt: Date | null } | null;
  canEdit: boolean;
};

export async function getListingEditor(ctx: Ctx, listingId: string): Promise<ListingEditor> {
  const { listing, business, role } = await requireListingMember(ctx, listingId);
  const revs = await listRevisionsForSubject(ctx, { kind: LISTING_KIND, subjectId: listing.id, limit: 5 });
  const pendingRev = revs.find((r) => r.state === "pending") ?? null;
  const lastDecided = revs.find((r) => r.state === "approved" || r.state === "rejected") ?? null;
  const live = await getLivePayload(ctx, listing);
  const pending = pendingRev ? { revisionId: pendingRev.id, payload: pendingRev.payload as ListingPayload, submittedAt: pendingRev.createdAt } : null;
  return {
    listing,
    business,
    role,
    live,
    pending,
    draft: listing.draft,
    working: listing.draft ?? pending?.payload ?? live,
    lastRejection: !pendingRev && lastDecided?.state === "rejected" ? { reason: lastDecided.decisionReason, decidedAt: lastDecided.decidedAt } : null,
    canEdit: business.status === "active" && listing.status !== "retired" && listing.status !== "suspended",
  };
}

/* ── Create, save, submit, retire ──────────────────────────────────────── */

/**
 * Creates a listing as a draft. At most five per business (P1); refused while the business
 * is lapsed, restricted or suspended (assertBusinessCanCreate).
 */
export async function createListing(ctx: Ctx, input: { businessId: string; payload: unknown }): Promise<Listing> {
  requireWriteCapable(ctx);
  const businessId = zId.parse(input.businessId);
  await requireBusinessMember(ctx, businessId);
  await assertBusinessCanCreate(ctx, businessId);
  const payload = await validateListingPayload(ctx, input.payload, { businessId, mode: "draft" });
  return inTx(ctx, async (tx) => {
    // serialise per business so the limit cannot be passed by two submits at once
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${"listing.create:" + businessId}))`);
    const [n] = await tx.db
      .select({ n: count() })
      .from(listings)
      .where(and(eq(listings.businessId, businessId), ne(listings.status, "retired")));
    if ((n?.n ?? 0) >= MAX_LISTINGS_PER_BUSINESS) {
      throw new AppError("LIMIT", "listings.errors.tooManyListings", { params: { max: MAX_LISTINGS_PER_BUSINESS } });
    }
    const [row] = await tx.db
      .insert(listings)
      .values({ businessId, status: "draft", claimed: true, name: payload.name, draft: payload, createdAt: tx.now })
      .returning();
    await audit(tx, { action: "listing.created", objectType: "listing", objectId: row!.id, meta: { businessId } });
    return row!;
  });
}

/** Saves the working copy. Nothing public changes. */
export async function saveListingDraft(ctx: Ctx, input: { listingId: string; payload: unknown }): Promise<Listing> {
  requireWriteCapable(ctx);
  const { listing, business } = await requireListingMember(ctx, input.listingId);
  assertBusinessMayEdit(business);
  if (listing.status === "retired" || listing.status === "suspended") throw new AppError("CONFLICT", `listings.errors.${listing.status}`);
  const live = await getLivePayload(ctx, listing);
  const payload = await validateListingPayload(ctx, input.payload, { businessId: business.id, mode: "draft", existing: live });
  const [row] = await ctx.db
    .update(listings)
    .set({ draft: payload, ...(listing.liveRevisionId ? {} : { name: payload.name }) })
    .where(eq(listings.id, listing.id))
    .returning();
  return row!;
}

/**
 * "Trimite spre verificare": validates the content completely and queues it for a moderator.
 * A listing that was never live becomes "pending"; a live listing STAYS live, unchanged,
 * until the revision is approved (P3).
 */
export async function submitListing(
  ctx: Ctx,
  input: { listingId: string; payload?: unknown },
): Promise<{ listing: Listing; revisionId: string }> {
  requireWriteCapable(ctx);
  const { listing, business } = await requireListingMember(ctx, input.listingId);
  assertBusinessMayEdit(business);
  if (listing.status === "retired" || listing.status === "suspended") throw new AppError("CONFLICT", `listings.errors.${listing.status}`);
  const live = await getLivePayload(ctx, listing);
  const source = input.payload ?? listing.draft;
  if (!source) throw new AppError("VALIDATION", "listings.errors.nothingToSubmit");
  const payload = await validateListingPayload(ctx, source, { businessId: business.id, mode: "submit", existing: live });
  return inTx(ctx, async (tx) => {
    const revision = await submitForModeration(tx, {
      kind: LISTING_KIND,
      subjectId: listing.id,
      listingId: listing.id,
      businessId: business.id,
      payload,
      basePayload: live ?? undefined,
    });
    const [row] = await tx.db
      .update(listings)
      .set({
        draft: null,
        ...(listing.status === "draft" ? { status: "pending" as const } : {}),
        ...(listing.liveRevisionId ? {} : { name: payload.name }),
      })
      .where(eq(listings.id, listing.id))
      .returning();
    return { listing: row!, revisionId: revision.id };
  });
}

/** Withdraws the listing from the directory for good (owner or admin). Frees one of the five places. */
export async function retireListing(ctx: Ctx, input: { listingId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { listing } = await requireListingMember(ctx, input.listingId, { roles: ["owner", "admin"] });
  if (listing.status === "retired") return;
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(listingRevisions)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(listingRevisions.kind, LISTING_KIND), eq(listingRevisions.subjectId, listing.id), eq(listingRevisions.state, "pending")));
    await tx.db.update(listings).set({ status: "retired", draft: null }).where(eq(listings.id, listing.id));
    await audit(tx, { action: "listing.retired", objectType: "listing", objectId: listing.id, before: { status: listing.status }, after: { status: "retired" } });
  });
}

/** P31: hide or show this listing's response statistics. */
export async function setListingHideStats(ctx: Ctx, input: { listingId: string; hide: boolean }): Promise<void> {
  requireWriteCapable(ctx);
  const { listing } = await requireListingMember(ctx, input.listingId, { roles: ["owner", "admin"] });
  await ctx.db.update(listings).set({ hideStats: !!input.hide }).where(eq(listings.id, listing.id));
  await audit(ctx, { action: "listing.hide_stats", objectType: "listing", objectId: listing.id, after: { hideStats: !!input.hide } });
}

/* ── Unclaimed listings (P29, BD2, BD4) ────────────────────────────────── */

/** Extra facts carried by the revision of an unclaimed listing. */
export type UnclaimedSource = { sourceUrl: string; collectedAt: string; publicContactRoute: string };
export type UnclaimedListingPayload = ListingPayload & { unclaimed: UnclaimedSource };

export const createUnclaimedListingInput = z.object({
  name: shape.name,
  descriptionRo: z.string().trim().max(1000).optional(),
  categoryIds: z.array(z.string()).min(1).max(MAX_CATEGORIES),
  localityIds: z.array(z.string()).min(1).max(MAX_LOCALITIES),
  /** The contact route exactly as the public source states it (phone, address, page). */
  publicContactRoute: z.string().trim().min(3).max(500),
  sourceUrl: z.string().trim().max(1000).refine((v) => parseWebsite(v) !== null || /^http:\/\//.test(v), "common.validation.invalid"),
  collectedAt: z.coerce.date().optional(),
  /** Cited in the moderation record (BD4). */
  sourceNote: z.string().trim().max(1000).optional(),
});

/**
 * FOR THE DISCOVERY DOMAIN (P-09). Creates an unclaimed listing: never public until a
 * moderator approves its revision (BD2), no business, no photos, no enquiries (P29). The
 * counties are derived from the localities. System actor or moderating staff only; a staff
 * member who creates it cannot approve it.
 */
export async function createUnclaimedListing(
  ctx: Ctx,
  input: z.input<typeof createUnclaimedListingInput>,
): Promise<{ listingId: string; revisionId: string }> {
  if (ctx.actor.kind !== "system") requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const data = createUnclaimedListingInput.parse(input);
  const locRows = await ctx.db.select().from(localities).where(inArray(localities.id, unique(data.localityIds)));
  const base = await validateListingPayload(
    ctx,
    {
      name: data.name,
      descriptionRo: data.descriptionRo ?? "",
      categoryIds: data.categoryIds,
      countyCodes: unique(locRows.map((l) => l.countyCode)),
      localityIds: data.localityIds,
    },
    { businessId: null, mode: "draft" },
  );
  if (base.categoryIds.length === 0 || base.localityIds.length !== unique(data.localityIds).length) {
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { localityIds: ["listings.errors.unknownLocality"] } });
  }
  const collectedAt = data.collectedAt ?? ctx.now;
  const payload: UnclaimedListingPayload = {
    ...base,
    unclaimed: { sourceUrl: data.sourceUrl, collectedAt: collectedAt.toISOString(), publicContactRoute: data.publicContactRoute },
  };
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(listings)
      .values({
        businessId: null,
        claimed: false,
        status: "pending",
        name: base.name,
        sourceUrl: data.sourceUrl,
        collectedAt,
        publicContactRoute: data.publicContactRoute,
        createdAt: tx.now,
      })
      .returning();
    const revision = await submitForModeration(tx, {
      kind: LISTING_KIND,
      subjectId: row!.id,
      listingId: row!.id,
      businessId: null,
      payload,
      sourceNote: data.sourceNote ?? data.sourceUrl,
    });
    await audit(tx, { action: "listing.unclaimed_created", objectType: "listing", objectId: row!.id, meta: { sourceUrl: data.sourceUrl } });
    return { listingId: row!.id, revisionId: revision.id };
  });
}

/**
 * FOR THE CLAIMING DOMAIN (P-10). Turns an unclaimed listing into a normal claimed listing of
 * `businessId` once the claim has been verified and approved. System or moderating staff.
 */
export async function convertListingToClaimed(ctx: Ctx, input: { listingId: string; businessId: string }): Promise<Listing> {
  if (ctx.actor.kind !== "system") requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const data = z.object({ listingId: zId, businessId: zId }).parse(input);
  return inTx(ctx, async (tx) => {
    const [listing] = await tx.db.select().from(listings).where(eq(listings.id, data.listingId)).for("update");
    if (!listing) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (listing.claimed) throw new AppError("CONFLICT", "listings.errors.alreadyClaimed");
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${"listing.create:" + data.businessId}))`);
    const [n] = await tx.db
      .select({ n: count() })
      .from(listings)
      .where(and(eq(listings.businessId, data.businessId), ne(listings.status, "retired")));
    if ((n?.n ?? 0) >= MAX_LISTINGS_PER_BUSINESS) throw new AppError("LIMIT", "listings.errors.tooManyListings", { params: { max: MAX_LISTINGS_PER_BUSINESS } });
    const [row] = await tx.db.update(listings).set({ businessId: data.businessId, claimed: true }).where(eq(listings.id, listing.id)).returning();
    await tx.db
      .update(listingRevisions)
      .set({ businessId: data.businessId })
      .where(and(eq(listingRevisions.kind, LISTING_KIND), eq(listingRevisions.subjectId, listing.id), eq(listingRevisions.state, "pending")));
    await audit(tx, { action: "listing.claimed", objectType: "listing", objectId: listing.id, after: { businessId: data.businessId } });
    return row!;
  });
}

/* ── Moderation kind "listing" ─────────────────────────────────────────── */

async function namesFor(ctx: Ctx, payload: ListingPayload | null) {
  if (!payload) return { categories: null, counties: null, localities: null };
  const cats = payload.categoryIds.length ? await ctx.db.select().from(categories).where(inArray(categories.id, payload.categoryIds)) : [];
  const cos = payload.countyCodes.length ? await ctx.db.select().from(counties).where(inArray(counties.code, payload.countyCodes)) : [];
  const locs = payload.localityIds.length ? await ctx.db.select().from(localities).where(inArray(localities.id, payload.localityIds)) : [];
  const join = (names: string[]) => (names.length ? names.sort((a, b) => a.localeCompare(b, "ro")).join(", ") : null);
  return {
    categories: join(cats.map((c) => localName(c, ctx.locale))),
    counties: join(cos.map((c) => localName(c, ctx.locale))),
    localities: join(locs.map((l) => localName(l, ctx.locale))),
  };
}

/** The before → after rows for a listing revision (also used by the business area). */
export async function describeListingChange(
  ctx: Ctx,
  after: ListingPayload | UnclaimedListingPayload,
  before: ListingPayload | null,
): Promise<ModerationField[]> {
  const [a, b] = await Promise.all([namesFor(ctx, after), namesFor(ctx, before)]);
  const photos = (p: ListingPayload | null) => (p && p.photoAssetIds.length > 0 ? String(p.photoAssetIds.length) : null);
  const fields: ModerationField[] = [
    { key: "name", labelKey: "listings.fields.name", before: before?.name ?? null, after: after.name },
    { key: "descriptionRo", labelKey: "listings.fields.descriptionRo", before: before?.descriptionRo || null, after: after.descriptionRo || null },
    { key: "descriptionEn", labelKey: "listings.fields.descriptionEn", before: before?.descriptionEn ?? null, after: after.descriptionEn ?? null },
    { key: "categories", labelKey: "listings.fields.categories", before: b.categories, after: a.categories },
    { key: "counties", labelKey: "listings.fields.counties", before: b.counties, after: a.counties },
    { key: "localities", labelKey: "listings.fields.localities", before: b.localities, after: a.localities },
    { key: "contactPhone", labelKey: "listings.fields.contactPhone", before: before?.contactPhone ?? null, after: after.contactPhone },
    { key: "contactEmail", labelKey: "listings.fields.contactEmail", before: before?.contactEmail ?? null, after: after.contactEmail },
    { key: "website", labelKey: "listings.fields.website", before: before?.website ?? null, after: after.website },
    { key: "photos", labelKey: "listings.fields.photoCount", before: photos(before), after: photos(after) },
  ];
  if ("unclaimed" in after) {
    fields.push(
      { key: "publicContactRoute", labelKey: "listings.fields.publicContactRoute", before: null, after: after.unclaimed.publicContactRoute },
      { key: "sourceUrl", labelKey: "listings.fields.sourceUrl", before: null, after: after.unclaimed.sourceUrl },
    );
  }
  return fields;
}

/** Approval: the revision's payload becomes the live listing, in one transaction. */
async function applyListingRevision(tx: Ctx, revision: ModerationRevision): Promise<void> {
  const [listing] = await tx.db.select().from(listings).where(eq(listings.id, revision.subjectId)).for("update");
  if (!listing) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (listing.status === "retired") throw new AppError("CONFLICT", "listings.errors.retired");
  const raw = revision.payload as ListingPayload & { unclaimed?: UnclaimedSource };
  const { unclaimed, ...content } = raw;
  // Picklists may have changed since submission (W4): follow merges, refuse what no longer exists.
  const payload = await validateListingPayload(tx, content, { businessId: listing.businessId, mode: listing.claimed ? "submit" : "draft", existing: content });
  await tx.db.delete(listingCategories).where(eq(listingCategories.listingId, listing.id));
  await tx.db.insert(listingCategories).values(payload.categoryIds.map((categoryId) => ({ listingId: listing.id, categoryId })));
  const locRows = await tx.db.select().from(localities).where(inArray(localities.id, payload.localityIds));
  await tx.db.delete(listingLocalities).where(eq(listingLocalities.listingId, listing.id));
  await tx.db.insert(listingLocalities).values(locRows.map((l) => ({ listingId: listing.id, localityId: l.id, countyCode: l.countyCode })));
  const suspended = listing.status === "suspended";
  await tx.db
    .update(listings)
    .set({
      name: payload.name,
      descriptionRo: payload.descriptionRo,
      descriptionEn: payload.descriptionEn,
      contactPhone: payload.contactPhone,
      contactEmail: payload.contactEmail,
      website: payload.website,
      photoAssetIds: payload.photoAssetIds,
      liveRevisionId: revision.id,
      publishedAt: listing.publishedAt ?? tx.now,
      // a suspension outlives an approval: the content is updated, the listing stays down
      status: suspended ? "suspended" : "live",
      statusBeforeSuspension: suspended ? "live" : null,
      ...(unclaimed && !listing.claimed
        ? { sourceUrl: unclaimed.sourceUrl, collectedAt: new Date(unclaimed.collectedAt), publicContactRoute: unclaimed.publicContactRoute }
        : {}),
    })
    .where(eq(listings.id, listing.id));
}

/** Rejection or withdrawal: the content goes back to the business's working copy. */
async function returnToDraft(tx: Ctx, revision: ModerationRevision, rejected: boolean): Promise<void> {
  const [listing] = await tx.db.select().from(listings).where(eq(listings.id, revision.subjectId)).for("update");
  if (!listing || listing.status === "retired") return;
  if (!listing.claimed) {
    // a rejected discovery draft never becomes public
    if (rejected && listing.status === "pending") await tx.db.update(listings).set({ status: "retired" }).where(eq(listings.id, listing.id));
    return;
  }
  const { unclaimed: _ignored, ...content } = revision.payload as ListingPayload & { unclaimed?: UnclaimedSource };
  await tx.db
    .update(listings)
    .set({ draft: listing.draft ?? content, ...(listing.status === "pending" ? { status: "draft" as const } : {}) })
    .where(eq(listings.id, listing.id));
}

/* ── W3 for a single listing ───────────────────────────────────────────── */

/** Internal (no role check): suspends a listing with the recorded reason. Joins the caller's transaction. */
export async function applyListingSuspension(ctx: Ctx, input: { listingId: string; reason: string }): Promise<Listing | null> {
  return inTx(ctx, async (tx) => {
    const [listing] = await tx.db.select().from(listings).where(eq(listings.id, input.listingId)).for("update");
    if (!listing) return null;
    if (listing.status === "suspended" || listing.status === "retired") return listing;
    const [row] = await tx.db
      .update(listings)
      .set({ status: "suspended", statusBeforeSuspension: listing.status, suspensionReason: input.reason, suspendedAt: tx.now })
      .where(eq(listings.id, listing.id))
      .returning();
    await audit(tx, {
      action: "listing.suspended",
      objectType: "listing",
      objectId: listing.id,
      before: { status: listing.status },
      after: { status: "suspended", reason: input.reason },
    });
    if (listing.businessId) {
      await addBusinessNotice(tx, { businessId: listing.businessId, kind: "listing.suspended", listingId: listing.id, reason: input.reason });
      await queueBusinessEmail(tx, { businessId: listing.businessId, headlineKey: "business.email.listing.suspended", reason: input.reason });
    }
    return row!;
  });
}

const zReason = z.string().trim().min(10, "moderation.errors.reasonRequired").max(2000, "common.validation.tooLong");

/** W3: takes one listing out of the directory, with the reason the business will see. */
export async function suspendListing(ctx: Ctx, input: { listingId: string; reason: string }): Promise<void> {
  requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const data = z.object({ listingId: zId, reason: zReason }).parse(input);
  const row = await applyListingSuspension(ctx, data);
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
}

/** W3: lifts a suspension; the listing returns to the state it had before. */
export async function restoreListing(ctx: Ctx, input: { listingId: string }): Promise<void> {
  requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const data = z.object({ listingId: zId }).parse(input);
  await inTx(ctx, async (tx) => {
    const [listing] = await tx.db.select().from(listings).where(eq(listings.id, data.listingId)).for("update");
    if (!listing) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (listing.status !== "suspended") return;
    const back: ListingStatus = listing.statusBeforeSuspension ?? (listing.liveRevisionId ? "live" : "draft");
    await tx.db
      .update(listings)
      .set({ status: back, statusBeforeSuspension: null, suspensionReason: null, suspendedAt: null })
      .where(eq(listings.id, listing.id));
    await audit(tx, { action: "listing.restored", objectType: "listing", objectId: listing.id, before: { status: "suspended" }, after: { status: back } });
    if (listing.businessId) {
      await addBusinessNotice(tx, { businessId: listing.businessId, kind: "listing.restored", listingId: listing.id });
      await queueBusinessEmail(tx, { businessId: listing.businessId, headlineKey: "business.email.listing.restored" });
    }
  });
}

/** Console: one listing with its owner, whatever its state. */
export async function getListingForConsole(ctx: Ctx, listingId: string): Promise<{ listing: Listing; businessName: string | null }> {
  requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  const [row] = await ctx.db
    .select({ listing: listings, businessName: businesses.name })
    .from(listings)
    .leftJoin(businesses, eq(businesses.id, listings.businessId))
    .where(eq(listings.id, listingId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** Console: unclaimed and suspended listings (those without a business page of their own). */
export async function listListingsForConsole(ctx: Ctx, input: { filter: "unclaimed" | "suspended" }): Promise<Listing[]> {
  requireStaffRole(ctx, ...BUSINESS_MODERATION_ROLES);
  return ctx.db
    .select()
    .from(listings)
    .where(input.filter === "unclaimed" ? and(eq(listings.claimed, false), ne(listings.status, "retired")) : eq(listings.status, "suspended"))
    .orderBy(desc(listings.createdAt))
    .limit(200);
}

/* ── Registrations ─────────────────────────────────────────────────────── */

function registerRules(): void {
  registerModerationKind(LISTING_KIND, {
    labelKey: "moderation.kinds.listing",
    describe: async (ctx, revision) => {
      const after = revision.payload as ListingPayload | UnclaimedListingPayload;
      const before = (revision.basePayload as ListingPayload | null) ?? null;
      return { title: after.name, fields: await describeListingChange(ctx, after, before), imageAssetIds: after.photoAssetIds };
    },
    apply: applyListingRevision,
    onRejected: (tx, revision) => returnToDraft(tx, revision, true),
    onWithdrawn: (tx, revision) => returnToDraft(tx, revision, false),
  });

  // LAU8 → W3: an actioned content report restricts its target, and the statement of reasons
  // reaches the affected business (in-app notice + email), inside the deciding transaction.
  onContentReportDecided(async (tx, { report, decision, reasonGivenToAffected }) => {
    if (decision !== "actioned" || !report.targetType || !report.targetId) return;
    if (report.targetType === "listing") {
      await applyListingSuspension(tx, { listingId: report.targetId, reason: reasonGivenToAffected });
    } else if (report.targetType === "business") {
      const [b] = await tx.db.select({ id: businesses.id, status: businesses.status }).from(businesses).where(eq(businesses.id, report.targetId));
      if (!b || b.status === "suspended") return;
      await applyBusinessStatus(tx, { businessId: b.id, status: "restricted", reason: reasonGivenToAffected });
      await queueBusinessEmail(tx, { businessId: b.id, headlineKey: "business.email.status.restricted", reason: reasonGivenToAffected });
    }
  });

  registerDashboardCounter({
    key: "listings",
    count: async (ctx) => {
      const rows = await ctx.db.select({ status: listings.status, n: count() }).from(listings).groupBy(listings.status);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
      return { total: rows.reduce((a, r) => a + r.n, 0), byStatus };
    },
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker (also loads the business rules). */
export function registerJobs(): void {
  registerRules();
}
