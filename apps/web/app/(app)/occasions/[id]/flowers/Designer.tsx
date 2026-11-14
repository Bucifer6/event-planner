"use client";

import { ARRANGEMENT_FORM_KEYS, ARRANGEMENT_VIEW, bloomInk, bloomPath, indicativeCost, layoutArrangement, leafPath, seasonState, type ArrangementFormKey } from "@ed/core/arrangementkit";
import { Button, Checkbox, EmptyState, Figure, Notice, SelectField, SheetTrigger, Stepper, SubmitButton, Tag, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { archiveArrangementAction, requestArrangementQuoteAction, saveArrangementAction } from "@/app/actions/arrangements";
import styles from "./flowers.module.css";

export type CatalogueOption = {
  id: string;
  varietyName: string;
  kind: "flower" | "foliage";
  listingId: string;
  listingName: string;
  colours: string[];
  seasonMonths: number[];
  pricePerStemMinor: number | null;
  currency: string;
};
export type DesignerLine = { catalogueItemId: string; stems: number; colour: string | null };
export type DesignerInitial = { designId: string | null; version: number | null; name: string; form: ArrangementFormKey; note: string; lines: DesignerLine[] };

const money = (minor: number, currency: string, locale: string) => `${new Intl.NumberFormat(locale === "en" ? "en-GB" : "ro-RO", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100)} ${currency}`;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * The arrangement designer (C-13): a base form, catalogue items with stem counts, a stylised
 * sketch that follows every tap, and the running INDICATIVE cost — always labelled as such,
 * never a quote, and never counting an unpriced item as zero.
 */
export function ArrangementDesigner({
  occasionId,
  occasionMonth,
  canManage,
  catalogue,
  snapshots,
  listings,
  initial,
  isCurrent,
  locale,
}: {
  occasionId: string;
  occasionMonth: number | null;
  canManage: boolean;
  catalogue: CatalogueOption[];
  /** Lines of the saved version whose variety is no longer published (kept readable). */
  snapshots: CatalogueOption[];
  listings: Array<{ id: string; name: string }>;
  initial: DesignerInitial;
  /** false when an older version is open: a quote is only ever asked for the current one. */
  isCurrent: boolean;
  locale: string;
}) {
  const t = useTranslations("arrangements");
  const tc = useTranslations("common");
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [form, setForm] = useState<ArrangementFormKey>(initial.form);
  const [note, setNote] = useState(initial.note);
  const [lines, setLines] = useState<DesignerLine[]>(initial.lines);
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [result, setResult] = useState<{ ok: true; version: number; created: boolean } | { ok: false; message: string; fieldErrors?: Record<string, string[]> } | null>(null);
  const [q, setQ] = useState("");
  const [seasonOnly, setSeasonOnly] = useState(false);
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [shareEmail, setShareEmail] = useState(false);
  const [quoteKey, setQuoteKey] = useState(newKey);
  const [quoting, startQuote] = useTransition();
  const [quoteState, setQuoteState] = useState<{ ok: boolean; message?: string } | null>(null);
  const [archiving, startArchive] = useTransition();

  const byId = useMemo(() => new Map([...snapshots, ...catalogue].map((c) => [c.id, c])), [catalogue, snapshots]);
  const touch = () => {
    setDirty(true);
    setResult(null);
  };
  const full = lines.map((l) => ({ ...l, item: byId.get(l.catalogueItemId)! })).filter((l) => l.item);
  const kitLines = full.map((l) => ({ catalogueItemId: l.catalogueItemId, stems: l.stems, colour: l.colour, kind: l.item.kind, pricePerStemMinor: l.item.pricePerStemMinor, currency: l.item.currency }));
  const scene = layoutArrangement(form, kitLines);
  const cost = indicativeCost(kitLines);
  const sum = cost.known.map((k) => money(k.minor, k.currency, locale)).join(" + ");
  // the hero stays a number: "≥ 476,50 RON"; what is NOT in it (unpriced items) is said in the note, never counted as zero
  const figures = cost.known.map((k) => new Intl.NumberFormat(locale === "en" ? "en-GB" : "ro-RO", { minimumFractionDigits: k.minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(k.minor / 100));
  const costValue = cost.state === "empty" ? t("cost.empty") : cost.state === "none" ? <em className="ed-muted">{t("cost.unknown")}</em> : cost.known.length === 1 ? `${cost.state === "partial" ? "≥ " : ""}${figures[0]}` : `${cost.state === "partial" ? "≥ " : ""}${sum}`;
  const costUnit = cost.known.length === 1 && cost.state !== "none" ? cost.known[0]!.currency : undefined;
  const costNote = cost.state === "full" ? t("cost.noteFull") : cost.state === "partial" ? t("cost.notePartial", { count: cost.unpricedLines }) : cost.state === "none" ? t("cost.noteNone", { count: cost.unpricedLines }) : undefined;

  const seasonText = (item: CatalogueOption) => {
    const s = seasonState(item.seasonMonths, occasionMonth);
    return s === "in" ? t("designer.inSeason") : s === "out" ? t("designer.outSeason") : t("designer.seasonUnknown");
  };
  const add = (item: CatalogueOption) => {
    if (lines.some((l) => l.catalogueItemId === item.id)) return;
    setLines([...lines, { catalogueItemId: item.id, stems: item.kind === "foliage" ? 5 : 10, colour: item.colours[0] ?? null }]);
    touch();
  };
  const needle = q.trim().toLocaleLowerCase("ro");
  const found = catalogue.filter((c) => {
    if (seasonOnly && seasonState(c.seasonMonths, occasionMonth) !== "in") return false;
    if (!needle) return true;
    return c.varietyName.toLocaleLowerCase("ro").includes(needle) || c.colours.some((col) => t(`colours.${col}`).toLocaleLowerCase("ro").includes(needle)) || c.listingName.toLocaleLowerCase("ro").includes(needle);
  });

  const save = () =>
    startSave(async () => {
      const res = await saveArrangementAction({ occasionId, designId: initial.designId, name, form, note: note || null, items: lines.map((l) => ({ catalogueItemId: l.catalogueItemId, stems: l.stems, colour: l.colour })) });
      if (res.ok) {
        setResult({ ok: true, version: res.data.version, created: res.data.created });
        setDirty(false);
        if (!initial.designId) router.replace(`/occasions/${occasionId}/flowers?design=${res.data.designId}`);
        else router.refresh();
      } else {
        setResult({ ok: false, message: res.error.message, fieldErrors: res.error.fieldErrors });
        if (res.error.fieldErrors?.name) document.getElementById("arr-name")?.focus();
      }
    });
  const requestQuote = () =>
    startQuote(async () => {
      if (!initial.designId) return;
      const res = await requestArrangementQuoteAction({ occasionId, designId: initial.designId, listingId, message, shareEmail, idempotencyKey: quoteKey });
      if (res.ok) {
        setQuoteState({ ok: true });
        setQuoteKey(newKey());
        setMessage("");
        router.refresh();
      } else setQuoteState({ ok: false, message: res.error.message });
    });

  return (
    <div className={styles.layout}>
      <div className={styles.sketchColumn}>
        <div className={styles.sketch}>
          <svg viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" aria-label={t("designer.previewAlt", { form: t(`forms.${form}`), view: t(`views.${ARRANGEMENT_VIEW[form]}`), stems: cost.totalStems })}>
            {scene.vessel.map((d) => (
              <path key={d} d={d} className={styles.vessel} />
            ))}
            {scene.outline.map((d) => (
              <path key={d} d={d} className={styles.guide} />
            ))}
            {scene.marks.map((m, i) =>
              m.kind === "foliage" ? (
                <path key={i} transform={`translate(${m.x} ${m.y}) rotate(${m.rot})`} d={leafPath(m.r)} fill={m.fill} stroke={m.core} strokeWidth={0.6} />
              ) : (
                <g key={i} transform={`translate(${m.x} ${m.y}) rotate(${m.rot})`}>
                  <path d={bloomPath(m.r)} fill={m.fill} stroke={m.core} strokeWidth={0.5} />
                  <circle r={Math.round(m.r * 2.2) / 10} fill={m.core} />
                </g>
              ),
            )}
          </svg>
        </div>
        <p className="ed-small ed-muted">
          {t(`forms.${form}`)}, {t(`views.${ARRANGEMENT_VIEW[form]}`)}. {t("designer.previewNote")} {scene.stemsPerMark > 1 ? t("designer.perMark", { count: scene.stemsPerMark }) : ""}
        </p>
        <Figure size="hero" label={t("cost.label")} value={costValue} unit={costUnit} note={costNote} />
        <p className="ed-small ed-muted ed-num">{t("cost.stems", { count: cost.totalStems })}</p>
      </div>

      <div className={styles.formColumn}>
        {!canManage ? <Notice>{t("designer.readOnly")}</Notice> : null}
        <TextField
          id="arr-name"
          label={t("designer.name")}
          value={name}
          maxLength={80}
          readOnly={!canManage}
          error={result && !result.ok ? result.fieldErrors?.name?.[0] : undefined}
          onChange={(e) => {
            setName(e.target.value);
            touch();
          }}
        />
        <fieldset className="ed-fieldset">
          <legend className="ed-field__label">{t("designer.formLegend")}</legend>
          <div className="ed-chips">
            {ARRANGEMENT_FORM_KEYS.map((k) => (
              <label className="ed-chip" key={k}>
                <input
                  type="radio"
                  name="form"
                  value={k}
                  checked={form === k}
                  onChange={() => {
                    if (!canManage) return;
                    setForm(k);
                    touch();
                  }}
                />
                <span>{t(`forms.${k}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.group}>
          <h3 className={styles.groupTitle}>{t("designer.itemsTitle")}</h3>
          {full.length === 0 ? (
            <EmptyState title={t("designer.itemsEmpty")}>{t("designer.itemsEmptyBody")}</EmptyState>
          ) : (
            <div>
              {full.map((l) => (
                <div className={styles.line} key={l.catalogueItemId}>
                  <div className={styles.lineHead}>
                    <span className={styles.lineName}>
                      <span className={styles.dot} style={{ background: bloomInk({ colour: l.colour, kind: l.item.kind }).fill }} aria-hidden />
                      {l.item.varietyName}
                    </span>
                    <span className="ed-small ed-muted">{t("designer.from", { listing: l.item.listingName })}</span>
                  </div>
                  <span className="ed-small ed-muted">
                    {l.item.pricePerStemMinor === null ? <em>{t("designer.priceUnknown")}</em> : t("designer.pricePerStem", { price: money(l.item.pricePerStemMinor, l.item.currency, locale) })} · {seasonText(l.item)}
                  </span>
                  {canManage ? (
                    <div className={styles.lineControls}>
                      <Stepper
                        name={`stems-${l.catalogueItemId}`}
                        label={t("designer.stems", { name: l.item.varietyName })}
                        defaultValue={l.stems}
                        min={1}
                        max={500}
                        decreaseLabel={t("designer.fewer", { name: l.item.varietyName })}
                        increaseLabel={t("designer.more", { name: l.item.varietyName })}
                        onChange={(v) => {
                          setLines((cur) => cur.map((x) => (x.catalogueItemId === l.catalogueItemId ? { ...x, stems: v } : x)));
                          touch();
                        }}
                      />
                      {l.item.colours.length > 1 ? (
                        <SelectField
                          id={`colour-${l.catalogueItemId}`}
                          label={t("designer.colour", { name: l.item.varietyName })}
                          value={l.colour ?? ""}
                          onChange={(e) => {
                            setLines((cur) => cur.map((x) => (x.catalogueItemId === l.catalogueItemId ? { ...x, colour: e.target.value || null } : x)));
                            touch();
                          }}
                        >
                          <option value="">{t("designer.colourAny")}</option>
                          {l.item.colours.map((c) => (
                            <option key={c} value={c}>
                              {t(`colours.${c}`)}
                            </option>
                          ))}
                        </SelectField>
                      ) : null}
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          setLines((cur) => cur.filter((x) => x.catalogueItemId !== l.catalogueItemId));
                          touch();
                        }}
                      >
                        {t("designer.remove", { name: l.item.varietyName })}
                      </Button>
                    </div>
                  ) : (
                    <span className="ed-num">{t("changes.stems", { count: l.stems })}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {canManage ? (
            <div>
              <SheetTrigger label={t("designer.add")} title={t("picker.title")} closeLabel={t("picker.close")} footer={(close) => <Button type="button" variant="primary" onClick={close}>{t("picker.done")}</Button>}>
                {catalogue.length === 0 ? (
                  <EmptyState title={t("picker.noCatalogues")}>{t("picker.noCataloguesBody")}</EmptyState>
                ) : (
                  <div className="ed-form">
                    <TextField id="arr-search" label={t("picker.search")} hint={t("picker.searchHint")} value={q} onChange={(e) => setQ(e.target.value)} />
                    {occasionMonth ? <Checkbox label={t("picker.seasonOnly")} checked={seasonOnly} onChange={(e) => setSeasonOnly(e.target.checked)} /> : null}
                    {found.length === 0 ? (
                      <EmptyState title={t("picker.none")}>{t("picker.noneBody")}</EmptyState>
                    ) : (
                      <div>
                        {found.map((c) => {
                          const inDesign = lines.some((l) => l.catalogueItemId === c.id);
                          return (
                            <div className={styles.pick} key={c.id}>
                              <div className={styles.pickMain}>
                                <span className={styles.lineName}>{c.varietyName}</span>
                                <span className="ed-small ed-muted">
                                  {t(`kinds.${c.kind}`)} · {t("designer.from", { listing: c.listingName })}
                                  {c.colours.length ? ` · ${c.colours.map((col) => t(`colours.${col}`)).join(", ")}` : ""}
                                </span>
                                <span className="ed-small ed-muted">
                                  {c.pricePerStemMinor === null ? <em>{t("designer.priceUnknown")}</em> : t("designer.pricePerStem", { price: money(c.pricePerStemMinor, c.currency, locale) })} ·{" "}
                                  {c.seasonMonths.length ? t("designer.season", { months: c.seasonMonths.map((m) => t(`months.${m}`)).join(", ") }) : t("designer.seasonUnknown")}
                                  {c.seasonMonths.length && occasionMonth ? ` — ${seasonText(c)}` : ""}
                                </span>
                              </div>
                              {inDesign ? (
                                <Tag>{t("picker.added")}</Tag>
                              ) : (
                                <Button type="button" size="sm" aria-label={t("picker.addItem", { name: c.varietyName })} onClick={() => add(c)}>
                                  {tc("actions.add")}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </SheetTrigger>
            </div>
          ) : null}
        </div>

        <TextareaField
          id="arr-note"
          label={t("designer.note")}
          hint={t("designer.noteHint")}
          optionalLabel={tc("optional")}
          rows={3}
          maxLength={600}
          value={note}
          readOnly={!canManage}
          onChange={(e) => {
            setNote(e.target.value);
            touch();
          }}
        />

        {canManage ? (
          <div className={styles.group}>
            {result && !result.ok ? <Notice tone="danger">{result.message}</Notice> : null}
            {result?.ok ? <Notice tone="success">{result.created ? t("designer.saved", { version: result.version }) : t("designer.savedSame", { version: result.version })}</Notice> : null}
            {dirty && initial.designId ? <p className="ed-small ed-muted">{t("designer.unsaved")}</p> : null}
            <div className="ed-actionbar">
              <SubmitButton pending={saving} pendingLabel={t("designer.saving")} disabled={full.length === 0} onClick={(e) => { e.preventDefault(); if (full.length) save(); }}>
                {t("designer.save")}
              </SubmitButton>
            </div>
          </div>
        ) : null}

        {canManage ? (
          <div className={styles.group}>
            <h3 className={styles.groupTitle}>{t("quote.title")}</h3>
            <p className="ed-small ed-muted">{t("quote.body")}</p>
            {!initial.designId || dirty || !isCurrent ? (
              <Notice>{t("quote.saveFirst")}</Notice>
            ) : listings.length === 0 ? (
              <Notice>{t("quote.noListings")}</Notice>
            ) : (
              <div className="ed-form">
                {quoteState && !quoteState.ok ? <Notice tone="danger">{quoteState.message}</Notice> : null}
                {quoteState?.ok ? <Notice tone="success">{t("quote.sent")}</Notice> : null}
                <SelectField id="arr-listing" label={t("quote.listing")} value={listingId} onChange={(e) => setListingId(e.target.value)}>
                  {listings.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </SelectField>
                <TextareaField id="arr-message" label={t("quote.message")} optionalLabel={tc("optional")} rows={3} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />
                <Checkbox label={t("quote.shareEmail")} checked={shareEmail} onChange={(e) => setShareEmail(e.target.checked)} />
                <div>
                  <SubmitButton variant="secondary" pending={quoting} pendingLabel={t("quote.sending")} onClick={(e) => { e.preventDefault(); requestQuote(); }}>
                    {t("quote.send", { version: initial.version ?? 1 })}
                  </SubmitButton>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {canManage && initial.designId ? (
          <div>
            <SheetTrigger
              label={t("designer.archive", { name: initial.name })}
              title={t("designer.archiveTitle")}
              closeLabel={tc("actions.close")}
              variant="danger-quiet"
              footer={(close) => (
                <>
                  <Button type="button" onClick={close}>
                    {t("designer.archiveKeep")}
                  </Button>
                  <SubmitButton
                    variant="danger"
                    pending={archiving}
                    pendingLabel={t("designer.archiving")}
                    onClick={(e) => {
                      e.preventDefault();
                      startArchive(async () => {
                        const res = await archiveArrangementAction({ occasionId, designId: initial.designId! });
                        if (res.ok) router.replace(`/occasions/${occasionId}/flowers`);
                      });
                    }}
                  >
                    {t("designer.archive", { name: initial.name })}
                  </SubmitButton>
                </>
              )}
            >
              <p>{t("designer.archiveBody")}</p>
            </SheetTrigger>
          </div>
        ) : null}
      </div>
    </div>
  );
}
