import {
  and,
  asc,
  assets,
  businesses,
  CATALOGUE_COLOURS,
  CATALOGUE_ITEM_KINDS,
  catalogueItems,
  categories,
  count,
  eq,
  flowerCatalogues,
  inArray,
  isNull,
  listingCategories,
  listingRevisions,
  listings,
  ne,
  notInArray,
  sql,
  type CatalogueColour,
  type CatalogueItemKind,
  type CatalogueItemPayload,
  type CataloguePayload,
  type CatalogueState,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { zId } from "@ed/shared/zod";
import { getAssetUrl } from "@ed/storage";
import { z } from "zod";
import { audit } from "./audit";
import { assertBusinessCanCreate, requireBusinessMember, type Business } from "./business";
import { requireWriteCapable, type Ctx } from "./context";
import { FLORAL_CATEGORY_SLUGS } from "./enquiries";
import { listRevisionsForSubject, registerModerationKind, submitForModeration, type ModerationField, type ModerationRevision } from "./moderation";
import { inTx } from "./tx";

// Flower catalogues (F1, F2).
//
// A business whose listing is in a florist or styling category publishes catalogues of
// varieties: image, seasonality, indicative price per stem and/or per bunch, colours from a
// fixed palette. Prices are INDICATIVE and may be unknown (null) — never zero, never a quote.
//
// F1: every create and every edit goes through THE moderation queue (@ed/core/moderation,
// kind "catalogue"). The business edits a working copy (`flower_catalogues.draft`); "Trimite
// spre verificare" queues it; the live catalogue_items rows are rewritten only on approval,
// so the live version stays up while an edit waits. Item ids are stable across edits —
// arrangement designs (release C) refer to them.
//
// F2: live catalogues are readable from the public listing page and by the designer through
// listPublicCatalogues / getCatalogueItem below. A lapsed plan (P23) hides nothing.
//
// The quote flow built on these (F5, F6) lives in @ed/core/enquiries: sendQuoteRequest,
// acceptQuote, getQuoteLink — re-exported here for the designer.

export { acceptQuote, buildQuoteRequestPayload, getQuoteLink, sendQuoteRequest } from "./enquiries";
export type { DesignRef, QuoteLinkChange, QuoteLinkVersion, QuoteLinkView, QuoteRequestShared } from "./enquiries";

export { CATALOGUE_COLOURS, CATALOGUE_ITEM_KINDS };
export type { CatalogueColour, CatalogueItemKind, CatalogueItemPayload, CataloguePayload, CatalogueState };
export type Catalogue = typeof flowerCatalogues.$inferSelect;
export type CatalogueItem = typeof catalogueItems.$inferSelect;

export const CATALOGUE_KIND = "catalogue";
export const MAX_CATALOGUES_PER_BUSINESS = 10;
export const MAX_ITEMS_PER_CATALOGUE = 200;

type FieldErrors = Record<string, string[]>;

const zName = z.string().trim().min(2, "common.validation.required").max(120, "common.validation.tooLong");
const zPrice = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.number("catalogues.errors.price").int("catalogues.errors.price").positive("catalogues.errors.priceZero").max(100_000_00, "catalogues.errors.price").nullable(),
);
const zArray = <T extends z.ZodType>(inner: T, max: number) =>
  z.preprocess((v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(inner).max(max));

export const catalogueItemInput = z.strictObject({
  /** Omit for a new variety. */
  id: z.string().min(1).max(64).optional(),
  kind: z.enum(CATALOGUE_ITEM_KINDS, "common.validation.required").default("flower"),
  varietyName: zName,
  imageAssetId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().max(64).nullable().optional()),
  seasonMonths: zArray(z.coerce.number().int().min(1).max(12), 12),
  /** Minor units. null = unknown. */
  pricePerStemMinor: zPrice.optional(),
  pricePerBunchMinor: zPrice.optional(),
  colours: zArray(z.enum(CATALOGUE_COLOURS, "common.validation.invalid"), CATALOGUE_COLOURS.length),
  notes: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(500, "common.validation.tooLong").nullable().optional()),
});
export type CatalogueItemInput = z.input<typeof catalogueItemInput>;

