import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  and,
  asc,
  bookings,
  briefingAcks,
  briefingVersions,
  desc,
  deliveries,
  deliveryItems,
  eq,
  inArray,
  ne,
  occasions,
  sql,
  suppliers,
  taskDayState,
  BRIEFING_FIELDS,
  type BookingState,
  type BriefingContent,
  type DeliveryKind,
} from "@ed/db";
import { translate } from "@ed/i18n";
import { formatDateTime, formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { AppError } from "@ed/shared/errors";
import { requireMember } from "./access";
import type { Ctx, Locale } from "./context";
import { registerExport } from "./exports";
import { getRsvpSummary } from "./rsvp";
import { PLANNING_ROLES } from "./suppliers";
import { queryTasksUnchecked } from "./tasks";
import { instantToDay, shiftDay } from "./templates";

// Downloadable briefing of the occasion (B11): one PDF, generated on the server from the same
// records the screens show — date, venue, the programme of the day, suppliers with contacts
// and their latest briefing, deliveries, and guest COUNTS.
//
// What is deliberately NOT in it: the guest list (names, contacts, answers), anything
// financial (agreed amounts, payment deadlines, deposits) and anything from the directory or
// promoted (P16). The data model below simply has no field for them.
//
// Fonts: pdfkit's built-in fonts cannot draw ș ț ă â î, so the PDF embeds DejaVu Serif / Sans
// (npm package `dejavu-fonts-ttf`, free licence). pdfFonts() and newPdfDocument() are exported
// for other server-made PDFs (print pack).

export type OccasionBriefing = {
  locale: Locale;
  title: string;
  timezone: string;
  startsAt: Date | null;
  endsAt: Date | null;
  venueName: string | null;
  venueAddress: string | null;
  programme: Array<{ day: string; time: string | null; title: string; ownerName: string | null }>;
  suppliers: Array<{
    name: string;
    categoryLabel: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    state: BookingState;
    briefing: { version: number; publishedAt: Date; content: BriefingContent; ack: { name: string; at: Date } | null } | null;
  }>;
  deliveries: Array<{
    title: string;
    kind: DeliveryKind;
    supplierName: string | null;
    expectedFrom: Date | null;
    expectedTo: Date | null;
    place: string | null;
    items: Array<{ label: string; expectedQty: number; unit: string | null }>;
  }>;
  guests: { adults: number; children: number; total: number };
  generatedAt: Date;
};

/** Gathers the briefing's content. Planning members only. No money, no guest names. */
export async function collectOccasionBriefing(ctx: Ctx, occasionId: string): Promise<OccasionBriefing> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const firstDay = o.startsAt ? instantToDay(o.startsAt, o.timezone) : null;
  const lastDay = o.endsAt ? instantToDay(o.endsAt, o.timezone) : firstDay;

  const [taskPage, supplierRows, deliveryRows, summary] = await Promise.all([
    firstDay && lastDay
      ? queryTasksUnchecked(ctx, occasionId, { dueFrom: firstDay, dueTo: lastDay < shiftDay(firstDay, { days: 30 }) ? lastDay : shiftDay(firstDay, { days: 30 }), limit: 500 })
      : Promise.resolve({ rows: [], total: 0, hasMore: false }),
    ctx.db
      .select({ s: suppliers, b: bookings })
      .from(suppliers)
      .innerJoin(bookings, eq(bookings.supplierId, suppliers.id))
      .where(and(eq(suppliers.occasionId, occasionId), ne(bookings.state, "cancelled")))
      .orderBy(asc(sql`lower(${suppliers.name})`)),
    ctx.db
      .select({ d: deliveries, supplierName: suppliers.name })
      .from(deliveries)
      .leftJoin(suppliers, eq(suppliers.id, deliveries.supplierId))
      .where(eq(deliveries.occasionId, occasionId))
      .orderBy(sql`${deliveries.expectedFrom} asc nulls last`, asc(deliveries.createdAt)),
    getRsvpSummary(ctx, occasionId),
  ]);

  const taskIds = taskPage.rows.map((t) => t.id);
  const bookingIds = supplierRows.map((r) => r.b.id);
  const deliveryIds = deliveryRows.map((r) => r.d.id);
  const [times, versions, items] = await Promise.all([
    taskIds.length ? ctx.db.select().from(taskDayState).where(inArray(taskDayState.taskId, taskIds)) : Promise.resolve([]),
    bookingIds.length
      ? ctx.db
          .select({ v: briefingVersions, a: briefingAcks })
          .from(briefingVersions)
          .leftJoin(briefingAcks, eq(briefingAcks.briefingVersionId, briefingVersions.id))
          .where(inArray(briefingVersions.bookingId, bookingIds))
          .orderBy(desc(briefingVersions.version))
      : Promise.resolve([]),
    deliveryIds.length
      ? ctx.db.select().from(deliveryItems).where(inArray(deliveryItems.deliveryId, deliveryIds)).orderBy(asc(deliveryItems.position), asc(deliveryItems.createdAt), asc(deliveryItems.id))
      : Promise.resolve([]),
  ]);

  const programme = taskPage.rows
    .map((t) => ({
      day: t.dueDay ?? "",
      time: times.find((x) => x.taskId === t.id)?.startTime ?? null,
      title: t.title,
      ownerName: t.ownerName,
    }))
    .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : (a.time ?? "99:99") < (b.time ?? "99:99") ? -1 : (a.time ?? "99:99") > (b.time ?? "99:99") ? 1 : 0));

  return {
    locale: ctx.locale,
    title: o.title,
    timezone: o.timezone,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    venueName: o.venueName,
    venueAddress: o.venueAddress,
    programme,
    suppliers: supplierRows.map(({ s, b }) => {
      const latest = versions.find((x) => x.v.bookingId === b.id);
      return {
        name: s.name,
        categoryLabel: s.categoryLabel,
        contactName: s.contactName,
        contactPhone: s.contactPhone,
        contactEmail: s.contactEmail,
        state: b.state,
        briefing: latest
          ? {
              version: latest.v.version,
              publishedAt: latest.v.createdAt,
              content: latest.v.content,
              ack: latest.a ? { name: latest.a.ackName, at: latest.a.ackAt } : null,
            }
          : null,
      };
    }),
    deliveries: deliveryRows.map(({ d, supplierName }) => ({
      title: d.title,
      kind: d.kind,
      supplierName,
      expectedFrom: d.expectedFrom,
      expectedTo: d.expectedTo,
      place: d.place,
      items: items.filter((i) => i.deliveryId === d.id).map((i) => ({ label: i.label, expectedQty: i.expectedQty, unit: i.unit })),
    })),
    guests: { ...summary.attending },
    generatedAt: ctx.now,
  };
}

