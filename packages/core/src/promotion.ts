import { eq, occasions, promotionCopies, PROMOTION_TEXT_KEYS, type PromotionText, type PromotionTextKey, type PromotionTexts } from "@ed/db";
import { translate } from "@ed/i18n";
import { formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { AppError } from "@ed/shared/errors";
import { zonedParts } from "@ed/shared/time";
import { z } from "zod";
import { isManager, requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx, Locale } from "./context";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { defaultStationeryTexts, fileSlug, newSheetDocument, readStationeryVersion, stationeryKitTexts, stillAiGenerated, type PdfFile } from "./stationery";
import { drawSceneNodes, layoutPiece, mm, sceneSvgBody, type KitTexts, type Scene } from "./stationerykit";
import { PLANNING_ROLES } from "./suppliers";
import { inTx } from "./tx";

// PROMOTION EXPORTS (C-12): copy and assets the planner DOWNLOADS and uses wherever they like.
//
//   getPromotionPage(ctx, occasionId)         the texts (saved or freshly composed) and what can be downloaded
//   savePromotionTexts(ctx, …)                keeps the planner's edits (with the AI label where it applies)
//   buildPromotionCard(ctx, { size })         a shareable image (PNG): square 1080×1080 or story 1080×1920
//   buildPromotionIcs(ctx, occasionId)        a calendar file (.ics)
//   buildPromotionPoster(ctx, { size })       a printable poster (PDF, A4 or A3)
//
// EXPORT ONLY. This module posts nothing, schedules nothing and spends nothing: it has no
// network client, no social or advertising integration and no credentials for one — every
// function either reads the occasion's own records or returns bytes to the person who asked.
// (A test reads this file and fails if a network call ever appears in it.)
//
// The assets are drawn with the occasion's stationery design (its newest saved version) or,
// before one exists, with the house design and the occasion's own facts. Wording suggestions
// from the AI text feature are requested by the page through @ed/core/aitext, within its
// monthly quota; this module only stores the label with the text.

export { PROMOTION_TEXT_KEYS };
export type { PromotionText, PromotionTextKey, PromotionTexts };

export const PROMOTION_TEXT_LIMITS: Record<PromotionTextKey, number> = { shortRo: 280, longRo: 1200, shortEn: 280, longEn: 1200 };
export const PROMOTION_CARD_SIZES = { square: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } } as const;
export type PromotionCardSize = keyof typeof PROMOTION_CARD_SIZES;
export const PROMOTION_POSTER_SIZES = { A4: { widthMm: 210, heightMm: 297 }, A3: { widthMm: 297, heightMm: 420 } } as const;
export type PromotionPosterSize = keyof typeof PROMOTION_POSTER_SIZES;

type Occasion = typeof occasions.$inferSelect;

async function loadOccasion(ctx: Pick<Ctx, "db">, occasionId: string): Promise<Occasion> {
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return o;
}

const hasClock = (o: Pick<Occasion, "startsAt" | "timezone">): boolean => {
  if (!o.startsAt) return false;
  const hm = formatTime(o.startsAt, "ro", o.timezone);
  return hm !== "12:00" && hm !== "00:00";
};

/** Short and long description in one language, written from the occasion's own facts. Missing facts are left out, never invented. */
export function composePromotionTexts(o: Pick<Occasion, "title" | "startsAt" | "timezone" | "venueName" | "venueAddress" | "purpose">, locale: Locale): { short: string; long: string } {
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, `promotion.copy.${key}`, params);
  const date = o.startsAt ? formatWeekdayDate(o.startsAt, locale, o.timezone) : null;
  const time = hasClock(o) ? formatTime(o.startsAt!, locale, o.timezone) : null;
  const when = date ? (time ? t("whenTime", { date, time }) : t("when", { date })) : null;
  const where = o.venueName ? (o.venueAddress ? t("whereAddress", { venue: o.venueName, address: o.venueAddress }) : t("where", { venue: o.venueName })) : o.venueAddress ? t("where", { venue: o.venueAddress }) : null;
  const facts = [when, where].filter(Boolean).join(", ");
  const short = facts ? t("short", { title: o.title, facts }) : t("shortBare", { title: o.title });
  const long = [t("longOpen", { title: o.title }), when ? t("longWhen", { when }) : null, where ? t("longWhere", { where }) : null, o.purpose?.trim() || null, t("longClose")].filter(Boolean).join(" ");
  return { short: short.slice(0, PROMOTION_TEXT_LIMITS.shortRo), long: long.slice(0, PROMOTION_TEXT_LIMITS.longRo) };
}