function parseItem(raw: unknown): CatalogueItemPayload {
  const parsed = catalogueItemInput.safeParse(raw);
  if (!parsed.success) {
    const errors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.length ? String(issue.path[0]) : "_form";
      const custom = /^[a-z]+(\.[A-Za-z0-9_]+)+$/.test(issue.message);
      (errors[field] ??= []).push(custom ? issue.message : "common.validation.invalid");
    }
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: errors });
  }
  const p = parsed.data;
  return {
    id: p.id ?? newId(),
    kind: p.kind,
    varietyName: p.varietyName,
    imageAssetId: p.imageAssetId ?? null,
    seasonMonths: [...new Set(p.seasonMonths)].sort((a, b) => a - b),
    pricePerStemMinor: p.pricePerStemMinor ?? null,
    pricePerBunchMinor: p.pricePerBunchMinor ?? null,
    colours: [...new Set(p.colours)],
    notes: p.notes ?? null,
  };
}

/** Every image must be a clean image owned by this business (Q9). */
async function assertImagesOwned(ctx: Ctx, businessId: string, items: CatalogueItemPayload[]): Promise<void> {
  const ids = [...new Set(items.map((i) => i.imageAssetId).filter((v): v is string => !!v))];
  if (ids.length === 0) return;
  const rows = await ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(and(inArray(assets.id, ids), eq(assets.ownerType, "business"), eq(assets.ownerId, businessId), eq(assets.kind, "image"), eq(assets.scanState, "clean"), isNull(assets.deletedAt)));
  if (rows.length !== ids.length) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { imageAssetId: ["catalogues.errors.imageNotYours"] } });
}

/** Validates a whole catalogue payload and returns it normalised. */
export async function validateCataloguePayload(ctx: Ctx, raw: unknown, opts: { businessId: string; mode: "draft" | "submit" }): Promise<CataloguePayload> {
  const shape = z.object({ name: zName, items: z.array(z.unknown()).max(MAX_ITEMS_PER_CATALOGUE, "catalogues.errors.tooManyItems") }).safeParse(raw);
  if (!shape.success) {
    const tooMany = shape.error.issues.some((i) => i.message === "catalogues.errors.tooManyItems");
    throw new AppError("VALIDATION", tooMany ? "catalogues.errors.tooManyItems" : "common.errors.VALIDATION", {
      fieldErrors: tooMany ? undefined : { name: ["common.validation.required"] },
      params: { max: MAX_ITEMS_PER_CATALOGUE },
    });
  }
  const items = shape.data.items.map(parseItem);
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new AppError("VALIDATION", "common.errors.VALIDATION");
  if (opts.mode === "submit" && items.length === 0) throw new AppError("VALIDATION", "catalogues.errors.empty");
  await assertImagesOwned(ctx, opts.businessId, items);
  return { name: shape.data.name, items };
}

/* ── Access ────────────────────────────────────────────────────────────── */

