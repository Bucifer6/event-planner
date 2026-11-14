import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_THEMES, UI_THEME_PAPER } from "@ed/core/appearance";

// The five looks (Console → Appearance). This guards three things for every look, in light and
// dark: it exists in the stylesheet, its text/background pairs meet WCAG AA (4.5:1), and every
// font file it names is really in the repo (self-hosted, no third-party origin).
const uiDir = join(__dirname, "..", "..", "..", "packages", "ui");
const css = readFileSync(join(uiDir, "src", "themes.css"), "utf8");

function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, `missing CSS block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
const PAIRS: Array<[string, string]> = [
  ["--ink", "--paper"], ["--ink", "--surface"], ["--ink-2", "--paper"], ["--ink-2", "--surface"], ["--ink-2", "--sunken"],
  ["--ink-3", "--paper"], ["--ink-3", "--surface"], ["--on-accent", "--accent"], ["--on-accent", "--accent-hover"],
  ["--accent", "--paper"], ["--accent", "--surface"], ["--accent", "--accent-tint"], ["--gilt-ink", "--paper"], ["--gilt-ink", "--surface"],
];

describe("UI looks", () => {
  it.each(UI_THEMES)("%s: light and dark palettes meet AA contrast", (theme) => {
    const light = block(`[data-ui="${theme}"]`);
    const dark = block(`:root:not([data-theme="light"])[data-ui="${theme}"]`);
    for (const [mode, vars] of [["light", light], ["dark", dark]] as const) {
      for (const [fg, bg] of PAIRS) {
        const r = ratio(vars[fg]!, vars[bg]!);
        expect(r, `${theme} ${mode} ${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(light["--paper"]).toBe(UI_THEME_PAPER[theme]);
    // the forced-dark surface (event day) is themed too
    expect(css).toContain(`[data-ui="${theme}"] [data-theme="dark"]`);
  });

  it("every font file a look names is self-hosted in the repo", () => {
    const files = [...css.matchAll(/url\("\.\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(existsSync(join(uiDir, "fonts", f)), f).toBe(true);
    expect(css).not.toMatch(/url\("https?:/);
  });
});
