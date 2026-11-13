import {
  and,
  asc,
  categories,
  counties,
  eq,
  inArray,
  listingCategories,
  listingLocalities,
  localities,
  localityKindSchema,
  sql,
  type LocalityKind,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { audit } from "./audit";
import type { Ctx, Locale } from "./context";
import { requireStaffRole } from "./staff";
import { inTx } from "./tx";

// Directory picklists (P2, PRD §8 definitions) and their console management (W4).
//
// READS are public: categories and geography are reference data shown on public pages and in
// every form. WRITES are staff-only (listing_moderator or platform_admin) and audited.
// Nothing here accepts free-text geography: a listing can only point at rows of these tables.

export const DIRECTORY_ADMIN_ROLES = ["listing_moderator", "platform_admin"] as const;

export type CategoryView = {
  id: string;
  slug: string;
  /** In the request language. */
  name: string;
  nameRo: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
  published: boolean;
};
export type CountyView = {
  code: string;
  slug: string;
  name: string;
  nameRo: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
  launchArea: boolean;
  published: boolean;
};
export type LocalityView = {
  id: string;
  countyCode: string;
  slug: string;
  name: string;
  nameRo: string;
  nameEn: string | null;
  kind: LocalityKind;
  countySeat: boolean;
  publicPage: boolean;
  active: boolean;
  sortOrder: number;
};

/** The name to show in `locale` (English falls back to Romanian). */
export function localName(row: { nameRo: string; nameEn?: string | null }, locale: Locale): string {
  return locale === "en" && row.nameEn ? row.nameEn : row.nameRo;
}

/** "Câmpia Turzii" → "campia-turzii". */
export function slugify(name: string): string {
  return name
    .replace(/[șş]/gi, "s")
    .replace(/[țţ]/gi, "t")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const toCategory = (ctx: Pick<Ctx, "locale">, r: typeof categories.$inferSelect): CategoryView => ({
  id: r.id,
  slug: r.slug,
  name: localName(r, ctx.locale),
  nameRo: r.nameRo,
  nameEn: r.nameEn,
  sortOrder: r.sortOrder,
  active: r.active,
  published: r.published,
});
const toCounty = (ctx: Pick<Ctx, "locale">, r: typeof counties.$inferSelect): CountyView => ({
  code: r.code,
  slug: r.slug,
  name: localName(r, ctx.locale),
  nameRo: r.nameRo,
  nameEn: r.nameEn,
  sortOrder: r.sortOrder,
  active: r.active,
  launchArea: r.launchArea,
  published: r.published,
});
const toLocality = (ctx: Pick<Ctx, "locale">, r: typeof localities.$inferSelect): LocalityView => ({
  id: r.id,
  countyCode: r.countyCode,
  slug: r.slug,
  name: localName(r, ctx.locale),
  nameRo: r.nameRo,
  nameEn: r.nameEn,
  kind: r.kind,
  countySeat: r.countySeat,
  publicPage: r.publicPage,
  active: r.active,
  sortOrder: r.sortOrder,
});

/* ── Lookups for forms and pages (public reference data) ───────────────── */

export async function listCategories(ctx: Ctx, opts: { includeInactive?: boolean } = {}): Promise<CategoryView[]> {
  const rows = await ctx.db
    .select()
    .from(categories)
    .where(opts.includeInactive ? undefined : eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.nameRo));
  return rows.map((r) => toCategory(ctx, r));
}

export async function listCounties(ctx: Ctx, opts: { includeInactive?: boolean } = {}): Promise<CountyView[]> {
  const rows = await ctx.db
    .select()
    .from(counties)
    .where(opts.includeInactive ? undefined : eq(counties.active, true))
    .orderBy(asc(counties.sortOrder), asc(counties.nameRo));
  return rows.map((r) => toCounty(ctx, r));
}

export async function listLocalities(
  ctx: Ctx,
  opts: { countyCode?: string; countyCodes?: string[]; includeInactive?: boolean } = {},
): Promise<LocalityView[]> {
  const codes = opts.countyCodes ?? (opts.countyCode ? [opts.countyCode] : null);
  if (codes && codes.length === 0) return [];
  const rows = await ctx.db
    .select()
    .from(localities)
    .where(and(codes ? inArray(localities.countyCode, codes) : undefined, opts.includeInactive ? undefined : eq(localities.active, true)))
    .orderBy(asc(localities.countyCode), asc(localities.sortOrder), asc(localities.nameRo));
  return rows.map((r) => toLocality(ctx, r));
}

export type Picklists = { categories: CategoryView[]; counties: CountyView[]; localities: LocalityView[] };

/** Everything a listing form or the search form needs, active entries only. */
export async function getPicklists(ctx: Ctx): Promise<Picklists> {
  const [c, co, l] = await Promise.all([listCategories(ctx), listCounties(ctx), listLocalities(ctx)]);
  return { categories: c, counties: co, localities: l };
}

export async function getCategoryBySlug(ctx: Ctx, slug: string): Promise<CategoryView | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [row] = await ctx.db.select().from(categories).where(eq(categories.slug, slug));
  return row ? toCategory(ctx, row) : null;
}

