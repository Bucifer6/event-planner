"use client";

import {
  buildPlanScene,
  FIXTURE_KIND_VALUES,
  mmToMetresText,
  parseMetres,
  POI_KIND_VALUES,
  polygonArea,
  type PlanModel,
  type PlanPoint,
  type SpaceMarkings,
} from "@ed/core/spacemodel";
import { Button, Notice, Section, SelectField, Sheet, Tag, TextField, Unknown } from "@ed/ui";
import { IconEdit, IconPlus, IconTrash } from "@ed/ui/icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { attachDrawingAction, calibrateSpaceAction, saveMarkingsAction } from "@/app/actions/drawings";
import { PlanSvg } from "@/components/plan/PlanSvg";
import { useMeasuredWidth } from "@/components/plan/PlanView";
import plan from "@/components/plan/plan.module.css";
import { FileField } from "@/components/upload/FileField";

// The business's drawing desk (P-06): 1 the drawing, 2 calibration (V7), 3 markings (V2, V8,
// V11). Every marking can be made two ways of equal standing: by touching the drawing, or by
// typing its position and size — nothing here needs a drag or a pointer.

type Locale = "ro" | "en";

export type SpaceEditorProps = {
  businessId: string;
  listingId: string;
  spaceId: string;
  locale: Locale;
  canEdit: boolean;
  name: string;
  version: number;
  pictureUrl: string | null;
  pdfWithoutPicture: boolean;
  hasDrawing: boolean;
  pixelWidth: number | null;
  pixelHeight: number | null;
  mmPerPx: number | null;
  calibration: { ax: number; ay: number; bx: number; by: number; distanceMm: number } | null;
  markings: SpaceMarkings;
  widthMm: number | null;
  lengthMm: number | null;
};

type Group = "areas" | "tableTypes" | "fixtures" | "pois" | "parkingAreas";
type Editing = { group: Group; id: string | null } | null;
/** What the next touch on the drawing means. */
type Placing =
  | { kind: "point"; group: "fixtures" | "pois"; id: string }
  | { kind: "rect"; group: "areas" | "parkingAreas"; id: string; first: PlanPoint | null }
  | { kind: "outline"; group: "areas"; id: string; points: PlanPoint[] }
  | { kind: "cal"; which: "a" | "b" }
  | null;

const uid = () => Math.random().toString(36).slice(2, 10);
const rectPoints = (x: number, y: number, w: number, l: number): PlanPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + l },
  { x, y: y + l },
];
const isAxisRect = (p: PlanPoint[]) => p.length === 4 && p[0]!.y === p[1]!.y && p[1]!.x === p[2]!.x && p[2]!.y === p[3]!.y && p[3]!.x === p[0]!.x;