async function loadCatalogue(ctx: Ctx, catalogueId: string): Promise<{ catalogue: Catalogue; business: Business; role: "owner" | "admin" | "staff" }> {
  const id = zId.safeParse(catalogueId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [catalogue] = await ctx.db.select().from(flowerCatalogues).where(eq(flowerCatalogues.id, id.data));
  if (!catalogue) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const { business, role } = await requireBusinessMember(ctx, catalogue.businessId);
  return { catalogue, business, role };
}

function assertEditable(business: Business, catalogue: Catalogue): void {
  if (business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${business.status}`);
  if (catalogue.state === "retired") throw new AppError("CONFLICT", "catalogues.errors.retired");
}

/** The business's listings that may carry a catalogue: those in a florist or styling category. */
export async function listFloralListings(ctx: Ctx, businessId: string): Promise<Array<{ id: string; name: string; status: string }>> {
  await requireBusinessMember(ctx, businessId);
  const rows = await ctx.db.select().from(listings).where(and(eq(listings.businessId, businessId), ne(listings.status, "retired"))).orderBy(asc(listings.createdAt));
  if (rows.length === 0) return [];
  const floral = await ctx.db.select({ id: categories.id }).from(categories).where(inArray(categories.slug, [...FLORAL_CATEGORY_SLUGS]));
  const floralIds = new Set(floral.map((c) => c.id));
  const live = await ctx.db
    .select({ listingId: listingCategories.listingId, categoryId: listingCategories.categoryId })
    .from(listingCategories)
    .where(inArray(listingCategories.listingId, rows.map((r) => r.id)));
  return rows
    .filter((l) => live.some((c) => c.listingId === l.id && floralIds.has(c.categoryId)) || (l.draft?.categoryIds ?? []).some((c) => floralIds.has(c)))
    .map((l) => ({ id: l.id, name: l.name, status: l.status }));
}

/* ── The business's side ───────────────────────────────────────────────── */

async function livePayload(ctx: Pick<Ctx, "db">, catalogue: Catalogue): Promise<CataloguePayload | null> {
  if (!catalogue.liveRevisionId) return null;
  const rows = await ctx.db.select().from(catalogueItems).where(eq(catalogueItems.catalogueId, catalogue.id)).orderBy(asc(catalogueItems.sortOrder), asc(catalogueItems.createdAt));
  return {
    name: catalogue.name,
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      varietyName: r.varietyName,
      imageAssetId: r.imageAssetId,
      seasonMonths: r.seasonMonths,
      pricePerStemMinor: r.pricePerStemMinor,
      pricePerBunchMinor: r.pricePerBunchMinor,
      colours: r.colours,
      notes: r.notes,
    })),
  };
}

export type BusinessCatalogueRow = {
  catalogue: Catalogue;
  listingName: string;
  liveItems: number;
  /** An edit waits for a moderator (the live version stays up meanwhile). */
  pendingSince: Date | null;
  /** Unsent changes in the working copy. */
  hasDraft: boolean;
  lastRejectionReason: string | null;
};

export async function listBusinessCatalogues(ctx: Ctx, businessId: string): Promise<BusinessCatalogueRow[]> {
  await requireBusinessMember(ctx, businessId);
  const rows = await ctx.db
    .select({ catalogue: flowerCatalogues, listingName: listings.name })
    .from(flowerCatalogues)
    .innerJoin(listings, eq(listings.id, flowerCatalogues.listingId))
    .where(and(eq(flowerCatalogues.businessId, businessId), ne(flowerCatalogues.state, "retired")))
    .orderBy(asc(flowerCatalogues.createdAt));
  const out: BusinessCatalogueRow[] = [];
  for (const { catalogue, listingName } of rows) {
    const revs = await listRevisionsForSubject(ctx, { kind: CATALOGUE_KIND, subjectId: catalogue.id, limit: 3 });
    const pending = revs.find((r) => r.state === "pending") ?? null;
    const lastDecided = revs.find((r) => r.state === "approved" || r.state === "rejected") ?? null;
    const [n] = await ctx.db.select({ n: count() }).from(catalogueItems).where(eq(catalogueItems.catalogueId, catalogue.id));
    out.push({
      catalogue,
      listingName,
      liveItems: n?.n ?? 0,
      pendingSince: pending?.createdAt ?? null,
      hasDraft: catalogue.draft !== null,
      lastRejectionReason: !pending && lastDecided?.state === "rejected" ? lastDecided.decisionReason : null,
    });
  }
  return out;
}

export type CatalogueEditorItem = CatalogueItemPayload & { imageUrl: string | null };
export type CatalogueEditor = {
  catalogue: Catalogue;
  listingName: string;
  business: Business;
  role: "owner" | "admin" | "staff";
  /** What is public now (null = never approved). */
  live: CataloguePayload | null;
  pending: { revisionId: string; submittedAt: Date } | null;
  /** What the editor shows: the working copy, else what waits, else what is live. */
  working: { name: string; items: CatalogueEditorItem[] };
  /** The working copy differs from what was last sent or approved. */
  hasUnsentChanges: boolean;
  lastRejection: { reason: string | null; decidedAt: Date | null } | null;
  canEdit: boolean;
};

export async function getCatalogueEditor(ctx: Ctx, catalogueId: string): Promise<CatalogueEditor> {
  const { catalogue, business, role } = await loadCatalogue(ctx, catalogueId);
  const [l] = await ctx.db.select({ name: listings.name }).from(listings).where(eq(listings.id, catalogue.listingId));
  const revs = await listRevisionsForSubject(ctx, { kind: CATALOGUE_KIND, subjectId: catalogue.id, limit: 5 });
  const pendingRev = revs.find((r) => r.state === "pending") ?? null;
  const lastDecided = revs.find((r) => r.state === "approved" || r.state === "rejected") ?? null;
  const live = await livePayload(ctx, catalogue);
  const working = catalogue.draft ?? (pendingRev?.payload as CataloguePayload | undefined) ?? live ?? { name: catalogue.name, items: [] };
  const items: CatalogueEditorItem[] = [];
  for (const item of working.items) {
    // a member of the business may read its own files
    const imageUrl = item.imageAssetId ? await getAssetUrl(ctx, item.imageAssetId, { ttlSeconds: 3600 }).catch(() => null) : null;
    items.push({ ...item, imageUrl });
  }
  return {
    catalogue,
    listingName: l?.name ?? "",
    business,
    role,
    live,
    pending: pendingRev ? { revisionId: pendingRev.id, submittedAt: pendingRev.createdAt } : null,
    working: { name: working.name, items },
    hasUnsentChanges: catalogue.draft !== null,
    lastRejection: !pendingRev && lastDecided?.state === "rejected" ? { reason: lastDecided.decisionReason, decidedAt: lastDecided.decidedAt } : null,
    canEdit: business.status === "active" && catalogue.state !== "retired",
  };
}

/**
 * Starts a catalogue (a working copy; nothing public). The listing must belong to the
 * business and be in a florist or styling category. Refused while the business is lapsed,
 * restricted or suspended (assertBusinessCanCreate).
 */
export async function createCatalogue(ctx: Ctx, input: { businessId: string; listingId: string; name: string }): Promise<Catalogue> {
  requireWriteCapable(ctx);
  const data = z.object({ businessId: zId, listingId: zId, name: zName }).parse(input);
  await requireBusinessMember(ctx, data.businessId);
  await assertBusinessCanCreate(ctx, data.businessId);
  const floral = await listFloralListings(ctx, data.businessId);
  if (!floral.some((l) => l.id === data.listingId)) {
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { listingId: ["catalogues.errors.notFloral"] } });
  }
  return inTx(ctx, async (tx) => {
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${"catalogue.create:" + data.businessId}))`);
    const [n] = await tx.db.select({ n: count() }).from(flowerCatalogues).where(and(eq(flowerCatalogues.businessId, data.businessId), ne(flowerCatalogues.state, "retired")));
    if ((n?.n ?? 0) >= MAX_CATALOGUES_PER_BUSINESS) throw new AppError("LIMIT", "catalogues.errors.tooManyCatalogues", { params: { max: MAX_CATALOGUES_PER_BUSINESS } });
    const [row] = await tx.db
      .insert(flowerCatalogues)
      .values({ businessId: data.businessId, listingId: data.listingId, name: data.name, state: "draft", draft: { name: data.name, items: [] }, createdAt: tx.now })
      .returning();
    await audit(tx, { action: "catalogue.created", objectType: "catalogue", objectId: row!.id, meta: { businessId: data.businessId, listingId: data.listingId } });
    return row!;
  });
}

