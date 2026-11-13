import {
  areLegalDocsPublished,
  getLaunchChecklist,
  getLaunchRecords,
  getLegalPublished,
  LAUNCH_ITEM_OWNER,
  LAUNCH_ITEMS,
  LAUNCH_RECORD_FIELDS,
  LAUNCH_STATUSES,
  LEGAL_DOCS,
  type LaunchStatus,
} from "@ed/core/compliance";
import { formatDateTime } from "@ed/i18n/format";
import { Card, Cluster, DescriptionList, Notice, Page, PageHeader, Section, SheetTrigger, Stack, Tag, Unknown } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { saveLaunchItem, saveLaunchRecords, saveLegalPublished } from "@/app/actions/console";
import { NoRole } from "../_components/NoRole";
import { SpecForm, type FieldSpec } from "../_components/SpecForm";
import { requireConsole } from "../_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.launch"))("title") };
}

const DATE_FIELDS = new Set(["anspdcpDate", "dpiaSignedOn", "dpiaLastReviewedOn", "ancomDate", "accessibilityStatementDate"]);
const LONG_FIELDS = new Set(["accessibilityEvaluationMethod"]);
const statusTone = (s: LaunchStatus) => (s === "done" ? "success" : s === "in_progress" ? "accent" : "attention");

/**
 * Launch obligations LAU1–LAU9 (PRD §20). Operator-owned records: the console offers the
 * fields, the operator fills them in. Nothing here is pre-filled; an empty field means
 * "not recorded".
 */
