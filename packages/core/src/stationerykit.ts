import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as fontkit from "fontkit";
import { pdfFonts } from "./briefingpdf";
import { qrPathData, type QrMatrix } from "./qr";
import { COLLECTION_PALETTES, EDITION_ART, KIND_MOTIFS, KIND_PALETTES, STITCH_CHARTS, STUDIO_PALETTES } from "./stationerycollections";
import { drawTemplate, occasionTemplates, TEMPLATE_PALETTES, type TemplateSpec } from "./stationerytemplates";

// THE STATIONERY KIT (C-04) — designs as data, one layout engine, two renderers.
//
//   STATIONERY_DESIGNS        eight original typographic house designs (no stock art, no imagery),
//                             plus the invitation collections (embroidery, signature, rustic,
//                             traditional and the twenty-composition library — see stationerycollections.ts)
//   STATIONERY_PIECES         invitation (A5, square), save-the-date, menu, table card, place card, thank-you
//   layoutPiece(input)        design + colourway + texts → a Scene (positioned text runs, paths)
//   sceneToSvg(scene)         the proof: text drawn as the font's own outlines
//   drawSceneOnPdf(doc, …)    the print: the same runs as live vector text with embedded fonts
//
// Proof = print: both renderers draw the SAME scene, measured with the SAME font files
// (fontkit — the engine pdfkit embeds with), so a line that fits on screen fits on paper.
// Text is fitted, never clipped: a text that is too wide is set smaller within bounds, a page
// that is too full is scaled down as a whole, and only past the hard floor is a text cut with
// an ellipsis.
//
// Fonts: the two Maison families as static TrueType — Bodoni Moda (display) and Hanken
// Grotesk (text), SIL OFL 1.1, from the npm packages `@expo-google-fonts/bodoni-moda` and
// `@expo-google-fonts/hanken-grotesk`. When they cannot be found the kit falls back to the
// DejaVu fonts of the PDF toolkit (stationeryFontFamily() says which is in use).
//
// Server-only (reads font files). Pages get SVG strings / scenes from here; nothing in this
// file touches the database.

/* ── Units ─────────────────────────────────────────────────────────────── */

export const MM = 72 / 25.4; // points per millimetre
export const mm = (v: number): number => v * MM;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/* ── Fonts ─────────────────────────────────────────────────────────────── */

export type FontKey = "display" | "display-italic" | "display-medium" | "text" | "text-light" | "text-medium";
export const FONT_KEYS: FontKey[] = ["display", "display-italic", "display-medium", "text", "text-light", "text-medium"];

// built at run time so no bundler tries to resolve the .ttf files as modules
const FONT_SCOPE = ["@expo", "google", "fonts"].join("-");
const MAISON_FILES: Record<FontKey, [pkg: string, dir: string, file: string]> = {
  display: ["bodoni-moda", "400Regular", "BodoniModa_400Regular.ttf"],
  "display-italic": ["bodoni-moda", "400Regular_Italic", "BodoniModa_400Regular_Italic.ttf"],
  "display-medium": ["bodoni-moda", "500Medium", "BodoniModa_500Medium.ttf"],
  text: ["hanken-grotesk", "400Regular", "HankenGrotesk_400Regular.ttf"],
  "text-light": ["hanken-grotesk", "300Light", "HankenGrotesk_300Light.ttf"],
  "text-medium": ["hanken-grotesk", "500Medium", "HankenGrotesk_500Medium.ttf"],
};

type FontSet = { family: "maison" | "fallback"; paths: Record<FontKey, string> };
let fontSet: FontSet | null = null;

function findFontSet(): FontSet {
  const roots: string[] = [];
  if (process.env.STATIONERY_FONT_DIR) roots.push(process.env.STATIONERY_FONT_DIR);
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    roots.push(join(dir, "node_modules", FONT_SCOPE));
    roots.push(join(dir, "packages", "core", "node_modules", FONT_SCOPE));
    const up = resolve(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  for (const root of roots) {
    const paths = Object.fromEntries(FONT_KEYS.map((k) => [k, join(root, ...MAISON_FILES[k])])) as Record<FontKey, string>;
    if (FONT_KEYS.every((k) => existsSync(paths[k]))) return { family: "maison", paths };
  }
  const dejavu = pdfFonts();
  return {
    family: "fallback",
    paths: {
      display: dejavu.serif,
      "display-italic": dejavu["serif-italic"],
      "display-medium": dejavu["serif-bold"],
      text: dejavu.sans,
      "text-light": dejavu.sans,
      "text-medium": dejavu["sans-bold"],
    },
  };
}

function fonts(): FontSet {
  return (fontSet ??= findFontSet());
}

/** "maison" = Bodoni Moda + Hanken Grotesk are embedded; "fallback" = DejaVu Serif / Sans. */
export function stationeryFontFamily(): "maison" | "fallback" {
  return fonts().family;
}

/** Absolute paths of the stationery fonts (for pdfkit's registerFont). */
export function stationeryFontPaths(): Record<FontKey, string> {
  return fonts().paths;
}

/** Name a stationery font is registered under on a pdfkit document. */
export const pdfFontName = (key: FontKey): string => `st-${key}`;

/** Registers the six stationery fonts on a pdfkit document (embedded, subset by pdfkit). */
export function registerStationeryFonts(doc: PDFKit.PDFDocument): void {
  for (const k of FONT_KEYS) doc.registerFont(pdfFontName(k), fonts().paths[k]);
}

const opened = new Map<FontKey, fontkit.Font>();
function font(key: FontKey): fontkit.Font {
  let f = opened.get(key);
  if (!f) {
    f = fontkit.openSync(fonts().paths[key]) as fontkit.Font;
    opened.set(key, f);
  }
  return f;
}

type Shaped = { advance: number; glyphs: Array<{ id: number; x: number }>; count: number };
const shapeCache = new Map<string, Shaped>();

/** Shapes `text` at 1 unit per em: glyph ids with their pen positions, and the total advance. */
function shape(key: FontKey, text: string): Shaped {
  const ck = `${key}\u0000${text}`;
  const hit = shapeCache.get(ck);
  if (hit) return hit;
  const f = font(key);
  const run = f.layout(text);
  const upm = f.unitsPerEm;
  let pen = 0;
  const glyphs: Shaped["glyphs"] = [];
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i]!;
    glyphs.push({ id: g.id, x: (pen + p.xOffset) / upm });
    pen += p.xAdvance;
  });
  const out = { advance: pen / upm, glyphs, count: glyphs.length };
  if (shapeCache.size > 4000) shapeCache.clear();
  shapeCache.set(ck, out);
  return out;
}

/** Width of one line in points; `tracking` is extra space after each glyph, in points. */
export function measureText(key: FontKey, text: string, size: number, tracking = 0): number {
  const s = shape(key, text);
  return s.advance * size + tracking * Math.max(0, s.count - 1);
}

function fontMetrics(key: FontKey): { ascent: number; descent: number; capHeight: number; xHeight: number } {
  const f = font(key);
  const u = f.unitsPerEm;
  return { ascent: f.ascent / u, descent: -f.descent / u, capHeight: (f.capHeight || f.ascent * 0.7) / u, xHeight: (f.xHeight || f.ascent * 0.5) / u };
}

const glyphCache = new Map<string, Array<{ c: string; a: number[] }>>();
function glyphCommands(key: FontKey, id: number): Array<{ c: string; a: number[] }> {
  const ck = `${key}:${id}`;
  let cmds = glyphCache.get(ck);
  if (!cmds) {
    const f = font(key);
    const g = f.getGlyph(id);
    cmds = (g.path.commands as Array<{ command: string; args: number[] }>).map((c) => ({ c: c.command, a: c.args.map((v) => v / f.unitsPerEm) }));
    glyphCache.set(ck, cmds);
  }
  return cmds;
}

const SVG_OP: Record<string, string> = { moveTo: "M", lineTo: "L", quadraticCurveTo: "Q", bezierCurveTo: "C", closePath: "Z" };

/** One text run as outline path data, baseline at (x, y). */
function runPathData(key: FontKey, text: string, size: number, tracking: number, x: number, y: number): string {
  const s = shape(key, text);
  let d = "";
  s.glyphs.forEach((g, i) => {
    const gx = x + g.x * size + tracking * i;
    for (const cmd of glyphCommands(key, g.id)) {
      d += SVG_OP[cmd.c] ?? "";
      for (let k = 0; k < cmd.a.length; k += 2) d += `${r2(gx + cmd.a[k]! * size)} ${r2(y - cmd.a[k + 1]! * size)} `;
    }
  });
  return d.trimEnd();
}

/* ── Colourways ────────────────────────────────────────────────────────── */

export type ColourRole = "ink" | "accent" | "muted" | "paper";
export type Colourway = {
  key: string;
  /** Stock colour. Printed as a flood only when `flood` is true (a tinted or dark sheet). */
  paper: string;
  ink: string;
  accent: string;
  muted: string;
  /** true = the paper colour is printed edge to edge (needs the bleed); false = print on ivory stock. */
  flood: boolean;
  dark?: boolean;
  /** Second colour of a textile design (embroidery thread). */
  thread?: string;
};

// Ivoire, gilt, ink and bleu nuit are the Maison tokens; the rest are the curated paper/ink pairs.
export const COLOURWAYS: Record<string, Colourway> = {
  ivoire: { key: "ivoire", paper: "#fffdf8", ink: "#17161b", accent: "#a08342", muted: "#4b4853", flood: false },
  nuit: { key: "nuit", paper: "#fffdf8", ink: "#1c2452", accent: "#a08342", muted: "#4a5078", flood: false },
  sauge: { key: "sauge", paper: "#f2f1e6", ink: "#2c3829", accent: "#75855c", muted: "#55604f", flood: true },
  rose: { key: "rose", paper: "#f8eee8", ink: "#472a2c", accent: "#b07f70", muted: "#765a58", flood: true },
  ciel: { key: "ciel", paper: "#eff3f6", ink: "#22324a", accent: "#7f97b2", muted: "#55667c", flood: true },
  terracotta: { key: "terracotta", paper: "#fbf2e8", ink: "#2a2321", accent: "#bb5c3b", muted: "#6a5850", flood: true },
  minuit: { key: "minuit", paper: "#161c3f", ink: "#f5f2ec", accent: "#c9ab70", muted: "#c3c2cf", flood: true, dark: true },
  noir: { key: "noir", paper: "#17161b", ink: "#ece8df", accent: "#c9ab70", muted: "#bcb8af", flood: true, dark: true },
  // the collection palettes (paper, ink, accent, muted, thread) — see stationerycollections.ts
  ...Object.fromEntries(Object.entries(COLLECTION_PALETTES).map(([key, p]) => [key, { key, ...p }])),
};

/** Colourway key of an occasion-template palette. */
export const templateColourwayKey = (palette: string) => `tp-${palette}`;

/** The house colourways (the curated paper/ink pairs of the eight house designs). */
export const HOUSE_COLOURWAYS = ["ivoire", "nuit", "sauge", "rose", "ciel", "terracotta", "minuit", "noir"] as const;

/* ── Pieces ────────────────────────────────────────────────────────────── */

export const STATIONERY_PIECES = ["invitation", "invitation-square", "save-the-date", "menu", "table-card", "place-card", "thank-you"] as const;
export type PieceKind = (typeof STATIONERY_PIECES)[number];

export type PieceSpec = {
  kind: PieceKind;
  /** Trim size in millimetres. */
  widthMm: number;
  heightMm: number;
  /** Safe margin (text never comes closer to the trim), mm: [horizontal, vertical]. */
  marginMm: [number, number];
  /** Type scale against the A5 invitation. */
  scale: number;
};

export const PIECES: Record<PieceKind, PieceSpec> = {
  invitation: { kind: "invitation", widthMm: 148, heightMm: 210, marginMm: [19, 22], scale: 1 },
  "invitation-square": { kind: "invitation-square", widthMm: 148, heightMm: 148, marginMm: [19, 18], scale: 0.84 },
  "save-the-date": { kind: "save-the-date", widthMm: 148, heightMm: 105, marginMm: [16, 15], scale: 0.86 },
  menu: { kind: "menu", widthMm: 99, heightMm: 210, marginMm: [13, 18], scale: 0.86 },
  "table-card": { kind: "table-card", widthMm: 105, heightMm: 148, marginMm: [13, 15], scale: 0.9 },
  "place-card": { kind: "place-card", widthMm: 90, heightMm: 55, marginMm: [8, 8], scale: 0.62 },
  "thank-you": { kind: "thank-you", widthMm: 148, heightMm: 105, marginMm: [18, 15], scale: 0.86 },
};

/* ── Ornaments (authored here; stroke or fill, unit = the ornament's own box) ───────────── */

export type OrnamentPath = { d: string; paint: "stroke" | "fill"; role: ColourRole; /** stroke width in points at final size */ sw?: number };
export type Ornament = { w: number; h: number; paths: OrnamentPath[] };

const f1 = (n: number) => Math.round(n * 10) / 10;

/** An almond leaf from base (bx, by), `len` long, pointing at `angle` (radians, 0 = right), with a midrib. */
function leaf(bx: number, by: number, len: number, angle: number, width: number, lean = 0.08): string {
  const tx = bx + Math.cos(angle) * len;
  const ty = by + Math.sin(angle) * len;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  // the belly sits a little before the middle, and one side is fuller than the other: a drawn leaf, not a lens
  const mx = bx + Math.cos(angle) * len * 0.44;
  const my = by + Math.sin(angle) * len * 0.44;
  const a = width * (1 + lean);
  const b = width * (1 - lean);
  return (
    `M${f1(bx)} ${f1(by)}Q${f1(mx + nx * a)} ${f1(my + ny * a)} ${f1(tx)} ${f1(ty)}` +
    `Q${f1(mx - nx * b)} ${f1(my - ny * b)} ${f1(bx)} ${f1(by)}` +
    `M${f1(bx)} ${f1(by)}L${f1(bx + Math.cos(angle) * len * 0.72)} ${f1(by + Math.sin(angle) * len * 0.72)}`
  );
}

