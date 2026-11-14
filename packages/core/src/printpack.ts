import { eq, occasions } from "@ed/db";
import { translate } from "@ed/i18n";
import { formatDate } from "@ed/i18n/format";
import { AppError, isAppError } from "@ed/shared/errors";
import { requireMember } from "./access";
import { PDF_COLORS, pdfFonts } from "./briefingpdf";
import type { Ctx, Locale } from "./context";
import { registerExport, type ExportFile } from "./exports";
import { getGuestEventPageUrl } from "./guestevent";
import { drawQrOnPdf, listHouseholdQrs, qrMatrix } from "./qr";
import { getSeatingSummary, getSpaceModel } from "./seating";
import { buildPlanScene, modelBounds, type PlanScene, type SceneNode, type SceneRole } from "./spacemodel";
import { buildStationeryPrintPdf, fileSlug, newSheetDocument, readStationeryVersion, stationeryKitTexts, type PdfFile } from "./stationery";
import { BLEED_MM, drawSceneOnPdf, layoutPiece, mm, pdfFontName, PIECES, type KitTexts } from "./stationerykit";
import { PLANNING_ROLES } from "./suppliers";

// PRINT PACK (C-09, V9, V10) — print-ready PDFs generated from the same records the screens
// show. Registered as exports, so they appear on /occasions/<id>/print by themselves:
//
//   qr-labels        a sheet of labels: household name + the QR of ITS OWN invitation view
//   qr-invitations   the proofed invitation, one sheet per household with its QR (proof gate)
//   table-cards      a card per table (number / name) with a QR to the guest event page
//   room-plan        the room plan TO SCALE (1:50, 1:100 …), vector, with scale bar and title block
//
// What is never in these files: anything from the directory or promoted (P16), anything
// financial, the guest list (a label carries one household's name and nothing about it).
//
// THE EVENT PAGE LINK on table cards comes from a provider, so this module does not depend on
// how the public page is built:
//     setEventPageUrlProvider(async (ctx, occasionId) => "https://…/e/<slug>" | null)
// The default provider is getGuestEventPageUrl from @ed/core/guestevent (the published public
// page, or null). With no page to point at, table cards are printed without a code — a QR
// that leads nowhere useful is worse than none.

export type EventPageUrlProvider = (ctx: Ctx, occasionId: string) => Promise<string | null>;
const g = globalThis as unknown as { __edEventPageUrl?: EventPageUrlProvider };

/** Replaces where the table cards' QR points (absolute URL, or null for "no page"). */
export function setEventPageUrlProvider(fn: EventPageUrlProvider | null): void {
  g.__edEventPageUrl = fn ?? undefined;
}

/** The URL table cards link to, or null. Members only (the provider checks again). */
export async function getEventPageUrl(ctx: Ctx, occasionId: string): Promise<string | null> {
  const provider = g.__edEventPageUrl ?? getGuestEventPageUrl;
  try {
    const url = await provider(ctx, occasionId);
    return url && /^https?:\/\//.test(url) ? url : null;
  } catch (e) {
    if (isAppError(e)) return null;
    throw e;
  }
}

async function loadOccasion(ctx: Pick<Ctx, "db">, occasionId: string) {
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return o;
}

const A4 = { w: mm(210), h: mm(297) };
const tr = (locale: Locale, key: string, params?: Record<string, string | number>) => translate(locale, `printpack.${key}`, params);

function registerToolkitFonts(doc: PDFKit.PDFDocument): void {
  for (const [name, path] of Object.entries(pdfFonts())) doc.registerFont(name, path);
}

/** Small running foot: what the sheet is, for whom, when it was made. */
function sheetFoot(doc: PDFKit.PDFDocument, text: string, pageW: number, pageH: number): void {
  doc.font(pdfFontName("text")).fontSize(6.5).fillColor(PDF_COLORS.ink2).text(text, mm(12), pageH - mm(8), { lineBreak: false, width: pageW - mm(24), ellipsis: true, baseline: "alphabetic" });
}

/* ── 1. QR labels ──────────────────────────────────────────────────────── */

/**
 * A4 sheets of labels, twelve to a page: the household's name and the QR that opens ITS OWN
 * invitation view (/g/q/<qrId>). Revoked invitations are left out. Managers only — the sheet
 * is a stack of personal links.
 */
