import { prisma } from '@eventdesk/db';
import { AppError, startOfUtcDay, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireStaff } from './staff';

// W4: directory management — categories/counties/localities create, merge, rename,
// retire, publish/unpublish; per-category x county daily stats without visitor
// identifiers (D4). Retired categories stop accepting new listings (P1 validation
// treats them as unknown).

export async function createDirectoryCategory(
  staffAccountId: string,
  input: { slug: string; nameRo: string; nameEn: string }
) {
  await requireStaff(staffAccountId, 'content_editor');
  const slug = input.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  if (!slug) throw new AppError('INVALID_INPUT', 'Slug required.');
  const cat = await prisma.category.create({
    data: { slug, nameRo: input.nameRo.trim(), nameEn: input.nameEn.trim(), sortKey: 999 },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: 'category_created',
    objectType: 'Category',
    objectId: cat.id,
    after: { slug },
  });
  return cat;
}

export async function renameDirectoryCategory(
  staffAccountId: string,
  categoryId: string,
  nameRo: string,
  nameEn: string
) {
  await requireStaff(staffAccountId, 'content_editor');
  const cat = await prisma.category.update({
    where: { id: categoryId },
    data: { nameRo: nameRo.trim(), nameEn: nameEn.trim() },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: 'category_renamed',
    objectType: 'Category',
    objectId: categoryId,
  });
  return cat;
}

// Merge moves all listing links to the target and deletes the source — recorded.
export async function mergeDirectoryCategory(
  staffAccountId: string,
  sourceId: string,
  targetId: string
) {
  await requireStaff(staffAccountId, 'content_editor');
  if (sourceId === targetId) throw new AppError('INVALID_INPUT', 'Cannot merge into itself.');
  await prisma.$transaction(async (tx) => {
    await tx.listingCategory.deleteMany({
      where: { categoryId: sourceId, listing: { categories: { some: { categoryId: targetId } } } },
    });
    await tx.listingCategory.updateMany({
      where: { categoryId: sourceId },
      data: { categoryId: targetId },
    });
    await tx.category.delete({ where: { id: sourceId } });
    await tx.auditLog.create({
      data: {
        actorId: staffAccountId,
        actorKind: 'staff',
        action: 'category_merged',
        objectType: 'Category',
        objectId: sourceId,
        after: { targetId },
      },
    });
  });
}

export async function retireDirectoryCategory(
  staffAccountId: string,
  categoryId: string,
  retired: boolean
) {
  await requireStaff(staffAccountId, 'content_editor');
  const cat = await prisma.category.update({
    where: { id: categoryId },
    data: { retiredAt: retired ? now() : null, published: retired ? false : undefined },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: retired ? 'category_retired' : 'category_unretired',
    objectType: 'Category',
    objectId: categoryId,
  });
  return cat;
}

export async function setDirectoryCategoryPublished(
  staffAccountId: string,
  categoryId: string,
  published: boolean
) {
  await requireStaff(staffAccountId, 'content_editor');
  return prisma.category.update({ where: { id: categoryId }, data: { published } });
}

export async function setCountyPublished(
  staffAccountId: string,
  countyId: string,
  published: boolean
) {
  await requireStaff(staffAccountId, 'content_editor');
  return prisma.county.update({ where: { id: countyId }, data: { published } });
}

export async function setLocalityPublished(
  staffAccountId: string,
  localityId: string,
  published: boolean
) {
  await requireStaff(staffAccountId, 'content_editor');
  return prisma.locality.update({ where: { id: localityId }, data: { published } });
}

// W4 daily stats per category x county: searches (DirectorySearchDaily) + listing
// response stats (ListingStats) — aggregates only, no visitor identifiers (D4).
export async function directoryDailyStats(days = 30) {
  const since = startOfUtcDay(new Date(now().getTime() - days * 86_400_000));
  const searches = await prisma.directorySearchDaily.findMany({
    where: { day: { gte: since } },
  });
  const catNames = new Map((await prisma.category.findMany()).map((c) => [c.id, c.slug]));
  const countyNames = new Map((await prisma.county.findMany()).map((c) => [c.id, c.code]));
  const byPair = new Map<string, { category: string; county: string; searches: number }>();
  for (const s of searches) {
    const key = `${s.categoryId}|${s.countyId}`;
    const cur = byPair.get(key) ?? {
      category: catNames.get(s.categoryId) ?? s.categoryId,
      county: countyNames.get(s.countyId) ?? s.countyId,
      searches: 0,
    };
    cur.searches += s.searches;
    byPair.set(key, cur);
  }
  const stats = await prisma.listingStats.findMany();
  const listingRows = await prisma.listing.findMany({
    where: { id: { in: stats.map((st) => st.listingId) } },
    include: { categories: true, counties: true },
  });
  const listingsById = new Map(listingRows.map((l) => [l.id, l]));
  const answeredByPair = new Map<string, { answered: number; sent: number }>();
  for (const st of stats) {
    const listing = listingsById.get(st.listingId);
    if (!listing) continue;
    for (const lc of listing.categories) {
      for (const cc of listing.counties) {
        const key = `${lc.categoryId}|${cc.countyId}`;
        const cur = answeredByPair.get(key) ?? { answered: 0, sent: 0 };
        cur.answered += st.enquiriesAnswered;
        cur.sent += st.enquiriesSent;
        answeredByPair.set(key, cur);
      }
    }
  }
  return [...byPair.entries()].map(([key, v]) => {
    const [categoryId, countyId] = key.split('|');
    const a = answeredByPair.get(key) ?? { answered: 0, sent: 0 };
    return {
      categoryId,
      countyId,
      category: v.category,
      county: v.county,
      searches30d: v.searches,
      enquiriesSent: a.sent,
      enquiriesAnswered: a.answered,
    };
  });
}