export function SpaceEditor(props: SpaceEditorProps) {
  const t = useTranslations("drawings");
  const tc = useTranslations("common");
  const router = useRouter();
  const { locale, canEdit } = props;
  const [markings, setMarkings] = useState(props.markings);
  const [version, setVersion] = useState(props.version);
  const [mmPerPx, setMmPerPx] = useState(props.mmPerPx);
  const [cal, setCal] = useState({
    ax: props.calibration?.ax ?? null,
    ay: props.calibration?.ay ?? null,
    bx: props.calibration?.bx ?? null,
    by: props.calibration?.by ?? null,
  } as { ax: number | null; ay: number | null; bx: number | null; by: number | null });
  const [distance, setDistance] = useState(props.calibration ? mmToMetresText(props.calibration.distanceMm, locale) : "");
  const [calError, setCalError] = useState<{ field?: string; message: string } | null>(null);
  const [placing, setPlacing] = useState<Placing>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const svgWrap = useRef<HTMLDivElement | null>(null);
  const calibrated = mmPerPx !== null;
  const m = (mm: number | null) => (mm === null ? null : mmToMetresText(mm, locale));

  // The sheet: calibrated → real millimetres; not yet → the picture's own pixels (no scale bar).
  const model: PlanModel = useMemo(() => {
    const pw = props.pixelWidth ?? 1000;
    const ph = props.pixelHeight ?? 700;
    const unit = mmPerPx ?? 1;
    return {
      name: props.name,
      source: "drawing",
      versionNo: null,
      effectiveAt: null,
      widthMm: props.widthMm,
      lengthMm: props.lengthMm,
      backdrop: props.pictureUrl ? { widthMm: Math.round(pw * unit), heightMm: Math.round(ph * unit) } : null,
      areas: calibrated ? markings.areas : [],
      tableTypes: markings.tableTypes,
      items: calibrated
        ? markings.fixtures.map((f) => ({ id: f.id, kind: "fixture" as const, source: "venue" as const, name: f.name, label: f.name, shape: "rect" as const, diameterMm: null, widthMm: f.widthMm, lengthMm: f.lengthMm, seats: null, x: f.x, y: f.y, rotation: f.rotation }))
        : [],
      pois: calibrated ? markings.pois : [],
      parkingAreas: calibrated ? markings.parkingAreas : [],
      aisleMm: 600,
    };
  }, [props.name, props.pixelWidth, props.pixelHeight, props.pictureUrl, props.widthMm, props.lengthMm, mmPerPx, calibrated, markings]);

  const width = Math.min(measured || 358, 1040);
  const scene = useMemo(() => buildPlanScene(model, { width, title: { name: props.name, meta: calibrated ? t("plan.working") : t("plan.notCalibrated") }, showScale: calibrated, scaleLabel: (n) => `${n} m` }), [model, width, props.name, calibrated, t]);

  /** Pointer position → sheet units (mm when calibrated, picture pixels otherwise). */
  const toUnits = useCallback(
    (e: PointerEvent<Element>): PlanPoint | null => {
      const svg = svgWrap.current?.querySelector("svg");
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) * scene.width) / r.width;
      const py = ((e.clientY - r.top) * scene.height) / r.height;
      return { x: Math.round((px - scene.originX) / scene.scale), y: Math.round((py - scene.originY) / scene.scale) };
    },
    [scene],
  );
  const X = (v: number) => scene.originX + v * scene.scale;
  const Y = (v: number) => scene.originY + v * scene.scale;

  async function persist(next: SpaceMarkings, label: string) {
    const before = markings;
    setMarkings(next); // optimistic: the drawing follows the finger at once
    setBusy(label);
    setError(null);
    setSaved(false);
    const res = await saveMarkingsAction({ spaceId: props.spaceId, markings: next, version });
    setBusy(null);
    if (res.ok) {
      setVersion(res.data.version);
      setMarkings(res.data.markings);
      setSaved(true);
    } else {
      setMarkings(before);
      setError(res.error.message);
      if (res.error.code === "CONFLICT") router.refresh();
    }
  }

  function onSheetPointer(e: PointerEvent<HTMLDivElement>) {
    if (!placing || !canEdit) return;
    const at = toUnits(e);
    if (!at) return;
    if (placing.kind === "cal") {
      const p = { x: Math.max(0, Math.min(props.pixelWidth ?? at.x, mmPerPx ? Math.round(at.x / mmPerPx) : at.x)), y: Math.max(0, Math.min(props.pixelHeight ?? at.y, mmPerPx ? Math.round(at.y / mmPerPx) : at.y)) };
      if (placing.which === "a") {
        setCal((c) => ({ ...c, ax: p.x, ay: p.y }));
        setPlacing({ kind: "cal", which: "b" });
      } else {
        setCal((c) => ({ ...c, bx: p.x, by: p.y }));
        setPlacing(null);
        document.getElementById(distanceId)?.focus();
      }
      return;
    }
    if (placing.kind === "point") {
      const next = { ...markings, [placing.group]: markings[placing.group].map((o) => (o.id === placing.id ? { ...o, x: at.x, y: at.y } : o)) } as SpaceMarkings;
      setPlacing(null);
      void persist(next, t("saving"));
      return;
    }
    if (placing.kind === "rect") {
      if (!placing.first) {
        setPlacing({ ...placing, first: at });
        return;
      }
      const x = Math.min(placing.first.x, at.x);
      const y = Math.min(placing.first.y, at.y);
      const w = Math.abs(at.x - placing.first.x);
      const l = Math.abs(at.y - placing.first.y);
      if (w < 300 || l < 300) return; // a slip of the finger, not a room
      const next = { ...markings, [placing.group]: markings[placing.group].map((o) => (o.id === placing.id ? { ...o, points: rectPoints(x, y, w, l) } : o)) } as SpaceMarkings;
      setPlacing(null);
      void persist(next, t("saving"));
      return;
    }
    setPlacing({ ...placing, points: [...placing.points, at] });
  }

  function closeOutline() {
    if (placing?.kind !== "outline" || placing.points.length < 3) return;
    const next = { ...markings, areas: markings.areas.map((a) => (a.id === placing.id ? { ...a, points: placing.points } : a)) };
    setPlacing(null);
    void persist(next, t("saving"));
  }

  function remove(group: Group, id: string) {
    void persist({ ...markings, [group]: markings[group].filter((o) => o.id !== id) } as SpaceMarkings, t("saving"));
  }

  const distanceId = useId();
  async function submitCalibration(e: FormEvent) {
    e.preventDefault();
    setCalError(null);
    if (cal.ax === null || cal.ay === null || cal.bx === null || cal.by === null) {
      setCalError({ message: t("calibration.errors.points") });
      return;
    }
    const mm = parseMetres(distance);
    if (mm === null || Number.isNaN(mm) || mm <= 0) {
      setCalError({ field: "distance", message: t(mm === null ? "calibration.errors.distanceMissing" : "errors.measure") });
      document.getElementById(distanceId)?.focus();
      return;
    }
    setBusy(t("calibration.saving"));
    const res = await calibrateSpaceAction({ spaceId: props.spaceId, ax: cal.ax, ay: cal.ay, bx: cal.bx, by: cal.by, distance, version });
    setBusy(null);
    if (!res.ok) {
      setCalError({ field: res.error.fieldErrors?.distance ? "distance" : undefined, message: res.error.fieldErrors?.distance?.[0] ?? res.error.message });
      if (res.error.code === "CONFLICT") router.refresh();
      return;
    }
    setVersion(res.data.version);
    setMmPerPx(res.data.mmPerPx);
    setMarkings(res.data.markings);
    setPlacing(null);
    setSaved(true);
    router.refresh();
  }

  // Calibration marks are kept in picture pixels; on a calibrated sheet they are drawn at their real place.
  const calUnit = mmPerPx ?? 1;
  const calA = cal.ax !== null && cal.ay !== null ? { x: X(cal.ax * calUnit), y: Y(cal.ay * calUnit) } : null;
  const calB = cal.bx !== null && cal.by !== null ? { x: X(cal.bx * calUnit), y: Y(cal.by * calUnit) } : null;
  const showCal = !calibrated || placing?.kind === "cal";

  const placingHint =
    placing?.kind === "cal"
      ? t(placing.which === "a" ? "calibration.touchA" : "calibration.touchB")
      : placing?.kind === "point"
        ? t("place.point")
        : placing?.kind === "rect"
          ? t(placing.first ? "place.rectSecond" : "place.rectFirst")
          : placing?.kind === "outline"
            ? t("place.outline", { count: placing.points.length })
            : null;

  const sizeOf = (w: number | null, l: number | null) => (w === null || l === null ? null : `${m(w)} × ${m(l)} m`);
  const unknown = <Unknown label={tc("unknown")} />;

  return (
    <div className={plan.steps}>
      {/* ── 1 · the drawing ── */}
      <Section title={t("drawing.title")} level={3}>
        {props.pdfWithoutPicture ? (
          <Notice tone="attention" title={t("drawing.pdfStoredTitle")}>
            {t("drawing.pdfStoredBody")}
          </Notice>
        ) : null}
        {!props.hasDrawing ? <p className="ed-muted">{t("drawing.none")}</p> : null}
        {canEdit ? (
          <UploadDrawing
            businessId={props.businessId}
            listingId={props.listingId}
            spaceId={props.spaceId}
            label={props.hasDrawing ? t("drawing.replace") : t("drawing.upload")}
            hint={props.hasDrawing ? t("drawing.replaceHint") : t("drawing.uploadHint")}
          />
        ) : null}
      </Section>

      {props.pictureUrl ? (
        <>
          {/* ── the sheet itself ── */}
          <div className={plan.frame}>
            {placingHint ? (
              <div className={plan.placing} role="status">
                <span>{placingHint}</span>
                <span className={plan.toolGroup}>
                  {placing?.kind === "outline" ? (
                    <Button size="sm" onClick={closeOutline} disabled={placing.points.length < 3}>
                      {t("place.closeOutline")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="quiet" onClick={() => setPlacing(null)}>
                    {t("place.cancel")}
                  </Button>
                </span>
              </div>
            ) : null}
            <div
              ref={(el) => {
                (ref as { current: HTMLDivElement | null }).current = el;
                svgWrap.current = el;
              }}
              className={`ed-plan ${plan.sheet} ${placing ? plan.crosshair : ""}`}
              data-backdrop="strong"
              onPointerUp={onSheetPointer}
            >
              <PlanSvg scene={scene} label={t("plan.label", { name: props.name })} pictureUrl={props.pictureUrl}>
                {showCal && calA && calB ? <line x1={calA.x} y1={calA.y} x2={calB.x} y2={calB.y} data-role="calibration" /> : null}
                {showCal
                  ? ([
                      ["A", calA],
                      ["B", calB],
                    ] as const).map(([name, p]) =>
                      p ? (
                        <g key={name}>
                          <circle cx={p.x} cy={p.y} r={7} data-role="calibration" />
                          <line x1={p.x - 11} y1={p.y} x2={p.x + 11} y2={p.y} data-role="calibration" />
                          <line x1={p.x} y1={p.y - 11} x2={p.x} y2={p.y + 11} data-role="calibration" />
                          <text x={p.x + 12} y={p.y - 9} data-role="label">
                            {name}
                          </text>
                        </g>
                      ) : null,
                    )
                  : null}
                {placing?.kind === "rect" && placing.first ? <circle cx={X(placing.first.x)} cy={Y(placing.first.y)} r={5} data-role="draft" /> : null}
                {placing?.kind === "outline" && placing.points.length > 0 ? (
                  <>
                    <polyline points={placing.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} data-role="draft" fill="none" />
                    {placing.points.map((p, i) => (
                      <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={4} data-role="draft" />
                    ))}
                  </>
                ) : null}
              </PlanSvg>
            </div>
            <p className={plan.saveState} role="status" aria-live="polite">
              {busy ?? (saved ? t("saved") : "")}
            </p>
            {error ? (
              <Notice tone="danger" title={error} />
            ) : null}
          </div>

          {/* ── 2 · calibration (V7) ── */}
          <Section
            title={t("calibration.title")}
            level={3}
            actions={calibrated ? <Tag tone="success">{t("calibration.done")}</Tag> : <Tag tone="attention">{t("calibration.needed")}</Tag>}
          >
            {calibrated ? (
              <p>
                {t("calibration.scale", { cm: (mmPerPx! / 10).toFixed(2).replace(".", locale === "ro" ? "," : "."), width: m(Math.round((props.pixelWidth ?? 0) * mmPerPx!)) ?? "", height: m(Math.round((props.pixelHeight ?? 0) * mmPerPx!)) ?? "" })}
              </p>
            ) : (
              <p className="ed-muted">{t("calibration.why")}</p>
            )}
            {canEdit ? (
              <form className="ed-form" onSubmit={submitCalibration} noValidate>
                <ol className={plan.guide}>
                  <li data-done={calA ? "true" : undefined}>{t("calibration.step1")}</li>
                  <li data-done={calB ? "true" : undefined}>{t("calibration.step2")}</li>
                  <li>{t("calibration.step3")}</li>
                </ol>
                <div className={plan.toolGroup}>
                  <Button onClick={() => setPlacing({ kind: "cal", which: "a" })}>{t(calA && calB ? "calibration.markAgain" : "calibration.mark")}</Button>
                </div>
                <details>
                  <summary>{t("calibration.typed")}</summary>
                  <div className={plan.pointFields}>
                    {(["ax", "ay", "bx", "by"] as const).map((k) => (
                      <TextField
                        key={k}
                        id={`${distanceId}-${k}`}
                        label={t(`calibration.fields.${k}`)}
                        inputMode="numeric"
                        value={cal[k] === null ? "" : String(Math.round(cal[k]!))}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          setCal((c) => ({ ...c, [k]: v === "" || !/^\d+$/.test(v) ? null : Number(v) }));
                        }}
                      />
                    ))}
                  </div>
                  <p className="ed-small ed-muted">{t("calibration.typedHint", { width: props.pixelWidth ?? 0, height: props.pixelHeight ?? 0 })}</p>
                </details>
                <TextField
                  id={distanceId}
                  label={t("calibration.distance")}
                  hint={t("calibration.distanceHint")}
                  inputMode="decimal"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  error={calError?.field === "distance" ? calError.message : undefined}
                />
                {calError && !calError.field ? <Notice tone="danger" title={calError.message} /> : null}
                <div>
                  <Button type="submit" variant={calibrated ? "secondary" : "primary"} disabled={!!busy}>
                    {busy === t("calibration.saving") ? busy : t(calibrated ? "calibration.redo" : "calibration.submit")}
                  </Button>
                </div>
              </form>
            ) : null}
          </Section>
        </>
      ) : null}

      {/* ── 3 · markings ── */}
      <Section title={t("markings.title")} level={3}>
        {calibrated ? <p className="ed-muted">{t("markings.description")}</p> : null}
        {!calibrated ? (
          <Notice tone="attention" title={t("markings.lockedTitle")}>
            {t("markings.lockedBody")}
          </Notice>
        ) : (
          <div className="ed-stack" data-gap="5">
            <MarkGroup
              title={t("areas.title")}
              hint={t("areas.hint")}
              empty={t("areas.empty")}
              addLabel={t("areas.add")}
              canEdit={canEdit}
              onAdd={() => setEditing({ group: "areas", id: null })}
              rows={markings.areas.map((a) => ({
                id: a.id,
                title: a.name ?? t("areas.unnamed"),
                meta: `${(Math.round(polygonArea(a.points) / 100_000) / 10).toString().replace(".", locale === "ro" ? "," : ".")} m²`,
                extra: (
                  <>
                    <Button size="sm" variant="quiet" onClick={() => setPlacing({ kind: "rect", group: "areas", id: a.id, first: null })}>
                      {t("areas.redraw")}
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setPlacing({ kind: "outline", group: "areas", id: a.id, points: [] })}>
                      {t("areas.outline")}
                    </Button>
                  </>
                ),
              }))}
              onEdit={(id) => setEditing({ group: "areas", id })}
              onRemove={(id) => remove("areas", id)}
              labels={{ edit: t("edit"), remove: t("remove") }}
            />

            <MarkGroup
              title={t("tables.title")}
              hint={t("tables.hint")}
              empty={t("tables.empty")}
              addLabel={t("tables.add")}
              canEdit={canEdit}
              onAdd={() => setEditing({ group: "tableTypes", id: null })}
              rows={markings.tableTypes.map((x) => ({
                id: x.id,
                title: x.name,
                meta: (
                  <>
                    {x.shape === "round" ? (x.diameterMm === null ? unknown : `⌀ ${m(x.diameterMm)} m`) : (sizeOf(x.widthMm, x.lengthMm) ?? unknown)} · {x.seats === null ? <>{t("tables.seatsLabel")} {unknown}</> : t("tables.seats", { count: x.seats })} ·{" "}
                    {x.count === null ? <>{t("tables.countLabel")} {unknown}</> : t("tables.count", { count: x.count })}
                  </>
                ),
              }))}
              onEdit={(id) => setEditing({ group: "tableTypes", id })}
              onRemove={(id) => remove("tableTypes", id)}
              labels={{ edit: t("edit"), remove: t("remove") }}
            />

            <MarkGroup
              title={t("fixtures.title")}
              hint={t("fixtures.hint")}
              empty={t("fixtures.empty")}
              addLabel={t("fixtures.add")}
              canEdit={canEdit}
              onAdd={() => setEditing({ group: "fixtures", id: null })}
              rows={markings.fixtures.map((f) => ({
                id: f.id,
                title: f.name,
                meta: <>{t(`fixtureKinds.${f.kind}`)} · {sizeOf(f.widthMm, f.lengthMm) ?? unknown}</>,
                extra: (
                  <Button size="sm" variant="quiet" onClick={() => setPlacing({ kind: "point", group: "fixtures", id: f.id })}>
                    {t("place.move")}
                  </Button>
                ),
              }))}
              onEdit={(id) => setEditing({ group: "fixtures", id })}
              onRemove={(id) => remove("fixtures", id)}
              labels={{ edit: t("edit"), remove: t("remove") }}
            />

            <MarkGroup
              title={t("pois.title")}
              hint={t("pois.hint")}
              empty={t("pois.empty")}
              addLabel={t("pois.add")}
              canEdit={canEdit}
              onAdd={() => setEditing({ group: "pois", id: null })}
              rows={markings.pois.map((p, i) => ({
                id: p.id,
                title: `${i + 1} · ${p.name ?? t(`poiKinds.${p.kind}`)}`,
                meta: p.name ? t(`poiKinds.${p.kind}`) : null,
                extra: (
                  <Button size="sm" variant="quiet" onClick={() => setPlacing({ kind: "point", group: "pois", id: p.id })}>
                    {t("place.move")}
                  </Button>
                ),
              }))}
              onEdit={(id) => setEditing({ group: "pois", id })}
              onRemove={(id) => remove("pois", id)}
              labels={{ edit: t("edit"), remove: t("remove") }}
            />

            <MarkGroup
              title={t("parkingAreas.title")}
              hint={t("parkingAreas.hint")}
              empty={t("parkingAreas.empty")}
              addLabel={t("parkingAreas.add")}
              canEdit={canEdit}
              onAdd={() => setEditing({ group: "parkingAreas", id: null })}
              rows={markings.parkingAreas.map((p) => ({
                id: p.id,
                title: p.name ?? t("parkingAreas.unnamed"),
                meta: p.spaces === null ? <>{t("parkingAreas.spacesLabel")} {unknown}</> : t("parkingAreas.spaces", { count: p.spaces }),
                extra: (
                  <Button size="sm" variant="quiet" onClick={() => setPlacing({ kind: "rect", group: "parkingAreas", id: p.id, first: null })}>
                    {t("areas.redraw")}
                  </Button>
                ),
              }))}
              onEdit={(id) => setEditing({ group: "parkingAreas", id })}
              onRemove={(id) => remove("parkingAreas", id)}
              labels={{ edit: t("edit"), remove: t("remove") }}
            />
          </div>
        )}
      </Section>

      {editing ? (
        <MarkSheet
          key={`${editing.group}-${editing.id ?? "new"}`}
          editing={editing}
          markings={markings}
          locale={locale}
          sheetMm={{ w: model.backdrop?.widthMm ?? 10_000, h: model.backdrop?.heightMm ?? 10_000 }}
          onClose={() => setEditing(null)}
          onSave={(next, placeNext) => {
            setEditing(null);
            void persist(next, t("saving")).then(() => {
              if (placeNext) setPlacing(placeNext);
            });
          }}
        />
      ) : null}
    </div>
  );
}