export async function buildQrLabelsPdf(ctx: Ctx, occasionId: string): Promise<PdfFile> {
  await requireMember(ctx, occasionId, { manage: true });
  const o = await loadOccasion(ctx, occasionId);
  const locale: Locale = o.locale === "en" ? "en" : "ro";
  const codes = (await listHouseholdQrs(ctx, occasionId)).filter((q) => !q.revoked);
  const title = tr(locale, "labels.docTitle", { title: o.title });
  const { doc, done } = await newSheetDocument({ title, lang: locale, createdAt: ctx.now, subject: tr(locale, "labels.subject") });
  const cols = 3;
  const rows = 4;
  const marginX = mm(12);
  const marginY = mm(14);
  const cellW = (A4.w - marginX * 2) / cols;
  const cellH = (A4.h - marginY * 2 - mm(6)) / rows;
  const perPage = cols * rows;
  const pages = Math.max(1, Math.ceil(codes.length / perPage));
  for (let p = 0; p < pages; p += 1) {
    doc.addPage({ size: [A4.w, A4.h], margin: 0 });
    if (codes.length === 0) {
      doc.font(pdfFontName("display")).fontSize(20).fillColor(PDF_COLORS.ink).text(tr(locale, "labels.emptyTitle"), marginX, mm(40), { width: A4.w - marginX * 2, align: "center" });
      doc.font(pdfFontName("text")).fontSize(10).fillColor(PDF_COLORS.ink2).text(tr(locale, "labels.emptyBody"), marginX, mm(54), { width: A4.w - marginX * 2, align: "center" });
    }
    // cut guides: hairlines between labels
    doc.save().lineWidth(0.25).strokeColor(PDF_COLORS.line).dash(1.5, { space: 2.5 });
    for (let c = 1; c < cols; c += 1) doc.moveTo(marginX + c * cellW, marginY).lineTo(marginX + c * cellW, marginY + rows * cellH).stroke();
    for (let r = 1; r < rows; r += 1) doc.moveTo(marginX, marginY + r * cellH).lineTo(marginX + cols * cellW, marginY + r * cellH).stroke();
    doc.restore();
    codes.slice(p * perPage, (p + 1) * perPage).forEach((q, i) => {
      const x = marginX + (i % cols) * cellW;
      const y = marginY + Math.floor(i / cols) * cellH;
      const size = mm(32);
      const qy = y + mm(8);
      drawQrOnPdf(doc, qrMatrix(q.url), x + (cellW - size) / 2, qy, size, { light: null });
      doc.font(pdfFontName("display")).fontSize(11.5).fillColor(PDF_COLORS.ink).text(q.householdName, x + mm(4), qy + size + mm(4), { width: cellW - mm(8), align: "center", height: 30, ellipsis: true, lineGap: 1 });
      doc
        .font(pdfFontName("text-medium"))
        .fontSize(5.6)
        .fillColor(PDF_COLORS.ink2)
        .text(tr(locale, "labels.caption").toLocaleUpperCase("ro"), x + mm(4), y + cellH - mm(9), { width: cellW - mm(8), align: "center", characterSpacing: 1.2, lineBreak: false });
    });
    sheetFoot(doc, tr(locale, "labels.foot", { title: o.title, page: p + 1, pages, date: formatDate(ctx.now, locale) }), A4.w, A4.h);
  }
  return { filename: `${fileSlug(o.title)}-${locale === "ro" ? "coduri-qr" : "qr-labels"}.pdf`, mime: "application/pdf", bytes: await done() };
}

/* ── 2. Table cards ────────────────────────────────────────────────────── */

function fallbackTexts(title: string): KitTexts {
  return { kicker: "", names: title, wording: "", date: "", time: "", venue: "", address: "", rsvp: "", saveTheDate: "", menuTitle: "", menuBody: "", thanks: "" };
}

/**
 * A card per table of the seating plan — the table's number or name, in the occasion's
 * stationery design (the newest PROOFED version; the house design before one exists) — with
 * a QR to the guest event page when there is one. Trim size with 3 mm bleed and crop marks.
 */