/** Point and tangent angle on a cubic Bézier. */
function cubicAt(p: number[], t: number): { x: number; y: number; a: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p as [number, number, number, number, number, number, number, number];
  const u = 1 - t;
  const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
  const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
  const dx = 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2);
  const dy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
  return { x, y, a: Math.atan2(dy, dx) };
}

/** A single sprig: one curved stem, leaves alternating, smaller towards the tip. */
function sprigOrnament(): Ornament {
  const stem = [52, 156, 44, 112, 62, 64, 50, 10];
  let d = `M${stem[0]} ${stem[1]}C${stem[2]} ${stem[3]} ${stem[4]} ${stem[5]} ${stem[6]} ${stem[7]}`;
  const steps = [0.16, 0.27, 0.38, 0.49, 0.6, 0.7, 0.79, 0.87];
  steps.forEach((t, i) => {
    const p = cubicAt(stem, t);
    const side = i % 2 === 0 ? -1 : 1;
    const len = 34 - i * 2.6;
    d += leaf(p.x, p.y, len, p.a + side * (0.86 - i * 0.03), len * 0.3, side * 0.1);
  });
  const tip = cubicAt(stem, 1);
  d += leaf(tip.x, tip.y, 13, tip.a, 3.6, 0);
  return { w: 104, h: 164, paths: [{ d, paint: "stroke", role: "accent", sw: 0.55 }] };
}

/** Two sprays curving up from a tie into an open wreath (soft; used by "Botez"). */
function wreathOrnament(): Ornament {
  const R = 46;
  const cx = 60;
  const cy = 58;
  let d = "";
  for (const side of [-1, 1]) {
    const pts: Array<{ x: number; y: number; a: number }> = [];
    for (let i = 0; i <= 26; i += 1) {
      const ang = Math.PI / 2 + side * (0.1 + (i / 26) * 2.32); // from the bottom, up one side
      pts.push({ x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R, a: ang + (side * Math.PI) / 2 });
    }
    d += pts.map((p, i) => `${i === 0 ? "M" : "L"}${f1(p.x)} ${f1(p.y)}`).join("");
    for (let i = 3; i <= 25; i += 3) {
      const p = pts[i]!;
      const size = 12.5 - (i / 26) * 5;
      d += leaf(p.x, p.y, size, p.a - side * 0.72, size * 0.3);
      d += leaf(p.x, p.y, size * 0.86, p.a + side * 0.82, size * 0.27);
    }
  }
  return { w: 120, h: 112, paths: [{ d, paint: "stroke", role: "accent", sw: 0.5 }] };
}

/** A short leafed twig lying flat — the Botanical design's rule. */
function twigOrnament(): Ornament {
  let d = "M4 12C30 9 62 15 116 11";
  const stem = [4, 12, 30, 9, 62, 15, 116, 11];
  [0.18, 0.34, 0.5, 0.66, 0.82].forEach((t, i) => {
    const p = cubicAt(stem, t);
    const side = i % 2 === 0 ? -1 : 1;
    d += leaf(p.x, p.y, 13 - i * 0.8, p.a + side * 0.7, 3.4, side * 0.1);
  });
  return { w: 120, h: 24, paths: [{ d, paint: "stroke", role: "accent", sw: 0.5 }] };
}

function star(cx: number, cy: number, r: number): string {
  const k = r * 0.16;
  return `M${f1(cx)} ${f1(cy - r)}Q${f1(cx + k)} ${f1(cy - k)} ${f1(cx + r)} ${f1(cy)}Q${f1(cx + k)} ${f1(cy + k)} ${f1(cx)} ${f1(cy + r)}Q${f1(cx - k)} ${f1(cy + k)} ${f1(cx - r)} ${f1(cy)}Q${f1(cx - k)} ${f1(cy - k)} ${f1(cx)} ${f1(cy - r)}Z`;
}

export const ORNAMENTS = {
  /** hairline – lozenge – hairline (the plate's own mark) */
  diamond: { w: 96, h: 12, paths: [{ d: "M0 6H38M58 6H96M48 1.2L52.8 6L48 10.8L43.2 6Z", paint: "stroke", role: "accent", sw: 0.5 }] },
  /** a plain short hairline */
  hair: { w: 40, h: 2, paths: [{ d: "M0 1H40", paint: "stroke", role: "accent", sw: 0.5 }] },
  /** a heavier short rule, for the left-aligned designs */
  bar: { w: 28, h: 2, paths: [{ d: "M0 1H28", paint: "stroke", role: "ink", sw: 1.1 }] },
  sprig: sprigOrnament(),
  twig: twigOrnament(),
  wreath: wreathOrnament(),
  /** three small stars, the middle one larger */
  stars: { w: 72, h: 20, paths: [{ d: star(36, 10, 9) + star(10, 10, 4.2) + star(62, 10, 4.2), paint: "fill", role: "accent" }] },
  /** three dots */
  dots: { w: 34, h: 4, paths: [{ d: "M3 2m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M17 2m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M31 2m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0", paint: "fill", role: "accent" }] },
} satisfies Record<string, Ornament>;
export type OrnamentKey = keyof typeof ORNAMENTS;

/** Scattered marks for "Petrecere" and "Nocturne": positions as fractions of the sheet. */
type Scatter = Array<{ x: number; y: number; kind: "dot" | "dash" | "arc" | "ring" | "star"; size: number; rot?: number; role: ColourRole }>;

const CONFETTI: Scatter = [
  { x: 0.08, y: 0.06, kind: "dot", size: 2.4, role: "accent" },
  { x: 0.16, y: 0.11, kind: "dash", size: 9, rot: 32, role: "ink" },
  { x: 0.25, y: 0.055, kind: "ring", size: 3.4, role: "accent" },
  { x: 0.11, y: 0.17, kind: "arc", size: 8, rot: -20, role: "accent" },
  { x: 0.33, y: 0.1, kind: "dot", size: 1.6, role: "ink" },
  { x: 0.2, y: 0.2, kind: "dot", size: 1.8, role: "accent" },
  { x: 0.06, y: 0.25, kind: "dash", size: 7, rot: -48, role: "accent" },
  { x: 0.92, y: 0.94, kind: "dot", size: 2.4, role: "accent" },
  { x: 0.84, y: 0.89, kind: "dash", size: 9, rot: 32, role: "ink" },
  { x: 0.75, y: 0.945, kind: "ring", size: 3.4, role: "accent" },
  { x: 0.89, y: 0.83, kind: "arc", size: 8, rot: 160, role: "accent" },
  { x: 0.67, y: 0.9, kind: "dot", size: 1.6, role: "ink" },
  { x: 0.8, y: 0.8, kind: "dot", size: 1.8, role: "accent" },
  { x: 0.94, y: 0.75, kind: "dash", size: 7, rot: -48, role: "accent" },
];

const STARFIELD: Scatter = [
  { x: 0.14, y: 0.085, kind: "star", size: 3.2, role: "accent" },
  { x: 0.27, y: 0.05, kind: "star", size: 1.7, role: "accent" },
  { x: 0.42, y: 0.075, kind: "dot", size: 0.7, role: "accent" },
  { x: 0.58, y: 0.045, kind: "star", size: 2.2, role: "accent" },
  { x: 0.73, y: 0.08, kind: "dot", size: 0.7, role: "accent" },
  { x: 0.86, y: 0.06, kind: "star", size: 2.8, role: "accent" },
  { x: 0.08, y: 0.16, kind: "dot", size: 0.7, role: "accent" },
  { x: 0.92, y: 0.15, kind: "dot", size: 0.8, role: "accent" },
  { x: 0.2, y: 0.93, kind: "star", size: 2, role: "accent" },
  { x: 0.5, y: 0.955, kind: "dot", size: 0.7, role: "accent" },
  { x: 0.8, y: 0.925, kind: "star", size: 2.4, role: "accent" },
];

/* ── Designs ───────────────────────────────────────────────────────────── */

export type TextRole =
  | "kicker"
  | "names"
  | "amp"
  | "wording"
  | "date"
  | "time"
  | "venue"
  | "address"
  | "rsvp"
  | "title"
  | "numeral"
  | "course"
  | "dish"
  | "placeName"
  | "note"
  | "signature"
  | "monogram";

export type TextStyle = {
  font: FontKey;
  /** Point size on the A5 invitation. */
  size: number;
  /** Letter-spacing in em. */
  tracking?: number;
  caps?: boolean;
  /** Line height as a multiple of the size. */
  leading?: number;
  color?: ColourRole;
  /** Widest line, as a fraction of the text column. */
  measure?: number;
  /** More lines than this → the text is set smaller. */
  maxLines?: number;
};

export type FrameKind = "none" | "plate" | "hairline" | "arch" | "rule-left";

/** Which family a design belongs to: the house designs, or one of the invitation collections. */
/** "occasion" = the templates made for one occasion kind (stationerytemplates.ts). */
export const DESIGN_RANGES = ["occasion", "house", "embroidery", "featured", "rustic", "traditional", "collection"] as const;
export type DesignRange = (typeof DESIGN_RANGES)[number];

export type HouseDesignKey = "classic" | "modern" | "monogram" | "botanical" | "minimal" | "nocturne" | "botez" | "petrecere";
/** A house design key or a collection design key (validated against DESIGN_KEYS). */
export type DesignKey = HouseDesignKey | (string & {});

export type Design = {
  key: DesignKey;
  range: DesignRange;
  align: "center" | "left" | "right";
  /** Where the stack sits when it has room to spare (default: the optical centre). */
  valign?: "top" | "bottom";
  frame: FrameKind;
  /** Drawn artwork behind the text (collections): a key of COLLECTION_ART. */
  art?: string;
  /** Room the text keeps from each edge, as fractions of the sheet [left, right, top, bottom] (collections). */
  textBox?: [number, number, number, number];
  /** Print the palette the other way round: ink becomes the sheet, paper the lettering. */
  invert?: boolean;
  /** The colourways come from the occasion kind's palette set (+ studio palettes); `openOn` = which one first. */
  kindColourways?: { openOn: number };
  /** The opening mark sits under the text instead of above it. */
  crestAt?: "top" | "foot";
  /** An occasion template: drawn by stationerytemplates.ts, offered only to occasions of `forKind`. */
  template?: TemplateSpec;
  forKind?: string;
  scatter?: "confetti" | "stars";
  /** How the names are set: one above the other with the conjunction between, or on running lines. */
  names: "stacked" | "inline";
  /** The mark between blocks. */
  rule: OrnamentKey;
  /** A larger opening mark above the text (invitation, menu, thank-you). */
  crest?: { ornament: OrnamentKey; widthMm: number } | { monogram: true; diameterMm: number } | { motif: "plain" | "ring" | "shield"; widthMm: number };
  /** Big date numerals (12 · 09 · 2026) instead of the written date, when the date can be read. */
  numeralDate?: boolean;
  styles: Record<TextRole, TextStyle>;
  colourways: string[];
};

const caps = (font: FontKey, size: number, tracking = 0.22, color: ColourRole = "ink"): TextStyle => ({ font, size, tracking, caps: true, leading: 1.5, color });

const BASE: Record<TextRole, TextStyle> = {
  kicker: caps("text-medium", 7.2, 0.26, "muted"),
  names: { font: "display", size: 38, tracking: -0.012, leading: 1.08, maxLines: 3 },
  amp: { font: "display-italic", size: 20, leading: 1.25, color: "accent" },
  wording: { font: "display-italic", size: 12, leading: 1.55, measure: 0.82, color: "ink" },
  date: { font: "display", size: 16.5, leading: 1.3, maxLines: 2 },
  time: { font: "display-italic", size: 12, leading: 1.35, color: "muted" },
  venue: caps("text-medium", 7.8, 0.22),
  address: { font: "text", size: 8.4, leading: 1.5, color: "muted", measure: 0.8 },
  rsvp: { font: "display-italic", size: 10.2, leading: 1.45, color: "muted", measure: 0.8 },
  title: { font: "display", size: 30, tracking: -0.01, leading: 1.1, maxLines: 2 },
  numeral: { font: "display", size: 92, tracking: -0.02, leading: 1, maxLines: 1 },
  course: caps("text-medium", 7, 0.24, "accent"),
  dish: { font: "display-italic", size: 11.2, leading: 1.5 },
  placeName: { font: "display", size: 26, leading: 1.1, maxLines: 2, tracking: -0.005 },
  note: caps("text-medium", 9.2, 0.2, "muted"),
  signature: { font: "display-italic", size: 13, leading: 1.3 },
  monogram: { font: "display", size: 21, leading: 1 },
};

const withStyles = (over: Partial<Record<TextRole, Partial<TextStyle>>>): Record<TextRole, TextStyle> => {
  const out = { ...BASE };
  for (const [k, v] of Object.entries(over)) out[k as TextRole] = { ...BASE[k as TextRole], ...v };
  return out;
};

