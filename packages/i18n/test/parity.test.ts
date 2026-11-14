import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locales } from "../src/config";
import { listNamespaces, loadMessages, type Messages } from "../src/load";

// THE i18n gate (L1/L2): run with `pnpm --filter @ed/i18n test`.
// - every namespace exists in ro and en
// - both locales have exactly the same keys
// - no empty strings; {placeholders} match between locales
// - the generated import map knows every JSON file on disk

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");

function flatten(node: Messages, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\s*(\w+)/g)].map((m) => m[1]).sort();

const filesOnDisk = (locale: string) =>
  readdirSync(join(messagesDir, locale))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

describe("messages", () => {
  it("the generated import map is up to date (run: pnpm --filter @ed/i18n gen)", () => {
    for (const locale of locales) {
      expect(listNamespaces(locale).sort(), `namespaces for ${locale}`).toEqual(
        filesOnDisk(locale),
      );
    }
  });

  it("every JSON file parses and is an object of strings/objects", () => {
    for (const locale of locales) {
      for (const ns of filesOnDisk(locale)) {
        const raw = readFileSync(join(messagesDir, locale, `${ns}.json`), "utf8");
        const parsed: unknown = JSON.parse(raw);
        expect(
          typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
          `${locale}/${ns}`,
        ).toBe(true);
      }
    }
  });

  it("ro and en have the same namespaces", () => {
    expect(filesOnDisk("en")).toEqual(filesOnDisk("ro"));
  });

  it("ro and en have identical key sets in every namespace", () => {
    const ro = loadMessages("ro");
    const en = loadMessages("en");
    const problems: string[] = [];
    for (const ns of new Set([...Object.keys(ro), ...Object.keys(en)])) {
      const roKeys = flatten(ro[ns] ?? {});
      const enKeys = flatten(en[ns] ?? {});
      for (const k of roKeys.keys())
        if (!enKeys.has(k)) problems.push(`en/${ns}.json is missing "${k}"`);
      for (const k of enKeys.keys())
        if (!roKeys.has(k)) problems.push(`ro/${ns}.json is missing "${k}"`);
    }
    expect(problems).toEqual([]);
  });

  it("no empty strings and matching {placeholders}", () => {
    const ro = loadMessages("ro");
    const en = loadMessages("en");
    const problems: string[] = [];
    for (const ns of Object.keys(ro)) {
      const roKeys = flatten(ro[ns] ?? {});
      const enKeys = flatten(en[ns] ?? {});
      for (const [k, v] of roKeys) {
        if (v.trim() === "") problems.push(`ro/${ns}.json "${k}" is empty`);
        const other = enKeys.get(k);
        if (other === undefined) continue;
        if (other.trim() === "") problems.push(`en/${ns}.json "${k}" is empty`);
        if (placeholders(v).join() !== placeholders(other).join()) {
          problems.push(`${ns}.json "${k}": placeholders differ between ro and en`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("Romanian uses comma-below diacritics (ș ț), never the cedilla forms (ş ţ)", () => {
    const problems: string[] = [];
    for (const [ns, tree] of Object.entries(loadMessages("ro"))) {
      for (const [k, v] of flatten(tree))
        if (/[şţŞŢ]/.test(v)) problems.push(`ro/${ns}.json "${k}"`);
    }
    expect(problems).toEqual([]);
  });

  it("common has a message for every AppError code", () => {
    for (const locale of locales) {
      const errors = (loadMessages(locale).common?.errors ?? {}) as Messages;
      for (const code of [
        "FORBIDDEN",
        "NOT_FOUND",
        "VALIDATION",
        "CONFLICT",
        "RATE_LIMITED",
        "TAKEN",
        "LIMIT",
        "UNAUTHENTICATED",
        "UNEXPECTED",
      ]) {
        expect(typeof errors[code], `${locale} common.errors.${code}`).toBe("string");
      }
    }
  });
});
