import { randomInt } from "node:crypto";
import { and, categories, counties, eq, featuredSlots, isNull, listingCategories, listingLocalities, listings, or, sql } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { addDays, bucharestDateKey } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { audit } from "./audit";
import { type Ctx } from "./context";
import { MAX_FEATURED, setFeaturedProvider } from "./directory";
import { localName } from "./geography";
import { requireListingMember } from "./listings";
import { assertMonetizationOn, isMonetizationOn, MONETIZATION_ROLES } from "./monetization";
import { requireStaffRole } from "./staff";
import { readDailyStats } from "./stats";

// Featured placement (P13–P16). INACTIVE while monetization is OFF (MON5).
//
//   The provider registered below is the ONLY source of Featured cards, and its only
//   consumer is getDirectoryResults (@ed/core/directory), which labels every card
//   `featured: true` / "Promovat — plasare plătită" (P14).
//
//   P13  up to three, picked at random on every request from live slots matching the search.
//   P15  getFeaturedPreview: expected share min(1, 3 ÷ (n + 1)) and the last 30 days of
//        searches — stated without any guarantee of views.
//   P16  Featured is a directory POSITION and nothing else: this module has no export that a
//        plan, a guest page, an email, an export or an offline pack could call to learn that
//        a listing is Featured; there is no "is featured" flag on a listing or a business.
//
// Invariant 7: organicOrder() never sees this table. getDirectoryResults computes `organic`
// first and identically with or without Featured (test: featured.test.ts).

export type FeaturedSlot = typeof featuredSlots.$inferSelect;

const liveSlot = (now: Date) => sql`${featuredSlots.active} and ${featuredSlots.startsAt} <= ${now} and (${featuredSlots.endsAt} is null or ${featuredSlots.endsAt} > ${now})`;
const publiclyVisible = sql`${listings.status} = 'live' and (${listings.businessId} is null or exists (select 1 from businesses b where b.id = ${listings.businessId} and b.status <> 'suspended'))`;

/** Unbiased shuffle with the OS random source: a new draw on every request (P13). */
export function pickRandom<T>(items: readonly T[], count: number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, count);
}

/** Listing ids with a live slot matching the search. Pure read. [] while monetization is off. */
export async function featuredForSearch(ctx: Ctx, search: { categoryId: string; countyCode: string; localityId?: string }): Promise<string[]> {
  if (!(await isMonetizationOn(ctx))) return []; // MON5
  const rows = await ctx.db
    .selectDistinct({ id: listings.id })
    .from(featuredSlots)
    .innerJoin(listings, eq(listings.id, featuredSlots.listingId))
    .innerJoin(listingCategories, and(eq(listingCategories.listingId, listings.id), eq(listingCategories.categoryId, search.categoryId)))
    .innerJoin(
      listingLocalities,
      and(eq(listingLocalities.listingId, listings.id), eq(listingLocalities.countyCode, search.countyCode), search.localityId ? eq(listingLocalities.localityId, search.localityId) : undefined),
    )
    .where(and(eq(featuredSlots.categoryId, search.categoryId), or(isNull(featuredSlots.countyCode), eq(featuredSlots.countyCode, search.countyCode)), liveSlot(ctx.now), publiclyVisible));
  return pickRandom(rows.map((r) => r.id), MAX_FEATURED);
}

setFeaturedProvider(featuredForSearch);

/* ── Pre-purchase view (P15) ───────────────────────────────────────────── */

/** min(1, 3 ÷ (n + 1)) — n = live Featured items already in that search. */
export function expectedShare(n: number): number {
  return Math.min(1, MAX_FEATURED / (Math.max(0, n) + 1));
}

export type FeaturedPreviewRow = { categoryId: string; categoryName: string; countyCode: string; countyName: string; current: number; share: number; searches30: number };

/**
 * What a business sees BEFORE buying Featured for a listing: for each category × county the
 * listing is live in, how many Featured items are there now, the share of rotations it could
 * expect, and how many searches there were in the last 30 days. Numbers, no promise.
 */