/** By slug ("cluj") or by code ("CJ", any case). */
export async function getCounty(ctx: Ctx, slugOrCode: string): Promise<CountyView | null> {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(slugOrCode)) return null;
  const [bySlug] = await ctx.db.select().from(counties).where(eq(counties.slug, slugOrCode.toLowerCase()));
  if (bySlug) return toCounty(ctx, bySlug);
  const [byCode] = await ctx.db.select().from(counties).where(eq(counties.code, slugOrCode.toUpperCase()));
  return byCode ? toCounty(ctx, byCode) : null;
}

export async function getLocalityBySlug(ctx: Ctx, countyCode: string, slug: string): Promise<LocalityView | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [row] = await ctx.db
    .select()
    .from(localities)
    .where(and(eq(localities.countyCode, countyCode), eq(localities.slug, slug)));
  return row ? toLocality(ctx, row) : null;
}

/* ── Console management (W4) ───────────────────────────────────────────── */

const zName = z.string().trim().min(2, "common.validation.required").max(80, "common.validation.tooLong");
const zOptName = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), zName.optional());

async function freeSlug(ctx: Ctx, base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "x";
  let slug = root;
  for (let i = 2; await taken(slug); i++) slug = `${root}-${i}`;
  return slug;
}

export const createCategoryInput = z.object({ nameRo: zName, nameEn: zName });

export async function createCategory(ctx: Ctx, input: z.input<typeof createCategoryInput>): Promise<CategoryView> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const data = createCategoryInput.parse(input);
  return inTx(ctx, async (tx) => {
    const slug = await freeSlug(tx, data.nameRo, async (s) => (await tx.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, s))).length > 0);
    const [last] = await tx.db.select({ m: sql<number>`coalesce(max(${categories.sortOrder}), 0)` }).from(categories);
    const [row] = await tx.db
      .insert(categories)
      .values({ slug, nameRo: data.nameRo, nameEn: data.nameEn, sortOrder: Number(last?.m ?? 0) + 10 })
      .returning();
    await audit(tx, { action: "directory.category.created", objectType: "category", objectId: row!.id, after: { slug, nameRo: data.nameRo, nameEn: data.nameEn } });
    return toCategory(tx, row!);
  });
}

export const updateCategoryInput = z.object({
  id: zId,
  nameRo: zName.optional(),
  nameEn: zName.optional(),
  /** false = retire (no longer offered); true = bring back. */
  active: z.boolean().optional(),
  /** Publish / unpublish the category's public directory pages. */
  published: z.boolean().optional(),
});

export async function updateCategory(ctx: Ctx, input: z.input<typeof updateCategoryInput>): Promise<CategoryView> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const { id, ...patch } = updateCategoryInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db.select().from(categories).where(eq(categories.id, id)).for("update");
    if (!before) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [row] = await tx.db.update(categories).set(patch).where(eq(categories.id, id)).returning();
    await audit(tx, {
      action: "directory.category.updated",
      objectType: "category",
      objectId: id,
      before: { nameRo: before.nameRo, nameEn: before.nameEn, active: before.active, published: before.published },
      after: { nameRo: row!.nameRo, nameEn: row!.nameEn, active: row!.active, published: row!.published },
    });
    return toCategory(tx, row!);
  });
}