/* ── Fonts and document helpers (reusable by other server-made PDFs) ─────────────── */

export type PdfFontName = "serif" | "serif-bold" | "serif-italic" | "sans" | "sans-bold";
const FONT_FILES: Record<PdfFontName, string> = {
  serif: "DejaVuSerif.ttf",
  "serif-bold": "DejaVuSerif-Bold.ttf",
  "serif-italic": "DejaVuSerif-Italic.ttf",
  sans: "DejaVuSans.ttf",
  "sans-bold": "DejaVuSans-Bold.ttf",
};

// The font files are found on disk at run time, by walking up from the working directory
// (the web app runs in apps/web, the worker in apps/worker, tests at the repo root). The
// package name is assembled at run time on purpose: a bundler that could see the path would
// try to bundle the .ttf files as modules.
const FONT_PACKAGE = ["dejavu", "fonts", "ttf"].join("-");
let cachedFontDir: string | null = null;

/** Folder holding the DejaVu .ttf files (env PDF_FONT_DIR overrides the lookup). */
export function pdfFontDir(): string {
  if (cachedFontDir) return cachedFontDir;
  const probe = FONT_FILES.sans;
  const candidates: string[] = [];
  if (process.env.PDF_FONT_DIR) candidates.push(process.env.PDF_FONT_DIR);
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    candidates.push(join(dir, "node_modules", FONT_PACKAGE, "ttf"));
    candidates.push(join(dir, "packages", "core", "node_modules", FONT_PACKAGE, "ttf"));
    const up = resolve(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  const found = candidates.find((c) => existsSync(join(c, probe)));
  if (!found) throw new Error("PDF fonts not found: install dejavu-fonts-ttf or set PDF_FONT_DIR");
  cachedFontDir = found;
  return found;
}

/** Absolute paths of the embedded fonts (TTF with full Romanian glyph coverage). */
export function pdfFonts(): Record<PdfFontName, string> {
  const dir = pdfFontDir();
  return Object.fromEntries(Object.entries(FONT_FILES).map(([name, file]) => [name, join(dir, file)])) as Record<PdfFontName, string>;
}

export const PDF_COLORS = { ink: "#17161b", ink2: "#4b4853", line: "#ddd7cb", gilt: "#a08342" } as const;
export const PDF_MARGIN = 56;

/**
 * A new A4 pdfkit document with the fonts registered under the names "serif", "serif-bold",
 * "serif-italic", "sans" and "sans-bold", plus `done()` resolving to the finished bytes.
 */
export async function newPdfDocument(info: { title: string; lang: Locale; createdAt: Date; subject?: string }): Promise<{
  doc: PDFKit.PDFDocument;
  done: () => Promise<Uint8Array>;
}> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({
    size: "A4",
    margin: PDF_MARGIN,
    lang: info.lang === "ro" ? "ro-RO" : "en-GB",
    bufferPages: true,
    info: { Title: info.title, Subject: info.subject ?? "", Creator: "EventDesk.ro", Producer: "EventDesk.ro", CreationDate: info.createdAt },
  });
  for (const [name, path] of Object.entries(pdfFonts())) doc.registerFont(name, path);
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

/* ── Rendering ───────────────────────────────────────────────────────────────────── */

/** Draws the briefing. Pure: everything it prints is in `b` (and the i18n messages). */
export async function renderBriefingPdf(b: OccasionBriefing): Promise<Uint8Array> {
  const t = (key: string, params?: Record<string, string | number>) => translate(b.locale, `briefing.pdf.${key}`, params);
  const { doc, done } = await newPdfDocument({ title: `${t("eyebrow")} — ${b.title}`, lang: b.locale, createdAt: b.generatedAt, subject: t("subject") });
  const width = doc.page.width - PDF_MARGIN * 2;
  const { ink, ink2, line, gilt } = PDF_COLORS;

  const rule = (color: string = line, gap = 10) => {
    const y = doc.y + gap / 2;
    doc.moveTo(PDF_MARGIN, y).lineTo(PDF_MARGIN + width, y).lineWidth(0.6).strokeColor(color).stroke();
    doc.y = y + gap / 2;
  };
  const room = (needed: number) => {
    if (doc.y + needed > doc.page.height - PDF_MARGIN - 24) doc.addPage();
  };
  const label = (text: string) => {
    doc.font("sans-bold").fontSize(7.5).fillColor(ink2).text(text.toUpperCase(), PDF_MARGIN, doc.y, { characterSpacing: 1.6, width });
  };
  const section = (title: string) => {
    room(70);
    doc.moveDown(1.4);
    doc.font("serif").fontSize(15).fillColor(ink).text(title, PDF_MARGIN, doc.y, { width });
    rule(ink, 8);
    doc.moveDown(0.2);
  };
  const body = (text: string, opts: { color?: string; indent?: number; font?: PdfFontName; size?: number } = {}) => {
    doc
      .font(opts.font ?? "sans")
      .fontSize(opts.size ?? 10)
      .fillColor(opts.color ?? ink)
      .text(text, PDF_MARGIN + (opts.indent ?? 0), doc.y, { width: width - (opts.indent ?? 0), lineGap: 2.5 });
  };
  const muted = (text: string, indent = 0) => body(text, { color: ink2, indent, font: "serif-italic" });
  const day = (d: Date) => formatWeekdayDate(d, b.locale, b.timezone);
  const time = (d: Date) => formatTime(d, b.locale, b.timezone);

  // masthead
  label(t("eyebrow"));
  doc.moveDown(0.5);
  doc.font("serif").fontSize(26).fillColor(ink).text(b.title, PDF_MARGIN, doc.y, { width, lineGap: 2 });
  rule(gilt, 14);
  let when = t("dateUndecided");
  if (b.startsAt) {
    const first = day(b.startsAt);
    const last = b.endsAt ? day(b.endsAt) : first;
    const clock = time(b.startsAt);
    when = last !== first ? `${first} – ${last}` : clock === "12:00" || clock === "00:00" ? first : `${first} · ${clock}`;
  }
  label(t("date"));
  body(when, { size: 11 });
  doc.moveDown(0.6);
  label(t("venue"));
  if (b.venueName || b.venueAddress) body([b.venueName, b.venueAddress].filter(Boolean).join(", "), { size: 11 });
  else muted(t("venueUnknown"));
  doc.moveDown(0.6);
  label(t("guests"));
  body(t("guestCounts", { total: b.guests.total, adults: b.guests.adults, children: b.guests.children }), { size: 11 });

  // programme of the day
  section(t("programme"));
  if (b.programme.length === 0) muted(t("programmeEmpty"));
  const severalDays = new Set(b.programme.map((p) => p.day)).size > 1;
  let lastDay = "";
  for (const p of b.programme) {
    room(22);
    if (severalDays && p.day !== lastDay) {
      doc.moveDown(0.4);
      label(`${p.day.slice(8, 10)}.${p.day.slice(5, 7)}.${p.day.slice(0, 4)}`);
      lastDay = p.day;
    }
    const y = doc.y;
    doc.font("serif").fontSize(11).fillColor(p.time ? ink : ink2).text(p.time ?? "—", PDF_MARGIN, y, { width: 48 });
    doc
      .font("sans")
      .fontSize(10)
      .fillColor(ink)
      .text(p.ownerName ? `${p.title}  ·  ${p.ownerName}` : p.title, PDF_MARGIN + 56, y + 1, { width: width - 56, lineGap: 2.5 });
    doc.moveDown(0.35);
  }

  // suppliers
  section(t("suppliers"));
  if (b.suppliers.length === 0) muted(t("suppliersEmpty"));
  b.suppliers.forEach((s, index) => {
    room(90);
    if (index > 0) rule(line, 12);
    doc.font("sans-bold").fontSize(11).fillColor(ink).text(s.name, PDF_MARGIN, doc.y, { width, continued: !!s.categoryLabel });
    if (s.categoryLabel) doc.font("sans").fillColor(ink2).text(`  ·  ${s.categoryLabel}`);
    const contact = [s.contactName, s.contactPhone, s.contactEmail].filter(Boolean).join("  ·  ");
    if (contact) body(contact);
    else muted(t("contactUnknown"));
    body(`${t("state")}: ${translate(b.locale, `suppliers.states.${s.state}`)}`, { color: ink2 });
    if (!s.briefing) {
      muted(t("briefingNone"));
      return;
    }
    doc.moveDown(0.4);
    label(t("briefingVersion", { version: s.briefing.version, date: formatDateTime(s.briefing.publishedAt, b.locale) }));
    doc.moveDown(0.2);
    for (const f of BRIEFING_FIELDS) {
      const value = s.briefing.content[f];
      if (!value) continue;
      room(36);
      body(translate(b.locale, `briefing.fields.${f}`), { font: "sans-bold", size: 9, color: ink2, indent: 12 });
      body(value, { indent: 12 });
      doc.moveDown(0.25);
    }
    if (s.briefing.ack) {
      body(t("acknowledged", { name: s.briefing.ack.name, date: formatDateTime(s.briefing.ack.at, b.locale) }), { color: ink2, indent: 12 });
    } else {
      muted(t("notAcknowledged"), 12);
    }
  });

  // deliveries
  section(t("deliveries"));
  if (b.deliveries.length === 0) muted(t("deliveriesEmpty"));
  b.deliveries.forEach((d, index) => {
    room(60);
    if (index > 0) doc.moveDown(0.6);
    doc.font("sans-bold").fontSize(10.5).fillColor(ink).text(d.title, PDF_MARGIN, doc.y, { width, continued: true });
    doc.font("sans").fillColor(ink2).text(`  ·  ${translate(b.locale, `deliveries.kinds.${d.kind}`)}${d.supplierName ? `  ·  ${d.supplierName}` : ""}`);
    const slot = d.expectedFrom
      ? `${day(d.expectedFrom)}, ${time(d.expectedFrom)}${d.expectedTo ? `–${time(d.expectedTo)}` : ""}`
      : t("slotUnknown");
    body([slot, d.place].filter(Boolean).join("  ·  "), { color: d.expectedFrom ? ink : ink2 });
    for (const i of d.items) body(`${i.expectedQty}${i.unit ? ` ${i.unit}` : ""}  ×  ${i.label}`, { indent: 12 });
  });

  // footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - PDF_MARGIN + 14;
    doc.page.margins.bottom = 0;
    doc
      .font("sans")
      .fontSize(7.5)
      .fillColor(ink2)
      .text(t("footer", { date: formatDateTime(b.generatedAt, b.locale), page: i - range.start + 1, pages: range.count }), PDF_MARGIN, y, {
        width,
        align: "center",
        lineBreak: false,
      });
    doc.page.margins.bottom = PDF_MARGIN;
  }
  return done();
}

function slug(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "ocazie"
  );
}

/** The briefing PDF of an occasion: file name and bytes. Planning members only. */
export async function buildOccasionBriefingPdf(ctx: Ctx, occasionId: string): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  const briefing = await collectOccasionBriefing(ctx, occasionId);
  return { filename: `${slug(briefing.title)}-briefing.pdf`, mime: "application/pdf", bytes: await renderBriefingPdf(briefing) };
}

registerExport({
  key: "briefing-pdf",
  titleKey: "briefing.pdf.exportTitle",
  descriptionKey: "briefing.pdf.exportDescription",
  run: async (ctx, occasionId) => {
    const file = await buildOccasionBriefingPdf(ctx, occasionId);
    // ExportFile.content is typed as text (CSV exports). The download route hands it to
    // `new Response(content)`, which sends a Uint8Array byte-for-byte — so the PDF travels as
    // bytes behind the string type. Widen ExportFile.content to `string | Uint8Array` when the
    // exports module is next touched.
    return { filename: file.filename, mime: file.mime, content: file.bytes as unknown as string };
  },
});
