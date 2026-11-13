import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResultsView } from "../../_components/ResultsView";
import { loadResults, resolveArea } from "./_load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ category: string; county: string }>; searchParams: Promise<{ occasion?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, county } = await params;
  const area = await resolveArea(category, county, null);
  const t = await getTranslations("directory");
  return {
    title: t("results.title", { category: area.category.name, area: area.county.name }),
    description: t("meta.resultsDescription", { category: area.category.name, area: area.county.name }),
    alternates: { canonical: `/directory/${area.category.slug}/${area.county.slug}` },
  };
}

/** P6: the public page of one category in one county. Organic results in the daily rotation (P5). */
export default async function CategoryCountyPage({ params, searchParams }: Props) {
  const [{ category, county }, sp] = await Promise.all([params, searchParams]);
  const data = await loadResults(category, county, null, sp.occasion);
  return <ResultsView {...data} />;
}
