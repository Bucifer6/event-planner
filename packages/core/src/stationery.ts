import {
  and,
  desc,
  eq,
  occasions,
  stationerySets,
  stationeryVersions,
  STATIONERY_TEXT_FIELDS,
  type StationeryLocale,
  type StationeryText,
  type StationeryTextField,
  type StationeryTexts,
} from "@ed/db";
import { translate } from "@ed/i18n";
import { formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember, isManager } from "./access";
import { audit } from "./audit";
import { PDF_COLORS } from "./briefingpdf";
import { requireAccount, type Ctx, type Locale } from "./context";
import { requireGuest } from "./invitations";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { listHouseholdQrs, qrMatrix } from "./qr";
import { getSeatingRoster, getSeatingSummary } from "./seating";
import {
  BLEED_MM,
  DESIGN_KEYS,
  drawSceneOnPdf,
  getColourway,
  getDesign,
  layoutPiece,
  pdfFontName,
  PIECES,
  registerStationeryFonts,
  sceneToSvg,
  stationeryFontFamily,
  STATIONERY_PIECES,
  type DesignKey,
  type KitTexts,
  type PieceExtra,
  type PieceKind,
  type Scene,
} from "./stationerykit";
import { PLANNING_ROLES } from "./suppliers";
import { inTx } from "./tx";

// INVITATION AND STATIONERY DESIGNER (C-04).
//
//   getStationeryEditor(ctx, occasionId)        everything the designer page shows
//   getStationerySummary(ctx, occasionId)       READ API for other domains / MCP get tools (no SVG)
//   previewStationery(ctx, draft)               SVG proofs of an UNSAVED draft (nothing stored)
//   saveStationeryVersion(ctx, input)           every save is a new immutable version
//   markStationeryProofed(ctx, …)               "Am verificat proba" — managers only
//   buildStationeryProofPdf(ctx, …)             the proof to read: every piece, stamped PROBĂ
//   buildStationeryPrintPdf(ctx, …)             print-ready — ONLY for a proofed version (the gate)
//   setDigitalInvitation(ctx, …)                the guest link's plate adopts a version's wording + colourway
//   getGuestInvitationStyle(ctx)                guest actor: what the plate adopts (or null)
//
// THE PROOF GATE: buildStationeryPrintPdf refuses (CONFLICT "stationery.errors.notProofed")
// unless that exact version carries a manager's proof mark. Saving anything — a comma, a
// colourway — makes a new version without a mark, so what is printed is what was checked.
//
// Not built, by decision: the animated-envelope presentation (PRD §13 open question), paid
// invitation packs or any upsell (non-goal).

export const STATIONERY_WORDING_KINDS = ["nunta", "botez", "aniversare"] as const;
export type StationeryWordingKind = (typeof STATIONERY_WORDING_KINDS)[number];

/** Longest text each field takes (the fitter's guarantees are tested against these). */
export const STATIONERY_FIELD_LIMITS: Record<StationeryTextField, number> = {
  kicker: 80,
  names: 90,
  wording: 420,
  date: 80,
  time: 60,
  venue: 80,
  address: 140,
  rsvp: 160,
  saveTheDate: 60,
  menuTitle: 40,
  menuBody: 900,
  thanks: 360,
};

const MULTILINE: ReadonlySet<StationeryTextField> = new Set(["names", "wording", "address", "menuBody", "thanks"]);

export type StationeryVersion = typeof stationeryVersions.$inferSelect;

const zLocale = z.enum(["ro", "en"]);
const zId = z.string().min(1).max(64);

const textInput = z.object({
  value: z.string().max(1000),
  /** The AI suggestion this text was accepted from, if any (INF7). */
  aiOriginal: z.string().max(1000).nullish(),
});

const draftInput = z.object({
  designKey: z.enum(DESIGN_KEYS as [DesignKey, ...DesignKey[]]),
  colourwayKey: z.string().min(1).max(40),
  locale: zLocale,
  texts: z.record(z.string(), textInput),
  qrOnInvitation: z.boolean().optional(),
});
export type StationeryDraftInput = z.input<typeof draftInput>;

