import { isFreshAuth } from "@ed/core/accounts";
import { getBusinessOccasion } from "@ed/core/bizoccasions";
import { listHandoverCandidates } from "@ed/core/handover";
import { listLibrary, listOccasionLibraryFiles } from "@ed/core/library";
import { getPreview, toPreviewView } from "@ed/core/whatif";
import { formatDate } from "@ed/i18n/format";
import { isAppError } from "@ed/shared/errors";
import { buttonClassName, EmptyState, ExternalLink, List, Notice, Section } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { applyLibraryItemAction, proposeHandoverAction, shareLibraryFileAction } from "@/app/actions/bizoccasions";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import biz from "../biz.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bizoccasions"))("manage.title") };
}

/**
 * One business occasion, from the business's side: apply things from the shared library
 * (P19 — always through a What-if preview) and hand the occasion over to the client (P22).
 * The planning itself happens in the occasion, like for any other occasion.
 */
export default async function BusinessOccasionPage({ params, searchParams }: { params: Promise<{ businessId: string; occasionId: string }>; searchParams: Promise<{ preview?: string }> }) {
  const [{ businessId, occasionId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("bizoccasions");
  const { occasion, role } = await orNotFound(getBusinessOccasion(ctx, { businessId, occasionId }));
  const [library, files, fresh] = await Promise.all([listLibrary(ctx, businessId), orNotFound(listOccasionLibraryFiles(ctx, occasionId)), isFreshAuth(ctx)]);
  const canHandOver = role !== "staff";
  const candidates = canHandOver ? await listHandoverCandidates(ctx, { occasionId }) : [];
  const base = `/business/${businessId}/occasions`;

  let preview = null;
  if (sp.preview) {
    try {
      const p = await getPreview(ctx, sp.preview);
      if (p.occasionId === occasionId && p.state === "pending") preview = toPreviewView(p);
    } catch (e) {
      if (!isAppError(e)) throw e;
    }
  }
  const applicable = library.items.filter((i) => i.kind !== "asset");
  const shareable = library.items.filter((i) => i.kind === "asset" && !files.some((f) => f.itemId === i.id));

  return (
    <>
      <nav aria-label={t("manage.back")}>
        <Link href={base} className={biz.back}>{t("manage.back")}</Link>
      </nav>
      <Section
        title={occasion.title}
        level={2}
        actions={
          <Link href={`/occasions/${occasion.id}`} className={buttonClassName({ variant: "secondary" })}>
            {t("manage.openPlan")}
          </Link>
        }
      >
        <p className="ed-muted">{occasion.startsAt ? formatDate(occasion.startsAt, ctx.locale, occasion.timezone) : t("list.noDate")}</p>
      </Section>

      {preview ? (
        <Section title={t("manage.previewTitle")} level={2}>
          <PreviewPanel preview={preview} appliedHref={preview.kind === "bizoccasion.handover" ? `${base}?handedOver=1` : `${base}/${occasionId}`} discardedHref={`${base}/${occasionId}`} />
        </Section>
      ) : null}

      <Section title={t("apply.title")} level={2}>
        <div className={biz.narrow}>
          {applicable.length === 0 ? (
            <EmptyState
              title={t("apply.emptyTitle")}
              action={
                <Link href={`/business/${businessId}/library`} className={buttonClassName({ variant: "secondary" })}>
                  {t("apply.openLibrary")}
                </Link>
              }
            >
              {t("apply.emptyBody")}
            </EmptyState>
          ) : (
            <SpecForm
              action={applyLibraryItemAction}
              hidden={{ businessId, occasionId }}
              fields={[
                {
                  kind: "select",
                  name: "itemId",
                  label: t("apply.item"),
                  hint: t("apply.itemHint"),
                  required: true,
                  placeholder: t("choose"),
                  options: applicable.map((i) => ({ value: i.id, label: `${t(`library.kindOne.${i.kind}`)} — ${i.title}` })),
                },
              ]}
              submitLabel={t("apply.preview")}
              pendingLabel={t("apply.previewing")}
              variant="secondary"
            />
          )}
        </div>
      </Section>

      <Section title={t("files.title")} level={2}>
        <div className={biz.narrow}>
          <p className="ed-muted">{t("files.body")}</p>
          {files.length > 0 ? (
            <List>
              {files.map((f) => (
                <li key={f.id} className="ed-row">
                  <div className="ed-row__main">
                    <span className="ed-row__title">{f.url ? <ExternalLink href={f.url}>{f.title}</ExternalLink> : f.title}</span>
                    <span className="ed-row__meta">{t("files.sharedOn", { date: formatDate(f.sharedAt, ctx.locale) })}</span>
                  </div>
                </li>
              ))}
            </List>
          ) : null}
          {shareable.length > 0 && library.canEdit ? (
            <SpecForm
              action={shareLibraryFileAction}
              hidden={{ businessId, occasionId }}
              fields={[{ kind: "select", name: "itemId", label: t("files.item"), required: true, placeholder: t("choose"), options: shareable.map((i) => ({ value: i.id, label: i.title })) }]}
              submitLabel={t("files.share")}
              pendingLabel={t("saving")}
              variant="secondary"
              success={t("files.shared")}
              refreshOnSuccess
            />
          ) : files.length === 0 ? (
            <p className="ed-muted">{library.canEdit ? t("files.none") : t("files.lapsed")}</p>
          ) : null}
        </div>
      </Section>

      {canHandOver ? (
        <Section title={t("handover.title")} level={2} id="handover">
          <div className={biz.narrow}>
            <p>{t("handover.body")}</p>
            <ul className="ed-prose">
              <li>{t("handover.ends1")}</li>
              <li>{t("handover.ends2")}</li>
              <li>{t("handover.ends3")}</li>
              <li>{t("handover.stays")}</li>
            </ul>
            {candidates.length === 0 ? (
              <EmptyState
                title={t("handover.noClientTitle")}
                action={
                  <Link href={`/occasions/${occasion.id}/team`} className={buttonClassName({ variant: "secondary" })}>
                    {t("handover.inviteClient")}
                  </Link>
                }
              >
                {t("handover.noClientBody")}
              </EmptyState>
            ) : (
              <>
                {!fresh ? (
                  <Notice title={t("handover.freshTitle")}>
                    {t("handover.freshBody")} <Link href="/account#fresh">{t("handover.freshLink")}</Link>
                  </Notice>
                ) : null}
                <SpecForm
                  action={proposeHandoverAction}
                  hidden={{ businessId, occasionId }}
                  fields={[
                    {
                      kind: "select",
                      name: "toMemberId",
                      label: t("handover.to"),
                      hint: t("handover.toHint"),
                      required: true,
                      placeholder: t("choose"),
                      options: candidates.map((c) => ({ value: c.memberId, label: c.name })),
                    },
                  ]}
                  submitLabel={t("handover.preview")}
                  pendingLabel={t("apply.previewing")}
                  variant="secondary"
                />
              </>
            )}
          </div>
        </Section>
      ) : null}
    </>
  );
}