const HOUSE_DESIGNS: Record<HouseDesignKey, Design> = {
  // Centred Bodoni inside a gilt plate-mark: the house style.
  classic: {
    key: "classic",
    range: "house",
    align: "center",
    frame: "plate",
    names: "stacked",
    rule: "diamond",
    styles: withStyles({}),
    colourways: ["ivoire", "nuit", "minuit"],
  },
  // Left-aligned, the date as large numerals, grotesque for everything that informs.
  modern: {
    key: "modern",
    range: "house",
    align: "left",
    frame: "rule-left",
    names: "inline",
    rule: "bar",
    numeralDate: true,
    styles: withStyles({
      kicker: { color: "accent", size: 7 },
      names: { size: 27, tracking: -0.015, leading: 1.1 },
      wording: { font: "text", size: 9.4, leading: 1.6, measure: 0.86, color: "muted" },
      date: { font: "text-medium", size: 7.8, tracking: 0.22, caps: true, leading: 1.5 },
      time: { font: "text", size: 9.4, color: "muted" },
      venue: { font: "display-italic", size: 14, tracking: 0, caps: false, leading: 1.25 },
      address: { size: 8.6 },
      rsvp: { font: "text", size: 8.4, leading: 1.5 },
      title: { size: 34, tracking: -0.02 },
      numeral: { size: 104 },
      dish: { font: "text", size: 9.6, leading: 1.55 },
      course: { color: "ink" },
      placeName: { size: 22 },
      signature: { font: "display", size: 14 },
    }),
    colourways: ["ivoire", "nuit", "terracotta"],
  },
  // Initials in a ring; the names themselves in spaced capitals.
  monogram: {
    key: "monogram",
    range: "house",
    align: "center",
    frame: "none",
    names: "inline",
    rule: "hair",
    crest: { monogram: true, diameterMm: 27 },
    styles: withStyles({
      names: { font: "text-medium", size: 10.6, tracking: 0.3, caps: true, leading: 1.7, maxLines: 3 },
      wording: { size: 11 },
      date: { size: 14.5 },
      title: { font: "text-medium", size: 10.6, tracking: 0.3, caps: true, leading: 1.7 },
      placeName: { size: 23 },
      signature: { font: "text-medium", size: 7.6, tracking: 0.26, caps: true },
    }),
    colourways: ["ivoire", "nuit", "sauge"],
  },
  // One drawn sprig; italic names; light grotesque.
  botanical: {
    key: "botanical",
    range: "house",
    align: "center",
    frame: "none",
    names: "stacked",
    rule: "twig",
    crest: { ornament: "sprig", widthMm: 23 },
    styles: withStyles({
      kicker: { size: 6.9 },
      names: { font: "display-italic", size: 31, tracking: 0, leading: 1.1 },
      amp: { font: "display-italic", size: 16 },
      wording: { font: "text-light", size: 9.4, leading: 1.62, color: "ink" },
      date: { font: "text-medium", size: 8, tracking: 0.22, caps: true, leading: 1.5 },
      time: { font: "text-light", size: 9.2, color: "muted" },
      rsvp: { font: "text-light", size: 8.4 },
      title: { font: "display-italic", size: 30, tracking: 0 },
      dish: { font: "text-light", size: 9.6, leading: 1.55 },
      placeName: { font: "display-italic", size: 25 },
    }),
    colourways: ["sauge", "ivoire", "rose"],
  },
  // Almost nothing: small type, a hairline, a great deal of paper.
  minimal: {
    key: "minimal",
    range: "house",
    align: "center",
    frame: "none",
    names: "inline",
    rule: "hair",
    styles: withStyles({
      kicker: { size: 6.6, tracking: 0.3 },
      names: { size: 24, leading: 1.14 },
      wording: { font: "text-light", size: 8.8, leading: 1.65, measure: 0.66, color: "muted" },
      date: { font: "text-medium", size: 7.4, tracking: 0.26, caps: true, leading: 1.6 },
      time: { font: "text-light", size: 8.6, color: "muted" },
      venue: { size: 7.2, tracking: 0.26 },
      address: { font: "text-light", size: 8 },
      rsvp: { font: "text-light", size: 8 },
      title: { size: 23 },
      numeral: { size: 74 },
      dish: { font: "text-light", size: 9.2, leading: 1.6 },
      placeName: { size: 21 },
      signature: { font: "text-light", size: 9 },
    }),
    colourways: ["ivoire", "nuit", "noir"],
  },
  // The classic set at night: ivory and gilt on a deep sheet, a few stars.
  nocturne: {
    key: "nocturne",
    range: "house",
    align: "center",
    frame: "hairline",
    scatter: "stars",
    names: "stacked",
    rule: "stars",
    styles: withStyles({
      kicker: { color: "accent" },
      names: { size: 33 },
      wording: { size: 11.2 },
      venue: { color: "accent" },
    }),
    colourways: ["minuit", "noir"],
  },
  // Soft, for a christening: an arched frame, an open wreath, italics.
  botez: {
    key: "botez",
    range: "house",
    align: "center",
    frame: "arch",
    names: "inline",
    rule: "dots",
    crest: { ornament: "wreath", widthMm: 30 },
    styles: withStyles({
      names: { font: "display-italic", size: 33, tracking: 0, leading: 1.1 },
      wording: { size: 11 },
      date: { size: 14.5 },
      title: { font: "display-italic", size: 29, tracking: 0 },
      placeName: { font: "display-italic", size: 25 },
    }),
    colourways: ["ciel", "rose", "ivoire"],
  },
  // A party: a little confetti in two corners, a heavier Bodoni, the date in italics.
  petrecere: {
    key: "petrecere",
    range: "house",
    align: "center",
    frame: "none",
    scatter: "confetti",
    names: "inline",
    rule: "dots",
    styles: withStyles({
      kicker: { color: "accent", size: 7.4 },
      names: { font: "display-medium", size: 36, tracking: -0.02, leading: 1.04 },
      wording: { font: "text", size: 9.8, leading: 1.6, color: "muted" },
      date: { font: "display-italic", size: 19 },
      time: { font: "text-medium", size: 7.8, tracking: 0.22, caps: true, color: "ink" },
      title: { font: "display-medium", size: 32, tracking: -0.02 },
      numeral: { font: "display-medium", size: 96 },
      dish: { font: "text", size: 9.8, leading: 1.55 },
      placeName: { font: "display-medium", size: 25 },
    }),
    colourways: ["terracotta", "nuit", "ivoire"],
  },
};

/* ── Collection designs (the invitation collections) ───────────────────── */

/** An own entry of a data table, or undefined — never an inherited property ("constructor", "__proto__"). */
function own<T>(table: Record<string, T>, key: string | null | undefined): T | undefined {
  return key && Object.hasOwn(table, key) ? table[key] : undefined;
}
/** The occasion kind's motif (the general one for an unknown kind). */
function motifFor(kind: string | null | undefined): string {
  return own(KIND_MOTIFS, kind) ?? KIND_MOTIFS.blank!;
}

/** Mixes two #rrggbb colours: `t` of `b` into `a`. */
export function mixColour(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const v = [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255) as [number, number, number];
  return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The same palette printed the other way round (ink sheet, paper lettering). */
function invertColourway(cw: Colourway): Colourway {
  const paper = cw.ink;
  const ink = cw.paper;
  let muted = mixColour(cw.paper, cw.ink, 0.2);
  if (contrastRatio(muted, paper) < 4.6) muted = ink;
  const dark = luminance(paper) < 0.18;
  return { ...cw, paper, ink, muted, accent: mixColour(cw.paper, cw.ink, 0.28), flood: true, dark };
}

/** How a collection design sets its names (the PR's lettering, in the two stationery families). */
type Voice = "roman" | "italic" | "caps" | "sans";

const VOICES: Record<Voice, Partial<Record<TextRole, Partial<TextStyle>>>> = {
  roman: { names: { size: 34 }, title: { size: 28 } },
  italic: { names: { font: "display-italic", size: 33, tracking: 0, leading: 1.1 }, title: { font: "display-italic", size: 29, tracking: 0 }, placeName: { font: "display-italic" } },
  caps: { names: { font: "text-medium", size: 15, tracking: 0.2, caps: true, leading: 1.5, maxLines: 3 }, title: { font: "text-medium", size: 14, tracking: 0.2, caps: true, leading: 1.5 }, placeName: { font: "text-medium", size: 15, tracking: 0.14, caps: true } },
  sans: { names: { font: "text-medium", size: 28, tracking: -0.01, leading: 1.08 }, title: { font: "text-medium", size: 24, tracking: -0.01 }, wording: { font: "text", size: 9.6, leading: 1.6 }, placeName: { font: "text-medium", size: 22 } },
};

// Accent is decoration on a collection palette; text stays in ink and muted so it always reads.
const COLLECTION_TEXT: Partial<Record<TextRole, Partial<TextStyle>>> = { amp: { color: "muted" }, course: { color: "ink" } };

type CollectionSpec = {
  range: Exclude<DesignRange, "house">;
  voice: Voice;
  align?: "center" | "left" | "right";
  valign?: "top" | "bottom";
  /** [left, right, top, bottom] fractions of the sheet the text keeps clear. */
  box?: [number, number, number, number];
  motif?: "plain" | "ring" | "shield" | "none";
  crestAt?: "top" | "foot";
  invert?: boolean;
  colourways: string[] | { openOn: number };
};

const W10 = { openOn: 0 };
// One entry per collection design. The artwork itself is drawn by COLLECTION_ART (same key).
const COLLECTION_SPECS: Record<string, CollectionSpec> = {
  // the twenty base compositions — any of the occasion kind's palettes or the studio palettes
  frame: { range: "collection", voice: "roman", box: [0.12, 0.12, 0.1, 0.1], colourways: W10 },
  arch: { range: "collection", voice: "italic", box: [0.13, 0.13, 0.2, 0.08], colourways: W10 },
  seal: { range: "collection", voice: "roman", motif: "ring", box: [0.1, 0.1, 0.08, 0.12], colourways: W10 },
  ribbon: { range: "collection", voice: "roman", align: "left", box: [0.12, 0.3, 0.09, 0.09], colourways: W10 },
  band: { range: "collection", voice: "sans", box: [0.1, 0.1, 0.16, 0.08], colourways: W10 },
  ticket: { range: "collection", voice: "caps", box: [0.1, 0.1, 0.1, 0.1], colourways: W10 },
  postcard: { range: "collection", voice: "roman", align: "left", valign: "bottom", motif: "none", box: [0.1, 0.1, 0.24, 0.08], colourways: W10 },
  split: { range: "collection", voice: "roman", align: "left", motif: "none", box: [0.37, 0.08, 0.08, 0.08], colourways: W10 },
  crest: { range: "collection", voice: "caps", box: [0.1, 0.1, 0.26, 0.08], colourways: W10 },
  border: { range: "collection", voice: "roman", crestAt: "foot", box: [0.1, 0.1, 0.09, 0.12], colourways: W10 },
  triptych: { range: "collection", voice: "roman", box: [0.17, 0.17, 0.08, 0.08], colourways: W10 },
  medallion: { range: "collection", voice: "roman", motif: "ring", box: [0.12, 0.12, 0.1, 0.1], colourways: W10 },
  rays: { range: "collection", voice: "roman", box: [0.1, 0.1, 0.08, 0.1], colourways: W10 },
  diagonal: { range: "collection", voice: "roman", align: "left", box: [0.1, 0.24, 0.08, 0.08], colourways: W10 },
  plaque: { range: "collection", voice: "roman", crestAt: "foot", box: [0.14, 0.14, 0.11, 0.11], colourways: W10 },
  column: { range: "collection", voice: "roman", align: "right", box: [0.22, 0.09, 0.08, 0.08], colourways: W10 },
  scallop: { range: "collection", voice: "italic", box: [0.1, 0.1, 0.11, 0.08], colourways: W10 },
  imprint: { range: "collection", voice: "roman", valign: "bottom", motif: "none", box: [0.1, 0.1, 0.12, 0.08], colourways: W10 },
  ruling: { range: "collection", voice: "sans", box: [0.1, 0.1, 0.14, 0.14], colourways: W10 },
  duotone: { range: "collection", voice: "roman", align: "left", motif: "none", box: [0.1, 0.1, 0.38, 0.08], colourways: W10 },
  // signature editions — open on one of the kind's palettes
  "letterpress-edition": { range: "featured", voice: "roman", box: [0.13, 0.13, 0.1, 0.1], colourways: { openOn: 0 } },
  "botanical-edition": { range: "featured", voice: "italic", box: [0.24, 0.24, 0.08, 0.08], colourways: { openOn: 2 } },
  "deco-edition": { range: "featured", voice: "caps", invert: true, box: [0.14, 0.14, 0.12, 0.12], colourways: { openOn: 1 } },
  "modernist-edition": { range: "featured", voice: "sans", align: "left", box: [0.27, 0.08, 0.08, 0.08], colourways: { openOn: 3 } },
  "folded-edition": { range: "featured", voice: "roman", motif: "ring", box: [0.12, 0.12, 0.31, 0.08], colourways: { openOn: 4 } },
  "engraved-edition": { range: "featured", voice: "caps", box: [0.14, 0.14, 0.1, 0.1], colourways: { openOn: 2 } },
  // rustic and traditional regional editions — each in its own palette
  "wildflower-edition": { range: "rustic", voice: "italic", valign: "top", box: [0.14, 0.14, 0.09, 0.34], colourways: ["harvest-linen"] },
  "woodcut-edition": { range: "rustic", voice: "caps", align: "left", valign: "bottom", box: [0.11, 0.11, 0.24, 0.07], colourways: ["orchard-bark"] },
  "woven-edition": { range: "rustic", voice: "roman", align: "left", box: [0.31, 0.08, 0.08, 0.08], colourways: ["oat-cloth"] },
  "maramures-gate": { range: "rustic", voice: "roman", box: [0.17, 0.17, 0.23, 0.08], colourways: ["maramures-oak"] },
  "bucovina-wax": { range: "rustic", voice: "italic", box: [0.1, 0.1, 0.2, 0.12], colourways: ["bucovina-wax"] },
  "horezu-clay": { range: "rustic", voice: "italic", align: "left", box: [0.11, 0.11, 0.2, 0.13], colourways: ["horezu-clay"] },
  "saxon-chest": { range: "rustic", voice: "roman", align: "left", box: [0.32, 0.08, 0.08, 0.08], colourways: ["saxon-chest"] },
  "muscel-altita": { range: "rustic", voice: "italic", box: [0.1, 0.1, 0.24, 0.15], colourways: ["muscel-thread"] },
  "maramures-ciupag": { range: "rustic", voice: "roman", align: "left", box: [0.13, 0.12, 0.22, 0.13], colourways: ["ciupag-thread"] },
  "moldova-sirlau": { range: "rustic", voice: "roman", align: "left", box: [0.33, 0.08, 0.08, 0.08], colourways: ["moldova-wool"] },
  "dobrogea-stergar": { range: "rustic", voice: "italic", box: [0.12, 0.12, 0.2, 0.17], colourways: ["dobrogea-cotton"] },
  "damask-edition": { range: "traditional", voice: "caps", box: [0.13, 0.13, 0.12, 0.12], colourways: ["antique-ivory"] },
  "heraldic-edition": { range: "traditional", voice: "caps", motif: "shield", box: [0.16, 0.16, 0.12, 0.12], colourways: ["heritage-blue"] },
  "embroidered-edition": { range: "traditional", voice: "italic", box: [0.1, 0.1, 0.15, 0.15], colourways: ["heirloom-red"] },
  "maramures-rosette": { range: "traditional", voice: "caps", box: [0.12, 0.12, 0.2, 0.2], colourways: ["maramures-ink"] },
  "bucovina-lozenge": { range: "traditional", voice: "caps", box: [0.14, 0.14, 0.1, 0.1], colourways: ["bucovina-red"] },
  "horezu-medallion": { range: "traditional", voice: "roman", box: [0.2, 0.2, 0.14, 0.14], colourways: ["horezu-glaze"] },
  "saxon-floral": { range: "traditional", voice: "italic", box: [0.12, 0.12, 0.2, 0.2], colourways: ["saxon-blue"] },
  "muscel-rauri": { range: "traditional", voice: "caps", box: [0.2, 0.2, 0.1, 0.1], colourways: ["muscel-thread"] },
  "sibiu-fodori": { range: "traditional", voice: "caps", box: [0.2, 0.2, 0.16, 0.16], colourways: ["sibiu-cloth"] },
  "oltenia-scoarta": { range: "traditional", voice: "italic", box: [0.12, 0.12, 0.24, 0.16], colourways: ["dolj-wool"] },
  "moldova-romburi": { range: "traditional", voice: "caps", box: [0.14, 0.14, 0.14, 0.14], colourways: ["moldova-diamond"] },
};

// Romanian embroidery and weaving: the chart is the decoration (no motif), on linen.
const EMBROIDERY_PAPER: Record<string, string> = {
  "comanesti-diamond": "linen-comanesti-diamond",
  "rasinari-woven": "linen-rasinari-woven",
  "dolj-woven": "linen-dolj-woven",
  "muscel-altita-grid": "linen-muscel-altita-grid",
};
const EMBROIDERY_VOICE: Record<string, Voice> = { "muscel-altita-grid": "caps", "comanesti-sprig": "italic", "dolj-woven": "italic" };

function collectionDesigns(): Record<string, Design> {
  const out: Record<string, Design> = {};
  const make = (key: string, spec: CollectionSpec): Design => {
    const motif = spec.motif ?? "plain";
    return {
      key,
      range: spec.range,
      align: spec.align ?? "center",
      valign: spec.valign,
      frame: "none",
      art: key,
      textBox: spec.box,
      invert: spec.invert,
      crestAt: spec.crestAt,
      kindColourways: Array.isArray(spec.colourways) ? undefined : spec.colourways,
      names: spec.voice === "caps" ? "inline" : "stacked",
      rule: spec.voice === "sans" || spec.voice === "caps" ? "hair" : "diamond",
      crest: motif === "none" ? undefined : { motif, widthMm: spec.range === "collection" ? 17 : 14 },
      styles: withStyles({ ...merge(VOICES[spec.voice], COLLECTION_TEXT) }),
      colourways: Array.isArray(spec.colourways) ? spec.colourways : [...STUDIO_PALETTES],
    };
  };
  for (const [key, spec] of Object.entries(COLLECTION_SPECS)) out[key] = make(key, spec);
  for (const key of Object.keys(STITCH_CHARTS)) {
    const placement = STITCH_CHARTS[key]!.placement;
    out[key] = make(key, {
      range: "embroidery",
      voice: EMBROIDERY_VOICE[key] ?? "roman",
      motif: "none",
      align: key === "rasinari-woven" ? "left" : "center",
      box: placement === "sidebar" ? [0.36, 0.1, 0.1, 0.1] : [0.11, 0.11, placement === "bottom" ? 0.1 : 0.22, placement === "top" ? 0.1 : 0.22],
      colourways: [EMBROIDERY_PAPER[key] ?? "stitched-linen"],
    });
  }
  return out;
}

function merge(a: Partial<Record<TextRole, Partial<TextStyle>>>, b: Partial<Record<TextRole, Partial<TextStyle>>>) {
  const out: Partial<Record<TextRole, Partial<TextStyle>>> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k as TextRole] = { ...out[k as TextRole], ...v };
  return out;
}