function cleanValue(field: StationeryTextField, raw: string): string {
  const s = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  const out = MULTILINE.has(field)
    ? s
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : s.replace(/\s+/g, " ").trim();
  return out;
}

/** Word-level similarity (LCS over words, 0–1). */
export function textSimilarity(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;
  const prev = new Array<number>(wb.length + 1).fill(0);
  for (let i = 1; i <= wa.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= wb.length; j += 1) {
      const up = prev[j]!;
      prev[j] = wa[i - 1] === wb[j - 1] ? diag + 1 : Math.max(up, prev[j - 1]!);
      diag = up;
    }
  }
  return (2 * prev[wb.length]!) / (wa.length + wb.length);
}

/** Below this similarity to the accepted suggestion the text counts as the user's own (INF7). */
export const AI_LABEL_SIMILARITY = 0.6;

/** INF7: is `value` still (mostly) the AI suggestion it was accepted from? */
export function stillAiGenerated(aiOriginal: string | null | undefined, value: string): boolean {
  if (!aiOriginal || !value.trim()) return false;
  return textSimilarity(aiOriginal, value) >= AI_LABEL_SIMILARITY;
}

function normaliseTexts(
  raw: Record<string, { value: string; aiOriginal?: string | null }>,
  previous: StationeryTexts | null,
): { texts: StationeryTexts; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  const texts = {} as StationeryTexts;
  for (const field of STATIONERY_TEXT_FIELDS) {
    const entry = raw[field];
    const value = cleanValue(field, entry?.value ?? "");
    if (value.length > STATIONERY_FIELD_LIMITS[field]) fieldErrors[field] = ["stationery.errors.tooLong"];
    // the label follows the text: a suggestion accepted now, or one carried from the last version
    const original = entry?.aiOriginal ?? previous?.[field]?.aiOriginal ?? null;
    const ai = stillAiGenerated(original, value);
    texts[field] = ai ? { value, aiGenerated: true, aiOriginal: original } : { value, aiGenerated: false };
  }
  if (!texts.names.value) fieldErrors.names = ["stationery.errors.namesRequired"];
  return { texts, fieldErrors };
}

const kitTexts = (texts: StationeryTexts): KitTexts => Object.fromEntries(STATIONERY_TEXT_FIELDS.map((f) => [f, texts[f]?.value ?? ""])) as KitTexts;

/* ── Wording presets and defaults ──────────────────────────────────────── */

const PRESET_FIELDS = ["kicker", "wording", "rsvp", "saveTheDate", "menuTitle", "thanks"] as const;
export type WordingPreset = Record<(typeof PRESET_FIELDS)[number], string>;

/** Ready wording for a wedding, a christening or an anniversary, in Romanian or English. */
export function getWordingPreset(kind: StationeryWordingKind, locale: StationeryLocale): WordingPreset {
  return Object.fromEntries(PRESET_FIELDS.map((f) => [f, translate(locale, `stationery.presets.${kind}.${f}`)])) as WordingPreset;
}

const presetKindFor = (occasionKind: string): StationeryWordingKind => (occasionKind === "nunta" ? "nunta" : occasionKind === "botez" ? "botez" : "aniversare");
const designFor = (occasionKind: string): DesignKey => (occasionKind === "nunta" ? "classic" : occasionKind === "botez" ? "botez" : occasionKind === "aniversare" || occasionKind === "revelion" || occasionKind === "picnic" ? "petrecere" : "minimal");

type OccasionFacts = Pick<typeof occasions.$inferSelect, "title" | "kind" | "startsAt" | "timezone" | "venueName" | "venueAddress">;

const capitalise = (s: string) => (s ? s[0]!.toLocaleUpperCase("ro") + s.slice(1) : s);

