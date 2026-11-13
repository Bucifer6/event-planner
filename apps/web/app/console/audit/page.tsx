import { auditFilterSchema, listAudit } from "@ed/core/auditview";
import { ACTOR_KINDS } from "@ed/db";
import { formatDateTime } from "@ed/i18n/format";
import { Button, buttonClassName, Cluster, EmptyState, Notice, Page, PageHeader, Section, SelectField, Table, TextField } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { NoRole } from "../_components/NoRole";
import { requireConsole } from "../_lib";
import styles from "../console.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.audit"))("title") };
}

const FILTER_KEYS = ["actorKind", "actorId", "action", "objectType", "objectId", "from", "to"] as const;
type Search = Partial<Record<(typeof FILTER_KEYS)[number] | "cursor", string>>;

function compactJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value, null, 1);
}

/** W8: the audit log, read-only. Filters travel in the URL so a view can be shared or exported. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("console");
  if (!has("platform_admin", "security_administrator", "privacy_owner")) {
    return <NoRole title={t("audit.title")} roles={["platform_admin", "security_administrator", "privacy_owner"]} />;
  }
  const sp = await searchParams;
  const raw = Object.fromEntries(FILTER_KEYS.map((k) => [k, typeof sp[k] === "string" ? sp[k] : ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const parsed = auditFilterSchema.safeParse(raw);
  const page = parsed.success ? await listAudit(ctx, { ...parsed.data, cursor: sp.cursor }) : { entries: [], nextCursor: null };
  const query = new URLSearchParams(Object.entries(raw).filter(([, v]) => v !== ""));
  const filtered = [...query.keys()].length > 0;
  const older = page.nextCursor ? `/console/audit?${new URLSearchParams([...query, ["cursor", page.nextCursor]])}` : null;

  return (
    <Page>
      <PageHeader title={t("audit.title")} description={t("audit.description")} />

      <Section title={t("audit.filters")}>
        <form method="get" action="/console/audit" className={styles.filterForm}>
          <div className={styles.filters}>
            <SelectField id="f-actorKind" name="actorKind" label={t("audit.actorKind")} defaultValue={raw.actorKind}>
              <option value="">{t("audit.anyActor")}</option>
              {ACTOR_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`audit.actorKinds.${k}`)}
                </option>
              ))}
            </SelectField>
            <TextField id="f-actorId" name="actorId" label={t("audit.actorId")} defaultValue={raw.actorId} maxLength={200} autoComplete="off" />
            <TextField id="f-action" name="action" label={t("audit.action")} hint={t("audit.actionHint")} defaultValue={raw.action} maxLength={200} autoComplete="off" />
            <TextField id="f-objectType" name="objectType" label={t("audit.objectType")} defaultValue={raw.objectType} maxLength={100} autoComplete="off" />
            <TextField id="f-objectId" name="objectId" label={t("audit.objectId")} defaultValue={raw.objectId} maxLength={200} autoComplete="off" />
            <TextField id="f-from" name="from" type="date" label={t("audit.from")} defaultValue={raw.from} />
            <TextField id="f-to" name="to" type="date" label={t("audit.to")} defaultValue={raw.to} />
          </div>
          <Cluster gap={2}>
            <Button type="submit" variant="primary">
              {t("audit.apply")}
            </Button>
            {filtered ? (
              <Link href="/console/audit" className={buttonClassName({ variant: "quiet" })}>
                {t("audit.clear")}
              </Link>
            ) : null}
          </Cluster>
        </form>
      </Section>

      {!parsed.success ? <Notice tone="danger" title={t("audit.badFilter")} /> : null}

      <Section
        title={t("audit.entries")}
        actions={
          <form method="post" action="/console/audit/export">
            {Object.entries(raw).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <Button type="submit">{t("audit.export")}</Button>
          </form>
        }
      >
        <p className="ed-small ed-muted">{t("audit.exportNote")}</p>
        {page.entries.length === 0 ? (
          <EmptyState title={t("audit.empty")}>{filtered ? t("audit.emptyFiltered") : null}</EmptyState>
        ) : (
          <Table caption={t("audit.entries")}>
            <thead>
              <tr>
                <th scope="col">{t("audit.when")}</th>
                <th scope="col">{t("audit.actor")}</th>
                <th scope="col">{t("audit.action")}</th>
                <th scope="col">{t("audit.object")}</th>
                <th scope="col">{t("audit.details")}</th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((e) => {
                const details = [
                  ["before", compactJson(e.before)],
                  ["after", compactJson(e.after)],
                  ["meta", compactJson(e.meta)],
                ].filter((d): d is [string, string] => d[1] !== null);
                return (
                  <tr key={e.id}>
                    <td className={styles.nowrap}>
                      {formatDateTime(e.at, ctx.locale)}
                    </td>
                    <td className={styles.cell}>
                      {t(`audit.actorKinds.${e.actorKind}`)}
                      {e.actorId ? (
                        <>
                          <br />
                          <span className="ed-small ed-muted">{e.actorId}</span>
                        </>
                      ) : null}
                    </td>
                    <td className={styles.cell}>{e.action}</td>
                    <td className={styles.cell}>
                      {e.objectType}
                      {e.objectId ? (
                        <>
                          <br />
                          <span className="ed-small ed-muted">{e.objectId}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {details.length === 0 ? (
                        <span className="ed-muted">—</span>
                      ) : (
                        <details>
                          <summary className={styles.summary}>{t("audit.showDetails")}</summary>
                          {details.map(([label, text]) => (
                            <div key={label}>
                              <span className="ed-label">{t(`audit.detail.${label as "before" | "after" | "meta"}`)}</span>
                              <pre className={styles.json}>{text}</pre>
                            </div>
                          ))}
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {older ? (
          <div>
            <Link href={older} className={buttonClassName()}>
              {t("audit.older")}
            </Link>
          </div>
        ) : null}
      </Section>
    </Page>
  );
}
