import { polygonArea, itemSizeText, mmToMetresText } from "@ed/core/spacemodel";
import { getSpaceModel, listAttachableSpaces } from "@ed/core/seating";
import { getPreview, toPreviewView } from "@ed/core/whatif";
import { formatDate } from "@ed/i18n/format";
import { buttonClassName, DescriptionList, EmptyState, Notice, PageHeader, Section, SheetTrigger, Table, Tag, Unknown } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { attachVenueSpaceAction, createOwnSpaceAction, proposeDrawingUpdateAction, removeSpaceModelAction, updateOwnSpaceAction } from "@/app/actions/space";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { ParkingFacts } from "@/app/directory/_slots/ParkingFacts";
import { PlanView } from "@/components/plan/PlanView";
import plan from "@/components/plan/plan.module.css";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { PlannerForm } from "../guests/_components/form";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("space"))("title") };
}

/**
 * The occasion's space model (P-06 V4–V6): the venue's approved plan — with its version and
 * effective date in view — or a simple space the planner describes. A newer venue drawing is
 * only ever a proposal here.
 */
export default async function SpacePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("space");
  const td = await getTranslations("drawings");
  const tc = await getTranslations("common");
  const space = await orNotFound(getSpaceModel(ctx, id));
  const base = `/occasions/${id}/space`;
  const unknown = <Unknown label={tc("unknown")} />;
  const m = (mm: number | null) => (mm === null ? unknown : `${mmToMetresText(mm, ctx.locale)} m`);

  if (!space) {
    const venues = await listAttachableSpaces(ctx, id);
    const usable = venues.filter((v) => v.calibrated);
    const ownForm = (
      <PlannerForm
        id="own-space"
        action={createOwnSpaceAction}
        hidden={{ occasionId: id }}
        variant={usable.length > 0 ? "secondary" : "primary"}
        fields={[
          { name: "name", label: t("own.name"), hint: t("own.nameHint"), required: true, maxLength: 120 },
          { name: "widthMm", label: t("own.width"), hint: t("own.dimsHint") },
          { name: "lengthMm", label: t("own.length") },
        ]}
        optionalLabel={t("own.emptyUnknown")}
        submitLabel={t("own.create")}
        pendingLabel={tc("status.saving")}
      />
    );
    return (
      <>
        <PageHeader level={2} title={t("title")} description={t("description")} />
        {venues.length > 0 ? (
          <Section title={t("venue.title")} level={3}>
            <p className="ed-muted">{t("venue.body")}</p>
            <div>
              {venues.map((v, i) => (
                <div className={plan.spaceCard} key={v.spaceId}>
                  <div className={plan.spaceHead}>
                    <h3>{v.name}</h3>
                    <span className="ed-small ed-muted">{v.supplierName}</span>
                  </div>
                  <ul className={plan.facts}>
                    <li>{t("venue.version", { n: v.versionNo, date: formatDate(v.effectiveAt, ctx.locale) })}</li>
                    <li>
                      {m(v.widthMm)} × {m(v.lengthMm)}
                    </li>
                  </ul>
                  {v.calibrated ? (
                    <ActionForm
                      action={attachVenueSpaceAction}
                      hidden={{ occasionId: id, spaceId: v.spaceId }}
                      refreshOnSuccess
                      variant={i === venues.findIndex((x) => x.calibrated) ? "primary" : "secondary"}
                      block={false}
                      submitLabel={t("venue.use", { name: v.name })}
                      pendingLabel={t("venue.using")}
                    />
                  ) : (
                    <p className="ed-unknown">{t("venue.notCalibrated")}</p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        ) : null}
        <Section title={venues.length > 0 ? t("own.titleAlso") : undefined} level={3}>
          {venues.length === 0 ? (
            <EmptyState title={t("empty.title")}>{t("empty.body")}</EmptyState>
          ) : null}
          {ownForm}
        </Section>
      </>
    );
  }

  const previewId = typeof sp.preview === "string" ? sp.preview : space.pendingUpdatePreviewId;
  const preview = previewId ? await getPreview(ctx, previewId).catch(() => null) : null;
  const { model } = space;
  const usableMm2 = model.areas.length > 0 ? model.areas.reduce((s, a) => s + polygonArea(a.points), 0) : null;
  const tables = model.items.filter((i) => i.kind === "table");
  const meta = space.source === "venue" && space.versionNo !== null && space.effectiveAt ? `v${space.versionNo} · ${formatDate(space.effectiveAt, ctx.locale)}` : t("ownMeta");

  return (
    <>
      <PageHeader
        level={2}
        title={t("title")}
        description={t("description")}
        actions={space.source === "venue" ? <Tag tone="success">{t("source.venue")}</Tag> : <Tag>{t("source.own")}</Tag>}
      />

      {preview && preview.state === "pending" ? <PreviewPanel preview={toPreviewView(preview)} appliedHref={base} discardedHref={base} /> : null}

      {space.newerVersion && !(preview && preview.state === "pending") ? (
        <Notice tone="attention" title={t("newer.title", { n: space.newerVersion.versionNo, date: formatDate(space.newerVersion.effectiveAt, ctx.locale) })}>
          <p>{t("newer.body", { n: space.versionNo ?? 1 })}</p>
          {space.newerVersion.usable ? (
            <ActionForm action={proposeDrawingUpdateAction} hidden={{ occasionId: id }} variant="secondary" block={false} submitLabel={t("newer.see")} pendingLabel={t("newer.preparing")} />
          ) : (
            <p className="ed-unknown">{t("newer.notCalibrated")}</p>
          )}
        </Notice>
      ) : null}

      <Section level={3}>
        <PlanView
          model={model}
          label={t("planLabel", { name: space.name })}
          pictureUrl={space.pictureUrl}
          title={{ name: space.name, meta }}
          poiLabels={model.pois.map((p) => p.name ?? td(`poiKinds.${p.kind}`))}
          options={{ showCounts: true, withBackdrop: model.areas.length === 0 }}
        />
        <div className="ed-actionbar">
          <Link href={`/occasions/${id}/seating`} className={buttonClassName({ variant: "primary" })}>
            {t("toSeating")}
          </Link>
          {space.source === "own" && space.canManage ? (
            <Link href={`${base}/draw`} className={buttonClassName({ variant: "secondary" })}>
              {space.drawn ? t("own.redraw") : t("own.draw")}
            </Link>
          ) : null}
        </div>
        {space.source === "own" && space.canManage ? <p className="ed-small ed-muted">{space.drawn ? t("own.drawnNote") : t("own.drawHint")}</p> : null}
      </Section>

      <Section title={t("facts.title")} level={3}>
        <DescriptionList
          cols={2}
          items={[
            { term: t("facts.space"), value: space.name },
            {
              term: t("facts.source"),
              value: space.source === "venue" ? t("facts.venueVersion", { n: space.versionNo ?? 1, date: space.effectiveAt ? formatDate(space.effectiveAt, ctx.locale) : "" }) : t("facts.ownSource"),
            },
            {
              term: t("facts.stated"),
              value: (
                <>
                  {m(model.widthMm)} × {m(model.lengthMm)}
                </>
              ),
            },
            { term: t("facts.usable"), value: usableMm2 === null ? unknown : `${(Math.round(usableMm2 / 100_000) / 10).toString().replace(".", ctx.locale === "ro" ? "," : ".")} m²` },
            { term: t("facts.tablesPlaced"), value: String(tables.length) },
            { term: t("facts.aisle"), value: `${Math.round(model.aisleMm / 10)} cm` },
          ]}
        />
      </Section>

      {model.tableTypes.length > 0 ? (
        <Section title={t("inventory.title")} level={3}>
          <p className="ed-muted">{t("inventory.body")}</p>
          <Table caption={t("inventory.title")}>
            <thead>
              <tr>
                <th scope="col">{td("public.cols.type")}</th>
                <th scope="col">{td("public.cols.size")}</th>
                <th scope="col" className="ed-right">
                  {td("public.cols.seats")}
                </th>
                <th scope="col" className="ed-right">
                  {t("inventory.placed")}
                </th>
              </tr>
            </thead>
            <tbody>
              {model.tableTypes.map((x) => (
                <tr key={x.id}>
                  <th scope="row">{x.name}</th>
                  <td>{itemSizeText(x, ctx.locale) ?? unknown}</td>
                  <td className="ed-right ed-num">{x.seats ?? unknown}</td>
                  <td className="ed-right ed-num">
                    {tables.filter((i) => i.source === "venue" && i.venueRef === x.id).length} / {x.count ?? unknown}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      ) : null}

      {space.parking ? (
        <Section title={td("parking.publicTitle")} level={3}>
          <ParkingFacts
            view={space.parking}
            labels={{
              unknown: tc("unknown"),
              yes: td("parking.yes"),
              no: td("parking.no"),
              noneOnSite: td("parking.noneOnSite"),
              onSite: td("parking.fields.onSite"),
              spaceCount: td("parking.fields.spaceCount"),
              onStreet: td("parking.fields.onStreet"),
              paid: td("parking.fields.paid"),
              accessibleSpaces: td("parking.fields.accessibleSpaces"),
              walkingDistance: td("parking.fields.walkingDistanceM"),
              metres: (n) => td("parking.metres", { m: n }),
            }}
          />
        </Section>
      ) : null}

      {space.canManage ? (
        <Section title={t("settings.title")} level={3}>
          <div className="ed-cluster">
            <SheetTrigger label={t("settings.open")} title={t("settings.title")} closeLabel={tc("actions.close")}>
              <PlannerForm
                id="space-settings"
                action={updateOwnSpaceAction}
                hidden={{ occasionId: id }}
                fields={[
                  ...(space.source === "own"
                    ? [
                        { name: "name", label: t("own.name"), required: true, maxLength: 120, defaultValue: space.name },
                      ]
                    : []),
                  ...(space.source === "own" && !space.drawn
                    ? [
                        { name: "widthMm", label: t("own.width"), hint: t("own.dimsHint"), defaultValue: model.widthMm === null ? "" : mmToMetresText(model.widthMm, ctx.locale) },
                        { name: "lengthMm", label: t("own.length"), defaultValue: model.lengthMm === null ? "" : mmToMetresText(model.lengthMm, ctx.locale) },
                      ]
                    : []),
                  { name: "aisleCm", label: t("settings.aisle"), hint: t("settings.aisleHint"), type: "number" as const, defaultValue: String(Math.round(model.aisleMm / 10)), required: true },
                ]}
                optionalLabel={t("own.emptyUnknown")}
                submitLabel={t("settings.save")}
                pendingLabel={tc("status.saving")}
                success={tc("status.saved")}
              />
            </SheetTrigger>
            <SheetTrigger label={t("remove.open")} variant="danger-quiet" title={t("remove.title")} closeLabel={tc("actions.close")}>
              <p>{t("remove.body")}</p>
              <ActionForm action={removeSpaceModelAction} hidden={{ occasionId: id }} variant="danger" block={false} submitLabel={t("remove.confirm")} pendingLabel={t("remove.removing")} />
            </SheetTrigger>
          </div>
        </Section>
      ) : null}
    </>
  );
}