/** The texts a new set starts from: the occasion's own facts and the preset for its kind. */
export function defaultStationeryTexts(o: OccasionFacts, locale: StationeryLocale): StationeryTexts {
  const preset = getWordingPreset(presetKindFor(o.kind), locale);
  let time = "";
  if (o.startsAt) {
    const hm = formatTime(o.startsAt, locale, o.timezone);
    if (hm !== "12:00" && hm !== "00:00") time = translate(locale, "stationery.defaults.time", { time: hm });
  }
  const values: Record<StationeryTextField, string> = {
    kicker: preset.kicker,
    names: o.title,
    wording: preset.wording,
    date: o.startsAt ? capitalise(formatWeekdayDate(o.startsAt, locale, o.timezone)) : "",
    time,
    venue: o.venueName ?? "",
    address: o.venueAddress ?? "",
    rsvp: preset.rsvp,
    saveTheDate: preset.saveTheDate,
    menuTitle: preset.menuTitle,
    menuBody: translate(locale, "stationery.defaults.menuBody"),
    thanks: preset.thanks,
  };
  return Object.fromEntries(STATIONERY_TEXT_FIELDS.map((f) => [f, { value: values[f].slice(0, STATIONERY_FIELD_LIMITS[f]), aiGenerated: false }])) as StationeryTexts;
}

/* ── Reads ─────────────────────────────────────────────────────────────── */

async function loadOccasion(ctx: Pick<Ctx, "db">, occasionId: string) {
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return o;
}

async function loadVersion(ctx: Pick<Ctx, "db">, occasionId: string, version?: number | null): Promise<StationeryVersion | null> {
  const where = version ? and(eq(stationeryVersions.occasionId, occasionId), eq(stationeryVersions.version, version)) : eq(stationeryVersions.occasionId, occasionId);
  const [row] = await ctx.db.select().from(stationeryVersions).where(where).orderBy(desc(stationeryVersions.version)).limit(1);
  return row ?? null;
}

export type StationeryVersionMeta = { version: number; designKey: string; colourwayKey: string; createdAt: Date; proofedAt: Date | null };

export type StationeryEditor = {
  occasion: { id: string; title: string; kind: string };
  canManage: boolean;
  /** The newest saved version, or null before the first save. */
  current: StationeryVersion | null;
  versions: StationeryVersionMeta[];
  /** What the form starts from when nothing is saved yet. */
  defaults: { designKey: DesignKey; colourwayKey: string; locale: StationeryLocale; texts: StationeryTexts };
  /** Version the guest link's plate adopts; null = the standard plate. */
  digitalVersion: number | null;
  fontFamily: "maison" | "fallback";
};

/** Everything the designer page needs. Planning members read; managers save and proof. */
export async function getStationeryEditor(ctx: Ctx, occasionId: string): Promise<StationeryEditor> {
  const member = await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const o = await loadOccasion(ctx, occasionId);
  const [set] = await ctx.db.select().from(stationerySets).where(eq(stationerySets.occasionId, occasionId));
  const rows = await ctx.db.select().from(stationeryVersions).where(eq(stationeryVersions.occasionId, occasionId)).orderBy(desc(stationeryVersions.version)).limit(50);
  const locale: StationeryLocale = o.locale === "en" ? "en" : "ro";
  const designKey = designFor(o.kind);
  return {
    occasion: { id: o.id, title: o.title, kind: o.kind },
    canManage: isManager(member) && ctx.actor.kind !== "mcp",
    current: rows[0] ?? null,
    versions: rows.map((r) => ({ version: r.version, designKey: r.designKey, colourwayKey: r.colourwayKey, createdAt: r.createdAt, proofedAt: r.proofedAt })),
    defaults: { designKey, colourwayKey: getDesign(designKey).colourways[0]!, locale, texts: defaultStationeryTexts(o, locale) },
    digitalVersion: set?.digitalVersion ?? null,
    fontFamily: stationeryFontFamily(),
  };
}