export type PromotionPage = {
  occasion: { id: string; title: string; kind: string; hasDate: boolean };
  /** The four texts: the planner's saved wording, or the composed one where nothing was saved. */
  texts: Record<PromotionTextKey, PromotionText & { saved: boolean }>;
  /** Design the assets are drawn with: the stationery set's, or the house design before one exists. */
  design: { fromStationery: boolean; designKey: string; colourwayKey: string | null };
  canManage: boolean;
};

async function readDesign(ctx: Pick<Ctx, "db">, o: Occasion): Promise<{ fromStationery: boolean; designKey: string; colourwayKey: string | null; texts: KitTexts }> {
  const row = await readStationeryVersion(ctx, o.id);
  if (row) return { fromStationery: true, designKey: row.designKey, colourwayKey: row.colourwayKey, texts: stationeryKitTexts(row) };
  const locale: Locale = o.locale === "en" ? "en" : "ro";
  const defaults = defaultStationeryTexts(o, locale);
  const texts = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v.value])) as KitTexts;
  return { fromStationery: false, designKey: "classic", colourwayKey: "ivoire", texts };
}

/** What the promotion page shows. Planning members. */
export async function getPromotionPage(ctx: Ctx, occasionId: string): Promise<PromotionPage> {
  const member = await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const o = await loadOccasion(ctx, occasionId);
  const [saved] = await ctx.db.select().from(promotionCopies).where(eq(promotionCopies.occasionId, occasionId));
  const ro = composePromotionTexts(o, "ro");
  const en = composePromotionTexts(o, "en");
  const composed: Record<PromotionTextKey, string> = { shortRo: ro.short, longRo: ro.long, shortEn: en.short, longEn: en.long };
  const texts = Object.fromEntries(
    PROMOTION_TEXT_KEYS.map((k) => {
      const s = saved?.texts[k];
      return [k, s ? { ...s, saved: true } : { value: composed[k], aiGenerated: false, saved: false }];
    }),
  ) as PromotionPage["texts"];
  const design = await readDesign(ctx, o);
  return {
    occasion: { id: o.id, title: o.title, kind: o.kind, hasDate: !!o.startsAt },
    texts,
    design: { fromStationery: design.fromStationery, designKey: design.designKey, colourwayKey: design.colourwayKey },
    canManage: isManager(member) && ctx.actor.kind !== "mcp",
  };
}

const textsInput = z.object({
  occasionId: z.string().min(1).max(64),
  texts: z.partialRecord(z.enum(PROMOTION_TEXT_KEYS), z.object({ value: z.string().max(2000), aiOriginal: z.string().max(2000).nullish() })),
});

