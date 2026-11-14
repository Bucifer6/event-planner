import "@ed/core/listings"; // registers the "listing" moderation kind
import { getModerationRevision } from "@ed/core/moderation";
import { isAppError } from "@ed/shared/errors";
import { formatDateTime } from "@ed/i18n/format";
import { getAssetUrl } from "@ed/storage";
import { DeltaList, DescriptionList, Notice, Page, PageHeader, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { decideRevisionAction } from "@/app/actions/moderation";
import { NoRole } from "../../_components/NoRole";
import { SpecForm } from "../../_components/SpecForm";
import { requireConsole } from "../../_lib";
import pageStyles from "../moderation.module.css";
import { waitText } from "../_wait";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("moderation"))("detail.title") };
}

/** One revision: what changes (before → after, field by field) and the decision (W2, P3). */
export default async function ModerationRevisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("moderation");
  const all = await getTranslations();
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("title")} roles={["listing_moderator", "platform_admin"]} />;
  const { id } = await params;
  const detail = await getModerationRevision(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { revision, description } = detail;
  const pending = revision.state === "pending";
  const isEdit = revision.basePayload !== null;
  const empty = <span className="ed-unknown">{t("detail.empty")}</span>;
  const changed = description.fields.filter((f) => f.before !== f.after);
  const same = description.fields.filter((f) => f.before === f.after && f.after !== null);
  const tt = (k: string, p?: Record<string, string | number>) => t(k as never, p as never);
  const photos: Array<{ id: string; url: string }> = [];
  for (const assetId of description.imageAssetIds ?? []) {
    try {
      photos.push({ id: assetId, url: await getAssetUrl(ctx, assetId, { ttlSeconds: 900 }) });
    } catch (e) {
      if (!isAppError(e)) throw e;
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow={<Link href="/console/moderation">{t("detail.back")}</Link>}
        title={description.title}
        actions={
          pending ? (
            <Tag tone={detail.overdue ? "danger" : "attention"}>
              {waitText(tt, detail.waitingMinutes)} · {detail.overdue ? t("overdue") : t("onTime")}
            </Tag>
          ) : (
            <Tag tone={revision.state === "approved" ? "success" : revision.state === "rejected" ? "danger" : "neutral"}>{t(`states.${revision.state}`)}</Tag>
          )
        }
      />

      <Section title={t("detail.about")}>
        <DescriptionList
          cols={2}
          items={[
            { term: t("cols.kind"), value: `${all(detail.kindLabelKey as never)} · ${isEdit ? t("change.edit") : t("change.new")}` },
            {
              term: t("cols.business"),
              value: revision.businessId ? <Link href={`/console/businesses/${revision.businessId}`}>{detail.businessName}</Link> : t("unclaimed"),
            },
            { term: t("cols.submitted"), value: formatDateTime(revision.createdAt, ctx.locale) },
            { term: t("detail.target"), value: t("detail.targetValue", { hours: detail.targetHours }) },
            ...(revision.sourceNote ? [{ term: t("detail.source"), value: revision.sourceNote }] : []),
          ]}
        />
        {isEdit ? <Notice title={t("detail.liveStays")} /> : null}
      </Section>

      <Section title={isEdit ? t("detail.changes") : t("detail.content")}>
        {changed.length === 0 ? (
          <p className="ed-muted">{t("detail.noChanges")}</p>
        ) : (
          <DeltaList
            rows={changed.map((f) => ({
              key: f.key,
              what: all(f.labelKey as never),
              before: isEdit ? (f.before ?? empty) : undefined,
              after: f.after ?? empty,
            }))}
          />
        )}
        {photos.length > 0 ? (
          <ul className={pageStyles.photos}>
            {photos.map((p, i) => (
              <li key={p.id}>
                <img src={p.url} alt={t("detail.photoAlt", { n: i + 1 })} width={320} height={240} loading="lazy" />
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {isEdit && same.length > 0 ? (
        <Section title={t("detail.unchanged")}>
          <DescriptionList cols={2} items={same.map((f) => ({ term: all(f.labelKey as never), value: f.after }))} />
        </Section>
      ) : null}

      {pending ? (
        <Section title={t("detail.decide")}>
          {detail.blockedReason ? (
            <Notice tone="attention" title={t(`blocked.${detail.blockedReason}Title`)}>
              {t(`blocked.${detail.blockedReason}Body`)}
            </Notice>
          ) : (
            <SpecForm
              action={decideRevisionAction}
              hidden={{ id: revision.id }}
              fields={[
                {
                  kind: "chips",
                  name: "decision",
                  label: t("detail.decision"),
                  required: true,
                  stack: true,
                  options: [
                    { value: "approve", label: t("detail.approve") },
                    { value: "reject", label: t("detail.reject") },
                  ],
                },
                { kind: "textarea", name: "reason", label: t("detail.reason"), hint: t("detail.reasonHint"), maxLength: 2000, rows: 4 },
              ]}
              submitLabel={t("detail.submit")}
              pendingLabel={t("detail.submitting")}
            />
          )}
        </Section>
      ) : (
        <Section title={t("detail.decisionTaken")}>
          <DescriptionList
            cols={2}
            items={[
              { term: t("detail.decision"), value: t(`states.${revision.state}`) },
              { term: t("detail.decidedAt"), value: revision.decidedAt ? formatDateTime(revision.decidedAt, ctx.locale) : empty },
              { term: t("detail.reason"), value: revision.decisionReason ?? empty },
            ]}
          />
          <p className="ed-small ed-muted">{t("detail.immutable")}</p>
        </Section>
      )}
    </Page>
  );
}
