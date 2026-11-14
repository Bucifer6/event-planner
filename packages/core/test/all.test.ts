import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("@ed/core/all", () => {
  it("lists every core module, so no registration is ever missing from a process", () => {
    const dir = join(__dirname, "..", "src");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "all.ts").map((f) => f.replace(/\.ts$/, "")).sort();
    const all = readFileSync(join(dir, "all.ts"), "utf8");
    const listed = [...all.matchAll(/^import "\.\/([^"]+)";$/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(files);
  });
});