async function workingCopy(ctx: Ctx, catalogue: Catalogue): Promise<CataloguePayload> {
  if (catalogue.draft) return catalogue.draft;
  const [pending] = (await listRevisionsForSubject(ctx, { kind: CATALOGUE_KIND, subjectId: catalogue.id, limit: 3 })).filter((r) => r.state === "pending");
  return (pending?.payload as CataloguePayload | undefined) ?? (await livePayload(ctx, catalogue)) ?? { name: catalogue.name, items: [] };
}

async function saveWorking(ctx: Ctx, catalogue: Catalogue, payload: CataloguePayload): Promise<void> {
  await ctx.db
    .update(flowerCatalogues)
    .set({ draft: payload, ...(catalogue.liveRevisionId ? {} : { name: payload.name }) })
    .where(eq(flowerCatalogues.id, catalogue.id));
}

/** Renames the working copy. Nothing public changes until it is approved. */
export async function renameCatalogue(ctx: Ctx, input: { catalogueId: string; name: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { catalogue, business } = await loadCatalogue(ctx, input.catalogueId);
  assertEditable(business, catalogue);
  const name = zName.parse(input.name);
  const working = await workingCopy(ctx, catalogue);
  await saveWorking(ctx, catalogue, { ...working, name });
}

/** Adds a variety to the working copy, or changes one (by `item.id`). Nothing public changes. */
export async function saveCatalogueItem(ctx: Ctx, input: { catalogueId: string; item: CatalogueItemInput }): Promise<{ itemId: string }> {
  requireWriteCapable(ctx);
  const { catalogue, business } = await loadCatalogue(ctx, input.catalogueId);
  assertEditable(business, catalogue);
  const item = parseItem(input.item);
  await assertImagesOwned(ctx, business.id, [item]);
  const working = await workingCopy(ctx, catalogue);
  const at = working.items.findIndex((i) => i.id === item.id);
  if (input.item.id && at < 0) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (at < 0 && working.items.length >= MAX_ITEMS_PER_CATALOGUE) throw new AppError("LIMIT", "catalogues.errors.tooManyItems", { params: { max: MAX_ITEMS_PER_CATALOGUE } });
  const items = at < 0 ? [...working.items, item] : working.items.map((i, n) => (n === at ? item : i));
  await saveWorking(ctx, catalogue, { ...working, items });
  return { itemId: item.id };
}

export async function removeCatalogueItem(ctx: Ctx, input: { catalogueId: string; itemId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { catalogue, business } = await loadCatalogue(ctx, input.catalogueId);
  assertEditable(business, catalogue);
  const working = await workingCopy(ctx, catalogue);
  await saveWorking(ctx, catalogue, { ...working, items: working.items.filter((i) => i.id !== input.itemId) });
}

/** Throws away unsent changes: the working copy goes back to what waits or is live. */
export async function discardCatalogueDraft(ctx: Ctx, input: { catalogueId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { catalogue } = await loadCatalogue(ctx, input.catalogueId);
  if (catalogue.state === "draft") return; // a never-submitted catalogue IS its draft
  await ctx.db.update(flowerCatalogues).set({ draft: null }).where(eq(flowerCatalogues.id, catalogue.id));
}

/**
 * "Trimite spre verificare" (F1): queues the working copy (or `payload`) for a moderator. A
 * catalogue that was never live becomes "pending"; a live one STAYS live, unchanged, until
 * the revision is approved.
 */
export async function submitCatalogue(ctx: Ctx, input: { catalogueId: string; payload?: unknown }): Promise<{ revisionId: string }> {
  requireWriteCapable(ctx);
  const { catalogue, business } = await loadCatalogue(ctx, input.catalogueId);
  assertEditable(business, catalogue);
  const source = input.payload ?? catalogue.draft;
  if (!source) throw new AppError("VALIDATION", "catalogues.errors.nothingToSubmit");
  const payload = await validateCataloguePayload(ctx, source, { businessId: business.id, mode: "submit" });
  const live = await livePayload(ctx, catalogue);
  return inTx(ctx, async (tx) => {
    const revision = await submitForModeration(tx, {
      kind: CATALOGUE_KIND,
      subjectId: catalogue.id,
      listingId: catalogue.listingId,
      businessId: business.id,
      payload,
      basePayload: live ?? undefined,
    });
    await tx.db
      .update(flowerCatalogues)
      .set({ draft: null, ...(catalogue.state === "draft" ? { state: "pending" as const } : {}), ...(catalogue.liveRevisionId ? {} : { name: payload.name }) })
      .where(eq(flowerCatalogues.id, catalogue.id));
    return { revisionId: revision.id };
  });
}

/** Withdraws the catalogue for good (owner or admin). Plans that already use its items keep their own copies. */
export async function retireCatalogue(ctx: Ctx, input: { catalogueId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { catalogue, role } = await loadCatalogue(ctx, input.catalogueId);
  if (role === "staff") throw new AppError("FORBIDDEN", "business.errors.roleRequired");
  if (catalogue.state === "retired") return;
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(listingRevisions)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(listingRevisions.kind, CATALOGUE_KIND), eq(listingRevisions.subjectId, catalogue.id), eq(listingRevisions.state, "pending")));
    await tx.db.update(flowerCatalogues).set({ state: "retired", draft: null }).where(eq(flowerCatalogues.id, catalogue.id));
    await audit(tx, { action: "catalogue.retired", objectType: "catalogue", objectId: catalogue.id, before: { state: catalogue.state }, after: { state: "retired" } });
  });
}

