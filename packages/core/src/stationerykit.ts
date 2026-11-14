import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as fontkit from "fontkit";
import { pdfFonts } from "./briefingpdf";
import { qrPathData, type QrMatrix } from "./qr";

// THE STATIONERY KIT (C-04) — designs as data, one layout engine, two renderers.
//
//   STATIONERY_DESIGNS        eight original typographic designs (no stock art, no imagery)
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
};

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

export type DesignKey = "classic" | "modern" | "monogram" | "botanical" | "minimal" | "nocturne" | "botez" | "petrecere";

export type Design = {
  key: DesignKey;
  align: "center" | "left";
  frame: FrameKind;
  scatter?: "confetti" | "stars";
  /** How the names are set: one above the other with the conjunction between, or on running lines. */
  names: "stacked" | "inline";
  /** The mark between blocks. */
  rule: OrnamentKey;
  /** A larger opening mark above the text (invitation, menu, thank-you). */
  crest?: { ornament: OrnamentKey; widthMm: number } | { monogram: true; diameterMm: number };
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

export const STATIONERY_DESIGNS: Record<DesignKey, Design> = {
  // Centred Bodoni inside a gilt plate-mark: the house style.
  classic: {
    key: "classic",
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

export const DESIGN_KEYS = Object.keys(STATIONERY_DESIGNS) as DesignKey[];

export function getDesign(key: string): Design {
  const d = STATIONERY_DESIGNS[key as DesignKey];
  if (!d) throw new Error(`Unknown stationery design "${key}"`);
  return d;
}

/** The colourway of a design; an unknown or foreign key falls back to the design's first. */
export function getColourway(design: Design, key: string | null | undefined): Colourway {
  const k = key && design.colourways.includes(key) ? key : design.colourways[0]!;
  return COLOURWAYS[k]!;
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
  | { t: "path"; d: string; tx: number; ty: number; s: number; paint: "stroke" | "fill"; color: string; sw: number }
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
          { i: "text", role: "kicker", value: t.kicker, gap: 0 },
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
          ...(extra.qr ? [{ i: "qr", gap: 14, sizeMm: 17 } as Item] : []),
        ];
      }
      return [
        ...(design.crest && !square ? [{ i: "crest", gap: 0 } as Item] : []),
        { i: "text", role: "kicker", value: t.kicker, gap: design.crest && !square ? 24 : 0 },
        { i: "names", gap: 24 },
        { i: "rule", gap: 24 },
        { i: "text", role: "wording", value: t.wording, gap: 24 },
        ...dateItems,
        { i: "text", role: "venue", value: t.venue, gap: 26 },
        { i: "text", role: "address", value: t.address, gap: 7 },
        { i: "text", role: "rsvp", value: t.rsvp, gap: 32 },
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
        ...(design.crest && !left ? [{ i: "crest", gap: 0 } as Item] : []),
        { i: "text", role: "title", value: t.menuTitle, gap: design.crest && !left ? 14 : 0 },
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
};

/** THE layout: design + colourway + texts → positioned runs and paths on the trim sheet. */
export function layoutPiece(input: LayoutInput): Scene {
  const design = getDesign(input.design);
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
  const column = W - mx * 2;
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
  let y = top + (flexTotal > 0 ? 0 : free * (design.align === "left" ? 0.4 : 0.46));
  const xLeft = mx;
  const xMid = W / 2;
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
        const x = design.align === "left" ? xLeft : xMid - width / 2;
        nodes.push({ t: "text", font: b.style.font, size: r2(b.size), x: r2(x), y: r2(baseline), text: line, tracking: r2(tracking), color: colour(b.style.color), width: r2(width) });
      });
    } else if (b.k === "ornament") {
      const scale = b.width / b.ornament.w;
      const x = design.align === "left" ? xLeft : xMid - b.width / 2;
      for (const p of b.ornament.paths) {
        nodes.push({ t: "path", d: p.d, tx: r2(x), ty: r2(y), s: scale, paint: p.paint, color: colour(b.colorOverride ?? p.role), sw: p.sw ?? 0 });
      }
    } else if (b.k === "monogram") {
      const r = b.diameter / 2;
      const cx = design.align === "left" ? xLeft + r : xMid;
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
      let x = design.align === "left" ? xLeft - b.size * 0.03 : xMid - total / 2;
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
      const x = design.align === "left" ? xLeft : xMid - b.size / 2;
      nodes.push({ t: "qr", x: r2(x), y: r2(y), size: r2(b.size), matrix: b.matrix });
      if (b.caption) {
        const st = { ...design.styles.note, size: 5.6 };
        const text = st.caps ? b.caption.toLocaleUpperCase("ro") : b.caption;
        const tracking = (st.tracking ?? 0) * st.size;
        const fitted = ellipsize(st.font, text, st.size, tracking, column);
        const width = measureText(st.font, fitted, st.size, tracking);
        nodes.push({ t: "text", font: st.font, size: st.size, x: r2(design.align === "left" ? xLeft : xMid - width / 2), y: r2(y + b.size + 9), text: fitted, tracking: r2(tracking), color: cw.muted, width: r2(width) });
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
  let out = `<rect width="${scene.width}" height="${scene.height}" fill="${scene.colourway.paper}"/>`;
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
  return out;
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
export function drawSceneNodes(doc: PDFKit.PDFDocument, scene: Scene): void {
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
  drawSceneNodes(doc, scene);
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
