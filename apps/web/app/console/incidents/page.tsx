import { listIncidents } from "@ed/core/incidents";
import { formatDateTime } from "@ed/i18n/format";
import { EmptyState, Notice, Page, PageHeader, Section, Stack, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { closeIncident, openIncident } from "@/app/actions/console";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.incidents"))("title") };
}

/** LAU5: the incident log and the plain-language status message guests see. */
export default async function IncidentsPage() {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("console");
  if (!has("security_administrator", "platform_admin")) {
    return <NoRole title={t("incidents.title")} roles={["security_administrator"]} />;
  }
  const canWrite = has("security_administrator");
  const incidents = await listIncidents(ctx);
  const active = incidents.filter((i) => !i.resolvedAt);

  return (
    <Page>
      <PageHeader title={t("incidents.title")} description={t("incidents.description")} />

      {active.length > 0 ? (
        <Stack gap={3}>
          {active.map((incident) => (
            <Notice key={incident.id} tone="danger" title={t("incidents.activeTitle", { time: formatDateTime(incident.startedAt, ctx.locale) })}>
              <Stack gap={3}>
                <span>
                  {t("incidents.shownToGuests")}{" "}
                  {incident.messageRo ?? incident.messageEn ?? <em>{t("incidents.defaultMessage")}</em>}
                </span>
                {canWrite ? (
                  <ActionForm
                    action={closeIncident}
                    hidden={{ id: incident.id }}
                    refreshOnSuccess
                    block={false}
                    submitLabel={t("incidents.resolve")}
                    pendingLabel={t("incidents.resolving")}
                  />
                ) : null}
              </Stack>
            </Notice>
          ))}
        </Stack>
      ) : (
        <Notice tone="success" title={t("incidents.noneActive")} />
      )}

      {canWrite && active.length === 0 ? (
        <Section title={t("incidents.open")}>
          <p>{t("incidents.openBody")}</p>
          <SpecForm
            action={openIncident}
            refreshOnSuccess
            variant="danger"
            fields={[
              { kind: "textarea", name: "messageRo", label: t("incidents.messageRo"), hint: t("incidents.messageHint"), maxLength: 500, rows: 3 },
              { kind: "textarea", name: "messageEn", label: t("incidents.messageEn"), hint: t("incidents.messageEnHint"), maxLength: 500, rows: 3 },
              { kind: "textarea", name: "internalNote", label: t("incidents.internalNote"), hint: t("incidents.internalNoteHint"), maxLength: 2000, rows: 3 },
            ]}
            submitLabel={t("incidents.openSubmit")}
            pendingLabel={t("incidents.opening")}
          />
        </Section>
      ) : null}
      {!canWrite ? <Notice>{t("incidents.readOnly")}</Notice> : null}

      <Section title={t("incidents.log")}>
        {incidents.length === 0 ? (
          <EmptyState title={t("incidents.empty")}>{t("incidents.emptyBody")}</EmptyState>
        ) : (
          <Table caption={t("incidents.log")}>
            <thead>
              <tr>
                <th scope="col">{t("incidents.started")}</th>
                <th scope="col">{t("incidents.resolved")}</th>
                <th scope="col">{t("incidents.message")}</th>
                <th scope="col">{t("incidents.internalNote")}</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td className="ed-num">{formatDateTime(i.startedAt, ctx.locale)}</td>
                  <td className="ed-num">{i.resolvedAt ? formatDateTime(i.resolvedAt, ctx.locale) : <Tag tone="danger">{t("incidents.stillOpen")}</Tag>}</td>
                  <td>{i.messageRo ?? i.messageEn ?? <em className="ed-muted">{t("incidents.defaultMessage")}</em>}</td>
                  <td>{i.internalNote ?? <span className="ed-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