/** A readable colourway from a template palette: ink pushed to AA+ on the paper, a muted that still reads. */
function templateColourway(key: string): Colourway {
  const p = TEMPLATE_PALETTES[key]!;
  const toward = (fg: string, bg: string, target: number) => {
    const end = luminance(bg) > 0.18 ? "#000000" : "#ffffff";
    let c = fg;
    for (let t = 0.04; contrastRatio(c, bg) < target && t <= 1; t += 0.04) c = mixColour(fg, end, t);
    return c;
  };
  const ink = toward(p.ink, p.paper, 7);
  let muted = ink;
  for (let t = 0.4; t >= 0; t -= 0.02) {
    const m = mixColour(ink, p.paper, t);
    if (contrastRatio(m, p.paper) >= 4.6) {
      muted = m;
      break;
    }
  }
  const dark = luminance(p.paper) < 0.18;
  const accent = dark ? toward(p.a1, p.paper, 4.5) : p.a1;
  return { key: templateColourwayKey(key), paper: p.paper, ink, accent, muted, flood: luminance(p.paper) < 0.94, dark, thread: p.a2 };
}
for (const key of Object.keys(TEMPLATE_PALETTES)) COLOURWAYS[templateColourwayKey(key)] = templateColourway(key);

const TEMPLATE_VOICES: Record<TemplateSpec["layout"]["voice"], Partial<Record<TextRole, Partial<TextStyle>>>> = {
  roman: { names: { size: 34 }, title: { size: 28 } },
  italic: { names: { font: "display-italic", size: 33, tracking: 0, leading: 1.1 }, title: { font: "display-italic", size: 29, tracking: 0 }, placeName: { font: "display-italic" } },
  caps: { names: { font: "text-medium", size: 15, tracking: 0.2, caps: true, leading: 1.5, maxLines: 3 }, title: { font: "text-medium", size: 14, tracking: 0.2, caps: true, leading: 1.5 }, placeName: { font: "text-medium", size: 15, tracking: 0.14, caps: true } },
  sans: { names: { font: "text-medium", size: 28, tracking: -0.01, leading: 1.08 }, title: { font: "text-medium", size: 24, tracking: -0.01 }, wording: { font: "text", size: 9.6, leading: 1.6 }, placeName: { font: "text-medium", size: 22 } },
};

/** The 52 templates of every occasion kind, as designs (offered only to that kind). */
function occasionTemplateDesigns(): Record<string, Design> {
  const out: Record<string, Design> = {};
  for (const kind of Object.keys(KIND_PALETTES)) {
    for (const spec of occasionTemplates(kind)) {
      const v = spec.layout.voice;
      out[spec.key] = {
        key: spec.key,
        range: "occasion",
        forKind: kind,
        template: spec,
        align: spec.layout.align,
        frame: "none",
        names: v === "caps" ? "inline" : "stacked",
        rule: v === "sans" || v === "caps" ? "hair" : "diamond",
        styles: withStyles({ ...TEMPLATE_VOICES[v], amp: { color: "muted" }, course: { color: "ink" }, kicker: { color: "muted" } }),
        colourways: spec.palettes.map(templateColourwayKey),
      };
    }
  }
  return out;
}

/** Whether a design may be used by an occasion of this kind (templates belong to one kind). */
export function designAvailableFor(design: Design, occasionKind: string | null | undefined): boolean {
  return !design.forKind || design.forKind === occasionKind;
}

export const STATIONERY_DESIGNS: Record<string, Design> = { ...HOUSE_DESIGNS, ...collectionDesigns(), ...occasionTemplateDesigns() };

export const DESIGN_KEYS = Object.keys(STATIONERY_DESIGNS) as DesignKey[];
export const HOUSE_DESIGN_KEYS = Object.keys(HOUSE_DESIGNS) as HouseDesignKey[];

export function getDesign(key: string): Design {
  const d = Object.hasOwn(STATIONERY_DESIGNS, key) ? STATIONERY_DESIGNS[key] : undefined;
  if (!d) throw new Error(`Unknown stationery design "${key}"`);
  return d;
}

/** The colourways a design offers for an occasion kind, in order (kind palettes first, then the studio palettes). */
export function colourwaysFor(design: Design, occasionKind?: string | null): string[] {
  if (!design.kindColourways) return design.colourways;
  const kind = own(KIND_PALETTES, occasionKind) ?? KIND_PALETTES.blank!;
  const first = kind[design.kindColourways.openOn % kind.length]!;
  return [...new Set([first, ...kind, ...STUDIO_PALETTES])];
}

/** The colourway of a design; an unknown or foreign key falls back to the design's first. */
export function getColourway(design: Design, key: string | null | undefined): Colourway {
  const allowed = key && (design.colourways.includes(key) || (design.kindColourways && Object.hasOwn(COLLECTION_PALETTES, key)));
  const cw = COLOURWAYS[allowed ? key : design.colourways[0]!]!;
  return design.invert ? invertColourway(cw) : cw;
}

/* ── Texts ─────────────────────────────────────────────────────────────── */

export type KitTexts = {
  kicker: string;
  names: string;
  wording: string;
  date: string;
  time: string;
  venue: string;
  address: string;
  rsvp: string;
  saveTheDate: string;
  menuTitle: string;
  menuBody: string;
  thanks: string;
};

export type PieceExtra = {
  /** Table card: "4" or "Masa mirilor". */
  tableLabel?: string;
  /** Table card: the word above a table NUMBER ("Masa"). */
  tableWord?: string;
  /** Place card: the guest's name, and the small line under it ("Masa 4", "+2 copii"). */
  placeName?: string;
  placeNote?: string;
  /** A QR code to draw (invitation, table card) with its caption. */
  qr?: { matrix: QrMatrix; caption?: string } | null;
};

const MONTHS_RO = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Reads "sâmbătă, 12 septembrie 2026", "12 September 2026" or "12.09.2026" → day, month, year; null when it cannot. */
export function parseDateText(text: string): { day: number; month: number; year: number | null } | null {
  const t = fold(text);
  const numeric = /\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?\b/.exec(t);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { day, month, year: numeric[3] ? Number(numeric[3]) : null };
  }
  const all = [...MONTHS_RO.map((m, i) => [fold(m), i + 1] as const), ...MONTHS_EN.map((m, i) => [m, i + 1] as const)];
  for (const [name, month] of all) {
    const at = t.search(new RegExp(`\\b${name}\\b`));
    if (at < 0) continue;
    const before = /(\d{1,2})(?:st|nd|rd|th)?\s*(?:de\s+)?$/.exec(t.slice(0, at));
    const after = /^\s*(\d{1,2})(?:st|nd|rd|th)?\b/.exec(t.slice(at + name.length));
    const day = before ? Number(before[1]) : after ? Number(after[1]) : NaN;
    if (!(day >= 1 && day <= 31)) continue;
    const year = /\b(\d{4})\b/.exec(t);
    return { day, month, year: year ? Number(year[1]) : null };
  }
  return null;
}

/** "Ana & Mihai" / "Ana și Mihai" / "Ana and Mihai" → the two names and the word between them. */
export function splitNames(names: string): { first: string; joiner: string; second: string } | null {
  const m = /^(.+?)\s+(&|și|şi|si|and)\s+(.+)$/iu.exec(names.replace(/\s*\n\s*/g, " ").trim());
  if (!m) return null;
  // two NAMES: each side starts with a capital ("Nunta Ioanei și a lui Ștefan" is a title, not a pair)
  if (!/^\p{Lu}/u.test(m[1]!.trim()) || !/^\p{Lu}/u.test(m[3]!.trim())) return null;
  return { first: m[1]!.trim(), joiner: m[2] === "&" ? "&" : m[2]!.toLowerCase().replace("si", "și").replace("şi", "și"), second: m[3]!.trim() };
}

/** Initials for the ring: "A", "M" from two names, else the first letters of the first two words. */
export function monogramInitials(names: string): string[] {
  const initial = (s: string) => {
    const ch = [...s.trim()][0];
    return ch ? ch.toLocaleUpperCase("ro") : "";
  };
  const pair = splitNames(names);
  if (pair) return [initial(pair.first), initial(pair.second)].filter(Boolean);
  const words = names.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.slice(0, 2).map(initial).filter(Boolean);
}