export async function getFeaturedPreview(ctx: Ctx, input: { listingId: string }): Promise<FeaturedPreviewRow[]> {
  await assertMonetizationOn(ctx);
  const listingId = zId.parse(input.listingId);
  await requireListingMember(ctx, listingId);
  const cats = await ctx.db.select({ c: categories }).from(listingCategories).innerJoin(categories, eq(categories.id, listingCategories.categoryId)).where(eq(listingCategories.listingId, listingId));
  const cos = await ctx.db.selectDistinct({ c: counties }).from(listingLocalities).innerJoin(counties, eq(counties.code, listingLocalities.countyCode)).where(eq(listingLocalities.listingId, listingId));
  const from = bucharestDateKey(addDays(ctx.now, -30));
  const to = bucharestDateKey(ctx.now);
  const out: FeaturedPreviewRow[] = [];
  for (const { c: cat } of cats) {
    for (const { c: county } of cos) {
      const [row] = await ctx.db
        .select({ n: sql<number>`count(distinct ${featuredSlots.listingId})::int` })
        .from(featuredSlots)
        .where(and(eq(featuredSlots.categoryId, cat.id), or(isNull(featuredSlots.countyCode), eq(featuredSlots.countyCode, county.code)), liveSlot(ctx.now), sql`${featuredSlots.listingId} <> ${listingId}`));
      const current = Number(row?.n ?? 0);
      const searches = await readDailyStats(ctx, { metric: "directory.search", from, to, dims: { category: cat.slug, county: county.code } });
      out.push({
        categoryId: cat.id,
        categoryName: localName(cat, ctx.locale),
        countyCode: county.code,
        countyName: localName(county, ctx.locale),
        current,
        share: expectedShare(current),
        searches30: searches.reduce((a, s) => a + s.value, 0),
      });
    }
  }
  return out;
}

/* ── Slots (written by billing on a paid Featured subscription; staff for test mode) ── */

const slotInput = z.object({ listingId: zId, categoryId: zId, countyCode: z.string().min(1).max(3).nullable().optional(), days: z.number().int().min(1).max(366).optional() });

/** W6 (test mode): staff place a slot by hand. Only while monetization is on. */
export async function createFeaturedSlot(ctx: Ctx, input: z.input<typeof slotInput>): Promise<FeaturedSlot> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  await assertMonetizationOn(ctx);
  const data = slotInput.parse(input);
  const [inCategory] = await ctx.db.select({ id: listingCategories.listingId }).from(listingCategories).where(and(eq(listingCategories.listingId, data.listingId), eq(listingCategories.categoryId, data.categoryId)));
  if (!inCategory) throw new AppError("VALIDATION", "featured.errors.notInCategory");
  const [slot] = await ctx.db
    .insert(featuredSlots)
    .values({ listingId: data.listingId, categoryId: data.categoryId, countyCode: data.countyCode ?? null, active: true, startsAt: ctx.now, endsAt: data.days ? addDays(ctx.now, data.days) : null, createdAt: ctx.now })
    .returning();
  await audit(ctx, { action: "featured.slot_created", objectType: "featured_slot", objectId: slot!.id, after: { listingId: data.listingId, categoryId: data.categoryId, countyCode: data.countyCode ?? null } });
  return slot!;
}

export async function endFeaturedSlot(ctx: Ctx, input: { slotId: string }): Promise<void> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  const done = await ctx.db.update(featuredSlots).set({ active: false, endsAt: ctx.now }).where(and(eq(featuredSlots.id, zId.parse(input.slotId)), eq(featuredSlots.active, true))).returning({ id: featuredSlots.id });
  if (done[0]) await audit(ctx, { action: "featured.slot_ended", objectType: "featured_slot", objectId: done[0].id });
}

/** W6: live slots with the listing name. [] while monetization is off — Featured does not exist then. */
export async function listFeaturedSlots(ctx: Ctx): Promise<Array<FeaturedSlot & { listingName: string }>> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  if (!(await isMonetizationOn(ctx))) return [];
  const rows = await ctx.db.select({ s: featuredSlots, name: listings.name }).from(featuredSlots).innerJoin(listings, eq(listings.id, featuredSlots.listingId)).where(eq(featuredSlots.active, true)).limit(500);
  return rows.map((r) => ({ ...r.s, listingName: r.name }));
}

