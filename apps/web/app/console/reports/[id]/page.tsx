import { getContentReport, listContentReports } from "@ed/core/reports";
import { isAppError } from "@ed/shared/errors";
import { formatDateTime } from "@ed/i18n/format";
import { DescriptionList, Notice, Page, PageHeader, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { beginReportReview, decideReport } from "@/app/actions/console";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { NoRole } from "../../_components/NoRole";
import { SpecForm } from "../../_components/SpecForm";
import { requireConsole } from "../../_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.reports"))("detailTitle") };
}

/** One report: what was reported, and the decision with the reason given to the affected party. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("console");
  if (!has("listing_moderator", "platform_admin")) {
    return <NoRole title={t("reports.title")} roles={["listing_moderator", "platform_admin"]} />;
  }
  const { id } = await params;
  const report = await getContentReport(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const repeats = report.reporterContactHash
    ? ((await listContentReports(ctx, { state: "all", limit: 500 })).find((r) => r.id === report.id)?.otherReportsBySameReporter ?? 0)
    : 0;
  const open = report.state === "received" || report.state === "reviewing";
  const tone = report.state === "actioned" ? "danger" : report.state === "dismissed" ? "neutral" : report.state === "reviewing" ? "accent" : "attention";

  return (
    <Page>
      <PageHeader
        eyebrow={<Link href="/console/reports">{t("reports.back")}</Link>}
        title={t("reports.detailHeading", { reference: report.reference })}
        actions={<Tag tone={tone}>{t(`reports.states.${report.state}`)}</Tag>}
      />

      <Section title={t("reports.what")}>
        <DescriptionList
          cols={2}
          items={[
            { term: t("reports.target"), value: report.targetRef },
            { term: t("reports.category"), value: t(`reports.categories.${report.reasonCategory}`) },
            { term: t("reports.received"), value: formatDateTime(report.createdAt, ctx.locale) },
            {
              term: t("reports.reporter"),
              value: report.reporterContact ?? (report.reporterContactHash ? t("reports.reporterErased") : t("reports.reporterAnonymous")),
            },
            ...(repeats > 0 ? [{ term: t("reports.repeats"), value: <span className="ed-num">{repeats}</span> }] : []),
            ...(report.targetType ? [{ term: t("reports.linkedObject"), value: `${report.targetType} · ${report.targetId}` }] : []),
          ]}
        />
        <div>
          <span className="ed-label">{t("reports.descriptionLabel")}</span>
          <p className="ed-prose">{report.description}</p>
        </div>
      </Section>

      {open ? (
        <Section title={t("reports.decide")}>
          {report.state === "received" ? (
            <ActionForm
              action={beginReportReview}
              hidden={{ id: report.id }}
              refreshOnSuccess
              variant="secondary"
              block={false}
              submitLabel={t("reports.startReview")}
              pendingLabel={t("reports.startingReview")}
            />
          ) : null}
          <Notice title={t("reports.reasonNoticeTitle")}>{t("reports.reasonNoticeBody")}</Notice>
          <SpecForm
            action={decideReport}
            hidden={{ id: report.id }}
            fields={[
              {
                kind: "chips",
                name: "decision",
                label: t("reports.decision"),
                required: true,
                stack: true,
                options: [
                  { value: "actioned", label: t("reports.decisionActioned") },
                  { value: "dismissed", label: t("reports.decisionDismissed") },
                ],
              },
              {
                kind: "textarea",
                name: "reasonGivenToAffected",
                label: t("reports.reasonGiven"),
                hint: t("reports.reasonGivenHint"),
                required: true,
                maxLength: 2000,
                rows: 5,
              },
              { kind: "textarea", name: "internalNote", label: t("reports.internalNote"), hint: t("reports.internalNoteHint"), maxLength: 2000, rows: 3 },
            ]}
            submitLabel={t("reports.submitDecision")}
            pendingLabel={t("reports.submittingDecision")}
          />
        </Section>
      ) : (
        <Section title={t("reports.decisionTaken")}>
          <DescriptionList
            cols={2}
            items={[
              { term: t("reports.decision"), value: t(`reports.states.${report.state}`) },
              { term: t("reports.decidedAt"), value: report.decidedAt ? formatDateTime(report.decidedAt, ctx.locale) : "—" },
              { term: t("reports.reasonGiven"), value: report.reasonGivenToAffected },
              ...(report.internalNote ? [{ term: t("reports.internalNote"), value: report.internalNote }] : []),
            ]}
          />
        </Section>
      )}
    </Page>
  );
}
