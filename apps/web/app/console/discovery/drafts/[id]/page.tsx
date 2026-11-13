import { listDiscoveryDrafts } from "@ed/core/discovery";
import { getPicklists } from "@ed/core/geography";
import { formatDate } from "@ed/i18n/format";
import { DescriptionList, ExternalLink, Page, PageHeader, Unknown } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setDraftPlaceAction } from "@/app/actions/discovery";
import { NoRole } from "../../../_components/NoRole";
import { SpecForm } from "../../../_components/SpecForm";
import { requireConsole } from "../../../_lib";
import styles from "../../discovery.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("discovery"))("drafts.fixTitle") };
}

/**
 * One draft: what the source states (never edited here) and the classification the run
 * GUESSED — category and locality from the picklists — which a moderator may correct before
 * the draft can be approved (BD4: the listing stays within what the public source supports).
 */
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("discovery");
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("title")} roles={["listing_moderator", "platform_admin"]} />;
  const rows = [...(await listDiscoveryDrafts(ctx, { state: "pending", limit: 500 })), ...(await listDiscoveryDrafts(ctx, { state: "duplicate_review", limit: 500 }))];
  const row = rows.find((r) => r.draft.id === id);
  if (!row) notFound();
  const { draft } = row;
  const picklists = await getPicklists(ctx);
  const unknown = <Unknown label={t("drafts.guessMissing")} />;
  const back = `/console/discovery?tab=drafts&state=${draft.state}`;
  return (
    <Page narrow>
      <Link href={back} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("drafts.back")}
      </Link>
      <PageHeader title={draft.name} description={t("drafts.fixBody")} />
      <DescriptionList
        cols={2}
        items={[
          { term: t("drafts.cols.contact"), value: draft.publicContactRoute },
          { term: t("drafts.cols.source"), value: /^https?:\/\//.test(draft.sourceUrl) ? <ExternalLink href={draft.sourceUrl}>{row.sourceName}</ExternalLink> : row.sourceName },
          { term: t("drafts.cols.collected"), value: <span className="ed-num">{formatDate(draft.collectedAt, ctx.locale)}</span> },
          { term: t("drafts.cols.category"), value: row.categoryName ?? (draft.categoryGuessText ? `${draft.categoryGuessText} (?)` : unknown) },
          { term: t("drafts.cols.area"), value: row.localityName ? [row.localityName, row.countyName].filter(Boolean).join(", ") : draft.areaText ? `${draft.areaText} (?)` : unknown },
        ]}
      />
      {row.duplicateOf ? <p className="ed-muted">{t(row.duplicateOf.kind === "listing" ? "drafts.duplicateOfListing" : "drafts.duplicateOfDraft", { name: row.duplicateOf.name })}</p> : null}
      <h2>{t("drafts.fixTitle")}</h2>
      <SpecForm
        action={setDraftPlaceAction}
        hidden={{ id: draft.id }}
        fields={[
          { kind: "select", name: "categoryId", label: t("drafts.category"), required: true, defaultValue: draft.categoryGuessId ?? "", placeholder: t("drafts.choose"), options: picklists.categories.map((c) => ({ value: c.id, label: c.name })) },
          {
            kind: "select",
            name: "localityId",
            label: t("drafts.locality"),
            required: true,
            defaultValue: draft.localityId ?? "",
            placeholder: t("drafts.choose"),
            options: picklists.localities.map((l) => ({ value: l.id, label: `${l.name} (${l.countyCode})` })),
          },
        ]}
        submitLabel={t("drafts.saveFix")}
        pendingLabel={t("drafts.savingFix")}
        success={t("drafts.savedFix")}
        refreshOnSuccess
      />
    </Page>
  );
}