export type StationerySummary = {
  hasDesign: boolean;
  version: number | null;
  designKey: string | null;
  colourwayKey: string | null;
  locale: StationeryLocale | null;
  proofed: boolean;
  /** Wording per field with its AI label (INF7 / MCP5). */
  texts: Array<{ field: StationeryTextField; value: string; aiGenerated: boolean }>;
  digitalVersion: number | null;
};

/** READ API (other domains, MCP get tools): the current wording and design, no rendering. Planning members. */
export async function getStationerySummary(ctx: Ctx, occasionId: string): Promise<StationerySummary> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const current = await loadVersion(ctx, occasionId);
  const [set] = await ctx.db.select().from(stationerySets).where(eq(stationerySets.occasionId, occasionId));
  if (!current) return { hasDesign: false, version: null, designKey: null, colourwayKey: null, locale: null, proofed: false, texts: [], digitalVersion: null };
  return {
    hasDesign: true,
    version: current.version,
    designKey: current.designKey,
    colourwayKey: current.colourwayKey,
    locale: current.locale,
    proofed: !!current.proofedAt,
    texts: STATIONERY_TEXT_FIELDS.filter((f) => current.texts[f]?.value).map((f) => ({ field: f, value: current.texts[f].value, aiGenerated: current.texts[f].aiGenerated })),
    digitalVersion: set?.digitalVersion ?? null,
  };
}

/* ── Preview (nothing stored) ──────────────────────────────────────────── */

export type StationeryPreview = { piece: PieceKind; svg: string; widthMm: number; heightMm: number; fit: number; truncated: boolean };

const SAMPLE_EXTRA = (locale: StationeryLocale): PieceExtra => ({
  tableLabel: "4",
  tableWord: translate(locale, "stationery.pieces.tableWord"),
  placeName: translate(locale, "stationery.sample.placeName"),
  placeNote: translate(locale, "stationery.sample.placeNote"),
});

function previewOf(draft: z.output<typeof draftInput>, texts: StationeryTexts, pieces: readonly PieceKind[]): StationeryPreview[] {
  return pieces.map((piece) => {
    const scene = layoutPiece({ design: draft.designKey, colourway: draft.colourwayKey, piece, texts: kitTexts(texts), extra: SAMPLE_EXTRA(draft.locale) });
    const spec = PIECES[piece];
    return { piece, svg: sceneToSvg(scene, { title: translate(draft.locale, `stationery.pieces.${pieceKey(piece)}`) }), widthMm: spec.widthMm, heightMm: spec.heightMm, fit: scene.fit, truncated: scene.truncated };
  });
}

const pieceKey = (p: PieceKind): string => p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * The live proof of an unsaved draft: the SAME layout the PDF is drawn from, as SVG.
 * Signed-in accounts only (it costs CPU); it reads and stores nothing.
 */
export async function previewStationery(ctx: Ctx, input: StationeryDraftInput & { pieces?: PieceKind[] }): Promise<StationeryPreview[]> {
  requireAccount(ctx);
  const draft = draftInput.parse(input);
  const { texts } = normaliseTexts(draft.texts, null);
  for (const f of STATIONERY_TEXT_FIELDS) texts[f].value = texts[f].value.slice(0, STATIONERY_FIELD_LIMITS[f]);
  const pieces = (input.pieces ?? [...STATIONERY_PIECES]).filter((p) => (STATIONERY_PIECES as readonly string[]).includes(p));
  return previewOf(draft, texts, pieces);
}

/** SVG proofs of a SAVED version (the page's first paint, the version list). */
export async function renderStationeryVersion(ctx: Ctx, occasionId: string, version?: number | null, pieces: readonly PieceKind[] = STATIONERY_PIECES): Promise<StationeryPreview[]> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const row = await loadVersion(ctx, occasionId, version);
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return previewOf({ designKey: row.designKey as DesignKey, colourwayKey: row.colourwayKey, locale: row.locale, texts: {}, qrOnInvitation: row.qrOnInvitation }, row.texts, pieces);
}

