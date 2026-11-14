import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal-page";
import { pageLocale, type LocaleParams } from "@/lib/page";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  return legalMetadata(await pageLocale(params), "accessibility");
}

export default async function Page({ params }: LocaleParams) {
  return <LegalPage locale={await pageLocale(params)} doc="accessibility" />;
}
