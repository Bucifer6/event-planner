import { listLessons } from "@ed/core/closeout";
import { listTemplates } from "@ed/core/templates";
import { Page, PageHeader, Section, Stack } from "@ed/ui";
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
  // the person's own notes from occasions they closed — only shown when there are any
  const [templates, lessons] = await Promise.all([listTemplates(ctx), listLessons(ctx)]);
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
      {lessons.length > 0 ? (
        // below the form, so it never stands between the person and creating the occasion
        <Section title={t("new.lessonsTitle")} level={2}>
          <Stack gap={3}>
            <p className="ed-small ed-muted">{t("new.lessonsIntro")}</p>
            {lessons.slice(0, 3).map((lesson) => (
              <div key={lesson.id}>
                <p className="ed-label">{lesson.occasionTitle}</p>
                <p className="ed-small" style={{ whiteSpace: "pre-line", maxWidth: "var(--measure)" }}>
                  {lesson.body.length > 600 ? `${lesson.body.slice(0, 600).trimEnd()}…` : lesson.body}
                </p>
              </div>
            ))}
          </Stack>
        </Section>
      ) : null}
    </Page>
  );
}
