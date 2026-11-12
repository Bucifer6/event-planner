import { prisma } from '@eventdesk/db';
import { startOfUtcDay, now } from '@eventdesk/shared';
import { requireBusinessMember } from './business';

// P21: dashboard and reports across the business's occasions, including
// catalogue-item and drawing usage as DAILY TOTALS with no visitor identifier (D4).

export async function recordAssetUsage(
  assetKind: 'drawing' | 'catalogue_item',
  assetId: string,
  listingId: string
) {
  const day = startOfUtcDay(now());
  await prisma.assetUsageDaily.upsert({
    where: { day_assetKind_assetId: { day, assetKind, assetId } },
    update: { uses: { increment: 1 } },
    create: { day, assetKind, assetId, listingId, uses: 1 },
  });
}

export async function businessDashboard(businessId: string, accountId: string, days = 30) {
  await requireBusinessMember(businessId, accountId);
  const since = startOfUtcDay(new Date(now().getTime() - days * 86_400_000));
  const [occasions, listings, usage, enquiries] = await Promise.all([
    prisma.occasion.findMany({
      where: { businessId },
      include: { _count: { select: { tasks: true, households: true, expenses: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.listing.findMany({
      where: { businessId },
      include: { categories: { include: { category: true } } },
    }),
    prisma.assetUsageDaily.findMany({
      where: {
        day: { gte: since },
        listingId: {
          in: (await prisma.listing.findMany({ where: { businessId }, select: { id: true } })).map(
            (l) => l.id
          ),
        },
      },
      orderBy: { day: 'asc' },
    }),
    prisma.enquiry.findMany({
      where: { listing: { businessId }, sentAt: { gte: since } },
      select: { state: true, sentAt: true, answeredAt: true },
    }),
  ]);
  const answered = enquiries.filter((e) => e.state === 'answered').length;
  const statsRows = await prisma.listingStats.findMany({
    where: { listingId: { in: listings.map((l) => l.id) } },
  });
  const statsByListing = new Map(statsRows.map((r) => [r.listingId, r]));
  return {
    occasions: occasions.map((o) => ({
      id: o.id,
      title: o.title,
      status: o.status,
      handedOverAt: o.handedOverAt,
      tasks: o._count.tasks,
      households: o._count.households,
      expenses: o._count.expenses,
    })),
    listings: listings.map((l) => ({
      id: l.id,
      name: l.name,
      status: l.status,
      categories: l.categories.map((c) => c.category.slug),
      stats: (() => {
        const st = statsByListing.get(l.id);
        return st
          ? {
              sent: st.enquiriesSent,
              answered: st.enquiriesAnswered,
              medianReplyHours: st.medianReplyHours,
            }
          : null;
      })(),
    })),
    assetUsageDaily: usage.map((u) => ({
      day: u.day,
      assetKind: u.assetKind,
      assetId: u.assetId,
      uses: u.uses,
    })),
    enquiries30d: { sent: enquiries.length, answered },
  };
}