/** Keeps the planner's wording. A text accepted from the AI feature keeps its label until it is substantially rewritten (INF7). Managers. */
export async function savePromotionTexts(ctx: Ctx, input: z.input<typeof textsInput>): Promise<void> {
  const data = textsInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, data.occasionId);
  const [prev] = await ctx.db.select().from(promotionCopies).where(eq(promotionCopies.occasionId, data.occasionId));
  const next: PromotionTexts = { ...(prev?.texts ?? {}) };
  const fieldErrors: Record<string, string[]> = {};
  for (const key of PROMOTION_TEXT_KEYS) {
    const entry = data.texts[key];
    if (!entry) continue;
    const value = entry.value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
    if (value.length > PROMOTION_TEXT_LIMITS[key]) fieldErrors[key] = ["common.validation.tooLong"];
    const original = entry.aiOriginal ?? prev?.texts[key]?.aiOriginal ?? null;
    next[key] = stillAiGenerated(original, value) ? { value, aiGenerated: true, aiOriginal: original } : { value, aiGenerated: false };
  }
  if (Object.keys(fieldErrors).length) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
  await inTx(ctx, async (tx) => {
    await tx.db.insert(promotionCopies).values({ occasionId: data.occasionId, texts: next }).onConflictDoUpdate({ target: promotionCopies.occasionId, set: { texts: next, updatedAt: tx.now } });
    await audit(tx, { action: "promotion.texts_saved", objectType: "occasion", objectId: data.occasionId });
  });
}

/* ── Image card ────────────────────────────────────────────────────────── */

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** The card as SVG: the stationery sheet set on a quiet ground of its own paper colour. */
export function promotionCardSvg(scene: Scene, size: PromotionCardSize): string {
  const { width, height } = PROMOTION_CARD_SIZES[size];
  const cw = scene.colourway;
  const ground = cw.dark ? mix(cw.paper, "#000000", 0.28) : mix(cw.paper, cw.ink, 0.085);
  const k = Math.min((width * 0.84) / scene.width, (height * 0.84) / scene.height);
  const x = (width - scene.width * k) / 2;
  const y = (height - scene.height * k) / 2;
  const edge = cw.dark ? mix(cw.paper, "#ffffff", 0.12) : mix(cw.paper, cw.ink, 0.16);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${ground}"/>` +
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})">${sceneSvgBody(scene)}<rect width="${scene.width}" height="${scene.height}" fill="none" stroke="${edge}" stroke-width="${(1 / k).toFixed(3)}"/></g>` +
    `</svg>`
  );
}

async function cardScene(ctx: Pick<Ctx, "db">, o: Occasion, size: PromotionCardSize): Promise<Scene> {
  const d = await readDesign(ctx, o);
  // a card announces; the invitation's RSVP line and address stay on the invitation
  const texts: KitTexts = { ...d.texts, rsvp: "", address: "" };
  return layoutPiece({ design: d.designKey, colourway: d.colourwayKey, piece: size === "square" ? "invitation-square" : "invitation", texts, occasionKind: o.kind });
}

/** The square card as SVG, for the page's preview (the same drawing the PNG is made from). Planning members. */
export async function getPromotionCardPreview(ctx: Ctx, occasionId: string): Promise<string> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  return promotionCardSvg(await cardScene(ctx, await loadOccasion(ctx, occasionId), "square"), "square");
}

export type BinaryFile = { filename: string; mime: string; bytes: Uint8Array };

/** A shareable image card (PNG) in the occasion's stationery design. Planning members. Returned to the caller — never posted. */
export async function buildPromotionCard(ctx: Ctx, input: { occasionId: string; size: PromotionCardSize }): Promise<BinaryFile> {
  const size: PromotionCardSize = input.size === "story" ? "story" : "square";
  await requireMember(ctx, input.occasionId, { roles: PLANNING_ROLES });
  const o = await loadOccasion(ctx, input.occasionId);
  const svg = promotionCardSvg(await cardScene(ctx, o, size), size);
  const { default: sharp } = await import("sharp");
  const png = await sharp(Buffer.from(svg, "utf8")).png({ compressionLevel: 9 }).toBuffer();
  return { filename: `${fileSlug(o.title)}-${size === "square" ? "card" : "story"}.png`, mime: "image/png", bytes: new Uint8Array(png) };
}

/* ── Calendar file ─────────────────────────────────────────────────────── */

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const icsUtc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const icsDay = (d: Date, tz: string, plusDays = 0) => {
  const p = zonedParts(d, tz);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + plusDays));
  return `${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}`;
};