/* ── Public reads (F2) ─────────────────────────────────────────────────── */

export type PublicCatalogueItem = {
  id: string;
  catalogueId: string;
  businessId: string;
  listingId: string;
  kind: CatalogueItemKind;
  varietyName: string;
  /** Short-lived signed link, made on the server. Never stored. */
  imageUrl: string | null;
  /** 1–12; empty = unknown. */
  seasonMonths: number[];
  /** Indicative, minor units; null = unknown (never 0). */
  pricePerStemMinor: number | null;
  pricePerBunchMinor: number | null;
  currency: string;
  colours: CatalogueColour[];
  notes: string | null;
};
export type PublicCatalogue = { id: string; name: string; listingId: string; businessId: string; listingName: string; items: PublicCatalogueItem[] };

// public = the catalogue is live, its listing is live and its business is not suspended
const publicWhere = and(eq(flowerCatalogues.state, "live"), eq(listings.status, "live"), sql`${businesses.status} <> 'suspended'`);

async function toPublicItem(ctx: Pick<Ctx, "db" | "now">, row: CatalogueItem, listingId: string): Promise<PublicCatalogueItem> {
  let imageUrl: string | null = null;
  if (row.imageAssetId) {
    // the item is public (checked by the caller); the link itself is signed as the system
    imageUrl = await getAssetUrl({ db: ctx.db, now: ctx.now, actor: { kind: "system" }, locale: "ro" }, row.imageAssetId, { ttlSeconds: 3600 }).catch(() => null);
  }
  return {
    id: row.id,
    catalogueId: row.catalogueId,
    businessId: row.businessId,
    listingId,
    kind: row.kind,
    varietyName: row.varietyName,
    imageUrl,
    seasonMonths: row.seasonMonths,
    pricePerStemMinor: row.pricePerStemMinor,
    pricePerBunchMinor: row.pricePerBunchMinor,
    currency: row.currency,
    colours: row.colours,
    notes: row.notes,
  };
}

