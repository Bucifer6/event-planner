// OCCASION TEMPLATES — 50+ original invitation templates for every occasion kind.
//
// Each template is a drawn style (confetti, art deco fans, Bauhaus blocks, cross-hatched
// mountains…) + a palette + a layout, generated from a fixed seed so it is the same every time.
// Styles are chosen per kind (snowflakes for a Christmas party, laurels for an awards night, a
// calm candle-lit arch for a celebration of life), so every kind gets its own set.
//
// Pure data and geometry: no fonts, no database. The stationery kit (stationerykit.ts) turns
// each template into a design, calls drawTemplate() for its artwork and sets the text in the
// box the template returns, so a template prints exactly like any other design.
//
// The legibility rule every style keeps (tested): artwork never sits under the text, unless
// the template lays a plate of plain paper behind the text first.

/* ── Palettes ──────────────────────────────────────────────────────────── */

/** paper (the sheet, behind the text), ink (text), a1–a3 (artwork). */
export type TemplatePalette = { paper: string; ink: string; a1: string; a2: string; a3: string; mood: Mood };
type Mood = "pastel" | "bold" | "earthy" | "jewel" | "mono" | "night" | "festive" | "calm" | "fresh";

const P = (paper: string, ink: string, a1: string, a2: string, a3: string, mood: Mood): TemplatePalette => ({ paper, ink, a1, a2, a3, mood });

// Names are in stationery.json (stationery.palettes.<key>), Romanian and English.
export const TEMPLATE_PALETTES: Record<string, TemplatePalette> = {
  // pastel
  "macaron": P("#fff6f2", "#3d2a33", "#f4a7b9", "#a8d8c9", "#f9d78c", "pastel"),
  "sorbet-sky": P("#f5f8ff", "#26305a", "#a9c4ff", "#ffc2d1", "#ffe7a3", "pastel"),
  "lavender-milk": P("#f8f5ff", "#3a2d5c", "#c9b6f2", "#f2c4e0", "#b6e3e0", "pastel"),
  "pistachio-cream": P("#fbfbf1", "#2f3a22", "#c5dca0", "#f6d6a8", "#e7b7c8", "pastel"),
  "baby-blue": P("#f3f9fd", "#1f3b57", "#9fcbe8", "#d6ecf7", "#f6d9a6", "pastel"),
  "peach-fizz": P("#fff7f0", "#4a2a1e", "#ffb48f", "#ffd9a0", "#9ed3c6", "pastel"),
  "cotton-candy": P("#fff5fa", "#47233a", "#ff9ec7", "#9ed8ff", "#fff09e", "pastel"),
  "mint-julep": P("#f3fbf7", "#18402f", "#94dbbb", "#cdeedb", "#f7c9a9", "pastel"),
  // bold
  "pop-primary": P("#fffaf0", "#1b1b1f", "#e63946", "#1d4ed8", "#f5b800", "bold"),
  "tangerine-cobalt": P("#fff8ef", "#151a33", "#ff7a1a", "#2340c9", "#ffd166", "bold"),
  "memphis": P("#fffdf6", "#141414", "#ff5ca8", "#28c2c9", "#ffd23f", "bold"),
  "risograph": P("#fbf7ee", "#1e1b3a", "#ff4f79", "#2f6fdb", "#ffb000", "bold"),
  "bauhaus": P("#f4efe4", "#16161a", "#d6402c", "#2152a3", "#e8b21f", "bold"),
  "electric-lime": P("#f9fdf0", "#1a2310", "#a6e22e", "#7b4dff", "#ff6b9a", "bold"),
  "flamingo-teal": P("#fff7f5", "#20262e", "#ff6f91", "#00a6a6", "#ffc75f", "bold"),
  // earthy
  "terracotta-sage": P("#f7f1e8", "#3a2a20", "#c86b4a", "#9aab89", "#e2b97f", "earthy"),
  "desert-bloom": P("#f8efe4", "#3b2617", "#d98e5f", "#b5654a", "#e9c48a", "earthy"),
  "olive-grove": P("#f4f2e6", "#2c3220", "#7f8c4a", "#b9a26b", "#d9c9a3", "earthy"),
  "clay-linen": P("#f6efe6", "#3a2b23", "#b07a5c", "#d8b79a", "#8c9a7a", "earthy"),
  "harvest": P("#faf3e3", "#3d2a12", "#d9822b", "#9c4f2e", "#e5b94f", "earthy"),
  "kraft": P("#efe4d0", "#2e2418", "#a4703f", "#5d6b4a", "#c9a46b", "earthy"),
  "moss-stone": P("#f2f2ec", "#22291f", "#6f805a", "#a7a597", "#c7b48a", "earthy"),
  // jewel
  "emerald-gold": P("#f5f1e6", "#10372b", "#1f6b52", "#c9a24a", "#8fb8a6", "jewel"),
  "sapphire-silver": P("#f3f5fa", "#14234a", "#2a4a9c", "#a7b1c6", "#d9c27a", "jewel"),
  "ruby-blush": P("#fbf1f1", "#3d0f1c", "#a3213f", "#e8a6b0", "#c99a5b", "jewel"),
  "amethyst": P("#f6f2fa", "#2b1442", "#6b3fa0", "#c7a3e0", "#d9b45a", "jewel"),
  "peacock": P("#f1f7f6", "#0e2f33", "#0f6e73", "#2b4c9a", "#c9a24a", "jewel"),
  // mono
  "ink-paper": P("#fbfaf7", "#121212", "#121212", "#8a8a85", "#d9d7cf", "mono"),
  "graphite": P("#f2f2f0", "#1c1d20", "#3d4048", "#9a9ca3", "#c9cbcf", "mono"),
  "navy-cream": P("#faf6ec", "#14213d", "#14213d", "#8d99ae", "#e0c48a", "mono"),
  "oxblood-bone": P("#f6f1e8", "#2a1416", "#6e1f2a", "#b39a8a", "#d9cbb8", "mono"),
  // night (dark sheets)
  "midnight-gold": P("#141a2e", "#f6efdc", "#d9b45a", "#6b7fbf", "#f0d9a0", "night"),
  "velvet-noir": P("#16121a", "#f3ece2", "#c9a24a", "#8a5a9e", "#e6d3b0", "night"),
  "deep-teal": P("#0f2a2e", "#eef5f2", "#4fc3b0", "#e0b45a", "#9ad1c8", "night"),
  "neon-night": P("#14101f", "#f5f2ff", "#ff4fd8", "#3ef0e6", "#ffe066", "night"),
  "aubergine": P("#2a1530", "#fbeef5", "#e88ab8", "#f2c46b", "#a58ad9", "night"),
  "forest-night": P("#13221a", "#eef4ea", "#9ccf86", "#e3c27a", "#6fa38c", "night"),
  "ink-blue": P("#101c33", "#eef2fb", "#7aa2ff", "#f5c06b", "#c4d3f5", "night"),
  // festive
  "christmas-classic": P("#fbf6ee", "#1d2b20", "#b3202c", "#1f6b3e", "#d4a63c", "festive"),
  "nordic-winter": P("#f4f7f9", "#1b2a3a", "#c0392b", "#3d6e8f", "#b8c7d3", "festive"),
  "candy-cane": P("#fff8f6", "#3a0f14", "#d62839", "#7fb685", "#f2c14e", "festive"),
  "champagne": P("#faf5ea", "#2a2216", "#c9a24a", "#e8d7a8", "#a68a5b", "festive"),
  "fiesta": P("#fffaf2", "#2a1a12", "#ff5f40", "#00a19a", "#ffbe0b", "festive"),
  "carnival": P("#fffbf3", "#22152e", "#e5383b", "#3a86ff", "#ffbe0b", "festive"),
  // calm
  "stone-mist": P("#f4f4f1", "#2d302f", "#9ba3a0", "#c9cec9", "#d9d2c3", "calm"),
  "dove-grey": P("#f6f6f5", "#2a2c2e", "#a3a8ad", "#d3d6d9", "#c6b9a6", "calm"),
  "sea-glass": P("#f2f7f6", "#1f3836", "#8fbfb8", "#c6e0dc", "#d9cfb8", "calm"),
  "lily-white": P("#fdfcf8", "#2b2a26", "#b9b39e", "#e4dfcf", "#a8b5a0", "calm"),
  "twilight": P("#f3f2f7", "#252340", "#8f8ab5", "#c9c6de", "#e0c9a6", "calm"),
  // fresh
  "citrus-grove": P("#fffbec", "#24300f", "#f2b705", "#7cb342", "#ff8a3d", "fresh"),
  "lagoon-day": P("#f0faf9", "#0f3a40", "#1fb5ac", "#ffb547", "#7fd3e8", "fresh"),
  "meadow": P("#f7fbef", "#233318", "#8bc34a", "#ffd54f", "#f48fb1", "fresh"),
  "summit": P("#f2f6f8", "#14303d", "#3b7a8c", "#f2a65a", "#a7c7d1", "fresh"),
  "coral-reef": P("#fff6f3", "#262a3a", "#ff7f6b", "#2bb3c0", "#ffd166", "fresh"),
  "spring-garden": P("#fbfcf4", "#28331c", "#a5c46a", "#f2a7b8", "#f7d774", "fresh"),
};