export async function buildTableCardsPdf(ctx: Ctx, occasionId: string): Promise<PdfFile> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const o = await loadOccasion(ctx, occasionId);
  const locale: Locale = o.locale === "en" ? "en" : "ro";
  const summary = await getSeatingSummary(ctx, occasionId);
  if (summary.tables.length === 0) throw new AppError("CONFLICT", "printpack.errors.noTables");
  // the newest version that passed the proof gate; an unproofed design is never printed
  let design = "classic";
  let colourway: string | null = "ivoire";
  let texts = fallbackTexts(o.title);
  let lang: Locale = locale;
  const latest = await readStationeryVersion(ctx, occasionId);
  for (let v = latest?.version ?? 0; v >= 1; v -= 1) {
    const row = v === latest!.version ? latest! : await readStationeryVersion(ctx, occasionId, v);
    if (row?.proofedAt) {
      design = row.designKey;
      colourway = row.colourwayKey;
      texts = stationeryKitTexts(row);
      lang = row.locale;
      break;
    }
  }
  const url = await getEventPageUrl(ctx, occasionId);
  const qr = url ? { matrix: qrMatrix(url), caption: tr(lang, "tables.qrCaption") } : null;
  const { doc, done } = await newSheetDocument({ title: tr(locale, "tables.docTitle", { title: o.title }), lang: locale, createdAt: ctx.now, subject: tr(locale, "tables.subject"), keywords: "RGB; bleed 3 mm" });
  const spec = PIECES["table-card"];
  for (const t of summary.tables) {
    const scene = layoutPiece({ design, colourway, piece: "table-card", texts, occasionKind: o.kind, extra: { tableLabel: t.label, tableWord: translate(lang, "stationery.pieces.tableWord"), qr } });
    drawSceneOnPdf(doc, scene, { bleedMm: BLEED_MM, cropMarks: true, slug: `EventDesk.ro · ${tr(locale, "tables.slug", { label: t.label })} · ${spec.widthMm} × ${spec.heightMm} mm · ${translate(locale, "stationery.pdf.slugBleed", { mm: BLEED_MM })} · ${translate(locale, "stationery.pdf.printNote")}` });
  }
  return { filename: `${fileSlug(o.title)}-${locale === "ro" ? "carduri-mese" : "table-cards"}.pdf`, mime: "application/pdf", bytes: await done() };
}

/* ── 3. Room plan, to scale ────────────────────────────────────────────── */

/** Standard drawing scales (1:N), smallest N first. */
export const PLAN_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000] as const;

/** The largest standard scale at which `spanMm` fits `roomPt` (points on paper). */
export function pickPlanScale(spanXmm: number, spanYmm: number, roomWpt: number, roomHpt: number): number {
  for (const n of PLAN_SCALES) if (mm(spanXmm / n) <= roomWpt && mm(spanYmm / n) <= roomHpt) return n;
  return Math.ceil(Math.max(mm(spanXmm) / roomWpt, mm(spanYmm) / roomHpt) / 500) * 500;
}

const INK = PDF_COLORS.ink;
const INK2 = PDF_COLORS.ink2;
const LINE = PDF_COLORS.line;
const GILT = PDF_COLORS.gilt;
type Paint = { fill?: string; stroke?: string; sw?: number; dash?: [number, number]; fillOpacity?: number; font?: "sans" | "sans-bold"; size?: number; spacing?: number };
// the print inks of the on-screen plan (spacemodel PRINT_STYLE), for pdfkit
const PLAN_PAINT: Record<SceneRole, Paint | null> = {
  grid: { stroke: LINE, sw: 0.4 },
  "grid-major": { stroke: LINE, sw: 0.8 },
  area: { fill: "#fffdf8", fillOpacity: 0.82, stroke: INK, sw: 1.6 },
  "area-label": { fill: INK2, font: "sans-bold", size: 8.5, spacing: 1.2 },
  parking: { stroke: INK2, sw: 0.9, dash: [2, 3] },
  "parking-label": { fill: INK2, font: "sans-bold", size: 10, spacing: 0.6 },
  venue: { fill: "#ffffff", stroke: INK, sw: 1.3 },
  custom: { fill: "#ffffff", stroke: INK, sw: 1.3, dash: [5, 4] },
  fixture: { fill: "#ece8df", stroke: INK2, sw: 1 },
  "fixture-custom": { fill: "#ece8df", stroke: INK2, sw: 1, dash: [5, 4] },
  unknown: { stroke: INK2, sw: 1, dash: [1.5, 3] },
  seat: { fill: "#fffdf8", stroke: INK2, sw: 0.6 },
  "seat-taken": { fill: INK2, stroke: INK2, sw: 0.6 },
  label: { fill: INK, font: "sans-bold", size: 9.5, spacing: 0.2 },
  sublabel: { fill: INK2, font: "sans", size: 8.5 },
  "fixture-label": { fill: INK2, font: "sans-bold", size: 8.5, spacing: 1.1 },
  poi: { fill: GILT },
  "poi-label": { fill: INK, font: "sans-bold", size: 10 },
  hit: null,
  scale: { stroke: INK, sw: 1 },
  "scale-label": { fill: INK, font: "sans-bold", size: 9.5, spacing: 0.6 },
  "title-box": { fill: "#fffdf8", stroke: INK, sw: 0.8 },
  "title-name": { fill: INK, font: "sans-bold", size: 7.6, spacing: 0.7 },
  "title-meta": { fill: INK2, font: "sans", size: 7.6, spacing: 0.2 },
  calibration: { stroke: GILT, sw: 1.5 },
  highlight: { stroke: INK, sw: 2.4 },
};

