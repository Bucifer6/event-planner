import { isSingleOperatorMode, listStaff, STAFF_ROLES } from "@ed/core/staff";
import { formatDate } from "@ed/i18n/format";
import { Cluster, EmptyState, Notice, Page, PageHeader, Section, Table, Tag } from "@ed/ui";
import { IconCheck, IconAlert } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requestStaffRoles } from "@/app/actions/console";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.access"))("title") };
}

/** W8: who is on the staff and with which roles. Changes go to a second platform admin. */
export default async function AccessPage() {
  const { ctx, has, staffId } = await requireConsole();
  const t = await getTranslations("console");
  if (!has("platform_admin", "security_administrator")) {
    return <NoRole title={t("access.title")} roles={["platform_admin", "security_administrator"]} />;
  }
  const [staff, single] = await Promise.all([listStaff(ctx), isSingleOperatorMode(ctx)]);
  const canRequest = has("platform_admin");

  return (
    <Page>
      <PageHeader title={t("access.title")} description={t("access.description")} />
      {single ? (
        <Notice tone="attention" title={t("singleOperator.title")}>
          {t("access.singleOperatorBody")}
        </Notice>
      ) : null}

      <Section title={t("access.staff")}>
        {staff.length === 0 ? (
          <EmptyState title={t("access.empty")} />
        ) : (
          <Table caption={t("access.staff")}>
            <thead>
              <tr>
                <th scope="col">{t("access.person")}</th>
                <th scope="col">{t("access.roles")}</th>
                <th scope="col">{t("access.twoStep")}</th>
                <th scope="col">{t("access.state")}</th>
                <th scope="col">{t("access.since")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.label ?? <span className="ed-muted">{s.accountId}</span>}
                    {s.id === staffId ? <span className="ed-small ed-muted"> · {t("access.you")}</span> : null}
                  </td>
                  <td>
                    <Cluster gap={2}>
                      {s.roles.length === 0 ? <span className="ed-muted">—</span> : s.roles.map((r) => <Tag key={r}>{t(`roles.${r}`)}</Tag>)}
                    </Cluster>
                  </td>
                  <td>
                    {s.twoStepEnabled ? (
                      <Tag tone="success">
                        <IconCheck size={14} /> {t("access.twoStepOn")}
                      </Tag>
                    ) : (
                      <Tag tone="danger">
                        <IconAlert size={14} /> {t("access.twoStepOff")}
                      </Tag>
                    )}
                  </td>
                  <td>{s.active ? t("access.active") : t("access.inactive")}</td>
                  <td className="ed-num">{formatDate(s.createdAt, ctx.locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="ed-small ed-muted">{t("access.twoStepNote")}</p>
      </Section>

      <Section title={t("access.change")}>
        {canRequest ? (
          <>
            <p>{t("access.changeBody")}</p>
            <SpecForm
              action={requestStaffRoles}
              refreshOnSuccess
              success={
                <>
                  {t("access.requested")} <Link href="/console/approvals">{t("access.requestedLink")}</Link>
                </>
              }
              fields={[
                { kind: "email", name: "email", label: t("access.email"), hint: t("access.emailHint"), required: true, maxLength: 254 },
                {
                  kind: "checks",
                  name: "roles",
                  label: t("access.rolesLegend"),
                  options: STAFF_ROLES.map((r) => ({ name: `role_${r}`, label: t(`roles.${r}`), hint: t(`roleHints.${r}`) })),
                },
                { kind: "textarea", name: "reason", label: t("access.reason"), hint: t("access.reasonHint"), required: true, maxLength: 1000, rows: 3 },
              ]}
              submitLabel={t("access.submit")}
              pendingLabel={t("access.submitting")}
            />
            <p className="ed-small ed-muted">{t("access.removeNote")}</p>
          </>
        ) : (
          <Notice>{t("access.adminOnly")}</Notice>
        )}
      </Section>
    </Page>
  );
}
