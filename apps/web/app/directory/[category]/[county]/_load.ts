import "server-only";
import { actorAccountId } from "@ed/core/context";
import { getDirectoryIndex, getDirectoryPrefill, getDirectoryResults, recordDirectorySearch } from "@ed/core/directory";
import { getCategoryBySlug, getCounty, getLocalityBySlug, listLocalities } from "@ed/core/geography";
import { isAppError } from "@ed/shared/errors";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getCtx } from "@/lib/ctx";

/** Resolves the picklist values named in the URL; anything unknown, retired or unpublished is a 404. */
export const resolveArea = cache(async (categorySlug: string, countySlug: string, localitySlug: string | null) => {
  const ctx = await getCtx();
  const [category, county] = await Promise.all([getCategoryBySlug(ctx, categorySlug), getCounty(ctx, countySlug)]);
  if (!category || !county || !category.active || !category.published || !county.active || !county.published) notFound();
  // one canonical URL per page: the county slug, not its code
  if (county.slug !== countySlug) notFound();
  let locality = null;
  if (localitySlug !== null) {
    locality = await getLocalityBySlug(ctx, county.code, localitySlug);
    // P6: locality pages exist only where supply justifies them (operator toggle, W4)
    if (!locality || !locality.active || !locality.publicPage) notFound();
  }
  return { ctx, category, county, locality };
});

export async function loadResults(categorySlug: string, countySlug: string, localitySlug: string | null, occasion: string | undefined) {
  const { ctx, category, county, locality } = await resolveArea(categorySlug, countySlug, localitySlug);
  let occasionId: string | null = null;
  if (occasion && actorAccountId(ctx.actor)) {
    try {
      occasionId = (await getDirectoryPrefill(ctx, occasion)).occasionId;
    } catch (e) {
      if (!isAppError(e)) throw e;
    }
  }
  const [results, localities, index] = await Promise.all([
    getDirectoryResults(ctx, { categoryId: category.id, countyCode: county.code, localityId: locality?.id }),
    listLocalities(ctx, { countyCode: county.code }),
    getDirectoryIndex(ctx),
  ]);
  // D4 / INF11: one more search in today's total for this category × county. Nothing about the visitor.
  await recordDirectorySearch(ctx, { categorySlug: category.slug, countyCode: county.code });
  return {
    category,
    county,
    locality,
    results,
    occasionId,
    localityPages: localities.filter((l) => l.publicPage),
    otherCounties: index.launchCounties.filter((c) => c.code !== county.code),
  };
}
