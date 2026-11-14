import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A loading boundary starts streaming; once a page streams it can no longer answer 404. So no
// loading.tsx may sit ABOVE a layout that refuses access with notFound() — otherwise a stranger
// opening someone else's occasion gets "page not found" with HTTP status 200.

const app = join(__dirname, "..", "app");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

describe("loading boundaries and real 404s", () => {
  it("no loading.tsx wraps a layout that calls notFound()", () => {
    const files = walk(app);
    const loadings = files.filter((f) => f.endsWith("loading.tsx")).map((f) => dirname(f));
    const guarded = files.filter((f) => f.endsWith("layout.tsx") && /notFound|orNotFound/.test(readFileSync(f, "utf8"))).map((f) => dirname(f));
    expect(guarded.length).toBeGreaterThan(0);
    for (const g of guarded) {
      for (const l of loadings) {
        const above = l !== g && !relative(l, g).startsWith("..");
        expect(above, `${relative(app, l)}/loading.tsx sits above ${relative(app, g)}/layout.tsx`).toBe(false);
      }
    }
    expect(existsSync(join(app, "loading.tsx"))).toBe(false);
  });
});
