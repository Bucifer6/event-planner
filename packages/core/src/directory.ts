import { createHash } from 'node:crypto';
import { Prisma, prisma, type Listing } from '@eventdesk/db';
import { AppError, startOfUtcDay, now } from '@eventdesk/shared';
import { getMonetizationSwitch } from './staff';

// P5/P6/P7 + MON5: directory search. Organic order rotates daily (deterministic
// per UTC day) and payment can never change it — there is no payment field in
// the ordering. While the monetization switch is OFF, Featured does not exist:
// no FeaturedSlot rows are rendered anywhere (MON5). Statistics are daily
// aggregates only, no visitor identifiers (D4/INF11).

export interface DirectoryResult {
  listing: Listing & {
    categories: { category: { slug: string; nameRo: string; nameEn: string } }[];
    counties: { county: { code: string; nameRo: string } }[];
    localities?: { locality: { nameRo: string } }[];
    drawings?: { id: string; spaceName: string; version: number }[];
    catalogues?: { id: string; name: string; items: unknown[] }[];
  };
  badges: string[]; // P4: only the two factual badges
  unclaimed: boolean;
  publicContactRoute?: string | null;
  stats?: { shareAnswered: number; medianReplyHours: number | null };
}

function dailySeed(): string {
  return startOfUtcDay(now()).toISOString().slice(0, 10);
}

function organicRank(listingId: string, categorySlug: string, countyCode: string): string {
  // deterministic per (day, listing, category, county) — rotates daily, never by payment
  return createHash('sha256')
    .update(`${dailySeed()}|${listingId}|${categorySlug}|${countyCode}`)
    .digest('hex');
}

export async function searchDirectory(input: {
  categorySlug: string;
  countyCode: string;
  localityId?: string;
  limit?: number;
}): Promise<DirectoryResult[]> {
  const category = await prisma.category.findUnique({ where: { slug: input.categorySlug } });
  if (!category || !category.published || category.retiredAt)
    throw new AppError('NOT_FOUND', 'Unknown category.');
  const county = await prisma.county.findUnique({ where: { code: input.countyCode } });
  if (!county || !county.published) throw new AppError('NOT_FOUND', 'Unknown county.');

  const where: Record<string, unknown> = {
    status: 'live',
    categories: { some: { categoryId: category.id } },
    counties: { some: { countyId: county.id } },
  };
  if (input.localityId) {
    where.localities = { some: { localityId: input.localityId } };
  }

  // P15: daily aggregate search counter — no visitor identifier (D4/INF11)
  const { recordDirectorySearch } = await import('./billing');
  await recordDirectorySearch(category.id, county.id);

  const listings = await prisma.listing.findMany({
    where,
    include: {
      categories: { include: { category: true } },
      counties: { include: { county: true } },
      business: true,
    },
  });

  // MON5: while OFF there are no Featured cards at all. (When ON, up to 3 random
  // Featured cards would render above, labelled per P14 — never in organic order.)
  const mon = await getMonetizationSwitch();
  const featuredIds = new Set<string>();
  if (mon.state === 'ON') {
    const featured = await prisma.featuredSlot.findMany({
      where: {
        active: true,
        categoryId: category.id,
        listing: { status: 'live', counties: { some: { countyId: county.id } } },
      },
    });
    for (const f of featured) featuredIds.add(f.listingId);
  }

  const day = dailySeed();
  const sorted = listings
    .filter((l) => !featuredIds.has(l.id))
    .sort((a, b) =>
      organicRank(a.id, category.slug, county.code).localeCompare(
        organicRank(b.id, category.slug, county.code)
      )
    );

  const results: DirectoryResult[] = [];
  for (const l of sorted) {
    const stats = l.hideStats ? undefined : await listingStats(l.id);
    results.push({
      listing: l as never,
      badges: badgesFor(l),
      unclaimed: !l.claimed,
      publicContactRoute: l.publicContactRoute,
      stats,
    });
  }
  return results.slice(0, input.limit ?? 50);
}

// P4: factual badges only — ONRC registration and insurance-with-date. No
// generic "Verified" badge exists anywhere.
export function badgesFor(listing: {
  businessId: string | null;
  business?: { onrcRegistration: string | null; insuranceValidUntil: Date | null } | null;
}): string[] {
  const badges: string[] = [];
  if (listing.business?.onrcRegistration) badges.push('Verificat: înregistrare ONRC');
  if (listing.business?.insuranceValidUntil) {
    badges.push(
      `Verificat: asigurare văzută până la ${listing.business.insuranceValidUntil.toISOString().slice(0, 10)}`
    );
  }
  return badges;
}

async function listingStats(listingId: string) {
  const s = await prisma.listingStats.findUnique({ where: { listingId } });
  if (!s) return undefined;
  return {
    shareAnswered: s.enquiriesSent > 0 ? s.enquiriesAnswered / s.enquiriesSent : 0,
    medianReplyHours: s.medianReplyHours,
  };
}

export async function getListingPublic(listingId: string): Promise<DirectoryResult> {
  const l = await prisma.listing.findUniqueOrThrow({
    where: { id: listingId },
    include: {
      categories: { include: { category: true } },
      counties: { include: { county: true } },
      localities: { include: { locality: true } },
      business: true,
      drawings: { where: { calibrationP1: { not: Prisma.DbNull } } },
      catalogues: { include: { items: true } },
    },
  });
  if (l.status !== 'live') throw new AppError('NOT_FOUND', 'Listing not live.');
  return {
    listing: l as never,
    badges: badgesFor(l),
    unclaimed: !l.claimed,
    publicContactRoute: l.publicContactRoute,
    stats: l.hideStats ? undefined : await listingStats(l.id),
  };
}

export async function listDirectoryCategories() {
  return prisma.category.findMany({ orderBy: { sortKey: 'asc' } });
}

export async function listCounties() {
  return prisma.county.findMany({ include: { localities: true }, orderBy: { code: 'asc' } });
}