/* ── Scene ─────────────────────────────────────────────────────────────── */

export type SceneNode =
  | { t: "text"; font: FontKey; size: number; x: number; y: number; text: string; tracking: number; color: string; width: number }
  | { t: "path"; d: string; tx: number; ty: number; s: number; paint: "stroke" | "fill"; color: string; sw: number; /** template artwork: its bounds, and whether it is a text plate */ box?: [number, number, number, number]; plate?: boolean; frame?: boolean }
  | { t: "qr"; x: number; y: number; size: number; matrix: QrMatrix };

export type Scene = {
  piece: PieceKind;
  design: DesignKey;
  /** Trim size in points. */
  width: number;
  height: number;
  colourway: Colourway;
  nodes: SceneNode[];
  /** Scale the fitter had to apply to the whole page (1 = as designed). */
  fit: number;
  /** true when a text had to be cut with an ellipsis (it does not happen within the field limits). */
  truncated: boolean;
};

type Block =
  | { k: "lines"; role: TextRole; style: TextStyle; lines: string[]; size: number; gap: number }
  | { k: "ornament"; ornament: Ornament; width: number; gap: number; colorOverride?: ColourRole }
  | { k: "monogram"; diameter: number; initials: string[]; gap: number }
  | { k: "numerals"; parts: string[]; size: number; gap: number }
  | { k: "qr"; size: number; caption: string | null; gap: number; matrix: QrMatrix }
  | { k: "flex"; weight: number };

type Item =
  | { i: "text"; role: TextRole; value: string; gap: number }
  | { i: "names"; gap: number }
  | { i: "rule"; gap: number; width?: number }
  | { i: "crest"; gap: number }
  | { i: "numerals"; gap: number }
  | { i: "menu"; gap: number }
  | { i: "qr"; gap: number; sizeMm: number }
  | { i: "flex"; weight?: number };

/** What each piece says, in order. Gaps are points before the item on the A5 invitation. */
function compose(design: Design, piece: PieceKind, t: KitTexts, extra: PieceExtra): Item[] {
  const left = design.align === "left";
  const crestTop = !!design.crest && design.crestAt !== "foot";
  const crestFoot = !!design.crest && design.crestAt === "foot";
  const numerals = !!design.numeralDate && !!parseDateText(t.date);
  const dateItems: Item[] = [
    { i: "text", role: "date", value: t.date, gap: 28 },
    { i: "text", role: "time", value: t.time, gap: 7 },
  ];
  switch (piece) {
    case "invitation":
    case "invitation-square": {
      const square = piece === "invitation-square";
      if (left) {
        return [
          ...(crestTop && !square ? [{ i: "crest", gap: 0 } as Item] : []),
          { i: "text", role: "kicker", value: t.kicker, gap: crestTop && !square ? 20 : 0 },
          ...(numerals ? [{ i: "numerals", gap: 22 } as Item] : []),
          { i: "names", gap: numerals ? 26 : 20 },
          { i: "rule", gap: 20 },
          { i: "text", role: "wording", value: t.wording, gap: 20 },
          { i: "flex" },
          { i: "text", role: "date", value: t.date, gap: 24 },
          { i: "text", role: "time", value: t.time, gap: 6 },
          { i: "text", role: "venue", value: t.venue, gap: 20 },
          { i: "text", role: "address", value: t.address, gap: 6 },
          { i: "text", role: "rsvp", value: t.rsvp, gap: 22 },
          ...(crestFoot && !square ? [{ i: "crest", gap: 22 } as Item] : []),
          ...(extra.qr ? [{ i: "qr", gap: 14, sizeMm: 17 } as Item] : []),
        ];
      }
      return [
        ...(crestTop && !square ? [{ i: "crest", gap: 0 } as Item] : []),
        { i: "text", role: "kicker", value: t.kicker, gap: crestTop && !square ? 24 : 0 },
        { i: "names", gap: 24 },
        { i: "rule", gap: 24 },
        { i: "text", role: "wording", value: t.wording, gap: 24 },
        ...dateItems,
        { i: "text", role: "venue", value: t.venue, gap: 26 },
        { i: "text", role: "address", value: t.address, gap: 7 },
        { i: "text", role: "rsvp", value: t.rsvp, gap: 32 },
        ...(crestFoot && !square ? [{ i: "crest", gap: 26 } as Item] : []),
        ...(extra.qr ? [{ i: "qr", gap: 14, sizeMm: 17 } as Item] : []),
      ];
    }
    case "save-the-date":
      return [
        { i: "text", role: "kicker", value: t.saveTheDate, gap: 0 },
        { i: "names", gap: 14 },
        { i: "rule", gap: 14 },
        ...(numerals ? [{ i: "numerals", gap: 16 } as Item] : [{ i: "text", role: "date", value: t.date, gap: 18 } as Item]),
        { i: "text", role: "venue", value: t.venue, gap: 16 },
      ];
    case "menu":
      return [
        ...(crestTop && !left ? [{ i: "crest", gap: 0 } as Item] : []),
        { i: "text", role: "title", value: t.menuTitle, gap: crestTop && !left ? 14 : 0 },
        { i: "rule", gap: 16 },
        { i: "flex" },
        { i: "menu", gap: 18 },
        { i: "flex", weight: 1.3 },
        { i: "text", role: "signature", value: t.names.replace(/\s*\n\s*/g, " "), gap: 20 },
        { i: "text", role: "note", value: t.date, gap: 6 },
      ];
    case "table-card": {
      const label = (extra.tableLabel ?? "").trim();
      const numeric = /^\d{1,3}$/.test(label);
      return [
        { i: "text", role: "kicker", value: numeric ? (extra.tableWord ?? "") : "", gap: 0 },
        { i: "text", role: numeric ? "numeral" : "title", value: label, gap: numeric ? 14 : 0 },
        { i: "rule", gap: numeric ? 16 : 16 },
        { i: "text", role: "signature", value: t.names.replace(/\s*\n\s*/g, " "), gap: 14 },
        ...(extra.qr ? [{ i: "flex" } as Item, { i: "qr", gap: 14, sizeMm: 24 } as Item] : []),
      ];
    }
    case "place-card":
      return [
        { i: "text", role: "placeName", value: extra.placeName ?? "", gap: 0 },
        { i: "rule", gap: 11 },
        { i: "text", role: "note", value: extra.placeNote ?? "", gap: 10 },
      ];
    case "thank-you":
      return [
        { i: "text", role: "title", value: t.thanks.split("\n")[0] ?? "", gap: 0 },
        { i: "rule", gap: 14 },
        { i: "text", role: "wording", value: t.thanks.split("\n").slice(1).join("\n"), gap: 14 },
        { i: "text", role: "signature", value: t.names.replace(/\s*\n\s*/g, " "), gap: 16 },
      ];
  }
}

/** Greedy wrap of one paragraph to `maxWidth`; a word longer than the line stays whole (the caller shrinks). */
function wrapParagraph(key: FontKey, text: string, size: number, tracking: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = words[0]!;
  for (const w of words.slice(1)) {
    const next = `${line} ${w}`;
    if (measureText(key, next, size, tracking) <= maxWidth) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  lines.push(line);
  return lines;
}

/** Wraps, then narrows the column as far as the line count allows: even lines instead of a widow. */
function wrapBalanced(key: FontKey, text: string, size: number, tracking: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const first = wrapParagraph(key, para.trim(), size, tracking, maxWidth);
    if (first.length <= 1) {
      out.push(...first);
      continue;
    }
    let best = first;
    for (let w = maxWidth * 0.96; w > maxWidth * 0.5; w -= maxWidth * 0.04) {
      const attempt = wrapParagraph(key, para.trim(), size, tracking, w);
      if (attempt.length > first.length) break;
      best = attempt;
    }
    out.push(...best);
  }
  return out;
}

const widest = (key: FontKey, lines: string[], size: number, tracking: number) => lines.reduce((m, l) => Math.max(m, measureText(key, l, size, tracking)), 0);

/** Sets one text in its style: wrapped to the measure, smaller when it must be. Never wider than `column`. */
function fitText(style: TextStyle, raw: string, column: number, scale: number): { lines: string[]; size: number } {
  const value = style.caps ? raw.toLocaleUpperCase("ro") : raw;
  const maxWidth = column * (style.measure ?? 1);
  let size = style.size * scale;
  const floor = Math.max(4.2, size * 0.4);
  for (;;) {
    const tracking = (style.tracking ?? 0) * size;
    const lines = wrapBalanced(style.font, value, size, tracking, maxWidth);
    const tooWide = widest(style.font, lines, size, tracking) > maxWidth + 0.01;
    const tooMany = style.maxLines !== undefined && lines.length > Math.max(style.maxLines, value.split("\n").length);
    if ((!tooWide && !tooMany) || size <= floor) {
      if (tooWide) {
        // past the floor: cut the offending lines (unreachable within the field limits)
        return { lines: lines.map((l) => ellipsize(style.font, l, size, tracking, maxWidth)), size };
      }
      return { lines, size };
    }
    size *= 0.95;
  }
}

