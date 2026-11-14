import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResultsView } from "../../../_components/ResultsView";
import { loadResults, resolveArea } from "../_load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ category: string; county: string; locality: string }>; searchParams: Promise<{ occasion?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, county, locality } = await params;
  const area = await resolveArea(category, county, locality);
  const t = await getTranslations("directory");
  const name = `${area.locality!.name}, ${area.county.name}`;
  return {
    title: t("results.title", { category: area.category.name, area: name }),
    description: t("meta.resultsDescription", { category: area.category.name, area: name }),
    alternates: { canonical: `/directory/${area.category.slug}/${area.county.slug}/${area.locality!.slug}` },
  };
}

/** P6: a locality page — it exists only where the operator switched it on (supply justifies it). */
export default async function CategoryLocalityPage({ params, searchParams }: Props) {
  const [{ category, county, locality }, sp] = await Promise.all([params, searchParams]);
  const data = await loadResults(category, county, locality, sp.occasion);
  return <ResultsView {...data} />;
}