function UploadDrawing({ businessId, listingId, spaceId, label, hint }: { businessId: string; listingId: string; spaceId: string; label: string; hint: string }) {
  const t = useTranslations("drawings");
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  return (
    <div className="ed-stack" data-gap="2">
      <FileField
        label={label}
        hint={hint}
        purpose="business.drawing"
        ownerId={businessId}
        allowPdf
        onUploaded={async (file) => {
          setState({ busy: true, error: null });
          const res = await attachDrawingAction({ businessId, listingId, spaceId, assetId: file.id });
          setState({ busy: false, error: res.ok ? null : res.error.message });
          if (res.ok) router.refresh();
        }}
      />
      {state.busy ? (
        <p className="ed-small" role="status">
          {t("drawing.attaching")}
        </p>
      ) : null}
      {state.error ? <Notice tone="danger" title={state.error} /> : null}
    </div>
  );
}

function MarkGroup({
  title,
  hint,
  empty,
  addLabel,
  rows,
  canEdit,
  onAdd,
  onEdit,
  onRemove,
  labels,
}: {
  title: string;
  hint: string;
  empty: string;
  addLabel: string;
  rows: Array<{ id: string; title: ReactNode; meta?: ReactNode; extra?: ReactNode }>;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  labels: { edit: string; remove: string };
}) {
  return (
    <div className="ed-stack" data-gap="2">
      <div>
        <strong>{title}</strong>
        <p className="ed-small ed-muted">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="ed-small ed-muted">{empty}</p>
      ) : (
        <div>
          {rows.map((r) => (
            <div className={plan.markRow} key={r.id}>
              <div className={plan.markMain}>
                <span>{r.title}</span>
                {r.meta ? <span className="ed-small ed-muted">{r.meta}</span> : null}
              </div>
              {canEdit ? (
                <div className={plan.toolGroup}>
                  {r.extra}
                  <Button size="sm" variant="quiet" onClick={() => onEdit(r.id)} aria-label={`${labels.edit}: ${typeof r.title === "string" ? r.title : ""}`}>
                    <IconEdit size={16} />
                    {labels.edit}
                  </Button>
                  <Button size="sm" variant="danger-quiet" onClick={() => onRemove(r.id)} aria-label={`${labels.remove}: ${typeof r.title === "string" ? r.title : ""}`}>
                    <IconTrash size={16} />
                    {labels.remove}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {canEdit ? (
        <div>
          <Button onClick={onAdd}>
            <IconPlus size={16} />
            {addLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type Values = Record<string, string>;

/** One sheet for adding / editing any marking: typed values — the equal of touching the drawing. */
function MarkSheet({
  editing,
  markings,
  locale,
  sheetMm,
  onClose,
  onSave,
}: {
  editing: NonNullable<Editing>;
  markings: SpaceMarkings;
  locale: Locale;
  sheetMm: { w: number; h: number };
  onClose: () => void;
  onSave: (next: SpaceMarkings, placeNext: Placing) => void;
}) {
  const t = useTranslations("drawings");
  const tc = useTranslations("common");
  const { group, id } = editing;
  const fm = (mm: number | null | undefined) => (mm === null || mm === undefined ? "" : mmToMetresText(mm, locale));
  const formId = useId();

  const initial = useMemo((): Values => {
    if (group === "areas" || group === "parkingAreas") {
      const a = (markings[group] as Array<{ id: string; name: string | null; points: PlanPoint[]; spaces?: number | null }>).find((x) => x.id === id);
      const pts = a?.points ?? rectPoints(Math.round(sheetMm.w * 0.1), Math.round(sheetMm.h * 0.1), Math.round(sheetMm.w * 0.8), Math.round(sheetMm.h * 0.8));
      const rect = isAxisRect(pts);
      return {
        name: a?.name ?? "",
        spaces: a?.spaces === null || a?.spaces === undefined ? "" : String(a.spaces),
        rect: rect ? "1" : "",
        x: rect ? fm(pts[0]!.x) : "",
        y: rect ? fm(pts[0]!.y) : "",
        w: rect ? fm(pts[1]!.x - pts[0]!.x) : "",
        l: rect ? fm(pts[2]!.y - pts[1]!.y) : "",
      };
    }
    if (group === "tableTypes") {
      const x = markings.tableTypes.find((o) => o.id === id);
      return { name: x?.name ?? "", shape: x?.shape ?? "round", diameter: fm(x?.diameterMm), w: fm(x?.widthMm), l: fm(x?.lengthMm), seats: x?.seats === null || x?.seats === undefined ? "" : String(x.seats), count: x?.count === null || x?.count === undefined ? "" : String(x.count) };
    }
    if (group === "fixtures") {
      const f = markings.fixtures.find((o) => o.id === id);
      return { kind: f?.kind ?? "dance", name: f?.name ?? "", w: fm(f?.widthMm), l: fm(f?.lengthMm), x: fm(f?.x ?? Math.round(sheetMm.w / 2)), y: fm(f?.y ?? Math.round(sheetMm.h / 2)), rotation: String(f?.rotation ?? 0) };
    }
    const p = markings.pois.find((o) => o.id === id);
    return { kind: p?.kind ?? "toilets", name: p?.name ?? "", x: fm(p?.x ?? Math.round(sheetMm.w / 2)), y: fm(p?.y ?? Math.round(sheetMm.h / 2)) };
  }, []);
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    /** metres text → mm; `required` false lets it be empty (= unknown) */
    const measure = (k: string, required: boolean, positive = true): number | null => {
      const mm = parseMetres(v[k]);
      if (mm === null) {
        if (required) err[k] = tc("validation.required");
        return null;
      }
      if (Number.isNaN(mm) || (positive && mm <= 0)) {
        err[k] = t("errors.measure");
        return null;
      }
      return mm;
    };
    const int = (k: string, max: number): number | null => {
      const s = (v[k] ?? "").trim();
      if (!s) return null;
      if (!/^\d+$/.test(s) || Number(s) > max) {
        err[k] = t("errors.wholeNumber");
        return null;
      }
      return Number(s);
    };
    const name = (v.name ?? "").trim();
    let next = markings;
    let placeNext: Placing = null;
    const newId = id ?? uid();

    if (group === "areas" || group === "parkingAreas") {
      const existing = (markings[group] as Array<{ id: string; points: PlanPoint[] }>).find((x) => x.id === id);
      let points = existing?.points ?? null;
      if (v.rect || !existing) {
        const x = measure("x", true, false);
        const y = measure("y", true, false);
        const w = measure("w", true);
        const l = measure("l", true);
        if (x !== null && y !== null && w !== null && l !== null) points = rectPoints(x, y, w, l);
      }
      const spaces = group === "parkingAreas" ? int("spaces", 100_000) : null;
      if (Object.keys(err).length === 0 && points) {
        const row = group === "areas" ? { id: newId, name: name || null, points } : { id: newId, name: name || null, points, spaces };
        next = { ...markings, [group]: id ? markings[group].map((o) => (o.id === id ? row : o)) : [...markings[group], row] } as SpaceMarkings;
      }
    } else if (group === "tableTypes") {
      if (!name) err.name = tc("validation.required");
      const round = v.shape === "round";
      const diameter = round ? measure("diameter", false) : null;
      const w = round ? null : measure("w", false);
      const l = round ? null : measure("l", false);
      if (!round && (w === null) !== (l === null) && !err.w && !err.l) err[w === null ? "w" : "l"] = t("errors.bothSides");
      const seats = int("seats", 60);
      const count = int("count", 2000);
      if (Object.keys(err).length === 0) {
        const row = { id: newId, name, shape: round ? ("round" as const) : ("rect" as const), diameterMm: diameter, widthMm: w, lengthMm: l, seats, count };
        next = { ...markings, tableTypes: id ? markings.tableTypes.map((o) => (o.id === id ? row : o)) : [...markings.tableTypes, row] };
      }
    } else if (group === "fixtures") {
      if (!name) err.name = tc("validation.required");
      const w = measure("w", false);
      const l = measure("l", false);
      if ((w === null) !== (l === null) && !err.w && !err.l) err[w === null ? "w" : "l"] = t("errors.bothSides");
      const x = measure("x", true, false);
      const y = measure("y", true, false);
      const rotation = int("rotation", 359) ?? 0;
      if (Object.keys(err).length === 0 && x !== null && y !== null) {
        const row = { id: newId, kind: v.kind as (typeof FIXTURE_KIND_VALUES)[number], name, x, y, widthMm: w, lengthMm: l, rotation };
        next = { ...markings, fixtures: id ? markings.fixtures.map((o) => (o.id === id ? row : o)) : [...markings.fixtures, row] };
        if (!id) placeNext = { kind: "point", group: "fixtures", id: newId };
      }
    } else {
      const x = measure("x", true, false);
      const y = measure("y", true, false);
      if (Object.keys(err).length === 0 && x !== null && y !== null) {
        const row = { id: newId, kind: v.kind as (typeof POI_KIND_VALUES)[number], name: name || null, x, y };
        next = { ...markings, pois: id ? markings.pois.map((o) => (o.id === id ? row : o)) : [...markings.pois, row] };
        if (!id) placeNext = { kind: "point", group: "pois", id: newId };
      }
    }
    setErrors(err);
    if (Object.keys(err).length > 0) {
      const first = Object.keys(err)[0]!;
      document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }
    onSave(next, placeNext);
  }

  const f = (k: string, label: string, opts: { hint?: string; mode?: "decimal" | "numeric" | "text"; optional?: boolean } = {}) => (
    <TextField
      id={`${formId}-${k}`}
      label={label}
      hint={opts.hint}
      inputMode={opts.mode ?? "decimal"}
      optionalLabel={opts.optional ? t("optionalUnknown") : undefined}
      value={v[k] ?? ""}
      onChange={set(k)}
      error={errors[k]}
      autoComplete="off"
    />
  );
  const position = (
    <div className={plan.fields2}>
      {f("x", t("fields.x"), { hint: t("fields.xHint") })}
      {f("y", t("fields.y"), { hint: t("fields.yHint") })}
    </div>
  );
  const title = t(`${group}.${id ? "editTitle" : "add"}`);

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      closeLabel={tc("actions.close")}
      footer={
        <>
          <Button onClick={onClose}>{tc("actions.cancel")}</Button>
          <Button variant="primary" type="submit" form={formId}>
            {t(id ? "saveChanges" : `${group}.confirmAdd`)}
          </Button>
        </>
      }
    >
      <form id={formId} className="ed-form" onSubmit={submit} noValidate>
        {group === "areas" || group === "parkingAreas" ? (
          <>
            {f("name", t("fields.areaName"), { mode: "text", optional: true })}
            {group === "parkingAreas" ? f("spaces", t("fields.spaces"), { mode: "numeric", optional: true, hint: t("fields.spacesHint") }) : null}
            {v.rect || !id ? (
              <>
                {position}
                <div className={plan.fields2}>
                  {f("w", t("fields.width"))}
                  {f("l", t("fields.length"))}
                </div>
                <p className="ed-small ed-muted">{t("fields.rectHint")}</p>
              </>
            ) : (
              <p className="ed-small ed-muted">{t("fields.outlineHint")}</p>
            )}
          </>
        ) : null}
        {group === "tableTypes" ? (
          <>
            {f("name", t("fields.tableName"), { mode: "text", hint: t("fields.tableNameHint") })}
            <SelectField id={`${formId}-shape`} label={t("fields.shape")} value={v.shape} onChange={set("shape")}>
              <option value="round">{t("shapes.round")}</option>
              <option value="rect">{t("shapes.rect")}</option>
            </SelectField>
            {v.shape === "round" ? (
              f("diameter", t("fields.diameter"), { optional: true })
            ) : (
              <div className={plan.fields2}>
                {f("w", t("fields.width"), { optional: true })}
                {f("l", t("fields.length"), { optional: true })}
              </div>
            )}
            <div className={plan.fields2}>
              {f("seats", t("fields.seats"), { mode: "numeric", optional: true })}
              {f("count", t("fields.count"), { mode: "numeric", optional: true })}
            </div>
            <p className="ed-small ed-muted">{t("fields.unknownHint")}</p>
          </>
        ) : null}
        {group === "fixtures" ? (
          <>
            <SelectField id={`${formId}-kind`} label={t("fields.kind")} value={v.kind} onChange={(e) => setV((s) => ({ ...s, kind: e.target.value, name: s.name || t(`fixtureKinds.${e.target.value}`) }))}>
              {FIXTURE_KIND_VALUES.map((k) => (
                <option key={k} value={k}>
                  {t(`fixtureKinds.${k}`)}
                </option>
              ))}
            </SelectField>
            {f("name", t("fields.fixtureName"), { mode: "text" })}
            <div className={plan.fields2}>
              {f("w", t("fields.width"), { optional: true })}
              {f("l", t("fields.length"), { optional: true })}
            </div>
            {position}
            {f("rotation", t("fields.rotation"), { mode: "numeric" })}
            {!id ? <p className="ed-small ed-muted">{t("fields.thenPlace")}</p> : null}
          </>
        ) : null}
        {group === "pois" ? (
          <>
            <SelectField id={`${formId}-kind`} label={t("fields.kind")} value={v.kind} onChange={set("kind")}>
              {POI_KIND_VALUES.map((k) => (
                <option key={k} value={k}>
                  {t(`poiKinds.${k}`)}
                </option>
              ))}
            </SelectField>
            {f("name", t("fields.poiName"), { mode: "text", optional: true })}
            {position}
            {!id ? <p className="ed-small ed-muted">{t("fields.thenPlace")}</p> : null}
          </>
        ) : null}
      </form>
    </Sheet>
  );
}
