import { getImportPreview, IMPORT_FIELDS, IMPORT_MAX_ROWS } from "@ed/core/guestimport";
import { toPreviewView } from "@ed/core/whatif";
import { Figure, Figures, Notice, PageHeader, Section, Table } from "@ed/ui";
import { IconArrowLeft, IconUpload } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { remapGuestImportAction } from "@/app/actions/guests";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import { PlannerForm } from "../_components/form";
import styles from "../_components/guests.module.css";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ERRORS = ["empty", "tooBig", "tooManyRows", "unreadable", "childColumn", "needNameColumn", "FORBIDDEN", "NOT_FOUND"] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("guests"))("import.title") };
}

export default async function GuestImportPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("guests");
  const tc = await getTranslations("common");
  const base = `/occasions/${id}/guests`;
  const previewId = typeof sp.preview === "string" ? sp.preview : null;
  const errorKey = typeof sp.error === "string" ? sp.error : null;
  const view = previewId ? await getImportPreview(ctx, previewId).catch(() => null) : null;
  const pending = view?.preview.state === "pending" && view.preview.occasionId === id;

  return (
    <>
      <Link href={base} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("detail.back")}
      </Link>
      <PageHeader level={2} title={t("import.title")} description={t("import.description")} />

      {errorKey ? (
        <Notice tone="danger" title={t("import.failed")}>
          {(ERRORS as readonly string[]).includes(errorKey) && !["FORBIDDEN", "NOT_FOUND"].includes(errorKey)
            ? t(`import.errors.${errorKey as "empty"}`, { max: IMPORT_MAX_ROWS })
            : tc("errors.UNEXPECTED")}
        </Notice>
      ) : null}
      {previewId && !view ? <Notice tone="attention">{t("import.gone")}</Notice> : null}

      {view && pending ? (
        <>
          <Section title={t("import.mappingTitle")}>
            <p className="ed-muted">{t("import.mappingBody", { count: view.rowCount })}</p>
            {view.childColumns.length > 0 ? (
              <Notice tone="attention" title={t("import.childColumnsTitle")}>
                {t("import.childColumnsBody", { columns: view.childColumns.map((i) => view.headers[i] || `#${i + 1}`).join(", ") })}
              </Notice>
            ) : null}
            <Table caption={t("import.sampleCaption")}>
              <thead>
                <tr>
                  {view.headers.map((h, i) => (
                    <th key={i} scope="col">
                      {h || `#${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.sampleRows.map((r, ri) => (
                  <tr key={ri}>
                    {view.headers.map((_, ci) => (
                      <td key={ci} className={styles.sample}>
                        {view.childColumns.includes(ci) ? <span className="ed-unknown">{t("import.notImported")}</span> : r[ci]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            <PlannerForm
              id="remap"
              action={remapGuestImportAction}
              hidden={{ occasionId: id, previewId: view.preview.id }}
              variant="secondary"
              submitLabel={t("import.remap")}
              pendingLabel={tc("status.loading")}
              redirectTo={`${base}/import?preview={previewId}`}
              fields={IMPORT_FIELDS.map((f) => ({
                name: `map_${f}`,
                label: t(`import.fields.${f}`),
                type: "select" as const,
                defaultValue: view.mapping[f]?.toString() ?? "",
                options: [
                  { value: "", label: t("import.noColumn") },
                  ...view.headers
                    .map((h, i) => ({ value: String(i), label: h || `#${i + 1}` }))
                    .filter((o) => !view.childColumns.includes(Number(o.value))),
                ],
              }))}
            />
          </Section>

          <Section title={t("import.diffTitle")}>
            <Figures>
              <Figure size="sm" label={t("import.kinds.create")} value={view.summary.create} note={t("import.notes.create")} />
              <Figure size="sm" label={t("import.kinds.change")} value={view.summary.change} note={t("import.notes.change")} />
              <Figure size="sm" label={t("import.kinds.skip")} value={view.summary.skip} note={t("import.notes.skip")} />
            </Figures>
            <PreviewPanel preview={toPreviewView(view.preview)} appliedHref={base} discardedHref={`${base}/import`}>
              <p className="ed-small ed-muted">{t("import.linksNote")}</p>
            </PreviewPanel>
          </Section>
        </>
      ) : (
        <Section title={t("import.uploadTitle")}>
          {view && !pending ? <Notice tone="success">{t("import.alreadyDecided")}</Notice> : null}
          <p className="ed-muted">{t("import.uploadBody")}</p>
          <form method="post" action={`${base}/import/upload`} encType="multipart/form-data" className="ed-form">
            <div className="ed-field">
              <label className="ed-field__label" htmlFor="import-file">
                {t("import.file")}
              </label>
              <span className="ed-field__hint" id="import-file-hint">
                {t("import.fileHint", { max: IMPORT_MAX_ROWS })}
              </span>
              <input
                id="import-file"
                className="ed-input"
                type="file"
                name="file"
                required
                aria-describedby="import-file-hint"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              />
            </div>
            <div>
              <button type="submit" className="ed-btn ed-btn--primary">
                <IconUpload size={16} />
                {t("import.upload")}
              </button>
            </div>
          </form>
          <p className="ed-small ed-muted">{t("import.childrenNote")}</p>
        </Section>
      )}
    </>
  );
}
