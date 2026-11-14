// ARRANGEMENT KIT (C-13, F3) — pure and client-safe (no database, no Node APIs):
// the base forms, the stylised preview and the indicative cost. The designer page draws the
// preview in the browser from this file while the planner taps the steppers; the server uses
// the same functions for saved versions, quote requests and What-if previews.
//
// The preview is deliberately abstract — coloured stem marks laid out inside the form's
// silhouette, deterministic from the stem counts and colours. It is a way to see proportion
// and palette, not a picture of the finished arrangement.

export const ARRANGEMENT_FORM_KEYS = ["round_bouquet", "cascade", "low_table", "tall", "arch", "wreath", "candle"] as const;
export type ArrangementFormKey = (typeof ARRANGEMENT_FORM_KEYS)[number];

export type KitLine = {
  catalogueItemId: string;
  stems: number;
  colour: string | null;
  kind: "flower" | "foliage";
  pricePerStemMinor: number | null;
  currency: string;
};

export const ARRANGEMENT_LIMITS = { maxLines: 24, maxStemsPerLine: 500, maxStems: 3000, maxMarks: 260 } as const;

/** Which way the form is looked at in the preview. */
export const ARRANGEMENT_VIEW: Record<ArrangementFormKey, "top" | "side"> = {
  round_bouquet: "top",
  cascade: "side",
  low_table: "top",
  tall: "side",
  arch: "side",
  wreath: "top",
  candle: "side",
};

/** Bloom inks for the catalogue's colour names (stylised, print-safe mid-tones). */
export const BLOOM_COLOURS: Record<string, { fill: string; core: string }> = {
  white: { fill: "#f7f3ea", core: "#d9d1bf" },
  cream: { fill: "#f1e3c4", core: "#cdb98c" },
  yellow: { fill: "#e9c95a", core: "#b7952d" },
  orange: { fill: "#e3944b", core: "#b0652a" },
  peach: { fill: "#efb596", core: "#c98567" },
  pink: { fill: "#e6a2b4", core: "#bd6f86" },
  red: { fill: "#b8363c", core: "#7f1f27" },
  burgundy: { fill: "#6f2334", core: "#481320" },
  purple: { fill: "#6c4a86", core: "#46305a" },
  lilac: { fill: "#b9a3d0", core: "#8c74a8" },
  blue: { fill: "#6f8fc0", core: "#47638f" },
  green: { fill: "#8da26b", core: "#5d7443" },
};
const NEUTRAL_BLOOM = { fill: "#d9d3c6", core: "#a9a294" };
const FOLIAGE = { fill: "#7f9467", core: "#51663f" };

export function bloomInk(line: Pick<KitLine, "colour" | "kind">): { fill: string; core: string } {
  if (line.colour && BLOOM_COLOURS[line.colour]) return BLOOM_COLOURS[line.colour]!;
  return line.kind === "foliage" ? FOLIAGE : NEUTRAL_BLOOM;
}

/* ── Indicative cost (never a quote; unknown is never counted as zero) ─── */

export type IndicativeCost = {
  /** Sum of stems × published price per stem, for the lines that HAVE a price; per currency. */
  known: Array<{ currency: string; minor: number }>;
  /** Lines whose variety has no published price per stem. */
  unpricedLines: number;
  unpricedStems: number;
  pricedLines: number;
  totalStems: number;
  /** "none" = nothing priced; "partial" = at least this much; "full" = every line priced. */
  state: "empty" | "none" | "partial" | "full";
};

export function indicativeCost(lines: ReadonlyArray<Pick<KitLine, "stems" | "pricePerStemMinor" | "currency">>): IndicativeCost {
  const byCurrency = new Map<string, number>();
  let unpricedLines = 0;
  let unpricedStems = 0;
  let pricedLines = 0;
  let totalStems = 0;
  for (const l of lines) {
    if (l.stems <= 0) continue;
    totalStems += l.stems;
    if (l.pricePerStemMinor === null || l.pricePerStemMinor === undefined) {
      unpricedLines += 1;
      unpricedStems += l.stems;
    } else {
      pricedLines += 1;
      byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + l.stems * l.pricePerStemMinor);
    }
  }
  const known = [...byCurrency.entries()].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => a.currency.localeCompare(b.currency));
  const state = totalStems === 0 ? "empty" : pricedLines === 0 ? "none" : unpricedLines > 0 ? "partial" : "full";
  return { known, unpricedLines, unpricedStems, pricedLines, totalStems, state };
}

