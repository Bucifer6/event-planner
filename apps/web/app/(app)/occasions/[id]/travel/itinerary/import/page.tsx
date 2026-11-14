import { getItinerary, ITINERARY_IMPORT_KIND } from "@ed/core/itinerary";
import { allTimeZones } from "@ed/core/subgroups";
import { getPreview, toPreviewView } from "@ed/core/whatif";
import { buttonClassName, Notice, PageHeader, Section } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../../_lib/load";
import styles from "../../_components/travel.module.css";
import { ImportForm } from "./ImportForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("import.title") };
}

/**
 * D-01 booking import. Step 1: paste the confirmation or pick an .ics file. Step 2: the
 * What-if preview lists what would be added, changed or skipped. Nothing reaches the
 * itinerary until "Aplică schimbările".
 */
export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const tc = await getTranslations("common");
  const it = await orNotFound(getItinerary(ctx, id));
  if (!it.canPlan) notFound();
  const base = `/occasions/${id}/travel/itinerary`;
  const back = (
    <Link href={base} className={buttonClassName({ variant: "quiet" })}>
      <IconArrowLeft /> {t("import.back")}
    </Link>
  );

  if (sp.preview) {
    const preview = await orNotFound(getPreview(ctx, sp.preview));
    if (preview.kind !== ITINERARY_IMPORT_KIND || preview.occasionId !== id) notFound();
    return (
      <div className={styles.stack}>
        <PageHeader level={2} eyebrow={t("import.eyebrow")} title={t("import.previewHeading")} description={t("import.previewBody")} actions={back} />
        <PreviewPanel preview={toPreviewView(preview)} appliedHref={base} discardedHref={`${base}/import`}>
          <p className="ed-small ed-muted">{t("import.previewFoot")}</p>
        </PreviewPanel>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("import.eyebrow")} title={t("import.title")} description={t("import.description")} actions={back} />
      {it.occasion.status === "closed" ? (
        <Notice>{t("closedNotice")}</Notice>
      ) : (
        <Section>
          <ImportForm
            occasionId={id}
            defaultTz={it.occasion.timezone}
            zones={allTimeZones()}
            labels={{
              text: t("import.text"),
              textHint: t("import.textHint"),
              file: t("import.file"),
              fileHint: t("import.fileHint"),
              fileLoaded: t.raw("import.fileLoaded") as string,
              fileTooBig: t("import.fileTooBig"),
              zone: t("import.zone"),
              zoneHint: t("import.zoneHint"),
              submit: t("import.submit"),
              pending: t("import.pending"),
              optional: tc("optional"),
            }}
          />
        </Section>
      )}
    </div>
  );
}