/**
 * FOR THE LISTING PAGE AND THE ARRANGEMENT DESIGNER (F2, F3). Approved catalogues with their
 * items — of one listing, of one business, or all; `q` filters varieties by name. Anyone may
 * read: this is published content.
 */
export async function listPublicCatalogues(
  ctx: Pick<Ctx, "db" | "now">,
  input: { listingId?: string; businessId?: string; q?: string } = {},
): Promise<PublicCatalogue[]> {
  const data = z.object({ listingId: zId.optional(), businessId: zId.optional(), q: z.string().trim().max(80).optional() }).parse(input);
  const cats = await ctx.db
    .select({ c: flowerCatalogues, listingName: listings.name })
    .from(flowerCatalogues)
    .innerJoin(listings, eq(listings.id, flowerCatalogues.listingId))
    .innerJoin(businesses, eq(businesses.id, flowerCatalogues.businessId))
    .where(and(publicWhere, data.listingId ? eq(flowerCatalogues.listingId, data.listingId) : undefined, data.businessId ? eq(flowerCatalogues.businessId, data.businessId) : undefined))
    .orderBy(asc(flowerCatalogues.publishedAt), asc(flowerCatalogues.id))
    .limit(100);
  if (cats.length === 0) return [];
  const q = data.q ? `%${data.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const rows = await ctx.db
    .select()
    .from(catalogueItems)
    .where(and(inArray(catalogueItems.catalogueId, cats.map((c) => c.c.id)), q ? sql`${catalogueItems.varietyName} ilike ${q}` : undefined))
    .orderBy(asc(catalogueItems.sortOrder), asc(catalogueItems.createdAt));
  const out: PublicCatalogue[] = [];
  for (const { c, listingName } of cats) {
    const items: PublicCatalogueItem[] = [];
    for (const r of rows.filter((r) => r.catalogueId === c.id)) items.push(await toPublicItem(ctx, r, c.listingId));
    if (q && items.length === 0) continue;
    out.push({ id: c.id, name: c.name, listingId: c.listingId, businessId: c.businessId, listingName, items });
  }
  return out;
}

/** FOR THE DESIGNER: one published variety by id, or null when it is not (or no longer) public. */
export async function getCatalogueItem(ctx: Pick<Ctx, "db" | "now">, id: string): Promise<PublicCatalogueItem | null> {
  if (!zId.safeParse(id).success) return null;
  const [row] = await ctx.db
    .select({ item: catalogueItems, listingId: flowerCatalogues.listingId })
    .from(catalogueItems)
    .innerJoin(flowerCatalogues, eq(flowerCatalogues.id, catalogueItems.catalogueId))
    .innerJoin(listings, eq(listings.id, flowerCatalogues.listingId))
    .innerJoin(businesses, eq(businesses.id, flowerCatalogues.businessId))
    .where(and(eq(catalogueItems.id, id), publicWhere));
  return row ? toPublicItem(ctx, row.item, row.listingId) : null;
}

/* ── Moderation kind "catalogue" ───────────────────────────────────────── */

function itemLine(i: CatalogueItemPayload): string {
  const price = (minor: number | null, unit: string) => (minor === null ? `${unit}: ?` : `${unit}: ${(minor / 100).toFixed(2)} RON`);
  return [
    i.kind,
    price(i.pricePerStemMinor, "fir"),
    price(i.pricePerBunchMinor, "buchet"),
    i.colours.length ? i.colours.join("/") : "culori: ?",
    i.seasonMonths.length ? `sezon ${i.seasonMonths.join(",")}` : "sezon: ?",
    i.notes ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Before → after rows of a catalogue revision: the name, then one row per variety that changed. */
export function describeCatalogueChange(after: CataloguePayload, before: CataloguePayload | null): ModerationField[] {
  const fields: ModerationField[] = [
    { key: "name", labelKey: "catalogues.fields.name", before: before?.name ?? null, after: after.name },
    { key: "count", labelKey: "catalogues.fields.itemCount", before: before ? String(before.items.length) : null, after: String(after.items.length) },
  ];
  const beforeById = new Map((before?.items ?? []).map((i) => [i.id, i]));
  for (const item of after.items) {
    const was = beforeById.get(item.id);
    const a = `${item.varietyName} — ${itemLine(item)}`;
    const b = was ? `${was.varietyName} — ${itemLine(was)}` : null;
    if (a !== b || item.imageAssetId !== was?.imageAssetId) fields.push({ key: `item.${item.id}`, labelKey: "catalogues.fields.item", before: b, after: a });
    beforeById.delete(item.id);
  }
  for (const gone of beforeById.values()) fields.push({ key: `item.${gone.id}`, labelKey: "catalogues.fields.item", before: `${gone.varietyName} — ${itemLine(gone)}`, after: null });
  return fields;
}

/** Approval: the payload becomes the live catalogue. Item ids are kept. */
async function applyCatalogueRevision(tx: Ctx, revision: ModerationRevision): Promise<void> {
  const [catalogue] = await tx.db.select().from(flowerCatalogues).where(eq(flowerCatalogues.id, revision.subjectId)).for("update");
  if (!catalogue) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (catalogue.state === "retired") throw new AppError("CONFLICT", "catalogues.errors.retired");
  const payload = await validateCataloguePayload(tx, revision.payload, { businessId: catalogue.businessId, mode: "submit" });
  const keep = payload.items.map((i) => i.id);
  await tx.db.delete(catalogueItems).where(and(eq(catalogueItems.catalogueId, catalogue.id), keep.length ? notInArray(catalogueItems.id, keep) : undefined));
  let n = 0;
  for (const item of payload.items) {
    const values = {
      kind: item.kind,
      varietyName: item.varietyName,
      imageAssetId: item.imageAssetId,
      seasonMonths: item.seasonMonths,
      pricePerStemMinor: item.pricePerStemMinor,
      pricePerBunchMinor: item.pricePerBunchMinor,
      colours: item.colours,
      notes: item.notes,
      sortOrder: n++,
    };
    await tx.db
      .insert(catalogueItems)
      .values({ id: item.id, catalogueId: catalogue.id, businessId: catalogue.businessId, createdAt: tx.now, ...values })
      .onConflictDoUpdate({ target: catalogueItems.id, set: values, setWhere: eq(catalogueItems.catalogueId, catalogue.id) });
  }
  await tx.db
    .update(flowerCatalogues)
    .set({ name: payload.name, state: "live", liveRevisionId: revision.id, publishedAt: catalogue.publishedAt ?? tx.now })
    .where(eq(flowerCatalogues.id, catalogue.id));
}

/** Rejection or withdrawal: the content returns to the working copy; the live version is untouched. */
async function returnToDraft(tx: Ctx, revision: ModerationRevision): Promise<void> {
  const [catalogue] = await tx.db.select().from(flowerCatalogues).where(eq(flowerCatalogues.id, revision.subjectId)).for("update");
  if (!catalogue || catalogue.state === "retired") return;
  await tx.db
    .update(flowerCatalogues)
    .set({ draft: catalogue.draft ?? (revision.payload as CataloguePayload), ...(catalogue.state === "pending" ? { state: "draft" as const } : {}) })
    .where(eq(flowerCatalogues.id, catalogue.id));
}

function registerRules(): void {
  registerModerationKind(CATALOGUE_KIND, {
    labelKey: "catalogues.moderation.kind",
    describe: async (_ctx, revision) => {
      const after = revision.payload as CataloguePayload;
      const before = (revision.basePayload as CataloguePayload | null) ?? null;
      const beforeImages = new Set((before?.items ?? []).map((i) => i.imageAssetId));
      return {
        title: after.name,
        fields: describeCatalogueChange(after, before),
        // only the pictures that are new in this revision
        imageAssetIds: after.items.map((i) => i.imageAssetId).filter((v): v is string => !!v && !beforeImages.has(v)).slice(0, 60),
      };
    },
    apply: applyCatalogueRevision,
    onRejected: returnToDraft,
    onWithdrawn: returnToDraft,
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker. */
export function registerJobs(): void {
  registerRules();
}