/* ── Seasonality ───────────────────────────────────────────────────────── */

/** "in" = in season that month, "out" = published as out of season, "unknown" = no months published. */
export function seasonState(seasonMonths: readonly number[], month: number | null): "in" | "out" | "unknown" {
  if (!month || seasonMonths.length === 0) return "unknown";
  return seasonMonths.includes(month) ? "in" : "out";
}

/* ── Layout ────────────────────────────────────────────────────────────── */

export type Mark = { x: number; y: number; r: number; fill: string; core: string; kind: "flower" | "foliage"; rot: number };
export type ArrangementScene = {
  width: number;
  height: number;
  /** Outline of the base form (drawn as a faint guide) and of its vessel, if it has one. */
  outline: string[];
  vessel: string[];
  marks: Mark[];
  /** One mark stands for this many stems (1 unless the design is very large). */
  stemsPerMark: number;
};

const GOLDEN = 2.399963229728653;
const frac = (v: number) => v - Math.floor(v);
/** Low-discrepancy sequences: even spread without randomness. */
const h2 = (i: number) => frac((i + 0.5) * 0.6180339887498949);
const h3 = (i: number) => frac((i + 0.5) * 0.7548776662466927);
const h5 = (i: number) => frac((i + 0.5) * 0.5698402909980532);
const f1 = (n: number) => Math.round(n * 10) / 10;

/** Which line each mark belongs to: the lines dealt out evenly, so colours mix instead of clumping. */
function deal(counts: number[], total: number): number[] {
  const order: number[] = [];
  const given = counts.map(() => 0);
  for (let i = 0; i < total; i += 1) {
    let best = -1;
    let bestDebt = -Infinity;
    counts.forEach((c, k) => {
      if (given[k]! >= c) return;
      const debt = ((i + 1) * c) / total - given[k]!;
      if (debt > bestDebt) {
        bestDebt = debt;
        best = k;
      }
    });
    if (best < 0) break;
    given[best]! += 1;
    order.push(best);
  }
  return order;
}

const W = 320;
const H = 320;

type Placer = (i: number, n: number) => { x: number; y: number };

const disc =
  (cx: number, cy: number, rx: number, ry: number): Placer =>
  (i, n) => {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * GOLDEN;
    return { x: cx + Math.cos(a) * r * rx, y: cy + Math.sin(a) * r * ry };
  };

