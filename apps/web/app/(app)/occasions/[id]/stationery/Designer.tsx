"use client";

import { Checkbox, Notice, SelectField, SubmitButton, Tag, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { previewStationeryAction, saveStationeryAction } from "@/app/actions/stationery";
import { AiSuggest, type AiStatus } from "./AiSuggest";
import styles from "./stationery.module.css";

const FIELDS = ["kicker", "names", "wording", "date", "time", "venue", "address", "rsvp"] as const;
const MORE_FIELDS = ["saveTheDate", "menuTitle", "menuBody", "thanks"] as const;
type Field = (typeof FIELDS)[number] | (typeof MORE_FIELDS)[number];
const MULTILINE: Record<string, number> = { wording: 4, address: 2, menuBody: 9, thanks: 4 };
const PIECES = ["invitation", "invitation-square", "save-the-date", "menu", "table-card", "place-card", "thank-you"] as const;
type Piece = (typeof PIECES)[number];
const pieceKey = (p: string) => p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const PRESET_FIELDS = ["kicker", "wording", "rsvp", "saveTheDate", "menuTitle", "thanks"] as const;
const AI_FIELDS: Partial<Record<Field, "invitation" | "thanks">> = { wording: "invitation", thanks: "thanks" };

export type DesignOption = { key: string; name: string; range: string; thumb: string; colourways: Array<{ key: string; name: string; paper: string; ink: string; accent: string }> };
type Starters = Record<"ro" | "en", Array<{ key: string; text: string }>>;
export type DesignerDraft = { designKey: string; colourwayKey: string; locale: "ro" | "en"; texts: Record<Field, string>; aiOriginal: Partial<Record<Field, string | null>>; qrOnInvitation: boolean };
type Proof = { src: string; widthMm: number; heightMm: number; fit: number; truncated: boolean };
type Presets = Record<"ro" | "en", Record<"nunta" | "botez" | "aniversare", Record<(typeof PRESET_FIELDS)[number], string>>>;

function Chips<T extends string>({ name, legend, value, options, onChange }: { name: string; legend: string; value: T; options: Array<{ value: T; label: React.ReactNode }>; onChange: (v: T) => void }) {
  return (
    <fieldset className="ed-fieldset">
      <legend className="ed-field__label">{legend}</legend>
      <div className="ed-chips">
        {options.map((o) => (
          <label className="ed-chip" key={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The designer (C-04): design, colourway and wording on one side, the live proof on the other.
 * The proof is drawn on the server from the same layout the PDF uses (text as outlines), so
 * what shows here is what prints. Nothing typed is ever lost on a failed save.
 */
export function StationeryDesigner({
  occasionId,
  occasionKind,
  canManage,
  designs,
  ranges,
  starters,
  limits,
  presets,
  initial,
  initialProof,
  savedVersion,
  ai,
}: {
  occasionId: string;
  occasionKind: string;
  canManage: boolean;
  designs: DesignOption[];
  ranges: string[];
  starters: Starters;
  limits: Record<string, number>;
  presets: Presets;
  initial: DesignerDraft;
  initialProof: Proof;
  savedVersion: number | null;
  ai: AiStatus;
}) {
  const t = useTranslations("stationery");
  const tc = useTranslations("common");
  const router = useRouter();
  const [draft, setDraft] = useState<DesignerDraft>(initial);
  const [piece, setPiece] = useState<Piece>("invitation");
  const [proof, setProof] = useState<Proof>(initialProof);
  const [busy, setBusy] = useState(false);
  const [proofError, setProofError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [result, setResult] = useState<{ ok: true; version: number; created: boolean } | { ok: false; message: string; fieldErrors?: Record<string, string[]> } | null>(null);
  const seq = useRef(0);
  const first = useRef(true);

  const design = designs.find((d) => d.key === draft.designKey) ?? designs[0]!;
  const [range, setRange] = useState(design.range);
  const inRange = designs.filter((d) => d.range === range);
  const pickDesign = (key: string) => {
    if (!canManage) return;
    const next = designs.find((d) => d.key === key)!;
    change({ designKey: key, colourwayKey: next.colourways.some((c) => c.key === draft.colourwayKey) ? draft.colourwayKey : next.colourways[0]!.key });
  };
  const change = (patch: Partial<DesignerDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setResult(null);
  };
  const setText = (field: Field, value: string) => change({ texts: { ...draft.texts, [field]: value } });

  // redraw the proof a moment after the last change
  useEffect(() => {
    if (first.current && piece === "invitation") {
      first.current = false;
      return;
    }
    first.current = false;
    const mine = ++seq.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      const res = await previewStationeryAction({
        designKey: draft.designKey as never,
        colourwayKey: draft.colourwayKey,
        locale: draft.locale,
        texts: Object.fromEntries(Object.entries(draft.texts).map(([k, v]) => [k, { value: v.slice(0, limits[k] ?? 1000) }])),
        piece,
        occasionKind,
      });
      if (mine !== seq.current) return;
      setBusy(false);
      if (res.ok) {
        setProof(res.data);
        setProofError(false);
      } else setProofError(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [draft.designKey, draft.colourwayKey, draft.locale, draft.texts, piece, limits, occasionKind]);

  const save = () =>
    startSave(async () => {
      const res = await saveStationeryAction({
        occasionId,
        designKey: draft.designKey as never,
        colourwayKey: draft.colourwayKey,
        locale: draft.locale,
        qrOnInvitation: draft.qrOnInvitation,
        occasionKind,
        texts: Object.fromEntries(Object.entries(draft.texts).map(([k, v]) => [k, { value: v, aiOriginal: draft.aiOriginal[k as Field] ?? null }])),
      });
      if (res.ok) {
        setResult({ ok: true, version: res.data.version, created: res.data.created });
        setDirty(false);
        router.refresh();
      } else {
        setResult({ ok: false, message: res.error.message, fieldErrors: res.error.fieldErrors });
        const firstBad = Object.keys(res.error.fieldErrors ?? {})[0];
        if (firstBad) document.getElementById(`st-${firstBad}`)?.focus();
      }
    });

  const applyPreset = (kind: "nunta" | "botez" | "aniversare") => {
    const p = presets[draft.locale][kind];
    change({ texts: { ...draft.texts, ...p }, aiOriginal: { ...draft.aiOriginal, ...Object.fromEntries(PRESET_FIELDS.map((f) => [f, null])) } });
  };

  const fieldError = (f: string) => (result && !result.ok ? result.fieldErrors?.[f]?.[0] : undefined);
  const renderField = (f: Field) => {
    const over = draft.texts[f].length > (limits[f] ?? 1000);
    const common = {
      id: `st-${f}`,
      label: (
        <span className={styles.fieldHead}>
          {t(`fields.${f}.label`)}
          {draft.aiOriginal[f] ? <Tag tone="accent">{t("form.aiLabel")}</Tag> : null}
        </span>
      ),
      hint: t(`fields.${f}.hint`),
      error: fieldError(f) ?? (over ? t("errors.tooLong") : undefined),
      value: draft.texts[f],
      readOnly: !canManage,
    };
    const purpose = AI_FIELDS[f];
    return (
      <div key={f} className={styles.group}>
        {MULTILINE[f] ? <TextareaField {...common} rows={MULTILINE[f]} onChange={(e) => setText(f, e.target.value)} /> : <TextField {...common} onChange={(e) => setText(f, e.target.value)} />}
        {purpose && canManage ? (
          <div className={styles.aiRow}>
            <AiSuggest
              idPrefix={`ai-${f}`}
              purpose={purpose}
              occasionKind={occasionKind}
              language={draft.locale}
              names={draft.texts.names}
              status={ai}
              onAccept={(text, original) => {
                const value = f === "thanks" ? `${draft.texts.thanks.split("\n")[0] || ""}\n${text}`.trim() : text;
                change({ texts: { ...draft.texts, [f]: value }, aiOriginal: { ...draft.aiOriginal, [f]: f === "thanks" ? value : original } });
              }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.layout}>
      <div className={styles.proofColumn}>
        <Chips name="piece" legend={t("preview.pieceLegend")} value={piece} options={PIECES.map((p) => ({ value: p, label: t(`pieces.${pieceKey(p)}`) }))} onChange={setPiece} />
        <div className={styles.desk}>
          <img
            className={styles.sheet}
            data-busy={busy ? "true" : undefined}
            src={proof.src}
            width={Math.round(proof.widthMm * 3)}
            height={Math.round(proof.heightMm * 3)}
            alt={t("preview.alt", { piece: t(`pieces.${pieceKey(piece)}`), design: design.name })}
          />
        </div>
        <div className={styles.proofMeta}>
          <span className="ed-small ed-muted ed-num">{t("preview.size", { width: proof.widthMm, height: proof.heightMm })}</span>
          <span className="ed-small ed-muted" role="status" aria-live="polite">
            {busy ? t("preview.loading") : proof.fit < 1 && !proof.truncated ? t("preview.fit") : ""}
          </span>
        </div>
        {piece === "table-card" || piece === "place-card" ? <p className="ed-small ed-muted">{t(`pieces.note.${pieceKey(piece)}`)}</p> : null}
        {proof.truncated ? <Notice tone="attention">{t("preview.truncated")}</Notice> : null}
        {proofError ? <Notice tone="danger">{t("preview.error")}</Notice> : null}
      </div>

      <div className={styles.formColumn}>
        {!canManage ? <Notice>{t("form.readOnly")}</Notice> : null}
        <div className={styles.group}>
          <Chips
            name="range"
            legend={t("form.rangeLegend")}
            value={range}
            options={ranges.map((r) => ({ value: r, label: t(`ranges.${r}.name`) }))}
            onChange={setRange}
          />
          <p className="ed-small ed-muted">
            {t(`ranges.${range}.blurb`)} {t("form.designCount", { count: inRange.length })}
            {range !== "house" && range !== "embroidery" && range !== "occasion" ? ` ${t("form.motifNote")}` : ""}
          </p>
          <fieldset className="ed-fieldset">
            <legend className="ed-field__label">{t("form.designLegend")}</legend>
            <div className={styles.gallery}>
              {inRange.map((d) => (
                <label key={d.key} className={styles.option}>
                  <input className="ed-vh" type="radio" name="design" value={d.key} checked={draft.designKey === d.key} onChange={() => pickDesign(d.key)} />
                  <img src={d.thumb} alt="" width={148} height={210} loading="lazy" decoding="async" />
                  <span className="ed-small">{d.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {design.range === "house" ? <p className="ed-small ed-muted">{t(`designs.${draft.designKey}.blurb`)}</p> : null}
        </div>
        <Chips
          name="colourway"
          legend={t("form.colourwayLegend")}
          value={draft.colourwayKey}
          options={design.colourways.map((c) => ({
            value: c.key,
            label: (
              <>
                <span className={styles.swatch} aria-hidden>
                  <i style={{ background: c.paper }} />
                  <i style={{ background: c.ink }} />
                  <i style={{ background: c.accent }} />
                </span>
                <span className={styles.chipText}>{c.name}</span>
              </>
            ),
          }))}
          onChange={(key) => canManage && change({ colourwayKey: key })}
        />
        <Chips name="locale" legend={t("form.languageLegend")} value={draft.locale} options={[{ value: "ro", label: tc("languages.ro") }, { value: "en", label: tc("languages.en") }]} onChange={(v) => canManage && change({ locale: v })} />

        {canManage ? (
          <div className={styles.group}>
            <h3 className={styles.groupTitle}>{t("form.presetsTitle")}</h3>
            <p className="ed-small ed-muted">{t("form.presetsHint")}</p>
            <div className="ed-cluster">
              {(["nunta", "botez", "aniversare"] as const).map((k) => (
                <button key={k} type="button" className="ed-btn" onClick={() => applyPreset(k)}>
                  {t(`form.preset${k[0]!.toUpperCase()}${k.slice(1)}`)}
                </button>
              ))}
            </div>
            <SelectField
              id="st-starter"
              label={t("form.starterLabel")}
              hint={t("form.starterHint")}
              value=""
              onChange={(e) => {
                const chosen = starters[draft.locale].find((s) => s.key === e.target.value);
                if (chosen) change({ texts: { ...draft.texts, wording: chosen.text }, aiOriginal: { ...draft.aiOriginal, wording: null } });
              }}
            >
              <option value="">{t("form.starterNone")}</option>
              {starters[draft.locale].map((s) => (
                <option key={s.key} value={s.key}>
                  {s.text.length > 70 ? `${s.text.slice(0, 68).trimEnd()}…` : s.text}
                </option>
              ))}
            </SelectField>
          </div>
        ) : null}

        <div className={styles.group}>
          <h3 className={styles.groupTitle}>{t("form.textsTitle")}</h3>
          <div className="ed-form">{FIELDS.map(renderField)}</div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>{t("form.moreTitle")}</h3>
          <div className="ed-form">{MORE_FIELDS.map(renderField)}</div>
        </div>

        {canManage ? (
          <div className={styles.group}>
            <Checkbox label={t("form.qr")} hint={t("form.qrHint")} checked={draft.qrOnInvitation} onChange={(e) => change({ qrOnInvitation: e.target.checked })} />
            {result && !result.ok ? <Notice tone="danger">{result.message}</Notice> : null}
            {result?.ok ? <Notice tone="success">{result.created ? t("form.saved", { version: result.version }) : t("form.savedSame", { version: result.version })}</Notice> : null}
            {dirty && savedVersion ? <p className="ed-small ed-muted">{t("form.unsaved")}</p> : null}
            <div className="ed-actionbar">
              <SubmitButton pending={saving} pendingLabel={t("form.saving")} onClick={(e) => { e.preventDefault(); save(); }}>
                {t("form.save")}
              </SubmitButton>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
