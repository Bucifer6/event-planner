import { COMPLIANCE_ACCESS_DEFAULT_HOURS, COMPLIANCE_VIEW_ROLES, listComplianceGrants, type ComplianceGrantStatus } from "@ed/core/complianceaccess";
import { countActiveStaff } from "@ed/core/staff";
import { formatDateTime } from "@ed/i18n/format";
import { buttonClassName, Cluster, EmptyState, Notice, Page, PageHeader, Section, Stack, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";
import styles from "../console.module.css";
import { requestComplianceAccessAction, revokeComplianceAccessAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("deploys.compliance"))("title") };
}

const HOURS = [4, COMPLIANCE_ACCESS_DEFAULT_HOURS, 72];
const tone = (s: ComplianceGrantStatus) => (s === "live" ? "success" : s === "pending" ? "attention" : s === "rejected" ? "danger" : "neutral");

/** W8: compliance access to one data subject's records — three people, time-boxed, audited. */
export default async function ComplianceAccessPage() {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("deploys.compliance");
  if (!has(...COMPLIANCE_VIEW_ROLES)) return <NoRole title={t("title")} roles={COMPLIANCE_VIEW_ROLES} />;
  const [grants, staffCount] = await Promise.all([listComplianceGrants(ctx), countActiveStaff(ctx)]);
  const when = (d: Date | null) => (d ? formatDateTime(d, ctx.locale) : "—");

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      {staffCount < 3 ? <Notice tone="attention">{t("singleOperator")}</Notice> : null}

      <Section title={t("request.title")}>
        {has("privacy_owner") ? (
          <SpecForm
            action={requestComplianceAccessAction}
            refreshOnSuccess
            success={
              <>
                {t("request.requested")} <Link href="/console/approvals">{t("request.requestedLink")}</Link>
              </>
            }
            fields={[
              { kind: "email", name: "email", label: t("request.email"), hint: t("request.emailHint"), required: true, maxLength: 254 },
              { kind: "textarea", name: "legalReason", label: t("request.reason"), hint: t("request.reasonHint"), required: true, maxLength: 1000, rows: 3 },
              {
                kind: "select",
                name: "hours",
                label: t("request.hours"),
                defaultValue: String(COMPLIANCE_ACCESS_DEFAULT_HOURS),
                options: HOURS.map((h) => ({ value: String(h), label: t("request.hoursOption", { hours: h }) })),
              },
            ]}
            submitLabel={t("request.submit")}
            pendingLabel={t("request.submitting")}
          />
        ) : (
          <Notice>{t("request.ownerOnly")}</Notice>
        )}
        <p className="ed-small ed-muted">{t("threePeople")}</p>
      </Section>

      <Section title={t("list.title")}>
        {grants.length === 0 ? (
          <EmptyState title={t("list.none")} />
        ) : (
          <Table caption={t("list.title")}>
            <thead>
              <tr>
                <th scope="col">{t("list.requested")}</th>
                <th scope="col">{t("list.subject")}</th>
                <th scope="col">{t("list.reason")}</th>
                <th scope="col">{t("list.requester")}</th>
                <th scope="col">{t("list.status")}</th>
                <th scope="col">{t("list.until")}</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td className="ed-num">{when(g.createdAt)}</td>
                  <td>
                    <code>{g.subjectId}</code>
                  </td>
                  <td className={styles.cell}>{g.legalReason}</td>
                  <td className={styles.cell}>
                    {g.requesterLabel ?? "—"}
                    {g.mine ? <span className="ed-small ed-muted"> · {t("list.you")}</span> : null}
                  </td>
                  <td>
                    <Stack gap={2}>
                      <span>
                        <Tag tone={tone(g.status)}>{t(`statuses.${g.status}`)}</Tag>
                      </span>
                      {g.status === "pending" ? (
                        <span className="ed-small ed-muted ed-num">{t("list.approvals", { done: g.approvals, needed: g.approvalsNeeded })}</span>
                      ) : null}
                    </Stack>
                  </td>
                  <td>
                    <Stack gap={2}>
                      <span className="ed-num">{when(g.expiresAt)}</span>
                      {g.status === "live" && g.mine ? (
                        <Cluster gap={2}>
                          <form method="post" action={`/console/compliance/${g.id}/export`}>
                            <button type="submit" className={buttonClassName({ variant: "secondary" })} title={t("list.exportHint")}>
                              {t("list.export")}
                            </button>
                          </form>
                        </Cluster>
                      ) : null}
                      {g.status === "live" && (g.mine || has("security_administrator")) ? (
                        <ActionForm
                          action={revokeComplianceAccessAction}
                          hidden={{ id: g.id }}
                          refreshOnSuccess
                          variant="quiet"
                          block={false}
                          submitLabel={t("list.revoke")}
                          pendingLabel={t("list.revoking")}
                        />
                      ) : null}
                    </Stack>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