/* ── Writes ────────────────────────────────────────────────────────────── */

async function manage(ctx: Ctx, occasionId: string): Promise<string> {
  await requireMember(ctx, occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN"); // an assistant proposes text, it never saves
  await assertOccasionWritable(ctx, occasionId);
  return requireAccount(ctx);
}

const saveInput = draftInput.extend({ occasionId: zId });
export type SaveStationeryInput = z.input<typeof saveInput>;

/**
 * Saves the set as a NEW version (immutable, unproofed). Saving exactly what the newest
 * version already holds changes nothing and returns that version.
 */
export async function saveStationeryVersion(ctx: Ctx, input: SaveStationeryInput): Promise<{ version: number; created: boolean }> {
  const data = saveInput.parse(input);
  const accountId = await manage(ctx, data.occasionId);
  const design = getDesign(data.designKey);
  if (!design.colourways.includes(data.colourwayKey)) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { colourwayKey: ["stationery.errors.colourway"] } });
  return inTx(ctx, async (tx) => {
    // one writer at a time per occasion: the set row is the lock
    await tx.db.insert(stationerySets).values({ occasionId: data.occasionId }).onConflictDoNothing();
    const [set] = await tx.db.select().from(stationerySets).where(eq(stationerySets.occasionId, data.occasionId)).for("update");
    const previous = await loadVersion(tx, data.occasionId);
    const { texts, fieldErrors } = normaliseTexts(data.texts, previous?.texts ?? null);
    if (Object.keys(fieldErrors).length) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
    const qrOnInvitation = data.qrOnInvitation ?? false;
    if (
      previous &&
      previous.designKey === data.designKey &&
      previous.colourwayKey === data.colourwayKey &&
      previous.locale === data.locale &&
      previous.qrOnInvitation === qrOnInvitation &&
      JSON.stringify(kitTexts(previous.texts)) === JSON.stringify(kitTexts(texts))
    ) {
      return { version: previous.version, created: false };
    }
    const version = (set?.currentVersion ?? 0) + 1;
    await tx.db.insert(stationeryVersions).values({
      occasionId: data.occasionId,
      version,
      designKey: data.designKey,
      colourwayKey: data.colourwayKey,
      locale: data.locale,
      texts,
      qrOnInvitation,
      createdByAccountId: accountId,
    });
    // the guest link follows the newest wording once it has adopted the design
    await tx.db
      .update(stationerySets)
      .set({ currentVersion: version, ...(set?.digitalVersion ? { digitalVersion: version } : {}) })
      .where(eq(stationerySets.occasionId, data.occasionId));
    await audit(tx, { action: "stationery.saved", objectType: "occasion", objectId: data.occasionId, after: { version, designKey: data.designKey, colourwayKey: data.colourwayKey } });
    return { version, created: true };
  });
}

/** "Am verificat proba": a manager confirms having read this exact version. Idempotent; never undone. */
export async function markStationeryProofed(ctx: Ctx, input: { occasionId: string; version: number }): Promise<{ version: number; proofedAt: Date }> {
  const data = z.object({ occasionId: zId, version: z.number().int().min(1) }).parse(input);
  const accountId = await manage(ctx, data.occasionId);
  const row = await loadVersion(ctx, data.occasionId, data.version);
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (row.proofedAt) return { version: row.version, proofedAt: row.proofedAt };
  return inTx(ctx, async (tx) => {
    await tx.db
      .update(stationeryVersions)
      .set({ proofedAt: tx.now, proofedByAccountId: accountId })
      .where(and(eq(stationeryVersions.id, row.id)));
    await audit(tx, { action: "stationery.proofed", objectType: "occasion", objectId: data.occasionId, after: { version: row.version } });
    return { version: row.version, proofedAt: tx.now };
  });
}