const FORMS: Record<ArrangementFormKey, { place: Placer; outline: string[]; vessel: string[]; area: number }> = {
  // seen from above: a full round dome
  round_bouquet: {
    place: disc(160, 160, 104, 104),
    outline: ["M160 44a116 116 0 1 0 0 232a116 116 0 1 0 0-232Z"],
    vessel: [],
    area: Math.PI * 104 * 104,
  },
  // seen from the side: a rounded head that trails down to a point
  cascade: {
    place: (i, n) => {
      const head = Math.ceil(n * 0.58);
      if (i < head) return disc(160, 108, 84, 70)(i, head);
      const k = i - head;
      const t = (k + 0.5) / Math.max(1, n - head); // 0 at the head, 1 at the tip
      const half = 62 * Math.pow(1 - t, 1.25) + 5;
      return { x: 160 + (h2(k) - 0.5) * 2 * half + Math.sin(t * 3.1) * 10, y: 150 + t * 140 };
    },
    outline: ["M160 26C224 26 256 70 250 118C246 158 214 176 196 214C182 244 172 280 162 300C150 280 134 240 120 210C104 176 74 158 70 118C64 70 96 26 160 26Z"],
    vessel: [],
    area: Math.PI * 84 * 70 + 9000,
  },
  // seen from above: a long low centrepiece
  low_table: {
    place: disc(160, 160, 132, 62),
    outline: ["M160 88C236 88 304 118 304 160C304 202 236 232 160 232C84 232 16 202 16 160C16 118 84 88 160 88Z"],
    vessel: [],
    area: Math.PI * 132 * 62,
  },
  // seen from the side: a dome carried on a tall stand
  tall: {
    place: disc(160, 96, 100, 68),
    outline: ["M160 20C226 20 270 56 270 98C270 136 226 170 160 170C94 170 50 136 50 98C50 56 94 20 160 20Z"],
    vessel: ["M150 170V282M170 170V282M124 300C124 288 140 282 160 282C180 282 196 288 196 300Z"],
    area: Math.PI * 100 * 68,
  },
  // seen from the front: an arch with two posts
  arch: {
    place: (i, n) => {
      const t = h2(i);
      const band = (h3(i) - 0.5) * 34;
      if (t < 0.62) {
        const a = Math.PI * (1 - t / 0.62);
        return { x: 160 + Math.cos(a) * (112 + band), y: 150 - Math.sin(a) * (112 + band) };
      }
      // the two posts, fuller towards the shoulders
      const leftSide = h5(i) < 0.5;
      const d = Math.pow((t - 0.62) / 0.38, 1.4);
      return { x: (leftSide ? 48 : 272) + band * 0.8, y: 150 + d * 140 };
    },
    outline: ["M30 300V150A130 130 0 0 1 290 150V300", "M66 300V150A94 94 0 0 1 254 150V300"],
    vessel: [],
    area: 30000,
  },
  // seen from above: a ring
  wreath: {
    place: (i) => {
      const a = i * GOLDEN;
      const r = 96 + (h3(i) - 0.5) * 40;
      return { x: 160 + Math.cos(a) * r, y: 160 + Math.sin(a) * r };
    },
    outline: ["M160 40a120 120 0 1 0 0 240a120 120 0 1 0 0-240Z", "M160 88a72 72 0 1 0 0 144a72 72 0 1 0 0-144Z"],
    vessel: [],
    area: Math.PI * (116 * 116 - 76 * 76),
  },
  // seen from the front: a christening candle dressed at its middle, with a ribbon tail
  candle: {
    place: (i, n) => {
      const head = Math.ceil(n * 0.7);
      if (i < head) return disc(160, 176, 74, 50)(i, head);
      const k = i - head;
      const t = (k + 0.5) / Math.max(1, n - head);
      return { x: 160 + (h2(k) - 0.5) * 2 * (40 * (1 - t) + 6), y: 214 + t * 66 };
    },
    outline: ["M160 122C204 122 240 146 240 176C240 200 216 220 196 240C184 256 172 280 160 292C148 280 136 256 124 240C104 220 80 200 80 176C80 146 116 122 160 122Z"],
    vessel: ["M148 44H172V304H148Z", "M160 16C166 24 168 30 164 38C162 42 158 42 156 38C152 30 154 24 160 16Z"],
    area: Math.PI * 74 * 50 + 3000,
  },
};

/** Deterministic layout of the stem marks inside the form. Same input → same picture. */
export function layoutArrangement(form: ArrangementFormKey, lines: ReadonlyArray<Pick<KitLine, "stems" | "colour" | "kind">>): ArrangementScene {
  const f = FORMS[form] ?? FORMS.round_bouquet;
  const live = lines.filter((l) => l.stems > 0);
  const total = live.reduce((n, l) => n + l.stems, 0);
  const stemsPerMark = Math.max(1, Math.ceil(total / ARRANGEMENT_LIMITS.maxMarks));
  // every line keeps at least one mark, so a single stem of something is still seen
  const counts = live.map((l) => Math.max(1, Math.round(l.stems / stemsPerMark)));
  const n = counts.reduce((a, b) => a + b, 0);
  const order = deal(counts, n);
  // mark size from how much room each has; never tiny, never a blob
  const r = n === 0 ? 0 : Math.max(4.2, Math.min(19, Math.sqrt(f.area / n) * 0.47));
  const marks: Mark[] = order.map((k, i) => {
    const line = live[k]!;
    const ink = bloomInk(line);
    const p = f.place(i, n);
    const wobble = 0.86 + h5(i) * 0.28;
    return { x: f1(p.x), y: f1(p.y), r: f1(r * (line.kind === "foliage" ? 1.05 : wobble)), fill: ink.fill, core: ink.core, kind: line.kind, rot: Math.round(h3(i) * 360) };
  });
  // foliage sits under the blooms
  marks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "foliage" ? -1 : 1));
  return { width: W, height: H, outline: f.outline, vessel: f.vessel, marks, stemsPerMark };
}