/* ── Styles ────────────────────────────────────────────────────────────── */

export const TEMPLATE_STYLES = [
  "confetti", "balloons", "bunting", "sunburst", "rainbow", "memphis", "bauhaus", "terrazzo", "blobs", "vines",
  "florals", "deco-fan", "constellation", "snowflakes", "baubles", "waves", "mountains", "postage", "polaroids", "blueprint",
  "halftone", "awning", "gingham", "hearts", "motif-wallpaper", "candlelight", "banner", "laurel", "soundwave", "brushstrokes",
  "mosaic", "celestial", "sprinkles", "lanterns", "polka", "skyline", "network", "pitch", "fireworks", "vellum",
  "scallop-frame", "arch-window", "ribbon-corner", "petals", "zigzag",
] as const;
export type TemplateStyle = (typeof TEMPLATE_STYLES)[number];

/** How a style may be laid out; the generator picks among them for variety. */
type Layout = { align: "center" | "left"; voice: "roman" | "italic" | "caps" | "sans" };

/** Kinds share families of styles and moods; a few have their own specials. */
const FAMILY: Record<string, { styles: TemplateStyle[]; moods: Mood[] }> = {
  love: { styles: ["vines", "florals", "deco-fan", "arch-window", "petals", "hearts", "vellum", "scallop-frame", "blobs", "laurel", "ribbon-corner", "motif-wallpaper", "celestial", "terrazzo"], moods: ["pastel", "jewel", "calm", "earthy", "mono", "night"] },
  baby: { styles: ["balloons", "rainbow", "celestial", "polka", "blobs", "petals", "bunting", "scallop-frame", "constellation", "motif-wallpaper", "confetti", "waves", "vellum", "sprinkles"], moods: ["pastel", "fresh", "calm"] },
  party: { styles: ["confetti", "balloons", "bunting", "sunburst", "rainbow", "memphis", "blobs", "sprinkles", "lanterns", "polka", "zigzag", "fireworks", "awning", "halftone", "terrazzo", "motif-wallpaper"], moods: ["bold", "festive", "pastel", "fresh", "night"] },
  kids: { styles: ["balloons", "confetti", "bunting", "rainbow", "polka", "memphis", "sprinkles", "zigzag", "gingham", "blobs", "constellation", "awning", "motif-wallpaper", "sunburst"], moods: ["bold", "pastel", "fresh"] },
  work: { styles: ["blueprint", "bauhaus", "halftone", "network", "mosaic", "zigzag", "brushstrokes", "postage", "sunburst", "memphis", "vellum", "skyline", "banner", "motif-wallpaper"], moods: ["mono", "bold", "jewel", "night", "calm"] },
  culture: { styles: ["soundwave", "brushstrokes", "bauhaus", "halftone", "memphis", "mosaic", "terrazzo", "fireworks", "lanterns", "postage", "sunburst", "blobs", "zigzag", "motif-wallpaper"], moods: ["bold", "night", "mono", "fresh", "jewel"] },
  travel: { styles: ["mountains", "waves", "postage", "sunburst", "constellation", "polaroids", "blueprint", "skyline", "awning", "motif-wallpaper", "halftone", "celestial", "zigzag"], moods: ["fresh", "earthy", "calm", "night", "bold"] },
  calm: { styles: ["candlelight", "arch-window", "vines", "vellum", "celestial", "waves", "laurel", "petals", "scallop-frame", "constellation", "motif-wallpaper", "mountains"], moods: ["calm", "mono", "earthy", "night"] },
  winter: { styles: ["snowflakes", "baubles", "constellation", "lanterns", "confetti", "deco-fan", "motif-wallpaper", "gingham", "scallop-frame", "fireworks", "vines", "polka", "bunting"], moods: ["festive", "night", "jewel", "calm"] },
  mixed: { styles: ["confetti", "bunting", "sunburst", "rainbow", "memphis", "bauhaus", "terrazzo", "blobs", "vines", "florals", "deco-fan", "constellation", "waves", "mountains", "postage", "halftone", "awning", "hearts", "motif-wallpaper", "brushstrokes", "mosaic", "celestial", "lanterns", "polka", "fireworks", "vellum", "scallop-frame", "arch-window", "ribbon-corner", "petals", "zigzag"], moods: ["pastel", "bold", "earthy", "jewel", "mono", "night", "festive", "calm", "fresh"] },
  gala: { styles: ["deco-fan", "constellation", "fireworks", "laurel", "vellum", "banner", "arch-window", "celestial", "halftone", "ribbon-corner", "terrazzo", "motif-wallpaper", "scallop-frame"], moods: ["night", "jewel", "mono", "festive"] },
};

const KIND_FAMILY: Record<string, string> = {
  nunta: "love", logodna: "love", reinnoire_juraminte: "love", petrecere_mireasa: "love",
  botez: "baby", petrecere_bebelus: "baby", dezvaluire_sex_bebelus: "baby",
  aniversare: "party", zi_de_nastere: "party", absolvire: "party", pensionare: "party", reuniune: "party", inaugurare_casa: "party", cina: "party", picnic: "party",
  zi_de_nastere_copii: "kids",
  revelion: "gala", gala_caritabila: "gala", festivitate_premii: "gala",
  petrecere_craciun: "winter",
  conferinta: "work", lansare: "work", eveniment_networking: "work", atelier: "work",
  concert: "culture", expozitie: "culture", festival: "culture", turneu_sportiv: "culture",
  voiaj_solo: "travel", voiaj_grup: "travel",
  comemorare: "calm",
  blank: "mixed",
};

/** Styles a kind gets on top of its family's (they come first). */
const KIND_SPECIALS: Partial<Record<string, TemplateStyle[]>> = {
  picnic: ["gingham", "awning", "petals"], cina: ["lanterns", "vellum", "arch-window"], inaugurare_casa: ["skyline", "awning"],
  absolvire: ["banner", "laurel"], pensionare: ["waves", "mountains", "sunburst"], reuniune: ["polaroids", "postage"],
  turneu_sportiv: ["pitch", "laurel", "banner"], concert: ["soundwave", "fireworks"], expozitie: ["brushstrokes", "terrazzo"],
  festival: ["lanterns", "bunting", "fireworks"], revelion: ["fireworks", "constellation"], festivitate_premii: ["laurel", "banner"],
  eveniment_networking: ["network"], lansare: ["halftone", "sunburst"], atelier: ["brushstrokes", "blueprint"],
  petrecere_mireasa: ["blobs", "petals"], dezvaluire_sex_bebelus: ["balloons", "confetti"],
};

/* ── Templates ─────────────────────────────────────────────────────────── */

export type TemplateSpec = {
  key: string;
  kind: string;
  style: TemplateStyle;
  /** The palette it opens on, then two alternatives. */
  palettes: [string, string, string];
  seed: number;
  layout: Layout;
};

export const TEMPLATES_PER_KIND = 52;

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const VOICES: Layout["voice"][] = ["roman", "italic", "caps", "sans"];

/** The fixed set of templates of one occasion kind (the same every time). */
function templatesFor(kind: string): TemplateSpec[] {
  const family = FAMILY[KIND_FAMILY[kind] ?? "party"]!;
  const specials = KIND_SPECIALS[kind] ?? [];
  const styles = [...new Set([...specials, ...family.styles])];
  const palettes = Object.keys(TEMPLATE_PALETTES).filter((p) => family.moods.includes(TEMPLATE_PALETTES[p]!.mood));
  const rnd = rngOf(hash(kind));
  const out: TemplateSpec[] = [];
  const used = new Set<string>();
  let i = 0;
  while (out.length < TEMPLATES_PER_KIND) {
    const style = styles[i % styles.length]!;
    // walk the palettes so neighbouring templates differ; skip a style/palette pair already used
    let tries = 0;
    let p = palettes[Math.floor(rnd() * palettes.length)]!;
    while (used.has(`${style}|${p}`) && tries < 40) {
      p = palettes[Math.floor(rnd() * palettes.length)]!;
      tries += 1;
    }
    used.add(`${style}|${p}`);
    const alts = palettes.filter((x) => x !== p);
    const a1 = alts[Math.floor(rnd() * alts.length)]!;
    const a2 = alts.filter((x) => x !== a1)[Math.floor(rnd() * (alts.length - 1))]!;
    const n = String(out.length + 1).padStart(2, "0");
    out.push({
      key: `t.${kind}.${n}`,
      kind,
      style,
      palettes: [p, a1, a2],
      seed: hash(`${kind}:${n}`),
      layout: { align: rnd() < 0.72 ? "center" : "left", voice: VOICES[Math.floor(rnd() * VOICES.length)]! },
    });
    i += 1;
  }
  return out;
}

