import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The code map (docs/build/21-code-map.md) is how people and coding agents find things.
// It is generated from the code; this test fails when it is stale or when a core module has
// no plain-English purpose in docs/build/module-purposes.json. Fix: `pnpm codemap`.
describe("code map", () => {
  it("is up to date with the code (run `pnpm codemap` to refresh it)", () => {
    const root = join(__dirname, "..", "..", "..");
    let problem = "";
    try {
      execFileSync("node", [join(root, "scripts/gen-codemap.mjs"), "--check"], { cwd: root, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      problem = String((e as { stderr?: string }).stderr ?? e);
    }
    expect(problem).toBe("");
  });
});