/** Moves one category up or down by swapping its sort position with its neighbour. */
export async function moveCategory(ctx: Ctx, input: { id: string; direction: "up" | "down" }): Promise<void> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const data = z.object({ id: zId, direction: z.enum(["up", "down"]) }).parse(input);
  await inTx(ctx, async (tx) => {
    const rows = await tx.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.nameRo)).for("update");
    const i = rows.findIndex((r) => r.id === data.id);
    if (i < 0) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const j = data.direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    const order = rows.map((r) => r.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (const [k, cid] of order.entries()) {
      await tx.db.update(categories).set({ sortOrder: (k + 1) * 10 }).where(eq(categories.id, cid));
    }
    await audit(tx, { action: "directory.category.reordered", objectType: "category", objectId: data.id, meta: { direction: data.direction } });
  });
}

/**
 * Merges category `fromId` into `intoId`: every live listing in the old category is in the
 * new one afterwards (no listing loses a category), and the old one is retired.
 */
export async function mergeCategory(ctx: Ctx, input: { fromId: string; intoId: string }): Promise<void> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const data = z.object({ fromId: zId, intoId: zId }).parse(input);
  if (data.fromId === data.intoId) throw new AppError("VALIDATION", "moderation.errors.mergeSame", { fieldErrors: { intoId: ["moderation.errors.mergeSame"] } });
  await inTx(ctx, async (tx) => {
    const rows = await tx.db.select().from(categories).where(inArray(categories.id, [data.fromId, data.intoId])).for("update");
    const from = rows.find((r) => r.id === data.fromId);
    const into = rows.find((r) => r.id === data.intoId);
    if (!from || !into) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (!into.active) throw new AppError("CONFLICT", "moderation.errors.mergeIntoRetired");
    await tx.db.execute(sql`
      insert into listing_categories (listing_id, category_id)
      select listing_id, ${data.intoId} from listing_categories where category_id = ${data.fromId}
      on conflict do nothing`);
    const moved = await tx.db.delete(listingCategories).where(eq(listingCategories.categoryId, data.fromId)).returning({ id: listingCategories.listingId });
    await tx.db.update(categories).set({ active: false, published: false, mergedIntoId: data.intoId }).where(eq(categories.id, data.fromId));
    await audit(tx, {
      action: "directory.category.merged",
      objectType: "category",
      objectId: data.fromId,
      after: { mergedIntoId: data.intoId },
      meta: { listingsMoved: moved.length },
    });
  });
}

export const createCountyInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/, "common.validation.invalid"),
  nameRo: zName,
  nameEn: zOptName,
});

export async function createCounty(ctx: Ctx, input: z.input<typeof createCountyInput>): Promise<CountyView> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const data = createCountyInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [dup] = await tx.db.select({ code: counties.code }).from(counties).where(eq(counties.code, data.code));
    if (dup) throw new AppError("TAKEN", "moderation.errors.codeTaken", { fieldErrors: { code: ["moderation.errors.codeTaken"] } });
    const slug = await freeSlug(tx, data.nameRo, async (s) => (await tx.db.select({ c: counties.code }).from(counties).where(eq(counties.slug, s))).length > 0);
    const [last] = await tx.db.select({ m: sql<number>`coalesce(max(${counties.sortOrder}), 0)` }).from(counties);
    const [row] = await tx.db
      .insert(counties)
      .values({ code: data.code, slug, nameRo: data.nameRo, nameEn: data.nameEn ?? data.nameRo, sortOrder: Number(last?.m ?? 0) + 10 })
      .returning();
    await audit(tx, { action: "directory.county.created", objectType: "county", objectId: data.code, after: { nameRo: data.nameRo } });
    return toCounty(tx, row!);
  });
}

export const updateCountyInput = z.object({
  code: z.string().min(1).max(3),
  nameRo: zName.optional(),
  nameEn: zName.optional(),
  active: z.boolean().optional(),
  launchArea: z.boolean().optional(),
  published: z.boolean().optional(),
});