const cache = new Map<string, TemplateSpec[]>();
/** The templates of an occasion kind (52 per kind). */
export function occasionTemplates(kind: string): TemplateSpec[] {
  if (!cache.has(kind)) cache.set(kind, templatesFor(kind));
  return cache.get(kind)!;
}

/* ── Drawing ───────────────────────────────────────────────────────────── */

/** One drawn shape, in sheet points, with its bounding box (the legibility test reads it). */
export type ArtNode = { d: string; paint: "fill" | "stroke"; color: string; sw: number; box: [number, number, number, number]; plate?: boolean; /** an outline around the text: only its line counts */ frame?: boolean };

/** What a style hands back: where the text goes, as fractions of the sheet [left, right, top, bottom]. */
export type ArtResult = { box: [number, number, number, number]; align?: "center" | "left"; valign?: "top" | "bottom" };

const f = (n: number) => Math.round(n * 100) / 100;

class Pen {
  nodes: ArtNode[] = [];
  constructor(
    readonly W: number,
    readonly H: number,
    readonly pal: TemplatePalette,
    readonly rnd: () => number,
    readonly motif: string,
  ) {}
  /** Points per pixel of a 400-pixel reference card (short side). */
  get k() {
    return Math.min(this.W, this.H) / 400;
  }
  /** Bleed allowance: fills touching an edge run past it. */
  get E() {
    return 12;
  }
  r(a: number, b: number) {
    return a + this.rnd() * (b - a);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)]!;
  }
  art() {
    return this.pick([this.pal.a1, this.pal.a2, this.pal.a3]);
  }
  push(d: string, paint: "fill" | "stroke", color: string, box: [number, number, number, number], sw = 0, plate = false) {
    const pad = sw / 2;
    this.nodes.push({ d, paint, color, sw, box: [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], plate: plate || undefined });
  }
  /** A thin outline rectangle around the text area (the text must sit inside it). */
  frame(x: number, y: number, w: number, h: number, color: string, sw: number) {
    this.nodes.push({ d: `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`, paint: "stroke", color, sw, box: [x, y, x + w, y + h], frame: true });
  }
  rect(x: number, y: number, w: number, h: number, color: string, paint: "fill" | "stroke" = "fill", sw = 0) {
    this.push(`M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`, paint, color, [x, y, x + w, y + h], sw);
  }
  circle(cx: number, cy: number, r: number, color: string, paint: "fill" | "stroke" = "fill", sw = 0) {
    this.push(`M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`, paint, color, [cx - r, cy - r, cx + r, cy + r], sw);
  }
  poly(pts: Array<[number, number]>, color: string, paint: "fill" | "stroke" = "fill", sw = 0, closed = true) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    this.push(`M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join("L")}${closed ? "Z" : ""}`, paint, color, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], sw);
  }
  line(x1: number, y1: number, x2: number, y2: number, color: string, sw: number) {
    this.poly([[x1, y1], [x2, y2]], color, "stroke", sw, false);
  }
  /** A smooth closed blob around (cx, cy). */
  blob(cx: number, cy: number, r: number, color: string, lobes = 7) {
    const pts = Array.from({ length: lobes }, (_, i) => {
      const a = (i / lobes) * Math.PI * 2;
      const rr = r * this.r(0.72, 1.12);
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as [number, number];
    });
    let d = "";
    for (let i = 0; i < lobes; i += 1) {
      const p0 = pts[i]!;
      const p1 = pts[(i + 1) % lobes]!;
      const mx = (p0[0] + p1[0]) / 2;
      const my = (p0[1] + p1[1]) / 2;
      if (i === 0) {
        const pl = pts[lobes - 1]!;
        d += `M${f((pl[0] + p0[0]) / 2)} ${f((pl[1] + p0[1]) / 2)}`;
      }
      d += `Q${f(p0[0])} ${f(p0[1])} ${f(mx)} ${f(my)}`;
    }
    this.push(`${d}Z`, "fill", color, [cx - r * 1.12, cy - r * 1.12, cx + r * 1.12, cy + r * 1.12]);
  }
  /** A wavy line from x1 to x2 at height y. */
  wave(x1: number, x2: number, y: number, amp: number, period: number, color: string, sw: number) {
    let d = `M${f(x1)} ${f(y)}`;
    for (let x = x1; x < x2; x += period) d += `Q${f(x + period / 4)} ${f(y - amp)} ${f(x + period / 2)} ${f(y)}T${f(x + period)} ${f(y)}`;
    this.push(d, "stroke", color, [x1, y - amp, x2 + period, y + amp], sw);
  }
  star(cx: number, cy: number, r: number, color: string, points = 5, inner = 0.45) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < points * 2; i += 1) {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * inner;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    this.poly(pts, color);
  }
  heart(cx: number, cy: number, s: number, color: string) {
    this.push(
      `M${f(cx)} ${f(cy + s * 0.9)}C${f(cx - s * 1.3)} ${f(cy + s * 0.1)} ${f(cx - s * 0.8)} ${f(cy - s * 0.9)} ${f(cx)} ${f(cy - s * 0.35)}C${f(cx + s * 0.8)} ${f(cy - s * 0.9)} ${f(cx + s * 1.3)} ${f(cy + s * 0.1)} ${f(cx)} ${f(cy + s * 0.9)}Z`,
      "fill",
      color,
      [cx - s * 1.1, cy - s * 0.8, cx + s * 1.1, cy + s * 0.9],
    );
  }
  leaf(x: number, y: number, len: number, ang: number, w: number, color: string) {
    const tx = x + Math.cos(ang) * len;
    const ty = y + Math.sin(ang) * len;
    const nx = -Math.sin(ang) * w;
    const ny = Math.cos(ang) * w;
    const mx = (x + tx) / 2;
    const my = (y + ty) / 2;
    this.push(`M${f(x)} ${f(y)}Q${f(mx + nx)} ${f(my + ny)} ${f(tx)} ${f(ty)}Q${f(mx - nx)} ${f(my - ny)} ${f(x)} ${f(y)}Z`, "fill", color, [Math.min(x, tx) - w, Math.min(y, ty) - w, Math.max(x, tx) + w, Math.max(y, ty) + w]);
  }
  flower(cx: number, cy: number, r: number, petal: string, centre: string, petals = 6) {
    for (let i = 0; i < petals; i += 1) {
      const a = (i / petals) * Math.PI * 2;
      this.circle(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, petal);
    }
    this.circle(cx, cy, r * 0.32, centre);
  }
  /** The occasion motif (80 × 64 line drawing) scaled into a box. */
  motifAt(x: number, y: number, w: number, color: string, sw: number) {
    const s = w / 80;
    this.push(scalePath(this.motif, s, x, y), "stroke", color, [x, y, x + w, y + 64 * s], sw);
  }
  /** A plain paper plate behind the text (optionally edged), so artwork may run under it. */
  plate(x: number, y: number, w: number, h: number, radius: number, edge?: string) {
    const r = Math.min(radius, w / 2, h / 2);
    const d =
      r > 0
        ? `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`
        : `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
    this.push(d, "fill", this.pal.paper, [x, y, x + w, y + h], 0, true);
    if (edge) this.push(d, "stroke", edge, [x, y, x + w, y + h], 1.2 * this.k, true);
  }
}

/** Scales and moves simple path data (the motifs use M/L/H/V/C/S/Q/T/A/Z, absolute or relative). */
function scalePath(d: string, s: number, tx: number, ty: number): string {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const out: string[] = [];
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const num = () => parseFloat(tokens[i++] ?? "0");
  const X = (x: number) => f(x * s + tx);
  const Y = (y: number) => f(y * s + ty);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i]!)) cmd = tokens[i++]!;
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    const pair = () => [num() + ox, num() + oy] as const;
    switch (cmd.toUpperCase()) {
      case "M": {
        const [x, y] = pair();
        cx = sx = x;
        cy = sy = y;
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
        out.push(`A${f(rx * s)} ${f(ry * s)} ${rot} ${large} ${sweep} ${X(x)} ${Y(y)}`);
        cx = x;
        cy = y;
        break;
      }
      case "Z":
        out.push("Z");
        cx = sx;
        cy = sy;
        break;
      default:
        i += 1;
    }
  }
  return out.join("");
}

/** Positions for scattered marks: the top and bottom bands, clear of a central text area. */
function bands(g: Pen, n: number, topFrac: number, bottomFrac: number, pad = 0): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const top = i % 2 === 0;
    const y = top ? g.r(pad, g.H * topFrac - pad) : g.r(g.H * (1 - bottomFrac) + pad, g.H - pad);
    pts.push([g.r(0, g.W), y]);
  }
  return pts;
}

type StyleFn = (g: Pen) => ArtResult;

const STYLES: Record<TemplateStyle, StyleFn> = {
  confetti(g) {
    const { k } = g;
    const t = 0.2;
    for (const [x, y] of bands(g, 70, t, t, 4 * k)) {
      const c = g.art();
      const kind = g.pick(["dot", "rect", "tri", "squig"]);
      const s = g.r(3, 8) * k;
      if (kind === "dot") g.circle(x, y, s * 0.6, c);
      else if (kind === "rect") {
        const a = g.r(0, Math.PI);
        const dx = Math.cos(a) * s;
        const dy = Math.sin(a) * s;
        g.poly([[x - dx, y - dy], [x + dx, y + dy], [x + dx - dy * 0.35, y + dy + dx * 0.35], [x - dx - dy * 0.35, y - dy + dx * 0.35]], c);
      } else if (kind === "tri") g.poly([[x, y - s], [x + s, y + s * 0.7], [x - s, y + s * 0.7]], c);
      else g.wave(x - s * 1.5, x + s * 1.5, y, s * 0.4, s, c, 1.4 * k);
    }
    return { box: [0.1, 0.1, t + 0.04, t + 0.04] };
  },
  balloons(g) {
    const { W, H, k } = g;
    const left = g.rnd() < 0.5;
    const n = 5 + Math.floor(g.r(0, 3));
    const baseX = left ? W * 0.16 : W * 0.84;
    for (let i = 0; i < n; i += 1) {
      const cx = baseX + g.r(-W * 0.12, W * 0.12);
      const cy = g.r(40 * k, 78 * k);
      const rx = g.r(20, 30) * k;
      const c = g.art();
      g.push(
        `M${f(cx)} ${f(cy - rx * 1.2)}C${f(cx + rx * 1.1)} ${f(cy - rx * 1.2)} ${f(cx + rx * 1.1)} ${f(cy + rx * 0.6)} ${f(cx)} ${f(cy + rx * 1.15)}C${f(cx - rx * 1.1)} ${f(cy + rx * 0.6)} ${f(cx - rx * 1.1)} ${f(cy - rx * 1.2)} ${f(cx)} ${f(cy - rx * 1.2)}Z`,
        "fill",
        c,
        [cx - rx * 1.1, cy - rx * 1.2, cx + rx * 1.1, cy + rx * 1.15],
      );
      g.poly([[cx, cy + rx * 1.12], [cx - 3 * k, cy + rx * 1.3], [cx + 3 * k, cy + rx * 1.3]], c);
      const sy = cy + rx * 1.3;
      const ey = 128 * k;
      g.push(`M${f(cx)} ${f(sy)}Q${f(cx + 10 * k)} ${f((sy + ey) / 2)} ${f(baseX)} ${f(ey)}`, "stroke", g.pal.ink, [Math.min(cx, baseX) - 10 * k, sy, Math.max(cx, baseX) + 10 * k, ey], 0.6 * k);
    }
    for (let i = 0; i < 4; i += 1) g.circle(g.r(0, W), H - g.r(10, 22) * k, g.r(3, 7) * k, g.art());
    return { box: [0.1, 0.1, (146 * k) / H, (40 * k) / H] };
  },
  bunting(g) {
    const { W, H, k } = g;
    const rows = g.rnd() < 0.5 ? 1 : 2;
    for (let r = 0; r < rows; r += 1) {
      const y0 = (18 + r * 46) * k;
      const sag = 26 * k;
      const n = 9;
      g.push(`M${f(-10)} ${f(y0)}Q${f(W / 2)} ${f(y0 + sag * 2)} ${f(W + 10)} ${f(y0)}`, "stroke", g.pal.ink, [-10, y0, W + 10, y0 + sag], 0.8 * k);
      for (let i = 0; i < n; i += 1) {
        const t = (i + 0.5) / n;
        const x = W * t;
        const y = y0 + sag * 4 * t * (1 - t) * 1;
        const w = W / n / 2.4;
        g.poly([[x - w, y], [x + w, y], [x, y + w * 1.8]], g.art());
      }
    }
    const t = (rows === 1 ? 90 : 136) * k / H + 0.04;
    return { box: [0.1, 0.1, t, 0.1] };
  },
  sunburst(g) {
    const { W, H, k } = g;
    const atTop = g.rnd() < 0.5;
    const cy = atTop ? -H * 0.05 : H * 1.05;
    const n = 24;
    for (let i = 0; i < n; i += 1) {
      if (i % 2) continue;
      const a1 = (i / n) * Math.PI * 2;
      const a2 = ((i + 1) / n) * Math.PI * 2;
      const R = Math.hypot(W, H) * 0.32;
      const pts: Array<[number, number]> = [[W / 2, cy], [W / 2 + Math.cos(a1) * R, cy + Math.sin(a1) * R], [W / 2 + Math.cos(a2) * R, cy + Math.sin(a2) * R]];
      g.poly(pts, g.pal.a3);
    }
    g.circle(W / 2, cy, 70 * k, g.pal.a1);
    const frac = (Math.hypot(W, H) * 0.32 - H * 0.05) / H + 0.03;
    return atTop ? { box: [0.1, 0.1, frac, 0.08] } : { box: [0.1, 0.1, 0.08, frac] };
  },
  rainbow(g) {
    const { W, H, k } = g;
    const right = g.rnd() < 0.5;
    const cx = right ? W : 0;
    const cy = H;
    const colours = [g.pal.a1, g.pal.a2, g.pal.a3, g.pal.a1];
    const band = 16 * k;
    let R = 150 * k;
    for (const c of colours) {
      g.push(`M${f(cx - R)} ${f(cy)}A${f(R)} ${f(R)} 0 0 1 ${f(cx + R)} ${f(cy)}`, "stroke", c, [cx - R, cy - R, cx + R, cy], band);
      R -= band * 1.05;
    }
    g.circle(right ? W * 0.2 : W * 0.8, H * 0.1, 26 * k, g.pal.a3);
    return { box: [0.12, 0.12, 0.18, (158 * k) / H + 0.03] };
  },
  memphis(g) {
    const { W, H, k } = g;
    // a full-bleed field of shapes, then a paper plate for the text
    for (let i = 0; i < 46; i += 1) {
      const x = g.r(0, W);
      const y = g.r(0, H);
      const c = g.art();
      const s = g.r(8, 18) * k;
      const t = g.pick(["tri", "ring", "squig", "zig", "dot"]);
      if (t === "tri") g.poly([[x, y - s], [x + s, y + s], [x - s, y + s]], c, "stroke", 2 * k);
      else if (t === "ring") g.circle(x, y, s * 0.7, c, "stroke", 2.2 * k);
      else if (t === "squig") g.wave(x - s * 2, x + s * 2, y, s * 0.5, s * 1.4, c, 2.2 * k);
      else if (t === "zig") g.poly([[x - s * 2, y], [x - s, y - s * 0.7], [x, y], [x + s, y - s * 0.7], [x + s * 2, y]], c, "stroke", 2.2 * k, false);
      else g.circle(x, y, s * 0.35, g.pal.ink);
    }
    const m = 0.13;
    g.plate(W * m, H * m, W * (1 - 2 * m), H * (1 - 2 * m), 4 * k, g.pal.ink);
    return { box: [m + 0.07, m + 0.07, m + 0.05, m + 0.05] };
  },
  bauhaus(g) {
    const { W, H, k } = g;
    const top = g.rnd() < 0.5;
    const bandH = H * 0.3;
    const y0 = top ? 0 : H - bandH;
    const cols = 4;
    const cw = W / cols;
    for (let i = 0; i < cols; i += 1) {
      const x = i * cw;
      const c = [g.pal.a1, g.pal.a2, g.pal.a3, g.pal.ink][(i + Math.floor(g.r(0, 4))) % 4]!;
      const kind = g.pick(["half", "circle", "quarter", "tri", "bar"]);
      const cy = y0 + bandH / 2;
      if (kind === "half") g.push(`M${f(x)} ${f(cy)}A${f(cw / 2)} ${f(cw / 2)} 0 0 1 ${f(x + cw)} ${f(cy)}Z`, "fill", c, [x, cy - cw / 2, x + cw, cy]);
      else if (kind === "circle") g.circle(x + cw / 2, cy, Math.min(cw, bandH) * 0.42, c);
      else if (kind === "quarter") g.push(`M${f(x)} ${f(y0 + bandH)}V${f(y0 + bandH - cw)}A${f(cw)} ${f(cw)} 0 0 1 ${f(x + cw)} ${f(y0 + bandH)}Z`, "fill", c, [x, y0 + bandH - cw, x + cw, y0 + bandH]);
      else if (kind === "tri") g.poly([[x, y0 + bandH * 0.9], [x + cw, y0 + bandH * 0.9], [x + cw / 2, y0 + bandH * 0.15]], c);
      else g.rect(x + cw * 0.3, y0 + bandH * 0.1, cw * 0.4, bandH * 0.8, c);
    }
    g.rect(0, top ? bandH - 3 * k : y0, W, 3 * k, g.pal.ink);
    return top ? { box: [0.1, 0.1, 0.36, 0.08], align: "left" } : { box: [0.1, 0.1, 0.08, 0.36], align: "left" };
  },
  terrazzo(g) {
    const { W, H, k } = g;
    for (let i = 0; i < 90; i += 1) {
      const x = g.r(-10, W + 10);
      const y = g.r(-10, H + 10);
      const r = g.r(3, 11) * k;
      const pts: Array<[number, number]> = Array.from({ length: 5 }, (_, j) => {
        const a = (j / 5) * Math.PI * 2 + g.r(-0.4, 0.4);
        const rr = r * g.r(0.6, 1.2);
        return [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
      });
      g.poly(pts, g.art());
    }
    const m = 0.11;
    g.plate(W * m, H * m, W * (1 - 2 * m), H * (1 - 2 * m), 0);
    return { box: [m + 0.06, m + 0.06, m + 0.05, m + 0.05] };
  },
  blobs(g) {
    const { W, H, k } = g;
    const corners: Array<[number, number]> = [[0, 0], [W, 0], [0, H], [W, H]];
    for (const [cx, cy] of corners) {
      for (let j = 0; j < 3; j += 1) g.blob(cx + g.r(-30, 30) * k, cy + g.r(-30, 30) * k, g.r(50, 80) * k, g.art());
    }
    return { box: [0.15, 0.15, (128 * k) / H, (128 * k) / H] };
  },
  vines(g) {
    const { W, H, k } = g;
    for (const side of [0, 1]) {
      const x0 = side ? W - 26 * k : 26 * k;
      let d = `M${f(x0)} ${f(H * 0.06)}`;
      const pts: Array<[number, number]> = [];
      for (let y = H * 0.06; y <= H * 0.94; y += 40 * k) {
        const x = x0 + Math.sin(y / (40 * k)) * 10 * k;
        d += `L${f(x)} ${f(y)}`;
        pts.push([x, y]);
      }
      g.push(d, "stroke", g.pal.a2, [x0 - 12 * k, H * 0.06, x0 + 12 * k, H * 0.94], 1.2 * k);
      pts.forEach(([x, y], i) => {
        const dir = i % 2 ? 1 : -1;
        g.leaf(x, y, 18 * k, (dir > 0 ? -0.6 : Math.PI + 0.6) + (side ? 0 : 0), 6 * k, i % 3 ? g.pal.a1 : g.pal.a2);
        if (i % 4 === 2) g.flower(x + dir * 12 * k, y - 8 * k, 7 * k, g.pal.a3, g.pal.a1, 5);
      });
    }
    return { box: [0.2, 0.2, 0.1, 0.1] };
  },
  florals(g) {
    const { W, H, k } = g;
    const corners: Array<[number, number, number]> = g.rnd() < 0.5 ? [[0, 0, 0], [W, H, Math.PI]] : [[W, 0, Math.PI / 2], [0, H, -Math.PI / 2]];
    for (const [cx, cy, rot] of corners) {
      for (let i = 0; i < 9; i += 1) {
        const a = rot + g.r(0, Math.PI / 2);
        const dist = g.r(20, 110) * k;
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist;
        if (i % 3 === 0) g.flower(x, y, g.r(14, 24) * k, g.pal.a1, g.pal.a3, g.pick([5, 6, 8]));
        else g.leaf(x, y, g.r(22, 38) * k, g.r(0, Math.PI * 2), g.r(6, 10) * k, g.pal.a2);
      }
    }
    return { box: [0.13, 0.13, (146 * k) / H, (146 * k) / H] };
  },
  "deco-fan"(g) {
    const { W, H, k } = g;
    const R = 92 * k;
    for (const [cx, cy, a0] of [[0, 0, 0], [W, 0, Math.PI / 2], [W, H, Math.PI], [0, H, Math.PI * 1.5]] as Array<[number, number, number]>) {
      for (let i = 0; i <= 6; i += 1) {
        const a = a0 + (i / 6) * (Math.PI / 2);
        g.line(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, g.pal.a1, 1.2 * k);
      }
      for (const rr of [R, R * 0.7, R * 0.4]) {
        const sx = cx + Math.cos(a0) * rr;
        const sy = cy + Math.sin(a0) * rr;
        const ex = cx + Math.cos(a0 + Math.PI / 2) * rr;
        const ey = cy + Math.sin(a0 + Math.PI / 2) * rr;
        g.push(`M${f(sx)} ${f(sy)}A${f(rr)} ${f(rr)} 0 0 1 ${f(ex)} ${f(ey)}`, "stroke", g.pal.a1, [cx - rr, cy - rr, cx + rr, cy + rr], 1.4 * k);
      }
    }
    const m = 14 * k;
    g.frame(m, m, W - 2 * m, H - 2 * m, g.pal.a1, 1 * k);
    g.frame(m + 5 * k, m + 5 * k, W - 2 * m - 10 * k, H - 2 * m - 10 * k, g.pal.a1, 0.6 * k);
    return { box: [0.16, 0.16, (R + 20 * k) / H, (R + 20 * k) / H] };
  },
  constellation(g) {
    const { W, H, k } = g;
    for (const band of [0, 1]) {
      const pts: Array<[number, number]> = Array.from({ length: 7 }, () => [g.r(W * 0.05, W * 0.95), band ? g.r(H * 0.8, H * 0.95) : g.r(H * 0.04, H * 0.18)]);
      pts.sort((a, b) => a[0] - b[0]);
      g.poly(pts, g.pal.a2, "stroke", 0.7 * k, false);
      for (const [x, y] of pts) g.star(x, y, g.r(4, 8) * k, g.pal.a1, 4, 0.35);
    }
    for (let i = 0; i < 40; i += 1) {
      const top = i % 2 === 0;
      g.circle(g.r(0, W), top ? g.r(0, H * 0.2) : g.r(H * 0.78, H), g.r(0.6, 1.6) * k, g.pal.a3);
    }
    return { box: [0.1, 0.1, 0.23, 0.25] };
  },
  snowflakes(g) {
    const { k } = g;
    for (const [x, y] of bands(g, 22, 0.2, 0.18, 10 * k)) {
      const r = g.r(7, 16) * k;
      const c = g.pick([g.pal.a2, g.pal.a3, g.pal.a1]);
      let d = "";
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const ex = x + Math.cos(a) * r;
        const ey = y + Math.sin(a) * r;
        d += `M${f(x)} ${f(y)}L${f(ex)} ${f(ey)}`;
        const bx = x + Math.cos(a) * r * 0.6;
        const by = y + Math.sin(a) * r * 0.6;
        for (const s of [-1, 1]) d += `M${f(bx)} ${f(by)}L${f(bx + Math.cos(a + s * 0.7) * r * 0.35)} ${f(by + Math.sin(a + s * 0.7) * r * 0.35)}`;
      }
      g.push(d, "stroke", c, [x - r, y - r, x + r, y + r], 1.1 * k);
    }
    return { box: [0.1, 0.1, 0.24, 0.22] };
  },
  baubles(g) {
    const { W, k } = g;
    const n = 6;
    let maxY = 0;
    for (let i = 0; i < n; i += 1) {
      const x = W * ((i + 0.5) / n) + g.r(-8, 8) * k;
      const len = g.r(30, 95) * k;
      const r = g.r(12, 20) * k;
      g.line(x, -5, x, len, g.pal.ink, 0.6 * k);
      g.rect(x - 4 * k, len - 2 * k, 8 * k, 6 * k, g.pal.a3);
      g.circle(x, len + r + 3 * k, r, g.art());
      g.wave(x - r * 0.8, x + r * 0.6, len + r + 3 * k, 2.5 * k, 6 * k, g.pal.paper, 1.2 * k);
      maxY = Math.max(maxY, len + 2 * r + 3 * k);
    }
    return { box: [0.1, 0.1, maxY / g.H + 0.05, 0.1] };
  },
  waves(g) {
    const { W, H, k } = g;
    const layers = 4;
    for (let i = 0; i < layers; i += 1) {
      const y = H - (70 - i * 15) * k;
      const amp = g.r(6, 12) * k;
      const per = g.r(70, 110) * k;
      let d = `M${f(-12)} ${f(H + 12)}L${f(-12)} ${f(y)}`;
      for (let x = -12; x < W + per; x += per) d += `Q${f(x + per / 4)} ${f(y - amp)} ${f(x + per / 2)} ${f(y)}T${f(x + per)} ${f(y)}`;
      d += `L${f(W + 12)} ${f(H + 12)}Z`;
      g.push(d, "fill", [g.pal.a3, g.pal.a2, g.pal.a1, g.pal.a2][i]!, [-12, y - amp, W + 12, H + 12]);
    }
    g.circle(W * g.r(0.2, 0.8), H * 0.1, 22 * k, g.pal.a3);
    return { box: [0.1, 0.1, 0.18, (80 * k) / H + 0.04] };
  },
  mountains(g) {
    const { W, H, k } = g;
    const base = H;
    for (let layer = 0; layer < 3; layer += 1) {
      const peaks = 3 + layer;
      const pts: Array<[number, number]> = [[-12, base + 12]];
      for (let i = 0; i <= peaks * 2; i += 1) {
        const x = (i / (peaks * 2)) * (W + 24) - 12;
        const y = i % 2 ? base - g.r(70, 130) * k + layer * 22 * k : base - g.r(20, 45) * k + layer * 18 * k;
        pts.push([x, y]);
      }
      pts.push([W + 12, base + 12]);
      g.poly(pts, [g.pal.a3, g.pal.a2, g.pal.a1][layer]!);
    }
    g.circle(W * 0.75, H * 0.12, 18 * k, g.pal.a3);
    return { box: [0.1, 0.1, 0.2, (140 * k) / H + 0.04] };
  },
  postage(g) {
    const { W, H, k } = g;
    // a perforated stamp edge around the sheet
    const r = 4.5 * k;
    g.rect(-12, -12, W + 24, H + 24, g.pal.a1);
    g.plate(10 * k, 10 * k, W - 20 * k, H - 20 * k, 0);
    for (let x = 10 * k; x <= W - 10 * k; x += r * 3) {
      g.circle(x, 10 * k, r, g.pal.a1);
      g.circle(x, H - 10 * k, r, g.pal.a1);
    }
    for (let y = 10 * k; y <= H - 10 * k; y += r * 3) {
      g.circle(10 * k, y, r, g.pal.a1);
      g.circle(W - 10 * k, y, r, g.pal.a1);
    }
    g.frame(24 * k, 24 * k, W - 48 * k, H - 48 * k, g.pal.a2, 1.2 * k);
    g.motifAt(W - 92 * k, 36 * k, 54 * k, g.pal.a2, 1.4 * k);
    g.wave(36 * k, 110 * k, 50 * k, 4 * k, 18 * k, g.pal.a2, 1 * k);
    g.wave(36 * k, 110 * k, 60 * k, 4 * k, 18 * k, g.pal.a2, 1 * k);
    return { box: [0.12, 0.12, (100 * k) / H, 0.1] };
  },
  polaroids(g) {
    const { W, H, k } = g;
    for (let i = 0; i < 3; i += 1) {
      const w = 82 * k;
      const x = W * (0.12 + i * 0.28) + g.r(-6, 6) * k;
      const y = H * 0.04 + g.r(0, 10) * k;
      g.rect(x, y, w, w * 1.15, g.pal.a3);
      g.rect(x + 6 * k, y + 6 * k, w - 12 * k, w * 0.85, g.art());
      g.motifAt(x + w * 0.25, y + w * 0.2, w * 0.5, g.pal.paper, 1.3 * k);
    }
    return { box: [0.1, 0.1, (100 * k) / H + 0.08, 0.1] };
  },
  blueprint(g) {
    const { W, H, k } = g;
    g.rect(-12, -12, W + 24, H + 24, g.pal.a1);
    const step = 18 * k;
    for (let x = 0; x < W; x += step) g.line(x, -12, x, H + 12, g.pal.a2, 0.4 * k);
    for (let y = 0; y < H; y += step) g.line(-12, y, W + 12, y, g.pal.a2, 0.4 * k);
    const m = 0.1;
    g.plate(W * m, H * 0.16, W * (1 - 2 * m), H * 0.7, 0, g.pal.ink);
    g.line(W * m, H * 0.1, W * (1 - m), H * 0.1, g.pal.a3, 1.2 * k);
    g.line(W * m, H * 0.09, W * m, H * 0.11, g.pal.a3, 1.2 * k);
    g.line(W * (1 - m), H * 0.09, W * (1 - m), H * 0.11, g.pal.a3, 1.2 * k);
    g.circle(W * 0.9, H * 0.93, 10 * k, g.pal.a3, "stroke", 1.2 * k);
    return { box: [m + 0.06, m + 0.06, 0.2, 0.18], align: "left" };
  },
  halftone(g) {
    const { W, H, k } = g;
    const top = g.rnd() < 0.5;
    const step = 11 * k;
    for (let y = 0; y < H * 0.3; y += step) {
      for (let x = (y / step) % 2 ? step / 2 : 0; x < W + step; x += step) {
        const t = 1 - y / (H * 0.3);
        const r = step * 0.48 * t;
        if (r < 0.5) continue;
        g.circle(x, top ? y : H - y, r, g.pal.a1);
      }
    }
    return top ? { box: [0.1, 0.1, 0.3, 0.08] } : { box: [0.1, 0.1, 0.08, 0.3] };
  },
  awning(g) {
    const { W, k } = g;
    const n = 8;
    const h = 52 * k;
    for (let i = 0; i < n; i += 1) {
      const x = (W / n) * i;
      const c = i % 2 ? g.pal.paper : g.pal.a1;
      g.rect(x, -12, W / n, h + 12, c);
      g.push(`M${f(x)} ${f(h)}A${f(W / n / 2)} ${f(W / n / 2)} 0 0 0 ${f(x + W / n)} ${f(h)}Z`, "fill", i % 2 ? g.pal.a2 : g.pal.a1, [x, h, x + W / n, h + W / n / 2]);
    }
    return { box: [0.1, 0.1, (h + W / n / 2 + 20 * k) / g.H, 0.1] };
  },
  gingham(g) {
    const { W, H, k } = g;
    const s = 16 * k;
    const band = 44 * k;
    for (const y0 of [0, H - band]) {
      for (let x = 0; x < W + s; x += s) g.rect(x, y0 - (y0 ? 0 : 12), s / 2, band + 12, g.pal.a1 + "");
      for (let y = y0; y < y0 + band; y += s) g.rect(-12, y, W + 24, s / 2, g.pal.a2);
    }
    return { box: [0.1, 0.1, (band + 18 * k) / H, (band + 18 * k) / H] };
  },
  hearts(g) {
    for (const [x, y] of bands(g, 26, 0.18, 0.16, 8 * g.k)) g.heart(x, y, g.r(5, 12) * g.k, g.art());
    return { box: [0.1, 0.1, 0.22, 0.2] };
  },
  "motif-wallpaper"(g) {
    const { W, H, k } = g;
    const step = 64 * k;
    for (let y = 8 * k; y < H; y += step) {
      for (let x = ((y / step) % 2 ? step / 2 : 0) + 6 * k; x < W; x += step) g.motifAt(x, y, 38 * k, g.art(), 1.1 * k);
    }
    const m = 0.14;
    g.plate(W * m, H * m, W * (1 - 2 * m), H * (1 - 2 * m), 6 * k, g.pal.a1);
    return { box: [m + 0.07, m + 0.07, m + 0.05, m + 0.05] };
  },
  candlelight(g) {
    const { W, H, k } = g;
    const cx = W / 2;
    for (let i = 4; i >= 1; i -= 1) g.circle(cx, H * 0.14, i * 13 * k, i % 2 ? g.pal.a3 : g.pal.paper);
    g.rect(cx - 7 * k, H * 0.14, 14 * k, 44 * k, g.pal.a2);
    g.push(`M${f(cx)} ${f(H * 0.14 - 18 * k)}C${f(cx + 8 * k)} ${f(H * 0.14 - 6 * k)} ${f(cx + 5 * k)} ${f(H * 0.14)} ${f(cx)} ${f(H * 0.14)}C${f(cx - 5 * k)} ${f(H * 0.14)} ${f(cx - 8 * k)} ${f(H * 0.14 - 6 * k)} ${f(cx)} ${f(H * 0.14 - 18 * k)}Z`, "fill", g.pal.a1, [cx - 8 * k, H * 0.14 - 18 * k, cx + 8 * k, H * 0.14]);
    g.line(W * 0.3, H * 0.94, W * 0.7, H * 0.94, g.pal.a2, 0.8 * k);
    return { box: [0.12, 0.12, H * 0.14 / H + (60 * k) / H, 0.1] };
  },
  banner(g) {
    const { W, k } = g;
    const y = 30 * k;
    const h = 40 * k;
    g.poly([[W * 0.08, y + h * 0.3], [W * 0.18, y + h * 0.3], [W * 0.18, y + h * 1.3], [W * 0.08, y + h * 1.3], [W * 0.12, y + h * 0.8]], g.pal.a2);
    g.poly([[W * 0.92, y + h * 0.3], [W * 0.82, y + h * 0.3], [W * 0.82, y + h * 1.3], [W * 0.92, y + h * 1.3], [W * 0.88, y + h * 0.8]], g.pal.a2);
    g.rect(W * 0.15, y, W * 0.7, h, g.pal.a1);
    g.motifAt(W / 2 - 18 * k, y + 6 * k, 36 * k, g.pal.paper, 1.4 * k);
    for (let i = 0; i < 3; i += 1) g.star(W * (0.4 + i * 0.1), y + h * 1.8, 6 * k, g.pal.a3);
    return { box: [0.1, 0.1, (y + h * 2.2 + 10 * k) / g.H, 0.1] };
  },
  laurel(g) {
    // a laurel wreath under the text: two branches climbing the sides of a circle, a star on top
    const { W, H, k } = g;
    const R = 46 * k;
    const cx = W / 2;
    const cy = H - 74 * k;
    for (const side of [-1, 1]) {
      let d = "";
      for (let i = 0; i <= 10; i += 1) {
        const a = Math.PI / 2 + side * (0.3 + i * 0.205);
        const x = cx + Math.cos(a) * R;
        const y = cy + Math.sin(a) * R;
        d += `${i ? "L" : "M"}${f(x)} ${f(y)}`;
        const along = a + side * (Math.PI / 2);
        g.leaf(x, y, 14 * k, along - side * 0.55, 4.2 * k, i % 2 ? g.pal.a1 : g.pal.a2);
        if (i % 2 === 0) g.leaf(x, y, 12 * k, along + side * 0.75, 3.6 * k, g.pal.a2);
      }
      g.push(d, "stroke", g.pal.a1, [cx - R, cy - R, cx + R, cy + R], 1 * k);
    }
    g.star(cx, cy - R - 2 * k, 7 * k, g.pal.a3);
    g.line(W * 0.2, 22 * k, W * 0.8, 22 * k, g.pal.a1, 1 * k);
    return { box: [0.12, 0.12, (34 * k) / H + 0.04, (74 * k + R + 26 * k) / H] };
  },
  soundwave(g) {
    const { W, H, k } = g;
    const top = g.rnd() < 0.5;
    const cy = top ? 60 * k : H - 60 * k;
    const n = 48;
    for (let i = 0; i < n; i += 1) {
      const x = (W / n) * (i + 0.5);
      const h = (Math.abs(Math.sin(i * 0.5)) * 0.7 + g.r(0.1, 0.4)) * 44 * k;
      g.rect(x - 1.6 * k, cy - h, 3.2 * k, h * 2, i % 5 === 0 ? g.pal.a2 : g.pal.a1);
    }
    const frac = (124 * k) / H;
    return top ? { box: [0.1, 0.1, frac, 0.08] } : { box: [0.1, 0.1, 0.08, frac] };
  },
  brushstrokes(g) {
    const { W, H, k } = g;
    for (let i = 0; i < 6; i += 1) {
      const top = i < 3;
      const y = top ? g.r(28 * k, 56 * k) : H - g.r(46 * k, 70 * k);
      const x1 = g.r(-20, W * 0.4);
      const x2 = x1 + g.r(W * 0.4, W * 0.8);
      const t = g.r(12, 26) * k;
      g.push(`M${f(x1)} ${f(y)}C${f(x1 + (x2 - x1) * 0.3)} ${f(y - t)} ${f(x1 + (x2 - x1) * 0.7)} ${f(y + t)} ${f(x2)} ${f(y)}C${f(x1 + (x2 - x1) * 0.7)} ${f(y + t * 1.6)} ${f(x1 + (x2 - x1) * 0.3)} ${f(y + t * 0.3)} ${f(x1)} ${f(y)}Z`, "fill", g.art(), [x1, y - t, x2, y + t * 1.6]);
    }
    return { box: [0.1, 0.1, (112 * k) / H, (112 * k) / H] };
  },
  mosaic(g) {
    const { W, H, k } = g;
    const top = g.rnd() < 0.5;
    const s = 34 * k;
    const rows = 3;
    for (let r = 0; r < rows; r += 1) {
      for (let x = -s; x < W + s; x += s) {
        const y = top ? r * s : H - (r + 1) * s;
        const up = (Math.floor(x / s) + r) % 2 === 0;
        g.poly(up ? [[x, y + s], [x + s, y + s], [x + s / 2, y]] : [[x, y], [x + s, y], [x + s / 2, y + s]], g.art());
        g.poly(up ? [[x + s / 2, y], [x + s * 1.5, y], [x + s, y + s]] : [[x + s / 2, y + s], [x + s * 1.5, y + s], [x + s, y]], g.art());
      }
    }
    const frac = (rows * s + 16 * k) / H;
    return top ? { box: [0.1, 0.1, frac, 0.08] } : { box: [0.1, 0.1, 0.08, frac] };
  },
  celestial(g) {
    const { W, H, k } = g;
    const cx = W / 2;
    const cy = H * 0.13;
    g.circle(cx, cy, 30 * k, g.pal.a1);
    g.circle(cx + 12 * k, cy - 8 * k, 26 * k, g.pal.paper);
    for (let i = 0; i < 9; i += 1) {
      const a = Math.PI + (i / 8) * Math.PI;
      g.star(cx + Math.cos(a) * 70 * k, cy + 10 * k + Math.sin(a) * 50 * k, g.r(3, 6) * k, g.pal.a3, 4, 0.35);
    }
    g.push(`M${f(W * 0.06)} ${f(H * 0.95)}H${f(W * 0.94)}`, "stroke", g.pal.a2, [W * 0.06, H * 0.95, W * 0.94, H * 0.95], 1 * k);
    for (let i = 0; i < 5; i += 1) g.star(W * (0.2 + i * 0.15), H * 0.92, 3 * k, g.pal.a1, 4, 0.35);
    return { box: [0.12, 0.12, (cy + 58 * k) / H, 0.12] };
  },
  sprinkles(g) {
    for (const [x, y] of bands(g, 110, 0.17, 0.17, 3 * g.k)) {
      const a = g.r(0, Math.PI);
      const l = 5 * g.k;
      g.line(x - Math.cos(a) * l, y - Math.sin(a) * l, x + Math.cos(a) * l, y + Math.sin(a) * l, g.art(), 3 * g.k);
    }
    return { box: [0.1, 0.1, 0.21, 0.21] };
  },
  lanterns(g) {
    const { W, k } = g;
    const y0 = 16 * k;
    g.push(`M${f(-10)} ${f(y0)}Q${f(W / 2)} ${f(y0 + 50 * k)} ${f(W + 10)} ${f(y0)}`, "stroke", g.pal.ink, [-10, y0, W + 10, y0 + 25 * k], 0.7 * k);
    let maxY = 0;
    for (let i = 0; i < 7; i += 1) {
      const t = (i + 0.5) / 7;
      const x = W * t;
      const y = y0 + 50 * k * t * (1 - t) * 2;
      const w = 15 * k;
      const h = 28 * k;
      g.line(x, y, x, y + 6 * k, g.pal.ink, 0.6 * k);
      g.blob(x, y + 6 * k + h / 2, w, g.art(), 9);
      g.rect(x - w * 0.5, y + 4 * k, w, 3 * k, g.pal.ink);
      maxY = Math.max(maxY, y + 6 * k + h);
    }
    return { box: [0.1, 0.1, (maxY + 24 * k) / g.H, 0.1] };
  },
  polka(g) {
    const { W, H, k } = g;
    const step = 26 * k;
    for (let y = 0; y < H + step; y += step) {
      for (let x = (Math.round(y / step) % 2) * (step / 2); x < W + step; x += step) g.circle(x, y, 5 * k, g.pal.a1);
    }
    const m = 0.12;
    g.plate(W * m, H * m, W * (1 - 2 * m), H * (1 - 2 * m), 14 * k);
    return { box: [m + 0.06, m + 0.06, m + 0.05, m + 0.05] };
  },
  skyline(g) {
    const { W, H, k } = g;
    let x = -12;
    while (x < W + 12) {
      const w = g.r(26, 52) * k;
      const h = g.r(50, 120) * k;
      const c = g.art();
      g.rect(x, H - h, w, h + 12, c);
      if (g.rnd() < 0.5) g.poly([[x, H - h], [x + w / 2, H - h - w * 0.45], [x + w, H - h]], c);
      for (let wy = H - h + 8 * k; wy < H - 10 * k; wy += 14 * k) for (let wx = x + 6 * k; wx < x + w - 8 * k; wx += 12 * k) g.rect(wx, wy, 5 * k, 6 * k, g.pal.paper);
      x += w + 3 * k;
    }
    return { box: [0.1, 0.1, 0.1, (140 * k) / H + 0.04] };
  },
  network(g) {
    const { H, k } = g;
    const pts: Array<[number, number]> = [];
    for (const [x, y] of bands(g, 26, 0.22, 0.2, 10 * k)) pts.push([x, y]);
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const [a, b] = [pts[i]!, pts[j]!];
        const same = (a[1] < H / 2) === (b[1] < H / 2);
        if (same && Math.hypot(a[0] - b[0], a[1] - b[1]) < 90 * k) g.line(a[0], a[1], b[0], b[1], g.pal.a2, 0.6 * k);
      }
    }
    for (const [x, y] of pts) g.circle(x, y, g.r(2.5, 6) * k, g.art());
    return { box: [0.1, 0.1, 0.26, 0.24] };
  },
  pitch(g) {
    const { W, H, k } = g;
    g.rect(-12, -12, W + 24, H + 24, g.pal.a1);
    const m = 16 * k;
    g.frame(m, m, W - 2 * m, H - 2 * m, g.pal.paper, 2 * k);
    g.line(m, H / 2, W - m, H / 2, g.pal.paper, 2 * k);
    g.circle(W / 2, H / 2, 46 * k, g.pal.paper, "stroke", 2 * k);
    g.rect(W * 0.3, m, W * 0.4, 50 * k, g.pal.paper, "stroke", 2 * k);
    g.rect(W * 0.3, H - m - 50 * k, W * 0.4, 50 * k, g.pal.paper, "stroke", 2 * k);
    g.plate(W * 0.12, H * 0.2, W * 0.76, H * 0.6, 4 * k);
    return { box: [0.17, 0.17, 0.24, 0.24] };
  },
  fireworks(g) {
    const { W, H, k } = g;
    for (let i = 0; i < 5; i += 1) {
      const top = i < 3;
      const cx = g.r(W * 0.1, W * 0.9);
      const cy = top ? g.r(52 * k, 64 * k) : H - g.r(52 * k, 64 * k);
      const R = g.r(26, 44) * k;
      const c = g.art();
      for (let j = 0; j < 14; j += 1) {
        const a = (j / 14) * Math.PI * 2;
        g.line(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3, cx + Math.cos(a) * R, cy + Math.sin(a) * R, c, 1.4 * k);
        g.circle(cx + Math.cos(a) * R * 1.15, cy + Math.sin(a) * R * 1.15, 1.6 * k, c);
      }
    }
    return { box: [0.1, 0.1, (130 * k) / H, (130 * k) / H] };
  },
  vellum(g) {
    const { W, H, k } = g;
    // a translucent band (a lighter tint) across the sheet with a wax seal
    const y = H * 0.62;
    g.rect(-12, y, W + 24, H * 0.12, g.pal.a3);
    g.circle(W / 2, y + H * 0.06, 22 * k, g.pal.a1);
    g.circle(W / 2, y + H * 0.06, 15 * k, g.pal.a2, "stroke", 1.4 * k);
    g.frame(14 * k, 14 * k, W - 28 * k, H - 28 * k, g.pal.a1, 0.8 * k);
    return { box: [0.12, 0.12, 0.1, 1 - 0.6], valign: "top" };
  },
  "scallop-frame"(g) {
    const { W, H, k } = g;
    g.rect(-12, -12, W + 24, H + 24, g.pal.a1);
    const m = 22 * k;
    const r = 10 * k;
    g.plate(m, m, W - 2 * m, H - 2 * m, 0);
    for (let x = m; x <= W - m; x += r * 2) {
      g.circle(x, m, r, g.pal.paper);
      g.circle(x, H - m, r, g.pal.paper);
    }
    for (let y = m; y <= H - m; y += r * 2) {
      g.circle(m, y, r, g.pal.paper);
      g.circle(W - m, y, r, g.pal.paper);
    }
    g.frame(m + 14 * k, m + 14 * k, W - 2 * m - 28 * k, H - 2 * m - 28 * k, g.pal.a2, 0.8 * k);
    return { box: [0.16, 0.16, 0.12, 0.12] };
  },
  "arch-window"(g) {
    const { W, H, k } = g;
    g.rect(-12, -12, W + 24, H + 24, g.pal.a1);
    const x = W * 0.1;
    const w = W * 0.8;
    const top = H * 0.08;
    const r = w / 2;
    g.push(`M${f(x)} ${f(H - H * 0.06)}V${f(top + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(top + r)}V${f(H - H * 0.06)}Z`, "fill", g.pal.paper, [x, top, x + w, H - H * 0.06], 0, true);
    g.push(`M${f(x + 8 * k)} ${f(H - H * 0.06 - 8 * k)}V${f(top + r)}A${f(r - 8 * k)} ${f(r - 8 * k)} 0 0 1 ${f(x + w - 8 * k)} ${f(top + r)}V${f(H - H * 0.06 - 8 * k)}Z`, "stroke", g.pal.a2, [x, top, x + w, H], 0.8 * k, true);
    return { box: [0.17, 0.17, (top + r * 0.55) / H, 0.1] };
  },
  "ribbon-corner"(g) {
    const { W, H, k } = g;
    const s = 120 * k;
    g.poly([[W - s, -12], [W + 12, -12], [W + 12, s], [W, s + 12]], g.pal.a1);
    g.poly([[W - s - 18 * k, -12], [W - s, -12], [W + 12, s], [W + 12, s + 18 * k]], g.pal.a2);
    const b = s * 0.6;
    g.poly([[-12, H - b], [b, H + 12], [-12, H + 12]], g.pal.a1);
    g.frame(16 * k, 16 * k, W - 32 * k, H - 32 * k, g.pal.a2, 0.6 * k);
    return { box: [0.12, 0.12, (s + 30 * k) / H, (b + 16 * k) / H] };
  },
  petals(g) {
    for (const [x, y] of bands(g, 36, 0.2, 0.2, 8 * g.k)) g.leaf(x, y, g.r(10, 18) * g.k, g.r(0, Math.PI * 2), g.r(4, 7) * g.k, g.art());
    return { box: [0.1, 0.1, 0.24, 0.24] };
  },
  zigzag(g) {
    const { W, H, k } = g;
    const amp = 10 * k;
    const per = 20 * k;
    for (let r = 0; r < 4; r += 1) {
      for (const top of [true, false]) {
        const y = top ? 16 * k + r * 14 * k : H - 16 * k - r * 14 * k;
        const pts: Array<[number, number]> = [];
        for (let x = -per; x < W + per; x += per) pts.push([x, y + ((x / per) % 2 === 0 ? -amp / 2 : amp / 2)]);
        g.poly(pts, [g.pal.a1, g.pal.a2, g.pal.a3, g.pal.a1][r]!, "stroke", 3 * k, false);
      }
    }
    return { box: [0.1, 0.1, (80 * k) / H + 0.04, (80 * k) / H + 0.04] };
  },
};

/** Draws a template on a sheet W × H (points). `motif` is the occasion's 80 × 64 line drawing. */
export function drawTemplate(spec: TemplateSpec, paletteKey: string, W: number, H: number, motif: string): { nodes: ArtNode[]; result: ArtResult } {
  const pal = TEMPLATE_PALETTES[paletteKey] ?? TEMPLATE_PALETTES[spec.palettes[0]]!;
  const pen = new Pen(W, H, pal, rngOf(spec.seed), motif);
  const result = STYLES[spec.style](pen);
  return { nodes: pen.nodes, result };
}