function paintShape(doc: PDFKit.PDFDocument, p: Paint): void {
  if (p.dash) doc.dash(p.dash[0], { space: p.dash[1] });
  else doc.undash();
  if (p.sw) doc.lineWidth(p.sw);
  if (p.fill && p.stroke) {
    doc.fillOpacity(p.fillOpacity ?? 1).fillAndStroke(p.fill, p.stroke);
    doc.fillOpacity(1);
  } else if (p.fill) doc.fill(p.fill);
  else if (p.stroke) doc.stroke(p.stroke);
}

function drawNode(doc: PDFKit.PDFDocument, n: SceneNode): void {
  const p = PLAN_PAINT[n.role];
  if (!p) return;
  switch (n.t) {
    case "line":
      doc.moveTo(n.x1, n.y1).lineTo(n.x2, n.y2);
      paintShape(doc, { stroke: p.stroke, sw: p.sw, dash: p.dash });
      break;
    case "rect":
      doc.save();
      if (n.rotate) doc.rotate(n.rotate, { origin: [n.cx ?? n.x + n.w / 2, n.cy ?? n.y + n.h / 2] });
      doc.rect(n.x, n.y, n.w, n.h);
      paintShape(doc, p);
      doc.restore();
      break;
    case "circle":
      doc.circle(n.cx, n.cy, n.r);
      paintShape(doc, p);
      break;
    case "polygon":
      if (n.points.length < 2) break;
      doc.polygon(...n.points);
      paintShape(doc, p);
      break;
    case "text": {
      doc.font(p.font ?? "sans").fontSize(p.size ?? 9);
      const spacing = p.spacing ?? 0;
      const w = doc.widthOfString(n.text, { characterSpacing: spacing });
      const x = n.anchor === "middle" ? n.x - w / 2 : n.anchor === "end" ? n.x - w : n.x;
      doc.fillColor(p.fill ?? INK).text(n.text, x, n.y, { lineBreak: false, characterSpacing: spacing, baseline: "alphabetic" });
      break;
    }
  }
}

/** Draws a plan scene with pdfkit as vector primitives, `k` points per scene unit, at (ox, oy). */
export function drawPlanSceneOnPdf(doc: PDFKit.PDFDocument, scene: PlanScene, ox: number, oy: number, k: number): void {
  doc.save();
  doc.translate(ox, oy).scale(k);
  for (const n of scene.under) drawNode(doc, n);
  for (const it of scene.items) for (const n of it.nodes) drawNode(doc, n);
  for (const p of scene.pois) for (const n of p.nodes) drawNode(doc, n);
  for (const n of scene.over) drawNode(doc, n);
  doc.restore();
  doc.undash();
}

/**
 * THE ROOM PLAN TO SCALE: the occasion's space model drawn 1:N on A4 landscape (the largest
 * standard scale that fits), as vector primitives of the same scene the screens draw, with
 * the scale bar and a title block. Needs a space model; an unpublished seating plan prints
 * all the same (it is the planner's working sheet). Table labels and seat counts only — no names.
 */
