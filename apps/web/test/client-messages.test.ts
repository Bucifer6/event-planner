import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientMessages, SERVER_ONLY_NAMESPACES } from "../lib/client-messages";

// The browser gets only the namespaces client components read (lib/client-messages.ts).
// This guards it: every useTranslations("ns") in a client component, and every namespace a
// What-if proposal can name at run time (the preview panel translates those keys in the
// browser), must still be in what the browser receives.

const repo = join(__dirname, "..", "..", "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === ".next") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(f)) out.push(p);
  }
  return out;
};
const ro = Object.fromEntries(readdirSync(join(repo, "packages/i18n/messages/ro")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(repo, "packages/i18n/messages/ro", f), "utf8"))]));

describe("messages sent to the browser", () => {
  it("keep every namespace a client component reads", () => {
    const client = walk(join(repo, "apps/web")).filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")));
    expect(client.length).toBeGreaterThan(40);
    const sent = clientMessages(ro);
    for (const f of client) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/useTranslations\(\s*["'`]([a-zA-Z]+)/g)) expect(sent[m[1]!], `${f} reads ${m[1]}`).toBeDefined();
    }
  });

  it("keep every namespace a What-if proposal or app error can name", () => {
    const sources = [...walk(join(repo, "packages/core/src")), ...walk(join(repo, "packages/mcp/src"))].map((f) => readFileSync(f, "utf8")).join("\n");
    const sent = clientMessages(ro);
    const named = new Set([...sources.matchAll(/(?:key|noteKey|kindLabelKey|labelKey|what):\s*\{?\s*(?:key:\s*)?["`]([a-zA-Z]+)\./g)].map((m) => m[1]!));
    for (const ns of named) if (ro[ns]) expect(sent[ns], `What-if keys use ${ns}`).toBeDefined();
    // the stationery proposal rows read these parts in the browser
    expect((sent.stationery as Record<string, unknown>).fields).toBeDefined();
    expect((sent.stationery as Record<string, unknown>).whatif).toBeDefined();
  });

  it("is much smaller than the whole catalogue", () => {
    const whole = JSON.stringify(ro).length;
    const sent = JSON.stringify(clientMessages(ro)).length;
    expect(sent).toBeLessThan(whole * 0.6);
    for (const ns of SERVER_ONLY_NAMESPACES) expect(ro[ns], `${ns} exists`).toBeDefined();
  });
});
