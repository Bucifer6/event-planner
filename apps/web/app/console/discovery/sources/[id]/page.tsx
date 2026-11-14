import { getDiscoverySource, listDiscoveryRuns } from "@ed/core/discovery";
import { listCategories } from "@ed/core/geography";
import { formatDateTime } from "@ed/i18n/format";
import { Page, PageHeader, Section, Tag } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { NoRole } from "../../../_components/NoRole";
import { requireConsole } from "../../../_lib";
import { SourceForm } from "../../_components/SourceForm";
import styles from "../../discovery.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("discovery"))("sourceForm.editTitle") };
}

/** W5: configure one source (its kind cannot change) and see its latest runs. */
export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("discovery");
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("title")} roles={["listing_moderator", "platform_admin"]} />;
  const source = await orNotFound(getDiscoverySource(ctx, id));
  const [categories, runs] = await Promise.all([listCategories(ctx), listDiscoveryRuns(ctx, { sourceId: source.id, limit: 10 })]);
  const c = source.config;
  return (
    <Page narrow>
      <Link href="/console/discovery" className={styles.back}>
        <IconArrowLeft size={16} />
        {t("sourceForm.back")}
      </Link>
      <PageHeader title={source.name} description={`${t(`kinds.${source.kind}`)} · ${t("sourceForm.kindLocked")}`} actions={<Tag tone={source.enabled ? "success" : "neutral"}>{source.enabled ? t("sources.enabled") : t("sources.paused")}</Tag>} />
      <SourceForm
        values={{
          id: source.id,
          kind: source.kind,
          name: source.name,
          termsReference: source.termsReference,
          rateLimitPerHour: String(source.rateLimitPerHour),
          format: c.format ?? "csv",
          url: c.url ?? "",
          inline: c.inline ?? "",
          urls: (c.urls ?? []).join("\n"),
          defaultCategoryId: c.defaultCategoryId ?? "",
          targetCategoryIds: (c.targetCategoryIds ?? []).join(", "),
          targetCountyCodes: (c.targetCountyCodes ?? []).join(", "),
        }}
        categories={categories.map((x) => ({ value: x.id, label: x.name }))}
      />
      {runs.length > 0 ? (
        <Section title={t("tabs.runs")}>
          <ul className="ed-list">
            {runs.map((r) => (
              <li key={r.id} className="ed-row">
                <div className="ed-row__main">
                  <span className="ed-row__title ed-num">{formatDateTime(r.startedAt, ctx.locale)}</span>
                  <span className="ed-row__meta">
                    {t("sources.lastRunSummary", { date: r.finishedAt ? t("runs.finished") : t("runs.running"), seen: r.itemsSeen, drafts: r.draftsCreated, duplicates: r.duplicatesQueued })}
                    {r.errors.length ? ` · ${t("runs.errors", { n: r.errors.length })}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  );
}