/** The guest link's invitation plate adopts this version's wording and colourway (null = the standard plate). */
export async function setDigitalInvitation(ctx: Ctx, input: { occasionId: string; enabled: boolean }): Promise<{ digitalVersion: number | null }> {
  const data = z.object({ occasionId: zId, enabled: z.boolean() }).parse(input);
  await manage(ctx, data.occasionId);
  const current = await loadVersion(ctx, data.occasionId);
  if (data.enabled && !current) throw new AppError("CONFLICT", "stationery.errors.saveFirst");
  const digitalVersion = data.enabled ? current!.version : null;
  await inTx(ctx, async (tx) => {
    await tx.db.insert(stationerySets).values({ occasionId: data.occasionId, digitalVersion }).onConflictDoUpdate({ target: stationerySets.occasionId, set: { digitalVersion } });
    await audit(tx, { action: "stationery.digital_set", objectType: "occasion", objectId: data.occasionId, after: { digitalVersion } });
  });
  return { digitalVersion };
}

export type GuestInvitationStyle = {
  designKey: string;
  kicker: string;
  names: string;
  wording: string;
  rsvp: string;
  colours: { paper: string; ink: string; accent: string; muted: string; dark: boolean };
};

/** GUEST ACTOR: what the plate on the household's own link adopts, or null for the standard plate. */
export async function getGuestInvitationStyle(ctx: Ctx): Promise<GuestInvitationStyle | null> {
  const actor = requireGuest(ctx);
  const [set] = await ctx.db.select().from(stationerySets).where(eq(stationerySets.occasionId, actor.occasionId));
  if (!set?.digitalVersion) return null;
  const row = await loadVersion(ctx, actor.occasionId, set.digitalVersion);
  if (!row) return null;
  const cw = getColourway(getDesign(row.designKey), row.colourwayKey);
  return {
    designKey: row.designKey,
    kicker: row.texts.kicker.value,
    names: row.texts.names.value,
    wording: row.texts.wording.value,
    rsvp: row.texts.rsvp.value,
    colours: { paper: cw.paper, ink: cw.ink, accent: cw.accent, muted: cw.muted, dark: !!cw.dark },
  };
}

/* ── PDFs ──────────────────────────────────────────────────────────────── */

export type PdfFile = { filename: string; mime: "application/pdf"; bytes: Uint8Array };

/** A pdfkit document without a first page (sheets set their own size), with every font registered. */
export async function newSheetDocument(info: { title: string; lang: Locale; createdAt: Date; subject?: string; keywords?: string }): Promise<{ doc: PDFKit.PDFDocument; done: () => Promise<Uint8Array> }> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    lang: info.lang === "ro" ? "ro-RO" : "en-GB",
    info: { Title: info.title, Subject: info.subject ?? "", Keywords: info.keywords ?? "", Creator: "EventDesk.ro", Producer: "EventDesk.ro", CreationDate: info.createdAt },
  });
  registerStationeryFonts(doc);
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolveBytes, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolveBytes(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  return {
    doc,
    done: () => {
      doc.end();
      return finished;
    },
  };
}

export function fileSlug(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "ocazie";
}

type PlaceCard = { name: string; note: string };

/**
 * Place cards from the seating plan: one per NAMED ADULT. Children are never named (invariant
 * 9): their number rides on the household's first card as "+2 copii"; unnamed adults get one
 * card under the household's name with their count.
 */
