import { listTemplates } from "@ed/core/templates";
import { Page, PageHeader } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { NewOccasionForm } from "./NewOccasionForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("occasions"))("new.title") };
}

/** A1 + A2: title, a template (or blank), and a date, a date range or "we decide by poll". */
export default async function NewOccasionPage() {
  const ctx = await requireCtx();
  const t = await getTranslations("occasions");
  const templates = await listTemplates(ctx);
  return (
    <Page narrow>
      <PageHeader
        eyebrow={<Link href="/occasions">{t("new.back")}</Link>}
        title={t("new.title")}
        description={t("new.description")}
      />
      <NewOccasionForm
        templates={templates.map((tpl) => ({
          kind: tpl.kind,
          name: ctx.locale === "en" ? tpl.nameEn : tpl.nameRo,
          description: (ctx.locale === "en" ? tpl.descriptionEn : tpl.descriptionRo) ?? "",
          taskCount: tpl.taskCount,
        }))}
      />
    </Page>
  );
}