function ellipsize(key: FontKey, line: string, size: number, tracking: number, maxWidth: number): string {
  if (measureText(key, line, size, tracking) <= maxWidth) return line;
  let s = line;
  while (s.length > 1 && measureText(key, `${s}…`, size, tracking) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Room kept under the last baseline of a text block, in em: enough for a descender to clear the next block. */
const DESCENT_ROOM = 0.2;

function blockHeight(b: Block): number {
  switch (b.k) {
    case "lines": {
      const lead = (b.style.leading ?? 1.3) * b.size;
      const m = fontMetrics(b.style.font);
      // first line: cap height (or x-height for lowercase-led italics is close enough); last line: no descender room
      return b.lines.length === 0 ? 0 : m.capHeight * b.size + (b.lines.length - 1) * lead + DESCENT_ROOM * b.size;
    }
    case "ornament":
      return (b.ornament.h / b.ornament.w) * b.width;
    case "monogram":
      return b.diameter;
    case "numerals":
      return fontMetrics("display").capHeight * b.size;
    case "qr":
      return b.size + (b.caption ? 12 : 0);
    case "flex":
      return 0;
  }
}

export type LayoutInput = {
  design: DesignKey | string;
  colourway?: string | null;
  piece: PieceKind;
  texts: KitTexts;
  extra?: PieceExtra;
  /** The occasion's kind: picks the collection designs' motif (none needed for the house designs). */
  occasionKind?: string | null;
};

/** THE layout: design + colourway + texts → positioned runs and paths on the trim sheet. */
export function layoutPiece(input: LayoutInput): Scene {
  let design = getDesign(input.design);
  const cw = getColourway(design, input.colourway);
  const spec = PIECES[input.piece];
  const extra = input.extra ?? {};
  const W = mm(spec.widthMm);
  const H = mm(spec.heightMm);
  const colour = (role: ColourRole | undefined): string => cw[role ?? "ink"];
  const nodes: SceneNode[] = [];

  /* frame + scatter (they define the safe box) */
  let mx = mm(spec.marginMm[0]);
  let top = mm(spec.marginMm[1]);
  let bottom = mm(spec.marginMm[1]);
  const inset = mm(Math.min(7, spec.widthMm * 0.05));
  const stroke = (d: string, color: string, sw: number) => nodes.push({ t: "path", d, tx: 0, ty: 0, s: 1, paint: "stroke", color, sw });
  const rect = (i: number) => `M${r2(i)} ${r2(i)}H${r2(W - i)}V${r2(H - i)}H${r2(i)}Z`;
  if (design.frame === "plate") {
    stroke(rect(inset), cw.accent, 0.6);
    stroke(rect(inset + mm(1.1)), cw.accent, 0.25);
  } else if (design.frame === "hairline") {
    stroke(rect(inset), cw.accent, 0.45);
  } else if (design.frame === "arch") {
    const rx = (W - inset * 2) / 2;
    const ry = Math.min(rx, H * 0.27);
    stroke(`M${r2(inset)} ${r2(H - inset)}V${r2(inset + ry)}A${r2(rx)} ${r2(ry)} 0 0 1 ${r2(W - inset)} ${r2(inset + ry)}V${r2(H - inset)}Z`, cw.accent, 0.5);
    top += ry * (spec.heightMm > spec.widthMm ? 0.2 : 0.16);
    bottom += mm(1.5);
  } else if (design.frame === "rule-left") {
    const x = mm(spec.marginMm[0]) - mm(Math.min(6, spec.marginMm[0] * 0.36));
    stroke(`M${r2(x)} ${r2(top)}V${r2(H - bottom)}`, cw.accent, 0.5);
  }
  if (design.scatter) {
    const marks = design.scatter === "confetti" ? CONFETTI : STARFIELD;
    const k = Math.min(W, H) / mm(148); // marks keep their size against the short side
    for (const m of marks) {
      const x = m.x * W;
      const y = m.y * H;
      const s = m.size * Math.max(0.62, k);
      const c = colour(m.role);
      const rot = ((m.rot ?? 0) * Math.PI) / 180;
      if (m.kind === "dot") nodes.push({ t: "path", d: circle(x, y, s), tx: 0, ty: 0, s: 1, paint: "fill", color: c, sw: 0 });
      else if (m.kind === "ring") stroke(circle(x, y, s), c, 0.7);
      else if (m.kind === "star") nodes.push({ t: "path", d: star(x, y, s), tx: 0, ty: 0, s: 1, paint: "fill", color: c, sw: 0 });
      else if (m.kind === "dash") stroke(`M${r2(x - (Math.cos(rot) * s) / 2)} ${r2(y - (Math.sin(rot) * s) / 2)}L${r2(x + (Math.cos(rot) * s) / 2)} ${r2(y + (Math.sin(rot) * s) / 2)}`, c, 1);
      else {
        const x1 = x - (Math.cos(rot) * s) / 2;
        const y1 = y - (Math.sin(rot) * s) / 2;
        const x2 = x + (Math.cos(rot) * s) / 2;
        const y2 = y + (Math.sin(rot) * s) / 2;
        stroke(`M${r2(x1)} ${r2(y1)}Q${r2(x + Math.sin(rot) * s * 0.5)} ${r2(y - Math.cos(rot) * s * 0.5)} ${r2(x2)} ${r2(y2)}`, c, 0.9);
      }
    }
    if (design.scatter === "confetti") {
      top += H * 0.05;
      bottom += H * 0.05;
    } else {
      top += H * 0.045;
      bottom += H * 0.03;
    }
  }
  if (design.frame === "plate" || design.frame === "hairline") {
    mx = Math.max(mx, inset + mm(8));
    top = Math.max(top, inset + mm(Math.min(13, spec.heightMm * 0.085)));
    bottom = Math.max(bottom, inset + mm(Math.min(13, spec.heightMm * 0.085)));
  }
  let ml = mx;
  let mr = mx;
  if (design.art) drawCollectionArt(design, W, H, cw, input.occasionKind ?? undefined, nodes);
  if (design.template) {
    // an occasion template: its artwork, then the text box (and alignment) the style asks for
    const motif = motifFor(design.forKind);
    const art = drawTemplate(design.template, cw.key.replace(/^tp-/, ""), W, H, motif);
    for (const n of art.nodes) nodes.push({ t: "path", d: n.d, tx: 0, ty: 0, s: 1, paint: n.paint, color: n.color, sw: n.sw, ...(n.plate ? { plate: true } : {}), ...(n.frame ? { frame: true } : {}), box: n.box });
    design = { ...design, textBox: art.result.box, align: art.result.align ?? design.align, valign: art.result.valign };
  }
  if (design.textBox) {
    // the collections keep their text clear of the artwork; small pieces keep at least the safe margin
    const [l, r, tp, b] = design.textBox;
    const short = Math.min(W, H) / mm(148);
    ml = Math.max(mm(spec.marginMm[0]) * 0.7, W * l * Math.max(0.75, short));
    mr = Math.max(mm(spec.marginMm[0]) * 0.7, W * r * Math.max(0.75, short));
    top = Math.max(mm(spec.marginMm[1]) * 0.7, H * tp);
    bottom = Math.max(mm(spec.marginMm[1]) * 0.7, H * b);
  }
  const column = W - ml - mr;
  const boxH = H - top - bottom;
  const items = compose(design, input.piece, input.texts, extra);

  /* build blocks at a page scale; shrink the page until the stack fits */
  let truncated = false;
  const build = (s: number): Block[] => {
    const sc = spec.scale * s;
    const blocks: Block[] = [];
    const g = (gap: number) => gap * sc;
    const pushText = (role: TextRole, value: string, gap: number, styleOver?: Partial<TextStyle>) => {
      if (!value.trim()) return;
      const style = { ...design.styles[role], ...styleOver };
      const fitted = fitText(style, value.trim(), column, sc);
      blocks.push({ k: "lines", role, style, lines: fitted.lines, size: fitted.size, gap: g(gap) });
    };
    for (const it of items) {
      if (it.i === "flex") blocks.push({ k: "flex", weight: it.weight ?? 1 });
      else if (it.i === "text") pushText(it.role, it.value, it.gap);
      else if (it.i === "names") {
        const pair = design.names === "stacked" ? splitNames(input.texts.names) : null;
        if (pair) {
          pushText("names", pair.first, it.gap);
          pushText("amp", pair.joiner, 9);
          pushText("names", pair.second, 11);
        } else pushText("names", input.texts.names, it.gap);
      } else if (it.i === "rule") {
        const o = ORNAMENTS[design.rule];
        blocks.push({ k: "ornament", ornament: o, width: (it.width ?? o.w) * Math.min(1, sc + 0.1), gap: g(it.gap) });
      } else if (it.i === "crest" && design.crest) {
        if ("monogram" in design.crest) {
          const initials = monogramInitials(input.texts.names);
          if (initials.length) blocks.push({ k: "monogram", diameter: mm(design.crest.diameterMm) * sc, initials, gap: g(it.gap) });
        } else if ("motif" in design.crest) {
          const o = motifOrnament(input.occasionKind ?? undefined, design.crest.motif);
          blocks.push({ k: "ornament", ornament: o, width: mm(design.crest.widthMm) * sc * (o.w / 80), gap: g(it.gap) });
        } else blocks.push({ k: "ornament", ornament: ORNAMENTS[design.crest.ornament], width: mm(design.crest.widthMm) * sc, gap: g(it.gap) });
      } else if (it.i === "numerals") {
        const p = parseDateText(input.texts.date);
        if (p) {
          const two = (n: number) => String(n).padStart(2, "0");
          const parts = [two(p.day), two(p.month), ...(p.year ? [String(p.year)] : [])];
          let size = 58 * sc;
          const width = () => measureText("display", parts.join(""), size, -0.02 * size) + (parts.length - 1) * size * 0.5;
          while (width() > column && size > 12) size *= 0.95;
          blocks.push({ k: "numerals", parts, size, gap: g(it.gap) });
        }
      } else if (it.i === "menu") {
        const groups = input.texts.menuBody
          .split(/\n\s*\n/)
          .map((grp) => grp.split("\n").map((l) => l.trim()).filter(Boolean))
          .filter((grp) => grp.length > 0);
        groups.forEach((grp, gi) => {
          // a group of one line is a dish on its own; otherwise the first line names the course
          const [head, ...dishes] = grp.length > 1 ? grp : ["", ...grp];
          if (head) pushText("course", head, gi === 0 ? it.gap : 18);
          dishes.forEach((dish, di) => pushText("dish", dish, di === 0 ? (head ? 7 : gi === 0 ? it.gap : 14) : 5));
        });
      } else if (it.i === "qr" && extra.qr) {
        blocks.push({ k: "qr", size: mm(it.sizeMm) * Math.max(0.9, Math.min(1, s + 0.2)), caption: extra.qr.caption?.trim() || null, gap: g(it.gap), matrix: extra.qr.matrix });
      }
    }
    // the first drawn block never carries a gap; a flex swallows the gap that follows it only if it has room
    const firstReal = blocks.findIndex((b) => b.k !== "flex");
    if (firstReal >= 0) (blocks[firstReal] as Exclude<Block, { k: "flex" }>).gap = 0;
    return blocks;
  };
  const stackHeight = (blocks: Block[]) => blocks.reduce((sum, b) => sum + blockHeight(b) + (b.k === "flex" ? 0 : b.gap), 0);

  let s = 1;
  let blocks = build(s);
  while (stackHeight(blocks) > boxH && s > 0.42) {
    s *= 0.95;
    blocks = build(s);
  }
  while (stackHeight(blocks) > boxH) {
    // hard floor: cut the longest text, a line at a time
    const longest = blocks.filter((b): b is Extract<Block, { k: "lines" }> => b.k === "lines" && b.lines.length > 1).sort((a, b) => b.lines.length - a.lines.length)[0];
    if (!longest) break;
    longest.lines = longest.lines.slice(0, -1);
    longest.lines[longest.lines.length - 1] = `${longest.lines[longest.lines.length - 1]!.replace(/[\s.,;:]+$/, "")}…`;
    truncated = true;
  }

  /* place: flexes take the free space by weight; with none, the stack sits at the optical centre */
  const free = Math.max(0, boxH - stackHeight(blocks));
  const flexTotal = blocks.reduce((n, b) => n + (b.k === "flex" ? b.weight : 0), 0);
  const rest = design.valign === "top" ? 0 : design.valign === "bottom" ? 1 : design.align === "left" ? 0.4 : 0.46;
  let y = top + (flexTotal > 0 ? 0 : free * rest);
  const xLeft = ml;
  const xRight = W - mr;
  const xMid = ml + column / 2;
  /** Left edge of a run `width` wide, by the design's alignment. */
  const xAt = (width: number) => (design.align === "left" ? xLeft : design.align === "right" ? xRight - width : xMid - width / 2);
  for (const b of blocks) {
    if (b.k === "flex") {
      y += (free * b.weight) / flexTotal;
      continue;
    }
    y += b.gap;
    const h = blockHeight(b);
    if (b.k === "lines") {
      const m = fontMetrics(b.style.font);
      const lead = (b.style.leading ?? 1.3) * b.size;
      const tracking = (b.style.tracking ?? 0) * b.size;
      b.lines.forEach((line, i) => {
        const width = measureText(b.style.font, line, b.size, tracking);
        const baseline = y + m.capHeight * b.size + i * lead;
        // tracked lines carry their spacing after the last letter: centre the letters, not the spacing
        const x = xAt(width);
        nodes.push({ t: "text", font: b.style.font, size: r2(b.size), x: r2(x), y: r2(baseline), text: line, tracking: r2(tracking), color: colour(b.style.color), width: r2(width) });
      });
    } else if (b.k === "ornament") {
      const scale = b.width / b.ornament.w;
      const x = xAt(b.width);
      for (const p of b.ornament.paths) {
        nodes.push({ t: "path", d: p.d, tx: r2(x), ty: r2(y), s: scale, paint: p.paint, color: colour(b.colorOverride ?? p.role), sw: p.sw ?? 0 });
      }
    } else if (b.k === "monogram") {
      const r = b.diameter / 2;
      const cx = xAt(b.diameter) + r;
      const cy = y + r;
      stroke(circle(cx, cy, r), cw.accent, 0.6);
      stroke(circle(cx, cy, r - mm(0.9)), cw.accent, 0.25);
      const st = design.styles.monogram;
      const size = b.diameter * (b.initials.length > 1 ? 0.34 : 0.44);
      const m = fontMetrics(st.font);
      const baseline = cy + (m.capHeight * size) / 2;
      if (b.initials.length > 1) {
        const ampSize = size * 0.62;
        const gap = size * 0.16;
        const w1 = measureText(st.font, b.initials[0]!, size);
        const wa = measureText("display-italic", "&", ampSize);
        const w2 = measureText(st.font, b.initials[1]!, size);
        let x = cx - (w1 + wa + w2 + gap * 2) / 2;
        nodes.push({ t: "text", font: st.font, size: r2(size), x: r2(x), y: r2(baseline), text: b.initials[0]!, tracking: 0, color: cw.ink, width: r2(w1) });
        x += w1 + gap;
        nodes.push({ t: "text", font: "display-italic", size: r2(ampSize), x: r2(x), y: r2(baseline - size * 0.04), text: "&", tracking: 0, color: cw.accent, width: r2(wa) });
        x += wa + gap;
        nodes.push({ t: "text", font: st.font, size: r2(size), x: r2(x), y: r2(baseline), text: b.initials[1]!, tracking: 0, color: cw.ink, width: r2(w2) });
      } else {
        const w1 = measureText(st.font, b.initials[0]!, size);
        nodes.push({ t: "text", font: st.font, size: r2(size), x: r2(cx - w1 / 2), y: r2(baseline), text: b.initials[0]!, tracking: 0, color: cw.ink, width: r2(w1) });
      }
    } else if (b.k === "numerals") {
      const tracking = -0.02 * b.size;
      const sep = b.size * 0.5;
      const widths = b.parts.map((p) => measureText("display", p, b.size, tracking));
      const total = widths.reduce((a, c) => a + c, 0) + sep * (b.parts.length - 1);
      let x = design.align === "left" ? xLeft - b.size * 0.03 : xAt(total);
      const baseline = y + h;
      b.parts.forEach((p, i) => {
        nodes.push({ t: "text", font: "display", size: r2(b.size), x: r2(x), y: r2(baseline), text: p, tracking: r2(tracking), color: cw.ink, width: r2(widths[i]!) });
        x += widths[i]!;
        if (i < b.parts.length - 1) {
          nodes.push({ t: "path", d: circle(x + sep / 2, baseline - h * 0.46, b.size * 0.045), tx: 0, ty: 0, s: 1, paint: "fill", color: cw.accent, sw: 0 });
          x += sep;
        }
      });
    } else if (b.k === "qr") {
      const x = xAt(b.size);
      nodes.push({ t: "qr", x: r2(x), y: r2(y), size: r2(b.size), matrix: b.matrix });
      if (b.caption) {
        const st = { ...design.styles.note, size: 5.6 };
        const text = st.caps ? b.caption.toLocaleUpperCase("ro") : b.caption;
        const tracking = (st.tracking ?? 0) * st.size;
        const fitted = ellipsize(st.font, text, st.size, tracking, column);
        const width = measureText(st.font, fitted, st.size, tracking);
        nodes.push({ t: "text", font: st.font, size: st.size, x: r2(xAt(width)), y: r2(y + b.size + 9), text: fitted, tracking: r2(tracking), color: cw.muted, width: r2(width) });
      }
    }
    y += h;
  }
  return { piece: input.piece, design: design.key, width: r2(W), height: r2(H), colourway: cw, nodes, fit: r2(s), truncated };
}

function circle(cx: number, cy: number, r: number): string {
  return `M${r2(cx - r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx + r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx - r)} ${r2(cy)}Z`;
}

/** Bounding box of everything that is text, for tests: [minX, minY, maxX, maxY] in points. */
export function sceneTextBounds(scene: Scene): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of scene.nodes) {
    if (n.t !== "text") continue;
    const m = fontMetrics(n.font);
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.width);
    minY = Math.min(minY, n.y - m.capHeight * n.size);
    maxY = Math.max(maxY, n.y + m.descent * n.size * 0.5);
  }
  return [minX, minY, maxX, maxY];
}

