import { OCCASION_KINDS } from "@ed/db";
import { translate } from "@ed/i18n";
import { describe, expect, it } from "vitest";
import { STATIONERY_FIELD_LIMITS, stationeryDesignName } from "../src/stationery";
import { colourwaysFor, COLOURWAYS, contrastRatio, DESIGN_KEYS, designAvailableFor, getDesign, layoutPiece, mm, sceneTextBounds, sceneToSvg, type KitTexts, type PieceKind } from "../src/stationerykit";
import { occasionTemplates, TEMPLATE_PALETTES, TEMPLATE_STYLES, TEMPLATES_PER_KIND } from "../src/stationerytemplates";

// The occasion templates: 50+ per kind, each different, every one fit to print — its text
// stays on the sheet and never sits on top of the artwork (unless a plain plate is under it).

const TEXTS: KitTexts = {
  kicker: "Împreună cu familiile noastre",
  names: "Alexandra & Ștefan-Andrei",
  wording: "vă invităm cu drag să fiți alături de noi într-o zi pe care o vom ține minte toată viața",
  date: "Sâmbătă, 12 septembrie 2026",
  time: "ora 17:00",
  venue: "Conacul Țărănesc",
  address: "Str. Învățătorilor 14, Snagov, Ilfov",
  rsvp: "Vă rugăm să ne confirmați prezența până la 15 august",
  saveTheDate: "Rezervați data",
  menuTitle: "Meniu",
  menuBody: "Gustare\nPlatou rece\n\nFel principal\nMușchi de vită\n\nDesert\nTort",
  thanks: "Mulțumim\nVă mulțumim din suflet.",
};
const PIECES_CHECKED: PieceKind[] = ["invitation", "invitation-square", "save-the-date", "place-card"];
const overlaps = (a: number[], b: number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;
const contains = (outer: number[], inner: number[]) => outer[0]! <= inner[0]! && outer[1]! <= inner[1]! && outer[2]! >= inner[2]! && outer[3]! >= inner[3]!;

describe("occasion templates", () => {
  it("gives every occasion kind at least 50 templates of its own, in many styles, each a different style/palette pair", () => {
    expect(TEMPLATES_PER_KIND).toBeGreaterThanOrEqual(50);
    const all = new Set<string>();
    for (const kind of OCCASION_KINDS) {
      const list = occasionTemplates(kind);
      expect(list.length, kind).toBeGreaterThanOrEqual(50);
      expect(new Set(list.map((t) => t.style)).size, kind).toBeGreaterThanOrEqual(12);
      expect(new Set(list.map((t) => `${t.style}|${t.palettes[0]}`)).size, kind).toBe(list.length);
      for (const t of list) {
        expect(all.has(t.key)).toBe(false);
        all.add(t.key);
        const d = getDesign(t.key);
        expect(d.range).toBe("occasion");
        expect(designAvailableFor(d, kind)).toBe(true);
        expect(designAvailableFor(d, kind === "nunta" ? "botez" : "nunta")).toBe(false);
        expect(colourwaysFor(d, kind)).toHaveLength(3);
      }
    }
    expect(DESIGN_KEYS.filter((k) => getDesign(k).range === "occasion")).toHaveLength(all.size);
    // the same every time (fixed seeds)
    expect(occasionTemplates("nunta").map((t) => t.style)).toEqual(occasionTemplates("nunta").map((t) => t.style));
    // a kind's specials come first: a Christmas party opens with snow, an awards night with laurels
    expect(occasionTemplates("petrecere_craciun").map((t) => t.style)).toContain("snowflakes");
    expect(occasionTemplates("festivitate_premii")[0]!.style).toBe("laurel");
    expect(occasionTemplates("comemorare").map((t) => t.style)).not.toContain("confetti");
  });

  it("has a name for every style and palette in both languages", () => {
    for (const locale of ["ro", "en"] as const) {
      for (const s of TEMPLATE_STYLES) expect(translate(locale, `stationery.styles.${s}`), s).not.toMatch(/^stationery\./);
      for (const p of Object.keys(TEMPLATE_PALETTES)) expect(translate(locale, `stationery.palettes.${p}`), p).not.toMatch(/^stationery\./);
    }
    const t = occasionTemplates("nunta")[0]!;
    expect(stationeryDesignName(t.key, "en")).toBe(`${translate("en", `stationery.styles.${t.style}`)} no. 1`);
    expect(stationeryDesignName(t.key, "ro")).toMatch(/ nr\. 1$/);
  });

  it("every template palette reads: ink and muted meet AA on the paper (and the accent on a dark sheet)", () => {
    for (const p of Object.keys(TEMPLATE_PALETTES)) {
      const cw = COLOURWAYS[`tp-${p}`]!;
      expect(contrastRatio(cw.ink, cw.paper), p).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(cw.muted, cw.paper), p).toBeGreaterThanOrEqual(4.5);
      if (cw.dark) expect(contrastRatio(cw.accent, cw.paper), p).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is fit to print: on every piece checked, text stays on the sheet and never on top of artwork", { timeout: 240_000 }, () => {
    const problems: string[] = [];
    for (const kind of OCCASION_KINDS) {
      for (const t of occasionTemplates(kind)) {
        for (const piece of PIECES_CHECKED) {
          const scene = layoutPiece({ design: t.key, colourway: `tp-${t.palettes[0]}`, piece, texts: TEXTS, occasionKind: kind, extra: { placeName: "Alexandra Constantinescu", placeNote: "Masa 12" } });
          const id = `${t.key}/${t.style}/${piece}`;
          if (scene.truncated) problems.push(`${id}: text cut`);
          const text = sceneTextBounds(scene);
          const safe = mm(3);
          if (text[0] < safe || text[1] < safe || text[2] > scene.width - safe || text[3] > scene.height - safe) problems.push(`${id}: text off the sheet ${text.map(Math.round)}`);
          const firstText = scene.nodes.findIndex((n) => n.t === "text");
          const art = scene.nodes.slice(0, firstText).filter((n): n is Extract<typeof n, { t: "path" }> => n.t === "path" && !!n.box);
          const plates = art.filter((n) => n.plate);
          const plateIdx = scene.nodes.findIndex((n) => n.t === "path" && n.plate);
          const covered = plates.some((p) => contains(p.box!, text));
          for (const n of art) {
            if (n.plate) continue;
            if (n.frame) {
              // an outline around the text: the text must sit inside its line
              const inner = [n.box![0] + n.sw, n.box![1] + n.sw, n.box![2] - n.sw, n.box![3] - n.sw];
              if (!contains(inner, text)) problems.push(`${id}: text crosses the frame`);
              continue;
            }
            const beforePlate = plateIdx >= 0 && scene.nodes.indexOf(n) < plateIdx;
            if (beforePlate && covered) continue;
            if (overlaps(n.box!, [text[0] - 2, text[1] - 2, text[2] + 2, text[3] + 2])) {
              problems.push(`${id}: artwork under the text`);
              break;
            }
          }
          if (piece === "invitation") {
            const svg = sceneToSvg(scene);
            if (svg.includes("NaN") || svg.includes("Infinity")) problems.push(`${id}: bad geometry`);
          }
        }
      }
    }
    expect(problems.slice(0, 40)).toEqual([]);
  });

  it("fits text at the field limits on every template: set smaller, never off the sheet", { timeout: 240_000 }, () => {
    const long = (n: number, word: string) => {
      let s = "";
      while (s.length + word.length + 1 <= n) s += `${s ? " " : ""}${word}`;
      return s;
    };
    const maxed: KitTexts = {
      ...TEXTS,
      kicker: long(STATIONERY_FIELD_LIMITS.kicker, "Împreună"),
      names: "Alexandra-Ecaterina Constantinescu & Maximilian-Sebastian Dumitrescu-Popa",
      wording: long(STATIONERY_FIELD_LIMITS.wording, "bucurie"),
      venue: long(STATIONERY_FIELD_LIMITS.venue, "Conacul"),
      address: long(STATIONERY_FIELD_LIMITS.address, "Strada"),
      rsvp: long(STATIONERY_FIELD_LIMITS.rsvp, "confirmați"),
    };
    const off: string[] = [];
    for (const kind of OCCASION_KINDS) {
      for (const t of occasionTemplates(kind)) {
        const scene = layoutPiece({ design: t.key, piece: "invitation", texts: maxed, occasionKind: kind });
        const [x0, y0, x1, y1] = sceneTextBounds(scene);
        if (x0 < 0 || y0 < 0 || x1 > scene.width || y1 > scene.height || scene.fit > 1) off.push(t.key);
      }
    }
    expect(off).toEqual([]);
  });

  it("an occasion kind from outside never reaches an inherited property (constructor, __proto__)", () => {
    for (const kind of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      for (const design of ["seal", "postcard", "maramures-gate", occasionTemplates("blank")[0]!.key]) {
        expect(() => layoutPiece({ design, piece: "invitation", texts: TEXTS, occasionKind: kind }), `${design}/${kind}`).not.toThrow();
      }
      expect(colourwaysFor(getDesign("frame"), kind)).toEqual(colourwaysFor(getDesign("frame"), "blank"));
    }
  });
});