export async function buildRoomPlanPdf(ctx: Ctx, occasionId: string): Promise<PdfFile & { scale: number }> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const o = await loadOccasion(ctx, occasionId);
  const locale: Locale = o.locale === "en" ? "en" : "ro";
  const [space, summary] = await Promise.all([getSpaceModel(ctx, occasionId), getSeatingSummary(ctx, occasionId)]);
  if (!space) throw new AppError("CONFLICT", "printpack.errors.noSpace");
  const page = { w: A4.h, h: A4.w }; // landscape
  const margin = mm(12);
  const head = mm(22);
  const foot = mm(12);
  const sceneMargin = 20;
  const sceneFooter = 46;
  const roomW = page.w - margin * 2 - sceneMargin * 2;
  const roomH = page.h - margin * 2 - head - foot - sceneMargin * 2 - sceneFooter;
  const sceneOpts = { showParking: false, withBackdrop: false, showCounts: true, margin: sceneMargin } as const;
  const b = modelBounds(space.model, { withParking: false, withBackdrop: false });
  const spanX = Math.max(b.maxX - b.minX, 1000);
  const spanY = Math.max(b.maxY - b.minY, 1000);
  const n = pickPlanScale(spanX, spanY, roomW, roomH);
  // a scene whose own unit is (almost exactly) one point at 1:n; `k` takes up the rounding
  const width = Math.round(mm(spanX / n) + sceneMargin * 2);
  const meta = [space.versionNo ? `v${space.versionNo}` : null, space.effectiveAt ? formatDate(space.effectiveAt, locale) : null, `1:${n}`].filter(Boolean).join(" · ");
  const scene = buildPlanScene(space.model, { ...sceneOpts, width, title: { name: space.name.toLocaleUpperCase("ro"), meta }, scaleLabel: (m) => `${m} m` });
  const k = mm(1 / n) / scene.scale;

  const { doc, done } = await newSheetDocument({ title: tr(locale, "plan.docTitle", { title: o.title }), lang: locale, createdAt: ctx.now, subject: tr(locale, "plan.subject", { scale: n }) });
  registerToolkitFonts(doc);
  doc.addPage({ size: [page.w, page.h], margin: 0 });
  // header: what, where, at which scale
  doc.font(pdfFontName("text-medium")).fontSize(6.8).fillColor(PDF_COLORS.ink2).text(tr(locale, "plan.eyebrow").toLocaleUpperCase("ro"), margin, margin + 6, { lineBreak: false, characterSpacing: 1.6, baseline: "alphabetic" });
  doc.font(pdfFontName("display")).fontSize(19).fillColor(INK).text(o.title, margin, margin + 27, { lineBreak: false, width: page.w * 0.6, ellipsis: true, baseline: "alphabetic" });
  const right = (text: string, y: number, fontKey: "text" | "text-medium", size: number, color: string) => {
    doc.font(pdfFontName(fontKey)).fontSize(size);
    doc.fillColor(color).text(text, page.w - margin - doc.widthOfString(text), y, { lineBreak: false, baseline: "alphabetic" });
  };
  right(tr(locale, "plan.scale", { scale: n }), margin + 12, "text-medium", 11, INK);
  right(`${space.name} · ${tr(locale, "plan.seats", { taken: summary.seats.taken, total: summary.seats.total })}`, margin + 27, "text", 8, INK2);
  doc.moveTo(margin, margin + head - mm(6)).lineTo(page.w - margin, margin + head - mm(6)).lineWidth(0.5).strokeColor(GILT).stroke();
  // the drawing, centred in the room left for it
  const drawW = scene.width * k;
  const drawH = scene.height * k;
  const areaTop = margin + head;
  const areaH = page.h - margin - foot - areaTop;
  drawPlanSceneOnPdf(doc, scene, (page.w - drawW) / 2, areaTop + Math.max(0, (areaH - drawH) / 2), k);
  sheetFoot(
    doc,
    [tr(locale, "plan.printNote"), summary.publishedAt ? null : tr(locale, "plan.unpublished"), tr(locale, "plan.made", { date: formatDate(ctx.now, locale) })].filter(Boolean).join("  ·  "),
    page.w,
    page.h,
  );
  return { filename: `${fileSlug(o.title)}-${locale === "ro" ? "planul-salii" : "room-plan"}-1-${n}.pdf`, mime: "application/pdf", bytes: await done(), scale: n };
}

/* ── 4. Invitations with each household's QR ───────────────────────────── */

/**
 * The print-ready invitation, one sheet per household with the QR of its own invitation view.
 * Goes through the stationery PROOF GATE: only the newest version, and only when a manager
 * marked it as proofed.
 */