/** A leaf mark: an almond with a midrib, pointing up before rotation. */
export function leafPath(r: number): string {
  const l = r * 1.7;
  const w = r * 0.72;
  return `M0 ${f1(l)}Q${f1(w)} 0 0 ${f1(-l)}Q${f1(-w)} 0 0 ${f1(l)}Z`;
}

/** A bloom mark: five overlapping petals as one path (centred on 0,0). */
export function bloomPath(r: number): string {
  let d = "";
  for (let k = 0; k < 5; k += 1) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * r * 0.42;
    const cy = Math.sin(a) * r * 0.42;
    const pr = r * 0.6;
    d += `M${f1(cx - pr)} ${f1(cy)}a${f1(pr)} ${f1(pr)} 0 1 0 ${f1(pr * 2)} 0a${f1(pr)} ${f1(pr)} 0 1 0 ${f1(-pr * 2)} 0Z`;
  }
  return d;
}

export type ArrangementSvgInks = { guide: string; vessel: string; paper?: string | null };

/** The scene as a self-contained SVG string (server side: saved versions, thumbnails). */
export function arrangementToSvg(scene: ArrangementScene, inks: ArrangementSvgInks = { guide: "#a9a294", vessel: "#66636e", paper: null }, title?: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" role="img">${title ? `<title>${esc(title)}</title>` : ""}`;
  if (inks.paper) out += `<rect width="${scene.width}" height="${scene.height}" fill="${inks.paper}"/>`;
  for (const d of scene.vessel) out += `<path d="${d}" fill="none" stroke="${inks.vessel}" stroke-width="1.2" stroke-linejoin="round"/>`;
  for (const d of scene.outline) out += `<path d="${d}" fill="none" stroke="${inks.guide}" stroke-width="0.8" stroke-dasharray="2 4" stroke-linecap="round"/>`;
  for (const m of scene.marks) {
    const tf = `transform="translate(${m.x} ${m.y}) rotate(${m.rot})"`;
    if (m.kind === "foliage") out += `<path ${tf} d="${leafPath(m.r)}" fill="${m.fill}" stroke="${m.core}" stroke-width="0.6"/>`;
    else out += `<g ${tf}><path d="${bloomPath(m.r)}" fill="${m.fill}" stroke="${m.core}" stroke-width="0.5"/><circle r="${f1(m.r * 0.22)}" fill="${m.core}"/></g>`;
  }
  return `${out}</svg>`;
}

/* ── Differences between two versions (F6) ─────────────────────────────── */

export type VersionShape = { form: string; note: string | null; lines: Array<{ catalogueItemId: string; varietyName: string; stems: number; colour: string | null }> };
export type DesignChange =
  | { kind: "form"; before: string; after: string }
  | { kind: "note"; before: string | null; after: string | null }
  | { kind: "added"; varietyName: string; stems: number }
  | { kind: "removed"; varietyName: string; stems: number }
  | { kind: "stems"; varietyName: string; before: number; after: number }
  | { kind: "colour"; varietyName: string; before: string | null; after: string | null };

/** What changed from `a` to `b`, item by item. Empty = the same design. */
export function diffVersions(a: VersionShape, b: VersionShape): DesignChange[] {
  const out: DesignChange[] = [];
  if (a.form !== b.form) out.push({ kind: "form", before: a.form, after: b.form });
  const before = new Map(a.lines.map((l) => [l.catalogueItemId, l]));
  const after = new Map(b.lines.map((l) => [l.catalogueItemId, l]));
  for (const [id, l] of after) {
    const p = before.get(id);
    if (!p) out.push({ kind: "added", varietyName: l.varietyName, stems: l.stems });
    else {
      if (p.stems !== l.stems) out.push({ kind: "stems", varietyName: l.varietyName, before: p.stems, after: l.stems });
      if ((p.colour ?? null) !== (l.colour ?? null)) out.push({ kind: "colour", varietyName: l.varietyName, before: p.colour ?? null, after: l.colour ?? null });
    }
  }
  for (const [id, l] of before) if (!after.has(id)) out.push({ kind: "removed", varietyName: l.varietyName, stems: l.stems });
  if ((a.note ?? "") !== (b.note ?? "")) out.push({ kind: "note", before: a.note, after: b.note });
  return out;
}