export async function listPlaceCards(ctx: Ctx, occasionId: string, locale: StationeryLocale): Promise<PlaceCard[]> {
  const [roster, summary] = await Promise.all([getSeatingRoster(ctx, occasionId), getSeatingSummary(ctx, occasionId)]);
  const tables = new Map(summary.tables.map((t) => [t.id, t.label]));
  const tableText = (id: string | null) => {
    const label = id ? tables.get(id) : null;
    if (!label) return "";
    return /^\d{1,3}$/.test(label) ? translate(locale, "stationery.place.table", { label }) : label;
  };
  const cards: PlaceCard[] = [];
  for (const h of roster) {
    if (h.attending === "no") continue;
    const kids = h.children ? translate(locale, h.children.count === 1 ? "stationery.place.childOne" : "stationery.place.childMany", { count: h.children.count }) : "";
    const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
    h.adults.forEach((a, i) => cards.push({ name: a.name, note: join(tableText(a.tableItemId), i === 0 ? kids : "") }));
    if (h.extra) {
      const seats = translate(locale, h.extra.count === 1 ? "stationery.place.seatOne" : "stationery.place.seatMany", { count: h.extra.count });
      cards.push({ name: h.name, note: join(tableText(h.extra.tableItemId), seats, h.adults.length === 0 ? kids : "") });
    } else if (h.adults.length === 0 && h.children) {
      cards.push({ name: h.name, note: join(tableText(h.children.tableItemId), kids) });
    }
  }
  return cards;
}

async function scenesFor(ctx: Ctx, row: StationeryVersion, pieces: readonly PieceKind[], opts: { personalise: boolean }): Promise<Array<{ piece: PieceKind; scene: Scene }>> {
  const texts = kitTexts(row.texts);
  const base = { design: row.designKey, colourway: row.colourwayKey, texts };
  const out: Array<{ piece: PieceKind; scene: Scene }> = [];
  const tableWord = translate(row.locale, "stationery.pieces.tableWord");
  for (const piece of pieces) {
    if (piece === "table-card") {
      const summary = await getSeatingSummary(ctx, row.occasionId);
      const labels = summary.tables.length ? summary.tables.map((t) => t.label) : opts.personalise ? [] : ["1"];
      for (const label of labels) out.push({ piece, scene: layoutPiece({ ...base, piece, extra: { tableLabel: label, tableWord } }) });
    } else if (piece === "place-card") {
      const cards = await listPlaceCards(ctx, row.occasionId, row.locale);
      const list = cards.length ? cards : opts.personalise ? [] : [{ name: translate(row.locale, "stationery.sample.placeName"), note: translate(row.locale, "stationery.sample.placeNote") }];
      for (const c of list) out.push({ piece, scene: layoutPiece({ ...base, piece, extra: { placeName: c.name, placeNote: c.note } }) });
    } else if (piece === "invitation" && row.qrOnInvitation && opts.personalise) {
      // one sheet per household, each with its own code (C-09)
      for (const q of (await listHouseholdQrs(ctx, row.occasionId)).filter((q) => !q.revoked)) {
        out.push({ piece, scene: layoutPiece({ ...base, piece, extra: { qr: { matrix: qrMatrix(q.url), caption: q.householdName } } }) });
      }
    } else out.push({ piece, scene: layoutPiece({ ...base, piece }) });
  }
  return out;
}

const pieceList = z.array(z.enum(STATIONERY_PIECES)).min(1).max(STATIONERY_PIECES.length);

/**
 * THE PROOF: every piece of a saved version at its real size, each sheet stamped "PROBĂ".
 * No bleed, no crop marks — it is for reading, on screen or a desk printer. Planning members.
 */
export async function buildStationeryProofPdf(ctx: Ctx, input: { occasionId: string; version?: number | null }): Promise<PdfFile> {
  await requireMember(ctx, input.occasionId, { roles: PLANNING_ROLES });
  const [o, row] = await Promise.all([loadOccasion(ctx, input.occasionId), loadVersion(ctx, input.occasionId, input.version)]);
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const t = (key: string, params?: Record<string, string | number>) => translate(row.locale, `stationery.pdf.${key}`, params);
  const { doc, done } = await newSheetDocument({ title: t("proofTitle", { title: o.title, version: row.version }), lang: row.locale, createdAt: ctx.now, subject: t("proofSubject") });
  for (const { scene } of await scenesFor(ctx, row, STATIONERY_PIECES, { personalise: false })) {
    drawSceneOnPdf(doc, scene);
    doc
      .font(pdfFontName("text-medium"))
      .fontSize(5.5)
      .fillColor(scene.colourway.dark ? "#ffffff" : PDF_COLORS.ink2)
      .text(t("proofStamp", { version: row.version }).toLocaleUpperCase("ro"), 8, 11, { lineBreak: false, characterSpacing: 1.1, baseline: "alphabetic" });
  }
  return { filename: `${fileSlug(o.title)}-${row.locale === "ro" ? "proba" : "proof"}-v${row.version}.pdf`, mime: "application/pdf", bytes: await done() };
}