/** Every text of the scene, in drawing order (tests, alt text). */
export function sceneTexts(scene: Scene): string[] {
  return scene.nodes.filter((n): n is Extract<SceneNode, { t: "text" }> => n.t === "text").map((n) => n.text);
}

/* ── Collection artwork (drawn behind the text) ────────────────────────── */

/**
 * Rewrites SVG path data as absolute commands, scaled by (sx, sy) then moved by (tx, ty).
 * Used to stretch the collections' 100 × 100 artwork over a sheet without stretching the stroke.
 */
export function transformPath(d: string, sx: number, sy: number, tx = 0, ty = 0): string {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  const X = (x: number) => r2(x * sx + tx);
  const Y = (y: number) => r2(y * sy + ty);
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  const num = () => parseFloat(tokens[i++] ?? "0");
  const isCmd = (t: string | undefined) => !!t && /^[a-zA-Z]$/.test(t);
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++]!;
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    const pair = () => [num() + ox, num() + oy] as const;
    switch (cmd.toUpperCase()) {
      case "M": {
        const [x, y] = pair();
        cx = startX = x;
        cy = startY = y;
        out.push(`M${X(x)} ${Y(y)}`);
        cmd = rel ? "l" : "L";
        break;
      }
      case "L": {
        const [x, y] = pair();
        cx = x;
        cy = y;
        out.push(`L${X(x)} ${Y(y)}`);
        break;
      }
      case "H":
        cx = num() + ox;
        out.push(`L${X(cx)} ${Y(cy)}`);
        break;
      case "V":
        cy = num() + oy;
        out.push(`L${X(cx)} ${Y(cy)}`);
        break;
      case "C": {
        const a = pair();
        const b = pair();
        const c = pair();
        out.push(`C${X(a[0])} ${Y(a[1])} ${X(b[0])} ${Y(b[1])} ${X(c[0])} ${Y(c[1])}`);
        [cx, cy] = c;
        break;
      }
      case "S":
      case "Q": {
        const a = pair();
        const b = pair();
        out.push(`${cmd.toUpperCase()}${X(a[0])} ${Y(a[1])} ${X(b[0])} ${Y(b[1])}`);
        [cx, cy] = b;
        break;
      }
      case "T": {
        const [x, y] = pair();
        out.push(`T${X(x)} ${Y(y)}`);
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const [x, y] = pair();
        const flip = sx * sy < 0 ? 1 - sweep : sweep;
        out.push(`A${r2(Math.abs(rx * sx))} ${r2(Math.abs(ry * sy))} ${rot} ${large} ${flip} ${X(x)} ${Y(y)}`);
        cx = x;
        cy = y;
        break;
      }
      case "Z":
        out.push("Z");
        cx = startX;
        cy = startY;
        break;
      default:
        i += 1; // unknown command: skip a token rather than loop forever
    }
  }
  return out.join("");
}

/** A dashed (or, with dash ≈ 0 and a round cap, dotted) straight line as separate segments. */
function dashed(x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  let d = "";
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + Math.max(dash, 0.01));
    d += `M${r2(x1 + ux * s)} ${r2(y1 + uy * s)}L${r2(x1 + ux * e)} ${r2(y1 + uy * e)}`;
  }
  return d;
}

const box = (x: number, y: number, w: number, h: number) => `M${r2(x)} ${r2(y)}H${r2(x + w)}V${r2(y + h)}H${r2(x)}Z`;

type ArtCtx = {
  W: number;
  H: number;
  /** Points per pixel of the collections' 400-pixel-wide reference card. */
  k: number;
  /** Bleed allowance: fills that touch an edge run this far past it (the PDF keeps what falls in the bleed). */
  E: number;
  cw: Colourway;
  /** The occasion kind's motif, 80 × 64. */
  motif: string;
  stroke: (d: string, color: string, sw: number) => void;
  fill: (d: string, color: string) => void;
  /** The accent laid over the paper at strength t (0 = paper, 1 = accent). */
  tint: (t: number) => string;
  /** 100 × 100 artwork stretched over the sheet. */
  sheet: (d: string) => string;
};

/** Draws a cross-stitch chart as filled squares, tiled `repeat` times along a strip. */
function stitchStrip(g: ArtCtx, chart: { colours: readonly string[]; cells: readonly string[] }, x: number, y: number, length: number, vertical: boolean, maxThickness?: number): number {
  const repeat = 5;
  const cols = Math.max(...chart.cells.map((r) => r.length));
  const rows = chart.cells.length;
  let cell = length / (cols * repeat);
  if (maxThickness && rows * cell > maxThickness) cell = maxThickness / rows;
  const used = cols * repeat * cell;
  const start = (vertical ? y : x) + (length - used) / 2;
  chart.colours.forEach((colour, ci) => {
    const mark = "ARCD"[ci];
    let d = "";
    for (let t = 0; t < repeat; t += 1) {
      chart.cells.forEach((row, r) => {
        // one rectangle per run of the same stitch
        for (let c = 0; c < row.length; c += 1) {
          if (row[c] !== mark) continue;
          let run = 1;
          while (row[c + run] === mark) run += 1;
          const along = start + (t * cols + c) * cell;
          const across = (vertical ? x : y) + r * cell;
          d += vertical ? box(across, along, cell + 0.05, run * cell + 0.05) : box(along, across, run * cell + 0.05, cell + 0.05);
          c += run - 1;
        }
      });
    }
    if (d) g.fill(d, colour);
  });
  return rows * cell;
}

/** Each collection design's artwork. Fractions follow the reference cards of the collection. */
const COLLECTION_ART: Record<string, (g: ArtCtx) => void> = {
  frame: ({ W, H, k, stroke, cw }) => {
    stroke(box(9.7 * k, 9.7 * k, W - 19.4 * k, H - 19.4 * k), cw.accent, 1.3 * k);
    stroke(box(12.3 * k, 12.3 * k, W - 24.6 * k, H - 24.6 * k), cw.accent, 1.3 * k);
  },
  arch: ({ W, H, E, stroke, cw }) => {
    const x0 = W * 0.05;
    const x1 = W * 0.95;
    const rx = (x1 - x0) / 2;
    const ry = Math.min(rx * 1.15, H * 0.4);
    const top = H * 0.06;
    stroke(`M${r2(x0)} ${r2(H + E)}V${r2(top + ry)}A${r2(rx)} ${r2(ry)} 0 0 1 ${r2(x1)} ${r2(top + ry)}V${r2(H + E)}`, cw.accent, 0.8);
  },
  seal: ({ W, H, k, stroke, cw }) => stroke(`M${r2(W * 0.1)} ${r2(H - 16 * k)}H${r2(W * 0.9)}`, cw.accent, 0.8),
  ribbon: ({ W, H, k, E, fill, stroke, tint }) => {
    fill(box(-E, -E, 12 * k + E, H + E * 2), tint(1));
    // diagonal hatching in a band on the right
    const x0 = W * 0.66;
    let d = "";
    for (let c = x0 + 9 * k; c < W + H + E; c += 9 * k) {
      const len = Math.min(H + E * 2, c - x0);
      d += `M${r2(c)} ${r2(-E)}L${r2(c - len)} ${r2(-E + len)}`;
    }
    stroke(d, tint(0.3), 0.5);
  },
  band: ({ W, k, E, fill, stroke, tint }) => {
    let d = "";
    for (let x = 0; x < W + E; x += 7 * k) d += box(x, -E, 2 * k, 24 * k + E);
    fill(d, tint(1));
    stroke(`M${r2(-E)} ${r2(24 * k)}H${r2(W + E)}`, tint(1), 0.8);
  },
  ticket: ({ W, H, k, E, fill, stroke, tint }) => {
    fill(box(-E, -E, W + E * 2, 8 * k + E) + box(-E, H - 8 * k, W + E * 2, 8 * k + E), tint(1));
    stroke(dashed(14 * k, 20 * k, 14 * k, H - 20 * k, 6 * k, 4 * k) + dashed(W - 14 * k, 20 * k, W - 14 * k, H - 20 * k, 6 * k, 4 * k), tint(1), 1.6 * k);
  },
  postcard: (g) => {
    const { W, k, stroke, cw } = g;
    stroke(box(12 * k, 12 * k, W - 24 * k, g.H - 24 * k), cw.accent, 0.8);
    const size = 62 * k;
    const x = W - 12 * k - mm(6) - size;
    const y = 12 * k + mm(6);
    stroke(dotted(box(x, y, size, size * 0.86), 3.2 * k), cw.accent, 1.6 * k);
    stroke(transformPath(g.motif, (size * 0.7) / 80, (size * 0.7) / 80, x + size * 0.15, y + size * 0.86 * 0.5 - size * 0.7 * 0.4), cw.accent, 1.1);
  },
  split: (g) => {
    const { W, H, E, fill, tint, stroke, cw } = g;
    fill(box(-E, -E, W * 0.3 + E, H + E * 2), tint(0.18));
    const size = W * 0.22;
    stroke(transformPath(g.motif, size / 80, size / 80, W * 0.15 - size / 2, H / 2 - size * 0.4), cw.accent, 1.1);
  },
  crest: ({ W, k, stroke, tint }) => {
    const r = 90 * k;
    stroke(circleD(W / 2, 4 * k, r - 1.35 * k), tint(0.55), 2.7 * k);
    stroke(circleD(W / 2, 4 * k, r - 6.7 * k), tint(0.55), 2.7 * k);
  },
  border: ({ W, H, k, E, fill, stroke, cw }) => {
    fill(box(-E, H - 14 * k, W + E * 2, 14 * k + E), cw.accent);
    stroke(`M${r2(10 * k)} ${r2(10 * k)}H${r2(W - 10 * k)}M${r2(10 * k)} ${r2(H - 24 * k)}H${r2(W - 10 * k)}`, cw.accent, 0.8);
  },
  triptych: ({ W, H, E, fill, tint }) => fill(box(-E, -E, W * 0.12 + E, H + E * 2) + box(W * 0.88, -E, W * 0.12 + E, H + E * 2), tint(0.24)),
  medallion: ({ W, H, stroke, cw }) => stroke(dotted(box(W * 0.05, H * 0.05, W * 0.9, H * 0.9), 4.2), cw.accent, 1.3),
  rays: ({ W, H, fill, tint }) => {
    // thin wedges fanning up from below the sheet, kept to its lower half
    const ox = W / 2;
    const oy = H * 1.15;
    const at = (deg: number) => r2(ox + Math.tan((deg * Math.PI) / 180) * (oy - H / 2));
    let d = "";
    for (let a = -77; a <= 77; a += 11) d += `M${r2(ox)} ${r2(oy)}L${at(a)} ${r2(H / 2)}L${at(a + 2)} ${r2(H / 2)}Z`;
    fill(d, tint(0.24));
  },
  diagonal: ({ W, H, E, fill, tint }) => fill(`M${r2(W * 0.85)} ${r2(-E)}L${r2(W + E)} ${r2(-E)}L${r2(W + E)} ${r2(H + E)}L${r2(W * 0.42)} ${r2(H + E)}Z`, tint(0.23)),
  plaque: ({ W, H, k, stroke, cw }) => {
    stroke(box(W * 0.08, H * 0.07, W * 0.84, H * 0.86), cw.accent, 0.8);
    stroke(box(W * 0.08 + 4 * k, H * 0.07 + 4 * k, W * 0.84 - 8 * k, H * 0.86 - 8 * k), cw.accent, 0.8);
  },
  column: ({ W, H, k, E, stroke, tint }) => {
    let d = "";
    for (let x = 0.5; x < W * 0.14; x += 6 * k) d += `M${r2(x)} ${r2(-E)}V${r2(H + E)}`;
    stroke(d, tint(0.5), 0.8 * k);
  },
  scallop: ({ W, k, fill, cw }) => {
    let d = "";
    for (let x = 14 * k; x < W + 28 * k; x += 28 * k) d += circleD(x, 0, 12 * k);
    fill(d, cw.accent);
  },
  imprint: (g) => {
    const size = g.W * 0.72 * 1.2;
    g.stroke(transformPath(g.motif, size / 80, size / 80, g.W * 0.4, -g.H * 0.06), g.tint(0.16), 2.4);
  },
  ruling: ({ W, H, k, stroke, cw }) => {
    for (const y of [H * 0.08, H * 0.92]) {
      stroke(`M${r2(W * 0.06)} ${r2(y - 1.35 * k)}H${r2(W * 0.94)}M${r2(W * 0.06)} ${r2(y + 1.35 * k)}H${r2(W * 0.94)}`, cw.accent, 1.3 * k);
    }
  },
  duotone: (g) => {
    const { W, H, E, fill, tint, stroke, cw } = g;
    fill(box(-E, -E, W + E * 2, H * 0.34 + E), tint(0.26));
    const size = W * 0.2;
    stroke(transformPath(g.motif, size / 80, size / 80, W - mm(14) - size, H * 0.17 - size * 0.4), cw.accent, 1.1);
  },
  "letterpress-edition": ({ W, H, stroke, tint, cw }) => {
    stroke(box(W * 0.04, H * 0.04, W * 0.92, H * 0.92), cw.accent, 0.8);
    stroke(box(W * 0.04 + 3.5, H * 0.04 + 3.5, W * 0.92 - 7, H * 0.92 - 7), tint(0.55), 0.6);
  },
  "deco-edition": () => {},
  "modernist-edition": ({ W, H, E, fill, cw }) => fill(box(-E, -E, W * 0.21 + E, H + E * 2), cw.ink),
  "folded-edition": ({ W, H, E, fill, tint }) => fill(`M${r2(-E)} ${r2(-E)}L${r2(W / 2)} ${r2(H * 0.37)}L${r2(W + E)} ${r2(-E)}Z`, tint(0.33)),
  "wildflower-edition": ({ W, H, k, stroke, tint }) => stroke(box(8 * k, 8 * k, W - 16 * k, H - 16 * k), tint(0.55), 0.8),
  "woven-edition": ({ W, H, E, fill, tint }) => fill(box(-E, -E, W * 0.26 + E, H + E * 2), tint(0.24)),
  "bucovina-lozenge": ({ W, H, stroke, tint }) => stroke(`M${r2(W * 0.1)} ${r2(H * 0.05)}V${r2(H * 0.95)}M${r2(W * 0.9)} ${r2(H * 0.05)}V${r2(H * 0.95)}`, tint(0.65), 0.8),
  "saxon-chest": ({ W, H, E, fill, tint }) => fill(box(-E, -E, W * 0.3 + E, H + E * 2), tint(0.22)),
  "moldova-sirlau": ({ W, H, E, fill, cw }) => fill(box(-E, -E, W * 0.28 + E, H + E * 2), mixColour(cw.accent, "#644049", 0.6)),
  "damask-edition": ({ W, H, stroke, cw }) => {
    stroke(box(W * 0.04, H * 0.04, W * 0.92, H * 0.92), cw.accent, 1);
    stroke(box(W * 0.04 + 2, H * 0.04 + 2, W * 0.92 - 4, H * 0.92 - 4), cw.accent, 1);
  },
  "embroidered-edition": ({ W, H, E, stroke, cw }) => stroke(`M${r2(-E)} ${r2(H * 0.11)}H${r2(W + E)}M${r2(-E)} ${r2(H * 0.89)}H${r2(W + E)}`, cw.accent, 0.8),
};

