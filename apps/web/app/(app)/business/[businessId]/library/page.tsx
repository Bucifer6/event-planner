import { listLibrary, templateLines, type LibraryItem } from "@ed/core/library";
import { LIBRARY_KINDS, type LibraryKind } from "@ed/db";
import { EmptyState, ExternalLink, List, Section } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { addLibraryItemAction, archiveLibraryItemAction, updateLibraryItemAction } from "@/app/actions/bizoccasions";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { plural } from "@/app/(app)/occasions/_lib/plural";
import { SpecForm, type FieldSpec } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import biz from "../occasions/biz.module.css";
import { FileItemForm } from "./FileItemForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bizoccasions"))("tabs.library") };
}

type T = Awaited<ReturnType<typeof getTranslations<"bizoccasions">>>;

function fieldsFor(kind: Exclude<LibraryKind, "asset">, t: T, item?: LibraryItem): FieldSpec[] {
  const title: FieldSpec = { kind: "text", name: "title", label: t(`library.titleLabel.${kind}`), required: true, maxLength: 160, defaultValue: item?.title };
  if (kind === "contact") {
    const b = item?.body.kind === "contact" ? item.body : null;
    return [
      title,
      { kind: "text", name: "category", label: t("library.contact.category"), maxLength: 80, defaultValue: b?.category ?? "", optionalLabel: t("optional") },
      { kind: "text", name: "person", label: t("library.contact.person"), maxLength: 160, defaultValue: b?.person ?? "", optionalLabel: t("optional") },
      { kind: "email", name: "email", label: t("library.contact.email"), maxLength: 320, defaultValue: b?.email ?? "", optionalLabel: t("optional") },
      { kind: "text", name: "phone", label: t("library.contact.phone"), maxLength: 40, defaultValue: b?.phone ?? "", optionalLabel: t("optional") },
      { kind: "textarea", name: "notes", label: t("library.contact.notes"), maxLength: 2000, rows: 3, defaultValue: b?.notes ?? "", optionalLabel: t("optional") },
    ];
  }
  const lines = item?.body.kind === "template" ? templateLines(item.body.tasks) : item?.body.kind === "checklist" ? item.body.items.join("\n") : "";
  return [title, { kind: "textarea", name: "lines", label: t(`library.linesLabel.${kind}`), hint: t(`library.linesHint.${kind}`), required: true, rows: 8, maxLength: 10000, defaultValue: lines }];
}

function summary(item: LibraryItem, t: T, locale: string): string {
  const b = item.body;
  if (b.kind === "template") return t(`library.count.tasks.${plural(b.tasks.length, locale)}`, { count: b.tasks.length });
  if (b.kind === "checklist") return t(`library.count.steps.${plural(b.items.length, locale)}`, { count: b.items.length });
  if (b.kind === "contact") return [b.category, b.person, b.phone, b.email].filter(Boolean).join(" · ") || t("library.contact.noDetails");
  return t(`library.fileKind.${b.assetKind}`);
}

/**
 * P19: what the team keeps once and reuses — task templates, checklists, supplier contacts
 * and files. Applying an item to an occasion happens on that occasion's page, through a
 * What-if preview. A lapsed plan stops EDITS here (P23); everything already applied stays.
 */
export default async function BusinessLibraryPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ kind?: string }> }) {
  const [{ businessId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("bizoccasions");
  const { items, canEdit } = await orNotFound(listLibrary(ctx, businessId));
  const kind: LibraryKind = (LIBRARY_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as LibraryKind) : "template";
  const rows = items.filter((i) => i.kind === kind);
  const base = `/business/${businessId}/library`;

  return (
    <>
      <nav aria-label={t("library.kindsLabel")} className={biz.subnav}>
        <ul className="ed-tabs">
          {LIBRARY_KINDS.map((k) => (
            <li key={k}>
              <Link className="ed-tab" href={k === "template" ? base : `${base}?kind=${k}`} aria-current={k === kind ? "page" : undefined}>
                {t(`library.kinds.${k}`)}
                <span className={biz.count}>{items.filter((i) => i.kind === k).length}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Section title={t(`library.kinds.${kind}`)} level={2}>
        <p className="ed-muted">{t(`library.about.${kind}`)}</p>
        {rows.length === 0 ? (
          <EmptyState title={t(`library.emptyTitle.${kind}`)}>{canEdit ? t("library.emptyBody") : t("library.lapsed")}</EmptyState>
        ) : (
          <List>
            {rows.map((item) => (
              <li key={item.id} className="ed-row">
                <div className="ed-row__main">
                  <span className="ed-row__title">{item.kind === "asset" && item.url ? <ExternalLink href={item.url}>{item.title}</ExternalLink> : item.title}</span>
                  <span className="ed-row__meta">{summary(item, t, ctx.locale)}</span>
                  {canEdit ? (
                    <details>
                      <summary className={biz.summary}>{t("library.editNamed", { title: item.title })}</summary>
                      <div className="ed-stack" data-gap="4">
                        {item.kind !== "asset" ? (
                          <SpecForm
                            action={updateLibraryItemAction}
                            hidden={{ businessId, itemId: item.id, kind: item.kind }}
                            fields={fieldsFor(item.kind, t, item)}
                            submitLabel={t("library.save")}
                            pendingLabel={t("saving")}
                            variant="secondary"
                            success={t("saved")}
                            refreshOnSuccess
                          />
                        ) : null}
                        <ActionForm
                          action={archiveLibraryItemAction}
                          hidden={{ businessId, itemId: item.id }}
                          refreshOnSuccess
                          variant="danger-quiet"
                          block={false}
                          submitLabel={t("library.archive")}
                          pendingLabel={t("library.archiving")}
                        >
                          <p className="ed-small ed-muted">{t("library.archiveHint")}</p>
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </List>
        )}
      </Section>

      {canEdit ? (
        <Section title={t(`library.addTitle.${kind}`)} level={2}>
          <div className={biz.narrow}>
            {kind === "asset" ? (
              <FileItemForm businessId={businessId} />
            ) : (
              <SpecForm
                key={kind}
                action={addLibraryItemAction}
                hidden={{ businessId, kind }}
                fields={fieldsFor(kind, t)}
                submitLabel={t(`library.add.${kind}`)}
                pendingLabel={t("saving")}
                success={t("library.added")}
                refreshOnSuccess
              />
            )}
          </div>
        </Section>
      ) : rows.length > 0 ? (
        <p className="ed-muted">{t("library.lapsed")}</p>
      ) : null}
    </>
  );
}