/** RFC 5545 line folding at 75 octets. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The calendar entry as text (pure). An occasion dated by day is an all-day event; one with a real time carries it in UTC. */
export function occasionToIcs(o: Pick<Occasion, "id" | "title" | "startsAt" | "endsAt" | "timezone" | "venueName" | "venueAddress">, description: string, now: Date): string {
  if (!o.startsAt) throw new AppError("CONFLICT", "promotion.errors.noDate");
  const timed = hasClock(o);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EventDesk.ro//Promotion export//RO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:${o.id}@eventdesk.ro`, `DTSTAMP:${icsUtc(now)}`];
  if (timed) {
    lines.push(`DTSTART:${icsUtc(o.startsAt)}`);
    lines.push(`DTEND:${icsUtc(o.endsAt && o.endsAt > o.startsAt ? o.endsAt : new Date(o.startsAt.getTime() + 4 * 3600_000))}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${icsDay(o.startsAt, o.timezone)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDay(o.endsAt && o.endsAt > o.startsAt ? o.endsAt : o.startsAt, o.timezone, 1)}`);
  }
  lines.push(`SUMMARY:${icsEscape(o.title)}`);
  const location = [o.venueName, o.venueAddress].filter(Boolean).join(", ");
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A calendar file of the occasion with the short description. Planning members. */
export async function buildPromotionIcs(ctx: Ctx, occasionId: string): Promise<BinaryFile> {
  const page = await getPromotionPage(ctx, occasionId);
  const o = await loadOccasion(ctx, occasionId);
  const text = occasionToIcs(o, page.texts[o.locale === "en" ? "shortEn" : "shortRo"].value, ctx.now);
  return { filename: `${fileSlug(o.title)}.ics`, mime: "text/calendar; charset=utf-8", bytes: new Uint8Array(Buffer.from(text, "utf8")) };
}

/* ── Poster ────────────────────────────────────────────────────────────── */

/** A printable poster (PDF, A4 or A3): the invitation sheet enlarged, vector, fonts embedded. Planning members. */
export async function buildPromotionPoster(ctx: Ctx, input: { occasionId: string; size: PromotionPosterSize }): Promise<PdfFile> {
  const size: PromotionPosterSize = input.size === "A3" ? "A3" : "A4";
  await requireMember(ctx, input.occasionId, { roles: PLANNING_ROLES });
  const o = await loadOccasion(ctx, input.occasionId);
  const locale: Locale = o.locale === "en" ? "en" : "ro";
  const d = await readDesign(ctx, o);
  const scene = layoutPiece({ design: d.designKey, colourway: d.colourwayKey, piece: "invitation", texts: { ...d.texts, rsvp: "" }, occasionKind: o.kind });
  const page = { w: mm(PROMOTION_POSTER_SIZES[size].widthMm), h: mm(PROMOTION_POSTER_SIZES[size].heightMm) };
  const { doc, done } = await newSheetDocument({ title: translate(locale, "promotion.poster.docTitle", { title: o.title, size }), lang: locale, createdAt: ctx.now, subject: translate(locale, "promotion.poster.subject") });
  doc.addPage({ size: [page.w, page.h], margin: 0 });
  if (scene.colourway.flood) doc.rect(0, 0, page.w, page.h).fill(scene.colourway.paper);
  // A5 → A4 → A3 keep one proportion: the sheet is simply enlarged
  const k = Math.min(page.w / scene.width, page.h / scene.height);
  doc.save();
  doc.translate((page.w - scene.width * k) / 2, (page.h - scene.height * k) / 2).scale(k);
  drawSceneNodes(doc, scene);
  doc.restore();
  return { filename: `${fileSlug(o.title)}-${locale === "ro" ? "afis" : "poster"}-${size}.pdf`, mime: "application/pdf", bytes: await done() };
}

onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(promotionCopies).where(eq(promotionCopies.occasionId, occasionId));
});