export async function buildQrInvitationsPdf(ctx: Ctx, occasionId: string): Promise<PdfFile> {
  await requireMember(ctx, occasionId, { manage: true });
  const latest = await readStationeryVersion(ctx, occasionId);
  if (!latest) throw new AppError("CONFLICT", "printpack.errors.noStationery");
  if (!latest.proofedAt) throw new AppError("CONFLICT", "stationery.errors.notProofed", { params: { version: latest.version } });
  if (!latest.qrOnInvitation) throw new AppError("CONFLICT", "printpack.errors.qrOff");
  return buildStationeryPrintPdf(ctx, { occasionId, version: latest.version, pieces: ["invitation"], cropMarks: true });
}

/* ── Exports ───────────────────────────────────────────────────────────── */

/** One A4 page that says, in words, why the file asked for cannot be made yet and what to do. */
async function noticePdf(ctx: Ctx, occasionId: string, key: string, messageKey: string, params?: Record<string, string | number>): Promise<PdfFile> {
  const o = await loadOccasion(ctx, occasionId);
  const locale: Locale = ctx.locale;
  const { doc, done } = await newSheetDocument({ title: tr(locale, `exports.${key}.title`), lang: locale, createdAt: ctx.now });
  doc.addPage({ size: [A4.w, A4.h], margin: 0 });
  const x = mm(24);
  const w = A4.w - x * 2;
  doc.font(pdfFontName("text-medium")).fontSize(7).fillColor(PDF_COLORS.ink2).text(tr(locale, "notice.eyebrow").toLocaleUpperCase("ro"), x, mm(40), { characterSpacing: 1.6, lineBreak: false });
  doc.font(pdfFontName("display")).fontSize(26).fillColor(INK).text(tr(locale, `exports.${key}.title`), x, mm(48), { width: w, lineGap: 2 });
  doc.moveTo(x, doc.y + 12).lineTo(x + 96, doc.y + 12).lineWidth(0.6).strokeColor(GILT).stroke();
  doc.font(pdfFontName("text")).fontSize(11).fillColor(INK).text(translate(locale, messageKey, params), x, doc.y + 28, { width: w, lineGap: 4 });
  doc.font(pdfFontName("text")).fontSize(9).fillColor(PDF_COLORS.ink2).text(o.title, x, doc.y + 18, { width: w });
  return { filename: `${fileSlug(o.title)}-${key}.pdf`, mime: "application/pdf", bytes: await done() };
}

const toExport = (f: PdfFile): ExportFile => ({ filename: f.filename, mime: f.mime, content: f.bytes as unknown as string }); // bytes behind the string type, like the briefing PDF

/** Runs a builder; a "not yet possible" answer becomes a one-page notice instead of a dead link. */
async function orNotice(ctx: Ctx, occasionId: string, key: string, build: () => Promise<PdfFile>): Promise<ExportFile> {
  try {
    return toExport(await build());
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT" && e.messageKey) {
      return toExport(await noticePdf(ctx, occasionId, key, e.messageKey, (e.details?.params ?? undefined) as Record<string, string | number> | undefined));
    }
    throw e;
  }
}

registerExport({
  key: "qr-labels",
  titleKey: "printpack.exports.qrLabels.title",
  descriptionKey: "printpack.exports.qrLabels.description",
  manageOnly: true,
  run: (ctx, occasionId) => orNotice(ctx, occasionId, "qrLabels", () => buildQrLabelsPdf(ctx, occasionId)),
});
registerExport({
  key: "qr-invitations",
  titleKey: "printpack.exports.qrInvitations.title",
  descriptionKey: "printpack.exports.qrInvitations.description",
  manageOnly: true,
  run: (ctx, occasionId) => orNotice(ctx, occasionId, "qrInvitations", () => buildQrInvitationsPdf(ctx, occasionId)),
});
registerExport({
  key: "table-cards",
  titleKey: "printpack.exports.tableCards.title",
  descriptionKey: "printpack.exports.tableCards.description",
  run: (ctx, occasionId) => orNotice(ctx, occasionId, "tableCards", () => buildTableCardsPdf(ctx, occasionId)),
});
registerExport({
  key: "room-plan",
  titleKey: "printpack.exports.roomPlan.title",
  descriptionKey: "printpack.exports.roomPlan.description",
  run: (ctx, occasionId) => orNotice(ctx, occasionId, "roomPlan", () => buildRoomPlanPdf(ctx, occasionId)),
});