/** Opacity of the drawn edition artwork, where the collection softens it. */
const EDITION_STRENGTH: Record<string, number> = { "botanical-edition": 0.6, "folded-edition": 0.65, "engraved-edition": 0.25, "maramures-gate": 0.76, "horezu-medallion": 0.65 };

function dotted(path: string, gap: number): string {
  // the rectangles drawn as dotted lines: walk each side
  const m = path.match(/M([\d.-]+) ([\d.-]+)H([\d.-]+)V([\d.-]+)H([\d.-]+)Z/);
  if (!m) return path;
  const [x0, y0, x1, y1] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return dashed(x0, y0, x1, y0, 0, gap) + dashed(x1, y0, x1, y1, 0, gap) + dashed(x1, y1, x0, y1, 0, gap) + dashed(x0, y1, x0, y0, 0, gap);
}

function circleD(cx: number, cy: number, r: number): string {
  return `M${r2(cx - r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx + r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 0 ${r2(cx - r)} ${r2(cy)}Z`;
}

/** Draws a collection design's artwork onto the scene (behind everything that follows). */
function drawCollectionArt(design: Design, W: number, H: number, cw: Colourway, occasionKind: string | undefined, nodes: SceneNode[]): void {
  const key = design.art!;
  const g: ArtCtx = {
    W,
    H,
    k: Math.min(W, H) / 400,
    E: mm(BLEED_MM + 1),
    cw,
    motif: motifFor(occasionKind),
    stroke: (d, color, sw) => nodes.push({ t: "path", d, tx: 0, ty: 0, s: 1, paint: "stroke", color, sw }),
    fill: (d, color) => nodes.push({ t: "path", d, tx: 0, ty: 0, s: 1, paint: "fill", color, sw: 0 }),
    tint: (t) => mixColour(cw.paper, cw.accent, t),
    sheet: (d) => transformPath(d, W / 100, H / 100),
  };
  const chart = own(STITCH_CHARTS, key);
  if (chart) {
    // Romanian embroidery: linen with a faint weave, a hairline edge, the chart as the border
    g.stroke(box(0.6, 0.6, W - 1.2, H - 1.2), g.tint(0.25), 0.6);
    if (key === "muscel-altita-grid") g.stroke(box(2.5 * g.k, 2.5 * g.k, W - 5 * g.k, H - 5 * g.k), "#241f21", 5 * g.k);
    const inset = key === "muscel-altita-grid" ? 9 * g.k : 0;
    const maxT = key === "comanesti-sprig" ? 58 * g.k : undefined;
    if (chart.placement === "sidebar") stitchStrip(g, chart, inset, 0, H, true, maxT);
    else {
      if (chart.placement !== "bottom") stitchStrip(g, chart, inset, inset, W - inset * 2, false, maxT);
      if (chart.placement !== "top") {
        const rows = chart.cells.length;
        const cols = Math.max(...chart.cells.map((r) => r.length));
        let cell = (W - inset * 2) / (cols * 5);
        if (maxT && rows * cell > maxT) cell = maxT / rows;
        stitchStrip(g, chart, inset, H - inset - rows * cell, W - inset * 2, false, maxT);
      }
    }
    return;
  }
  own(COLLECTION_ART, key)?.(g);
  const edition = own(EDITION_ART, key);
  if (edition) {
    const strength = EDITION_STRENGTH[key] ?? 1;
    g.stroke(g.sheet(edition.d), strength < 1 ? g.tint(strength) : cw.accent, 0.8);
    if (edition.thread) g.stroke(g.sheet(edition.thread), key === "maramures-ciupag" ? "#375994" : (cw.thread ?? cw.accent), 0.8);
  }
}

/** The occasion kind's motif as an opening mark: plain, in a ring, or in a shield. */
function motifOrnament(kind: string | undefined, variant: "plain" | "ring" | "shield"): Ornament {
  const d = motifFor(kind);
  if (variant === "plain") return { w: 80, h: 64, paths: [{ d, paint: "stroke", role: "accent", sw: 0.9 }] };
  if (variant === "ring") {
    return {
      w: 88,
      h: 88,
      paths: [
        { d: circleD(44, 44, 42), paint: "stroke", role: "accent", sw: 0.6 },
        { d: transformPath(d, 0.72, 0.72, 44 - 28.8, 44 - 23), paint: "stroke", role: "accent", sw: 0.9 },
      ],
    };
  }
  return {
    w: 80,
    h: 88,
    paths: [
      { d: "M6 4H74V44C74 66 56 80 40 85C24 80 6 66 6 44Z", paint: "stroke", role: "accent", sw: 0.6 },
      { d: transformPath(d, 0.62, 0.62, 40 - 24.8, 36 - 19.8), paint: "stroke", role: "accent", sw: 0.9 },
    ],
  };
}

/* ── Renderer 1: SVG (the proof) ───────────────────────────────────────── */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type SvgOptions = {
  /** Pixel width of the image; height follows. Omit for a scalable image. */
  width?: number;
  /** Title for assistive technology. */
  title?: string;
  /** Extra canvas around the sheet, in points, filled with `backdrop` (image cards). */
  pad?: number;
  backdrop?: string;
};

/** The body of a scene as SVG elements (no <svg> wrapper), in the scene's own points. */
export function sceneSvgBody(scene: Scene): string {
  // a nested <svg> clips the artwork that runs into the bleed to the sheet
  let out = `<svg width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" overflow="hidden"><rect width="${scene.width}" height="${scene.height}" fill="${scene.colourway.paper}"/>`;
  for (const n of scene.nodes) {
    if (n.t === "text") {
      out += `<path fill="${n.color}" d="${runPathData(n.font, n.text, n.size, n.tracking, n.x, n.y)}"/>`;
    } else if (n.t === "path") {
      const tf = n.tx || n.ty || n.s !== 1 ? ` transform="translate(${n.tx} ${n.ty}) scale(${r2(n.s * 1000) / 1000})"` : "";
      out +=
        n.paint === "fill"
          ? `<path${tf} fill="${n.color}" d="${n.d}"/>`
          : `<path${tf} fill="none" stroke="${n.color}" stroke-width="${r2((n.sw / n.s) * 100) / 100}" stroke-linecap="round" stroke-linejoin="round" d="${n.d}"/>`;
    } else {
      out += `<rect x="${n.x}" y="${n.y}" width="${n.size}" height="${n.size}" fill="#ffffff"/><path fill="#17161b" d="${qrPathData(n.matrix, n.x, n.y, n.size)}"/>`;
    }
  }
  return `${out}</svg>`;
}

/** A scene as a self-contained SVG document: no fonts needed, text is outlines. */
export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const pad = opts.pad ?? 0;
  const w = scene.width + pad * 2;
  const h = scene.height + pad * 2;
  const size = opts.width ? ` width="${opts.width}" height="${Math.round((opts.width * h) / w)}"` : "";
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : "";
  const back = pad ? `<rect width="${r2(w)}" height="${r2(h)}" fill="${opts.backdrop ?? "#ece8df"}"/>` : "";
  const body = pad ? `<g transform="translate(${pad} ${pad})">${sceneSvgBody(scene)}</g>` : sceneSvgBody(scene);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(w)} ${r2(h)}"${size} role="img">${title}${back}${body}</svg>`;
}

/** `data:` URI of an SVG string (for <img>; the strict CSP allows data: images). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/* ── Renderer 2: PDF (the print) ───────────────────────────────────────── */

export const BLEED_MM = 3;
/** Room around the bleed for crop marks and the slug line. */
export const SLUG_MM = 8;

export type PdfPageOptions = {
  /** Bleed on every side, mm (0 for a screen PDF). */
  bleedMm?: number;
  cropMarks?: boolean;
  /** One line for the print shop, set in the slug under the sheet (needs cropMarks). */
  slug?: string;
};

/** Page size of one sheet with its bleed (and slug when crop marks are on), in points. */
export function pdfPageSize(scene: Pick<Scene, "width" | "height">, opts: PdfPageOptions = {}): { width: number; height: number; offset: number } {
  const offset = mm((opts.bleedMm ?? 0) + (opts.cropMarks ? SLUG_MM : 0));
  return { width: scene.width + offset * 2, height: scene.height + offset * 2, offset };
}

/** Draws the scene's runs and paths at the current origin (1 unit = 1 pt of the trim sheet). No page, no flood. */
export function drawSceneNodes(doc: PDFKit.PDFDocument, scene: Scene, bleed = 0): void {
  // artwork may run past the sheet: keep it to the sheet (plus its bleed when printing)
  doc.save();
  doc.rect(-bleed, -bleed, scene.width + bleed * 2, scene.height + bleed * 2).clip();
  for (const n of scene.nodes) {
    if (n.t === "text") {
      doc
        .font(pdfFontName(n.font))
        .fontSize(n.size)
        .fillColor(n.color)
        .text(n.text, n.x, n.y, { lineBreak: false, characterSpacing: n.tracking, baseline: "alphabetic" });
    } else if (n.t === "path") {
      doc.save();
      doc.translate(n.tx, n.ty).scale(n.s);
      if (n.paint === "fill") doc.path(n.d).fill(n.color);
      else doc.path(n.d).lineWidth(n.sw / n.s).lineCap("round").lineJoin("round").stroke(n.color);
      doc.restore();
    } else {
      doc.rect(n.x, n.y, n.size, n.size).fill("#ffffff");
      doc.path(qrPathData(n.matrix, n.x, n.y, n.size)).fill("#17161b");
    }
  }
  doc.restore();
}

/**
 * Adds one page to `doc` and draws the scene on it: live vector text in the embedded
 * stationery fonts (registerStationeryFonts must have been called), the paper flood out to
 * the bleed when the colourway has one, crop marks and the slug line on request. Sets the
 * page's TrimBox and BleedBox so imposition software finds the sheet.
 */
export function drawSceneOnPdf(doc: PDFKit.PDFDocument, scene: Scene, opts: PdfPageOptions = {}): void {
  const bleed = mm(opts.bleedMm ?? 0);
  const page = pdfPageSize(scene, opts);
  doc.addPage({ size: [page.width, page.height], margin: 0 });
  const o = page.offset;
  const dict = doc.page.dictionary.data as Record<string, unknown>;
  dict.TrimBox = [o, o, o + scene.width, o + scene.height];
  dict.BleedBox = [o - bleed, o - bleed, o + scene.width + bleed, o + scene.height + bleed];

  if (scene.colourway.flood) {
    doc.rect(o - bleed, o - bleed, scene.width + bleed * 2, scene.height + bleed * 2).fill(scene.colourway.paper);
  }
  doc.save();
  doc.translate(o, o);
  drawSceneNodes(doc, scene, bleed);
  doc.restore();

  if (opts.cropMarks) {
    const len = mm(4);
    const gap = bleed; // marks start where the bleed ends
    const x0 = o;
    const y0 = o;
    const x1 = o + scene.width;
    const y1 = o + scene.height;
    doc.save().lineWidth(0.25).strokeColor("#000000");
    for (const [x, y, dx, dy] of [
      [x0, y0, -1, -1],
      [x1, y0, 1, -1],
      [x0, y1, -1, 1],
      [x1, y1, 1, 1],
    ] as const) {
      doc.moveTo(x + dx * gap, y).lineTo(x + dx * (gap + len), y).stroke();
      doc.moveTo(x, y + dy * gap).lineTo(x, y + dy * (gap + len)).stroke();
    }
    doc.restore();
    if (opts.slug) {
      doc
        .font(pdfFontName("text"))
        .fontSize(4.6)
        .fillColor("#000000")
        .text(opts.slug, o + len + bleed, y1 + bleed + mm(1.6), { lineBreak: false, width: scene.width - (len + bleed) * 2, ellipsis: true, baseline: "alphabetic" });
    }
  }
}
