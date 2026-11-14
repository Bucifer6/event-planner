import { getListingSpacesEditor } from "@ed/core/drawings";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Notice, PageHeader, Section, SheetTrigger, Tag, type Tone } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSpaceAction, submitParkingAction, withdrawSpaceRevisionAction } from "@/app/actions/drawings";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { ParkingFacts } from "@/app/directory/_slots/ParkingFacts";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { PlannerForm } from "@/app/(app)/occasions/[id]/guests/_components/form";
import plan from "@/components/plan/plan.module.css";
import { requireCtx } from "@/lib/ctx";
import styles from "../../../../business.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("drawings"))("list.title") };
}

const STATUS_TONE: Record<string, Tone> = { draft: "neutral", pending: "attention", live: "success" };

/** Spaces and drawings of one venue listing (P-06), plus its parking facts (V10). */
export default async function SpacesPage({ params, searchParams }: { params: Promise<{ businessId: string; listingId: string }>; searchParams: Promise<{ removed?: string }> }) {
  const [{ businessId, listingId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("drawings");
  const tc = await getTranslations("common");
  const ed = await orNotFound(getListingSpacesEditor(ctx, listingId));
  if (ed.businessId !== businessId) notFound();
  const base = `/business/${businessId}/listings/${listingId}/spaces`;
  const tri = (v: boolean | null | undefined) => (v === null || v === undefined ? "unknown" : v ? "yes" : "no");
  const triOptions = [
    { value: "unknown", label: t("parking.options.unknown") },
    { value: "yes", label: t("parking.options.yes") },
    { value: "no", label: t("parking.options.no") },
  ];
  const facts = ed.parking.pending?.facts ?? ed.parking.liveFacts;

  const addForm = (
    <PlannerForm
      id="new-space"
      action={createSpaceAction}
      hidden={{ businessId, listingId }}
      fields={[
        { name: "name", label: t("fields.spaceName"), hint: t("fields.spaceNameHint"), required: true, maxLength: 120 },
        { name: "widthMm", label: t("fields.statedWidth"), hint: t("fields.statedHint") },
        { name: "lengthMm", label: t("fields.statedLength") },
      ]}
      optionalLabel={t("optionalUnknown")}
      redirectTo={`${base}/{id}`}
      submitLabel={t("list.create")}
      pendingLabel={tc("status.saving")}
    />
  );

  return (
    <div className={styles.narrow}>
      <PageHeader
        level={2}
        eyebrow={<Link href={`/business/${businessId}/listings/${listingId}`}>{t("list.back", { name: ed.listing.name })}</Link>}
        title={t("list.title")}
        description={t("list.description")}
      />
      {sp.removed ? <Notice tone="success" title={t("list.removed")} /> : null}

      <Section title={t("list.spaces")} level={3}>
        {ed.spaces.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            action={
              ed.canEdit ? (
                <SheetTrigger label={t("list.addFirst")} variant="primary" title={t("list.addTitle")} closeLabel={tc("actions.close")}>
                  {addForm}
                </SheetTrigger>
              ) : undefined
            }
          >
            {t("list.emptyBody")}
          </EmptyState>
        ) : (
          <>
            <div>
              {ed.spaces.map((s) => (
                <div className={plan.spaceCard} key={s.id}>
                  <div className={plan.spaceHead}>
                    <h3>{s.name}</h3>
                    <span className="ed-cluster">
                      <Tag tone={STATUS_TONE[s.status]}>{s.status === "live" ? t("status.liveVersion", { n: s.liveVersionNo ?? 1, date: s.liveEffectiveAt ? formatDate(s.liveEffectiveAt, ctx.locale) : "" }) : t(`status.${s.status}`)}</Tag>
                      {s.status === "live" && s.pending ? <Tag tone="attention">{t("status.editPending")}</Tag> : null}
                    </span>
                  </div>
                  <ul className={plan.facts}>
                    <li>{s.hasDrawing ? t("list.hasDrawing") : <span className="ed-unknown">{t("list.noDrawing")}</span>}</li>
                    <li>{s.calibrated ? t("list.calibrated") : <span className="ed-unknown">{t("list.notCalibrated")}</span>}</li>
                    {s.dirty && !s.pending ? <li>{t("list.unsent")}</li> : null}
                  </ul>
                  {s.lastRejection ? (
                    <Notice tone="attention" title={t("rejected.title")}>
                      {s.lastRejection.reason}
                    </Notice>
                  ) : null}
                  <div>
                    <Link href={`${base}/${s.id}`} className={buttonClassName({})}>
                      {t("list.open", { name: s.name })}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            {ed.canEdit ? (
              <div>
                <SheetTrigger label={t("list.add")} variant="primary" title={t("list.addTitle")} closeLabel={tc("actions.close")}>
                  {addForm}
                </SheetTrigger>
              </div>
            ) : null}
          </>
        )}
      </Section>

      <Section title={t("parking.title")} level={3} id="parcare">
        <p className="ed-muted">{t("parking.description")}</p>
        {ed.parking.live ? (
          <ParkingFacts
            view={ed.parking.live}
            labels={{
              unknown: tc("unknown"),
              yes: t("parking.yes"),
              no: t("parking.no"),
              noneOnSite: t("parking.noneOnSite"),
              onSite: t("parking.fields.onSite"),
              spaceCount: t("parking.fields.spaceCount"),
              onStreet: t("parking.fields.onStreet"),
              paid: t("parking.fields.paid"),
              accessibleSpaces: t("parking.fields.accessibleSpaces"),
              walkingDistance: t("parking.fields.walkingDistanceM"),
              metres: (n) => t("parking.metres", { m: n }),
            }}
          />
        ) : (
          <p className="ed-unknown">{t("parking.nothingPublic")}</p>
        )}
        {ed.parking.live?.countMismatch ? (
          <Notice tone="attention" title={t("parking.mismatchTitle")}>
            {t("parking.mismatchBody", { stated: ed.parking.live.countMismatch.stated, drawn: ed.parking.live.countMismatch.drawn })}
          </Notice>
        ) : null}
        {ed.parking.lastRejection ? (
          <Notice tone="attention" title={t("rejected.title")}>
            {ed.parking.lastRejection.reason}
          </Notice>
        ) : null}
        {ed.parking.pending ? (
          <Notice title={t("parking.pendingTitle")}>
            <p>{t("parking.pendingBody", { date: formatDateTime(ed.parking.pending.submittedAt, ctx.locale) })}</p>
            <ActionForm
              action={withdrawSpaceRevisionAction}
              hidden={{ businessId, listingId, revisionId: ed.parking.pending.revisionId }}
              refreshOnSuccess
              variant="quiet"
              block={false}
              submitLabel={t("withdraw")}
              pendingLabel={t("withdrawing")}
            />
          </Notice>
        ) : null}
        {ed.canEdit ? (
          <SheetTrigger label={ed.parking.liveFacts || ed.parking.pending ? t("parking.change") : t("parking.state")} title={t("parking.formTitle")} closeLabel={tc("actions.close")}>
            <PlannerForm
              id="parking"
              action={submitParkingAction}
              hidden={{ businessId, listingId }}
              fields={[
                { name: "onSite", label: t("parking.fields.onSite"), type: "select", options: triOptions, defaultValue: tri(facts?.onSite), hint: t("parking.onSiteHint") },
                { name: "spaceCount", label: t("parking.fields.spaceCount"), type: "number", defaultValue: facts?.spaceCount === null || facts?.spaceCount === undefined ? "" : String(facts.spaceCount), hint: ed.parking.drawn === null ? t("parking.countHint") : t("parking.countHintDrawn", { drawn: ed.parking.drawn }) },
                ...(ed.parking.drawn !== null ? [{ name: "confirmCount", label: t("parking.confirmCount"), type: "checkbox" as const, hint: t("parking.confirmCountHint", { drawn: ed.parking.drawn }) }] : []),
                { name: "onStreet", label: t("parking.fields.onStreet"), type: "select", options: triOptions, defaultValue: tri(facts?.onStreet) },
                { name: "paid", label: t("parking.fields.paid"), type: "select", options: triOptions, defaultValue: tri(facts?.paid) },
                { name: "accessibleSpaces", label: t("parking.fields.accessibleSpaces"), type: "select", options: triOptions, defaultValue: tri(facts?.accessibleSpaces) },
                { name: "walkingDistanceM", label: t("parking.fields.walkingDistanceM"), type: "number", defaultValue: facts?.walkingDistanceM === null || facts?.walkingDistanceM === undefined ? "" : String(facts.walkingDistanceM), hint: t("parking.walkingHint") },
              ]}
              optionalLabel={t("optionalUnknown")}
              submitLabel={t("parking.submit")}
              pendingLabel={t("sending")}
              success={t("parking.sent")}
            />
          </SheetTrigger>
        ) : null}
      </Section>
    </div>
  );
}