export async function updateCounty(ctx: Ctx, input: z.input<typeof updateCountyInput>): Promise<CountyView> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const { code, ...patch } = updateCountyInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db.select().from(counties).where(eq(counties.code, code)).for("update");
    if (!before) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [row] = await tx.db.update(counties).set(patch).where(eq(counties.code, code)).returning();
    await audit(tx, {
      action: "directory.county.updated",
      objectType: "county",
      objectId: code,
      before: { nameRo: before.nameRo, nameEn: before.nameEn, active: before.active, launchArea: before.launchArea, published: before.published },
      after: { nameRo: row!.nameRo, nameEn: row!.nameEn, active: row!.active, launchArea: row!.launchArea, published: row!.published },
    });
    return toCounty(tx, row!);
  });
}

/**
 * Merges county `fromCode` into `intoCode`: its localities move to the target county (a
 * locality whose slug already exists there is merged into that one), listings stay attached,
 * and the old county is retired.
 */
export async function mergeCounty(ctx: Ctx, input: { fromCode: string; intoCode: string }): Promise<void> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const data = z.object({ fromCode: z.string().min(1).max(3), intoCode: z.string().min(1).max(3) }).parse(input);
  if (data.fromCode === data.intoCode) throw new AppError("VALIDATION", "moderation.errors.mergeSame", { fieldErrors: { intoCode: ["moderation.errors.mergeSame"] } });
  await inTx(ctx, async (tx) => {
    const rows = await tx.db.select().from(counties).where(inArray(counties.code, [data.fromCode, data.intoCode])).for("update");
    const into = rows.find((r) => r.code === data.intoCode);
    if (rows.length !== 2 || !into) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (!into.active) throw new AppError("CONFLICT", "moderation.errors.mergeIntoRetired");
    const moving = await tx.db.select().from(localities).where(eq(localities.countyCode, data.fromCode));
    const target = await tx.db.select().from(localities).where(eq(localities.countyCode, data.intoCode));
    const bySlug = new Map(target.map((l) => [l.slug, l]));
    for (const loc of moving) {
      const twin = bySlug.get(loc.slug);
      if (twin) {
        await moveLocalityListings(tx, loc.id, twin.id, data.intoCode);
        await tx.db.update(localities).set({ active: false, publicPage: false, mergedIntoId: twin.id }).where(eq(localities.id, loc.id));
      } else {
        await tx.db.update(localities).set({ countyCode: data.intoCode }).where(eq(localities.id, loc.id));
        await tx.db.update(listingLocalities).set({ countyCode: data.intoCode }).where(eq(listingLocalities.localityId, loc.id));
      }
    }
    await tx.db.update(counties).set({ active: false, published: false, launchArea: false, mergedIntoCode: data.intoCode }).where(eq(counties.code, data.fromCode));
    await audit(tx, {
      action: "directory.county.merged",
      objectType: "county",
      objectId: data.fromCode,
      after: { mergedIntoCode: data.intoCode },
      meta: { localitiesMoved: moving.length },
    });
  });
}

export const createLocalityInput = z.object({
  countyCode: z.string().min(1).max(3),
  nameRo: zName,
  nameEn: zOptName,
  kind: localityKindSchema.default("oras"),
});

export async function createLocality(ctx: Ctx, input: z.input<typeof createLocalityInput>): Promise<LocalityView> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const data = createLocalityInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [county] = await tx.db.select().from(counties).where(eq(counties.code, data.countyCode));
    if (!county) throw new AppError("VALIDATION", "listings.errors.unknownCounty", { fieldErrors: { countyCode: ["listings.errors.unknownCounty"] } });
    const slug = slugify(data.nameRo);
    const [dup] = await tx.db.select({ id: localities.id }).from(localities).where(and(eq(localities.countyCode, data.countyCode), eq(localities.slug, slug)));
    if (dup || !slug) throw new AppError("TAKEN", "moderation.errors.localityExists", { fieldErrors: { nameRo: ["moderation.errors.localityExists"] } });
    const [last] = await tx.db
      .select({ m: sql<number>`coalesce(max(${localities.sortOrder}), 0)` })
      .from(localities)
      .where(eq(localities.countyCode, data.countyCode));
    const [row] = await tx.db
      .insert(localities)
      .values({ countyCode: data.countyCode, slug, nameRo: data.nameRo, nameEn: data.nameEn ?? null, kind: data.kind, sortOrder: Number(last?.m ?? 0) + 10 })
      .returning();
    await audit(tx, { action: "directory.locality.created", objectType: "locality", objectId: row!.id, after: { countyCode: data.countyCode, nameRo: data.nameRo, kind: data.kind } });
    return toLocality(tx, row!);
  });
}