export default async function LaunchPage() {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("console");
  const tc = await getTranslations("common");
  if (!has("platform_admin", "privacy_owner", "security_administrator", "commercial_manager")) {
    return <NoRole title={t("launch.title")} roles={["platform_admin", "privacy_owner", "security_administrator", "commercial_manager"]} />;
  }
  const [checklist, records, legal, signupOpen] = await Promise.all([
    getLaunchChecklist(ctx),
    getLaunchRecords(ctx),
    getLegalPublished(ctx),
    areLegalDocsPublished(ctx),
  ]);
  const canEditRecords = has("platform_admin", "privacy_owner");
  const unknown = <Unknown label={t("launch.notRecorded")} />;
  const done = LAUNCH_ITEMS.filter((id) => checklist[id].status === "done").length;

  const recordFields: FieldSpec[] = LAUNCH_RECORD_FIELDS.map((key) =>
    DATE_FIELDS.has(key)
      ? { kind: "date", name: key, label: t(`launch.records.${key}`), defaultValue: records[key] ?? "", optionalLabel: tc("optional") }
      : LONG_FIELDS.has(key)
        ? { kind: "textarea", name: key, label: t(`launch.records.${key}`), defaultValue: records[key] ?? "", maxLength: 1000, rows: 4, optionalLabel: tc("optional") }
        : { kind: "text", name: key, label: t(`launch.records.${key}`), defaultValue: records[key] ?? "", maxLength: 300, optionalLabel: tc("optional") },
  );
  const legalFields: FieldSpec[] = LEGAL_DOCS.flatMap((doc) => [
    { kind: "text", name: `${doc}Version`, label: t("launch.legal.versionOf", { doc: t(`launch.legal.docs.${doc}`) }), defaultValue: legal[doc].version ?? "", maxLength: 60, optionalLabel: tc("optional") },
    { kind: "date", name: `${doc}PublishedOn`, label: t("launch.legal.dateOf", { doc: t(`launch.legal.docs.${doc}`) }), defaultValue: legal[doc].publishedOn ?? "", optionalLabel: tc("optional") },
  ]);

  return (
    <Page>
      <PageHeader title={t("launch.title")} description={t("launch.description")} />

      <Section title={t("launch.legal.title")}>
        <Notice tone={signupOpen ? "success" : "attention"} title={signupOpen ? t("launch.legal.open") : t("launch.legal.closed")}>
          {signupOpen ? t("launch.legal.openBody") : t("launch.legal.closedBody")}
        </Notice>
        <DescriptionList
          cols={2}
          items={LEGAL_DOCS.map((doc) => ({
            term: t(`launch.legal.docs.${doc}`),
            value:
              legal[doc].version || legal[doc].publishedOn ? (
                <span>
                  {legal[doc].version ? t("launch.legal.version", { version: legal[doc].version! }) : unknown}
                  {" · "}
                  {legal[doc].publishedOn ? <span className="ed-num">{legal[doc].publishedOn}</span> : unknown}
                </span>
              ) : (
                unknown
              ),
          }))}
        />
        {canEditRecords ? (
          <div>
            <SheetTrigger label={t("launch.legal.edit")} title={t("launch.legal.editTitle")} closeLabel={t("close")}>
              <Stack gap={3}>
                <p className="ed-small ed-muted">{t("launch.legal.editBody")}</p>
                <SpecForm
                  action={saveLegalPublished}
                  refreshOnSuccess
                  block
                  success={t("saved")}
                  fields={legalFields}
                  submitLabel={t("launch.legal.save")}
                  pendingLabel={tc("status.saving")}
                />
              </Stack>
            </SheetTrigger>
          </div>
        ) : null}
      </Section>

      <Section title={t("launch.checklist", { done, total: LAUNCH_ITEMS.length })}>
        <Stack gap={3}>
          {LAUNCH_ITEMS.map((id) => {
            const item = checklist[id];
            const owner = LAUNCH_ITEM_OWNER[id];
            return (
              <Card key={id}>
                <Stack gap={3}>
                  <Cluster justify="between">
                    <strong>
                      {id} · {t(`launch.items.${id}.title`)}
                    </strong>
                    <Tag tone={statusTone(item.status)}>{t(`launch.statuses.${item.status}`)}</Tag>
                  </Cluster>
                  <p className="ed-small">{t(`launch.items.${id}.summary`)}</p>
                  <DescriptionList
                    cols={3}
                    items={[
                      { term: t("launch.owner"), value: t(`roles.${owner}`) },
                      { term: t("launch.evidence"), value: item.evidenceRef ?? unknown },
                      {
                        term: t("launch.recorded"),
                        value: item.updatedAt ? t("launch.recordedBy", { time: formatDateTime(new Date(item.updatedAt), ctx.locale), staff: item.updatedByStaffId ?? "—" }) : unknown,
                      },
                      ...(item.note ? [{ term: t("launch.note"), value: item.note }] : []),
                    ]}
                  />
                  {has("platform_admin", owner) ? (
                    <div>
                      <SheetTrigger label={t("launch.record", { item: id })} title={`${id} · ${t(`launch.items.${id}.title`)}`} closeLabel={t("close")}>
                        <SpecForm
                          action={saveLaunchItem}
                          hidden={{ item: id }}
                          refreshOnSuccess
                          block
                          success={t("saved")}
                          fields={[
                            {
                              kind: "select",
                              name: "status",
                              label: t("launch.status"),
                              defaultValue: item.status,
                              required: true,
                              options: LAUNCH_STATUSES.map((s) => ({ value: s, label: t(`launch.statuses.${s}`) })),
                            },
                            { kind: "text", name: "evidenceRef", label: t("launch.evidence"), hint: t("launch.evidenceHint"), defaultValue: item.evidenceRef ?? "", maxLength: 500, optionalLabel: tc("optional") },
                            { kind: "textarea", name: "note", label: t("launch.note"), defaultValue: item.note ?? "", maxLength: 2000, rows: 3, optionalLabel: tc("optional") },
                          ]}
                          submitLabel={t("launch.save")}
                          pendingLabel={tc("status.saving")}
                        />
                      </SheetTrigger>
                    </div>
                  ) : null}
                </Stack>
              </Card>
            );
          })}
        </Stack>
      </Section>

      <Section title={t("launch.records.title")}>
        <p className="ed-small ed-muted">{t("launch.records.body")}</p>
        <DescriptionList
          cols={2}
          items={LAUNCH_RECORD_FIELDS.map((key) => ({
            term: t(`launch.records.${key}`),
            value: records[key] ? DATE_FIELDS.has(key) ? <span className="ed-num">{records[key]}</span> : records[key] : unknown,
          }))}
        />
        {records.updatedAt ? (
          <p className="ed-small ed-muted">
            {t("launch.recordedBy", { time: formatDateTime(new Date(records.updatedAt), ctx.locale), staff: records.updatedByStaffId ?? "—" })}
          </p>
        ) : null}
        {canEditRecords ? (
          <div>
            <SheetTrigger label={t("launch.records.edit")} title={t("launch.records.title")} closeLabel={t("close")}>
              <SpecForm
                action={saveLaunchRecords}
                refreshOnSuccess
                block
                success={t("saved")}
                fields={recordFields}
                submitLabel={t("launch.records.save")}
                pendingLabel={tc("status.saving")}
              />
            </SheetTrigger>
          </div>
        ) : null}
      </Section>
    </Page>
  );
}
