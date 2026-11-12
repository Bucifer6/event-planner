import { randomInt } from 'node:crypto';
import { prisma } from '@eventdesk/db';
import { now } from '@eventdesk/shared';
import { getMonetizationSwitch } from './staff';
import { getListingPublic, searchDirectory, type DirectoryResult } from './directory';
import { last30DaysSearches } from './billing';

// P-13 (P13-P16): Featured exists ONLY while the monetization switch is ON (MON5).
// Up to 3 cards above organic, picked at RANDOM on every request (P13), labelled
// verbatim "Promovat — plasare plătită" / "Featured — paid placement" (P14), same
// weight as the business name. Organic order is untouched and payment can never
// change it (P5). Featured never appears in plans, guest pages, emails, exports or
// offline packs (P16) — those surfaces never call this module.

export const FEATURED_LABEL_RO = 'Promovat — plasare plătită';
export const FEATURED_LABEL_EN = 'Featured — paid placement';
export const FEATURED_LIMIT = 3; // P13

export interface FeaturedResult extends DirectoryResult {
  featuredLabel: string;
}

export async function getFeaturedFor(input: {
  categorySlug: string;
  countyCode: string;
  limit?: number;
}): Promise<FeaturedResult[]> {
  const mon = await getMonetizationSwitch();
  if (mon.state !== 'ON') return []; // MON5: while OFF, Featured does not exist
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: input.categorySlug } });
  const county = await prisma.county.findUniqueOrThrow({ where: { code: input.countyCode } });
  const slots = await prisma.featuredSlot.findMany({
    where: {
      active: true,
      categoryId: category.id,
      listing: { status: 'live', claimed: true, counties: { some: { countyId: county.id } } },
    },
    include: { listing: true },
  });
  // P13: random pick on every request — Fisher-Yates over the active slots
  const pool = [...slots];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  const picked = pool.slice(0, input.limit ?? FEATURED_LIMIT);
  const out: FeaturedResult[] = [];
  for (const slot of picked) {
    // organic results exclude featured slots, so shape the listing directly
    const pub = await getListingPublic(slot.listingId);
    out.push({ ...pub, featuredLabel: FEATURED_LABEL_RO });
  }
  return out;
}

// P15: expected share of rotations min(1, 3/(n+1)) where n = live Featured items
// matching the same search (own included); plus last 30 days of searches in its
// categories/counties. No guarantee of views.
export function expectedFeaturedShare(n: number): number {
  return Math.min(1, FEATURED_LIMIT / (n + 1));
}

export async function prePurchaseView(input: { categorySlug: string; countyCode: string }) {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: input.categorySlug } });
  const county = await prisma.county.findUniqueOrThrow({ where: { code: input.countyCode } });
  const n = await prisma.featuredSlot.count({
    where: {
      active: true,
      categoryId: category.id,
      listing: { status: 'live', claimed: true, counties: { some: { countyId: county.id } } },
    },
  });
  const searches30d = await last30DaysSearches(category.id, county.id);
  return {
    liveFeatured: n,
    expectedShare: expectedFeaturedShare(n),
    searchesLast30Days: searches30d,
    guarantee: false,
  };
}

// The directory page surface: featured cards (labelled) ABOVE organic results.
export async function searchDirectoryWithFeatured(input: {
  categorySlug: string;
  countyCode: string;
  localityId?: string;
  limit?: number;
}): Promise<{ featured: FeaturedResult[]; organic: DirectoryResult[] }> {
  const organic = await searchDirectory(input);
  const featured = await getFeaturedFor(input);
  const featuredIds = new Set(featured.map((f) => f.listing.id));
  return { featured, organic: organic.filter((r) => !featuredIds.has(r.listing.id)) };
}

export async function isMonetizationOn(): Promise<boolean> {
  return (await getMonetizationSwitch()).state === 'ON';
}
