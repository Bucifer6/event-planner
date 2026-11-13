import { getSeatingEditor } from "@ed/core/seating";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Notice, PageHeader, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { publishSeatingAction, unpublishSeatingAction } from "@/app/actions/seating";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { SeatingEditor } from "@/components/plan/SeatingEditor";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("seating"))("title") };
}

/**
 * Seating and layout (C-01), fit checks per meal stage (C-02) and the publish switch for the
 * guest-facing seat (C-08) — all on the occasion's one space model.
 */
export default async function SeatingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("seating");
  const td = await getTranslations("drawings");
  const ed = await orNotFound(getSeatingEditor(ctx, id));

  if (!ed) {
    return (
      <>
        <PageHeader level={2} title={t("title")} description={t("description")} />
        <Section>
          <EmptyState
            title={t("empty.title")}
            action={
              <Link href={`/occasions/${id}/space`} className={buttonClassName({ variant: "primary" })}>
                {t("empty.action")}
              </Link>
            }
          >
            {t("empty.body")}
          </EmptyState>
        </Section>
      </>
    );
  }

  const { space } = ed;
  const meta = space.source === "venue" && space.versionNo !== null && space.effectiveAt ? `v${space.versionNo} · ${formatDate(space.effectiveAt, ctx.locale)}` : t("ownMeta");
  const seatedPeople = ed.roster.reduce((n, h) => n + h.adults.filter((a) => a.tableItemId).length + (h.extra?.tableItemId ? h.extra.count : 0) + (h.children?.tableItemId ? h.children.count : 0), 0);
  const syncKey = JSON.stringify([
    space.model.items.map((i) => [i.id, i.version]),
    ed.stages.map((s) => [s.id, s.name, s.position, s.states]),
    ed.roster.map((h) => [h.adults.map((a) => [a.tableItemId, a.seatNo]), h.extra, h.children]),
    space.versionNo,
    space.model.aisleMm,
  ]);

  return (
    <>
      <PageHeader
        level={2}
        title={t("title")}
        description={t("description")}
        actions={ed.publishedAt ? <Tag tone="success">{t("publish.tagOn")}</Tag> : <Tag>{t("publish.tagOff")}</Tag>}
      />
      {space.newerVersion ? (
        <Notice tone="attention" title={t("newerDrawing.title")}>
          <Link href={`/occasions/${id}/space`}>{t("newerDrawing.link")}</Link>
        </Notice>
      ) : null}

      <SeatingEditor
        occasionId={id}
        locale={ctx.locale}
        canManage={ed.canManage}
        model={space.model}
        stages={ed.stages}
        roster={ed.roster}
        attending={ed.fit.attending}
        invited={ed.fit.invited}
        title={{ name: space.name, meta }}
        pictureUrl={space.pictureUrl}
        poiLabels={space.model.pois.map((p) => p.name ?? td(`poiKinds.${p.kind}`))}
        syncKey={syncKey}
      />

      <Section title={t("publish.title")} level={3}>
        {ed.publishedAt ? (
          <>
            <p>{t("publish.onBody", { date: formatDateTime(ed.publishedAt, ctx.locale) })}</p>
            {ed.canManage ? (
              <ActionForm action={unpublishSeatingAction} hidden={{ occasionId: id }} refreshOnSuccess variant="secondary" block={false} submitLabel={t("publish.hide")} pendingLabel={t("publish.hiding")} />
            ) : null}
          </>
        ) : (
          <>
            <p>{t("publish.offBody")}</p>
            <p className="ed-small ed-muted">{t("publish.seatedNow", { count: seatedPeople })}</p>
            {ed.canManage ? (
              <ActionForm action={publishSeatingAction} hidden={{ occasionId: id }} refreshOnSuccess variant="secondary" block={false} submitLabel={t("publish.show")} pendingLabel={t("publish.showing")} />
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}
