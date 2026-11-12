import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireBusinessMember } from './business';

// F1/F2: flower catalogues published by florist/styling businesses — variety,
// image, seasonality, indicative price per stem/bunch, colours. Moderated with the
// listing (F1); readable from the listing and the in-app directory (F2); reusable
// across the business's occasions. Indicative prices are never a quote (F3).

export async function createCatalogue(listingId: string, accountId: string, name: string) {
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  if (!listing.businessId || !listing.claimed)
    throw new AppError('FORBIDDEN', 'Only claimed listings can publish catalogues (P29).');
  await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  const cat = await prisma.flowerCatalogue.create({
    data: { listingId, name: name.trim() || 'Catalog', revisionId: null },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'catalogue_created',
    objectType: 'FlowerCatalogue',
    objectId: cat.id,
  });
  return cat;
}

export async function addCatalogueItem(
  catalogueId: string,
  accountId: string,
  input: {
    variety: string;
    imageAssetId?: string;
    seasonality?: string;
    pricePerStemBani?: number;
    colours: string[];
  }
) {
  const catalogue = await prisma.flowerCatalogue.findUniqueOrThrow({ where: { id: catalogueId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: catalogue.listingId } });
  if (listing.businessId)
    await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  if (!input.variety.trim()) throw new AppError('INVALID_INPUT', 'Variety is required.');
  return prisma.catalogueItem.create({
    data: {
      catalogueId,
      variety: input.variety.trim(),
      imageAssetId: input.imageAssetId ?? null,
      seasonality: input.seasonality ?? null,
      pricePerStemBani: input.pricePerStemBani ?? null,
      colours: input.colours,
    },
  });
}

export async function listCataloguesForListing(listingId: string) {
  return prisma.flowerCatalogue.findMany({
    where: { listingId },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listPublicCatalogues(categorySlug = 'floristi') {
  const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
  if (!category) return [];
  const listings = await prisma.listing.findMany({
    where: { status: 'live', categories: { some: { categoryId: category.id } } },
    select: { id: true },
  });
  const ids = listings.map((l) => l.id);
  return prisma.flowerCatalogue.findMany({
    where: { listingId: { in: ids } },
    include: {
      items: true,
      listing: {
        include: {
          categories: { include: { category: true } },
          counties: { include: { county: true } },
        },
      },
    },
  });
}