export const updateLocalityInput = z.object({
  id: zId,
  nameRo: zName.optional(),
  nameEn: zName.nullable().optional(),
  active: z.boolean().optional(),
  /** P6: whether this locality gets its own public directory page. */
  publicPage: z.boolean().optional(),
});

export async function updateLocality(ctx: Ctx, input: z.input<typeof updateLocalityInput>): Promise<LocalityView> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const { id, ...patch } = updateLocalityInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db.select().from(localities).where(eq(localities.id, id)).for("update");
    if (!before) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const set = { ...patch, ...(patch.active === false ? { publicPage: false } : {}) };
    const [row] = await tx.db.update(localities).set(set).where(eq(localities.id, id)).returning();
    await audit(tx, {
      action: "directory.locality.updated",
      objectType: "locality",
      objectId: id,
      before: { nameRo: before.nameRo, nameEn: before.nameEn, active: before.active, publicPage: before.publicPage },
      after: { nameRo: row!.nameRo, nameEn: row!.nameEn, active: row!.active, publicPage: row!.publicPage },
    });
    return toLocality(tx, row!);
  });
}

/** Re-points every live listing from one locality to another without losing or doubling a row. */
async function moveLocalityListings(tx: Ctx, fromId: string, intoId: string, intoCounty: string): Promise<number> {
  await tx.db.execute(sql`
    insert into listing_localities (listing_id, locality_id, county_code)
    select listing_id, ${intoId}, ${intoCounty} from listing_localities where locality_id = ${fromId}
    on conflict do nothing`);
  const moved = await tx.db.delete(listingLocalities).where(eq(listingLocalities.localityId, fromId)).returning({ id: listingLocalities.listingId });
  return moved.length;
}

/**
 * Merges locality `fromId` into `intoId` (W4). Listings that served the old locality serve
 * the new one afterwards; the old one is retired and remembers where it went, so drafts and
 * waiting revisions that still name it are resolved to the new one (resolveMergedIds).
 */
export async function mergeLocality(ctx: Ctx, input: { fromId: string; intoId: string }): Promise<{ listingsMoved: number }> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const data = z.object({ fromId: zId, intoId: zId }).parse(input);
  if (data.fromId === data.intoId) throw new AppError("VALIDATION", "moderation.errors.mergeSame", { fieldErrors: { intoId: ["moderation.errors.mergeSame"] } });
  return inTx(ctx, async (tx) => {
    const rows = await tx.db.select().from(localities).where(inArray(localities.id, [data.fromId, data.intoId])).for("update");
    const from = rows.find((r) => r.id === data.fromId);
    const into = rows.find((r) => r.id === data.intoId);
    if (!from || !into) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (!into.active) throw new AppError("CONFLICT", "moderation.errors.mergeIntoRetired");
    const listingsMoved = await moveLocalityListings(tx, from.id, into.id, into.countyCode);
    await tx.db.update(localities).set({ active: false, publicPage: false, mergedIntoId: into.id }).where(eq(localities.id, from.id));
    await audit(tx, {
      action: "directory.locality.merged",
      objectType: "locality",
      objectId: from.id,
      after: { mergedIntoId: into.id },
      meta: { listingsMoved },
    });
    return { listingsMoved };
  });
}

/**
 * Follows W4 merges: maps each id to the row it was merged into (if any). Used when a draft
 * or a waiting revision still names a category or locality that has been merged since.
 */
export async function resolveMergedIds(ctx: Ctx, kind: "category" | "locality", ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const start of ids) {
    let current = start;
    for (let hop = 0; hop < 5; hop++) {
      const [row] =
        kind === "category"
          ? await ctx.db.select({ next: categories.mergedIntoId }).from(categories).where(eq(categories.id, current))
          : await ctx.db.select({ next: localities.mergedIntoId }).from(localities).where(eq(localities.id, current));
      if (!row?.next) break;
      current = row.next;
    }
    if (!out.includes(current)) out.push(current);
  }
  return out;
}