const printInput = z.object({
  occasionId: zId,
  version: z.number().int().min(1).nullish(),
  pieces: pieceList.optional(),
  cropMarks: z.boolean().default(true),
});

/**
 * PRINT-READY PDF — only for a PROOFED version (the gate). Every sheet at its exact trim size
 * with 3 mm bleed, TrimBox/BleedBox set, crop marks and a slug line for the print shop on
 * request; vector text, fonts embedded. Colour is RGB: the PDF says so and leaves the CMYK
 * conversion to the print shop. Place and table cards come from the seating plan; with
 * "QR on the invitation" each household gets its own sheet. Managers only.
 */
export async function buildStationeryPrintPdf(ctx: Ctx, input: z.input<typeof printInput>): Promise<PdfFile> {
  const data = printInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const [o, row] = await Promise.all([loadOccasion(ctx, data.occasionId), loadVersion(ctx, data.occasionId, data.version)]);
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (!row.proofedAt) throw new AppError("CONFLICT", "stationery.errors.notProofed", { params: { version: row.version } });
  const t = (key: string, params?: Record<string, string | number>) => translate(row.locale, `stationery.pdf.${key}`, params);
  const pieces = data.pieces ?? [...STATIONERY_PIECES];
  const cw = getColourway(getDesign(row.designKey), row.colourwayKey);
  const note = `${t("printNote")} ${cw.flood ? t("printNoteFlood") : t("printNoteStock")}`;
  const { doc, done } = await newSheetDocument({ title: t("printTitle", { title: o.title, version: row.version }), lang: row.locale, createdAt: ctx.now, subject: note, keywords: "RGB; bleed 3 mm" });
  const sheets = await scenesFor(ctx, row, pieces, { personalise: true });
  if (sheets.length === 0) throw new AppError("CONFLICT", "stationery.errors.nothingToPrint");
  for (const { piece, scene } of sheets) {
    const spec = PIECES[piece];
    const slug = `EventDesk.ro · ${translate(row.locale, `stationery.pieces.${pieceKey(piece)}`)} · ${spec.widthMm} × ${spec.heightMm} mm · ${t("slugBleed", { mm: BLEED_MM })} · v${row.version} · ${note}`;
    drawSceneOnPdf(doc, scene, { bleedMm: BLEED_MM, cropMarks: data.cropMarks, slug });
  }
  await audit(ctx, { action: "stationery.print_pdf", objectType: "occasion", objectId: data.occasionId, meta: { version: row.version, pieces, sheets: sheets.length } });
  return { filename: `${fileSlug(o.title)}-${row.locale === "ro" ? "tipar" : "print"}-v${row.version}.pdf`, mime: "application/pdf", bytes: await done() };
}

/** INTERNAL (print pack, promotion): the newest version row after the caller's own access check. */
export async function readStationeryVersion(ctx: Pick<Ctx, "db">, occasionId: string, version?: number | null): Promise<StationeryVersion | null> {
  return loadVersion(ctx, occasionId, version);
}

export function stationeryKitTexts(row: Pick<StationeryVersion, "texts">): KitTexts {
  return kitTexts(row.texts);
}

export type { StationeryLocale, StationeryText, StationeryTextField, StationeryTexts };
export { STATIONERY_TEXT_FIELDS };

onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(stationeryVersions).where(eq(stationeryVersions.occasionId, occasionId));
  await tx.db.delete(stationerySets).where(eq(stationerySets.occasionId, occasionId));
});
