#!/usr/bin/env node
// Generates docs/build/21-code-map.md — the "where is everything" index for people and coding
// agents. It is derived from the code, so it cannot drift: `node scripts/gen-codemap.mjs --check`
// (run by apps/web/test/codemap.test.ts) fails when the file on disk is stale.
//   node scripts/gen-codemap.mjs          rewrite the map
//   node scripts/gen-codemap.mjs --check  exit 1 if the map is out of date
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/build/21-code-map.md");
const rel = (p) => relative(root, p).split("\\").join("/");
const read = (p) => readFileSync(p, "utf8");

function walk(dir, keep, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".next" || name === "out" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, acc);
    else if (keep(p)) acc.push(p);
  }
  return acc;
}
const isCode = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts");

/** First sentence of the first comment in a file, as its one-line purpose. */
function purpose(src) {
  const block = src.match(/\/\*\*?([\s\S]*?)\*\//);
  const line = src.match(/^(?:\s*\/\/[^\n]*\n)+/m);
  let text = "";
  // only a comment that opens the file (a real header) counts
  const bi = block ? src.indexOf(block[0]) : -1;
  const li = line ? src.indexOf(line[0]) : -1;
  const headerAt = (i) => i >= 0 && /^(\s|import [^\n]*\n|"use (client|server)";?\n)*$/.test(src.slice(0, i));
  if (headerAt(li) && (bi < 0 || li < bi)) text = line[0].replace(/^\s*\/\/\s?/gm, " ");
  else if (headerAt(bi)) text = block[1].replace(/^\s*\*\s?/gm, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const first = text.split(/(?<=[.:;])\s/)[0];
  return (first.length > 150 ? first.slice(0, 147) + "…" : first).replace(/\|/g, "/");
}

const purposes = JSON.parse(read(join(root, "docs/build/module-purposes.json")));
const coreDir = join(root, "packages/core/src");
for (const k of Object.keys(purposes)) if (!existsSync(join(root, "packages/core/src", `${k}.ts`))) { console.error(`module-purposes.json lists "${k}" but packages/core/src/${k}.ts does not exist`); process.exit(1); }
const coreModules = readdirSync(coreDir).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")).sort();
const coreTests = walk(join(root, "packages/core/test"), (p) => p.endsWith(".test.ts"));
const webFiles = walk(join(root, "apps/web"), isCode);
const schemaDir = join(root, "packages/db/src/schema");
const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith(".ts") && !f.startsWith("_") && f !== "index.ts").sort();

const importsOf = (files, spec) => files.filter((f) => read(f).includes(spec));
const short = (list, n) => (list.length <= n ? list : [...list.slice(0, n), `… +${list.length - n} more`]);
const code = (s) => "`" + s + "`";

function routePath(file) {
  let r = rel(file).replace(/^apps\/web\/app/, "").replace(/\/(page|route)\.tsx?$/, "");
  r = r.split("/").filter((seg) => !/^\(.*\)$/.test(seg)).join("/");
  return r === "" ? "/" : r;
}

const lines = [];
const push = (...l) => lines.push(...l);

push(
  "# 21 — Code map (generated)",
  "",
  "**What this is:** an index of where everything lives, generated from the code by",
  "`node scripts/gen-codemap.mjs`. Do not edit it by hand — change the code, then regenerate.",
  "A test (`apps/web/test/codemap.test.ts`) fails when this file is out of date.",
  "",
  "Start with [`AGENTS.md`](../../AGENTS.md) for the rules; use this file to find things.",
  "",
  "## 1. Domain modules — `packages/core/src/<name>.ts` (import as `@ed/core/<name>`)",
  "",
  "All business rules and access checks live here. \"Used by\" lists the web actions and",
  "routes that import the module; \"Tests\" lists the test files that exercise it.",
  "",
  "| Module | Purpose | Tables (schema file) | Web actions | Routes that import it | Tests |",
  "| --- | --- | --- | --- | --- | --- |",
);
for (const m of coreModules) {
  if (!purposes[m]) {
    console.error(`docs/build/module-purposes.json has no entry for core module "${m}". Add one plain-English line.`);
    process.exit(1);
  }
  const schemaHit = schemaFiles.filter((f) => f === `${m}.ts`).map((f) => code(`schema/${f}`));
  const spec = `@ed/core/${m}"`;
  const users = importsOf(webFiles, spec);
  const actions = users.filter((f) => /\/actions(\/|\.ts$)/.test(rel(f)) || rel(f).includes("/app/actions/")).map((f) => code(rel(f).replace("apps/web/", "")));
  const routes = [...new Set(users.filter((f) => /\/(page|route)\.tsx?$/.test(f)).map(routePath))].map(code);
  const tests = coreTests
    .filter((t) => new RegExp(`from "\\.\\./src/${m}"`).test(read(t)))
    .map((t) => code(rel(t).replace("packages/core/test/", "")));
  push(`| ${code(m)} | ${purposes[m].replace(/\|/g, "/")} | ${schemaHit.join(" ") || "—"} | ${short(actions, 3).join(" ") || "—"} | ${short(routes, 4).join(" ") || "—"} | ${short(tests, 4).join(" ") || "—"} |`);
}

push("", "## 2. Database — `packages/db/src/schema/<file>.ts`", "", "| Schema file | Tables |", "| --- | --- |");
for (const f of schemaFiles) {
  const tables = [...read(join(schemaDir, f)).matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
  push(`| ${code(f)} | ${tables.map(code).join(" ")} |`);
}
const sqlDir = join(root, "packages/db/src/sql");
push("", "SQL guards (`packages/db/src/sql`, re-applied on every migrate/push/test run):", "");
for (const f of readdirSync(sqlDir).sort()) push(`- ${code(f)} — ${purpose(read(join(sqlDir, f)).replace(/^--\s?/gm, "// ")) || "see file"}`);

push("", "## 3. Extension points (registries)", "", "Add behaviour by registering, not by editing another domain. Every module that registers at", "import time is loaded in every process through `@ed/core/all`.", "", "| Registry | Defined in | Registered from |", "| --- | --- | --- |");
const pkgFiles = ["core", "mcp", "storage", "jobs", "email", "auth"].flatMap((p) => walk(join(root, "packages", p, "src"), isCode));
const regs = [];
for (const f of pkgFiles) {
  for (const m of read(f).matchAll(/export function ((?:register|on|set)[A-Z]\w*)\s*[(<]/g)) {
    if (/^(set|on)[A-Z]/.test(m[1]) && !/(Provider|Lister|Counter|Hook|Purge|Handover|Decided|Published|SignOut|Adapter|Scanner|Transport|Rasteriser|Changed)/.test(m[1])) continue;
    regs.push({ name: m[1], file: f });
  }
}
regs.sort((a, b) => a.name.localeCompare(b.name));
for (const r of regs) {
  const callers = pkgFiles.filter((f) => f !== r.file && new RegExp(`\\b${r.name}\\(`).test(read(f))).map((f) => code(rel(f).replace(/^packages\//, "")));
  push(`| ${code(r.name)} | ${code(rel(r.file))} | ${short(callers, 6).join(" ") || "—"} |`);
}

push("", "## 4. What-if kinds (preview → confirm)", "", "| Kind | Registered in |", "| --- | --- |");
// string constants across the packages, to resolve `defineJob(SOME_JOB, …)` style calls
const constants = new Map();
for (const f of pkgFiles) for (const m of read(f).matchAll(/const ([A-Z][A-Z0-9_]+)\s*(?::\s*[\w.]+\s*)?=\s*"([^"]+)"/g)) constants.set(m[1], m[2]);
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function firstArgs(src, fn) {
  const found = [];
  const text = stripComments(src);
  const re = new RegExp(`\\b${fn}\\b`, "g");
  let m;
  while ((m = re.exec(text))) {
    let i = m.index + fn.length;
    if (text[i] === "<") { let depth = 0; for (; i < text.length; i++) { if (text[i] === "<") depth++; else if (text[i] === ">") { depth--; if (depth === 0) { i++; break; } } } }
    if (text[i] !== "(") continue;
    const arg = text.slice(i + 1, i + 200).match(/^\s*(?:"([^"]+)"|([A-Z][A-Z0-9_]+))/);
    if (!arg) continue;
    const value = arg[1] ?? constants.get(arg[2]);
    if (value) found.push(value);
  }
  return found;
}
const kinds = [];
for (const f of pkgFiles) for (const k of firstArgs(read(f), "registerWhatIf")) kinds.push([k, rel(f)]);
for (const [k, f] of [...new Map(kinds.map((x) => [x.join("|"), x])).values()].sort()) push(`| ${code(k)} | ${code(f)} |`);

push("", "## 5. Background jobs", "", "| Job | Defined in |", "| --- | --- |");
const jobs = [];
for (const f of pkgFiles) for (const k of firstArgs(read(f), "defineJob")) jobs.push([k, rel(f)]);
for (const [k, f] of [...new Map(jobs.map((x) => [x.join("|"), x])).values()].sort()) push(`| ${code(k)} | ${code(f)} |`);

push("", "## 6. Web routes — `apps/web/app`", "", "Route groups in brackets do not appear in the URL. `page` = a screen, `route` = an HTTP endpoint.", "", "| URL | Kind | File |", "| --- | --- | --- |");
const routeFiles = walk(join(root, "apps/web/app"), (p) => /\/(page|route)\.tsx?$/.test(p.split("\\").join("/")));
for (const f of routeFiles.sort((a, b) => routePath(a).localeCompare(routePath(b)))) {
  push(`| ${code(routePath(f))} | ${/route\.tsx?$/.test(f) ? "route" : "page"} | ${code(rel(f))} |`);
}

push("", "## 7. Server actions — `apps/web/app/actions` and console actions", "", "| File | Exported actions |", "| --- | --- |");
const actionFiles = webFiles.filter((f) => /^apps\/web\/app\/(actions\/|console\/.*actions\.ts$)/.test(rel(f)) || /\/actions\.ts$/.test(rel(f)));
for (const f of actionFiles.sort()) {
  const names = [...read(f).matchAll(/export (?:const|async function) (\w+)/g)].map((m) => m[1]);
  push(`| ${code(rel(f))} | ${names.map(code).join(" ")} |`);
}

push("", "## 8. Translations — `packages/i18n/messages/{ro,en}/<namespace>.json`", "");
const ns = readdirSync(join(root, "packages/i18n/messages/ro")).map((f) => f.replace(/\.json$/, "")).sort();
push(ns.map(code).join(" "), "");

push("## 9. MCP tools — `packages/mcp/src`", "", "| Tool | Scope | File |", "| --- | --- | --- |");
const mcpFiles = walk(join(root, "packages/mcp/src"), isCode).filter((f) => !f.endsWith("tools.ts"));
const tools = [];
for (const f of mcpFiles) for (const m of stripComments(read(f)).matchAll(/name:\s*"((?:get|list|search|propose)_[a-z_]+|whoami)"[\s\S]{0,200}?scope:\s*"(read|propose)"/g)) tools.push([m[1], m[2], rel(f)]);
for (const [n, s, f] of tools.sort()) push(`| ${code(n)} | ${s} | ${code(f)} |`);

push("", "## 10. Shared UI — `packages/ui/src`", "");
const uiExports = (file) => [...read(join(root, "packages/ui/src", file)).matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
push(`- Server-safe components (${code("components.tsx")}): ${uiExports("components.tsx").map(code).join(" ")}`);
push(`- Interactive components (${code("client.tsx")}): ${uiExports("client.tsx").map(code).join(" ")}`);
push(`- Icons: ${code("icons.tsx")} · tokens: ${code("tokens.css")} · classes: ${code("components.css")}, ${code("shell.css")}`, "");

const text = lines.join("\n") + "\n";
if (process.argv.includes("--check")) {
  const current = existsSync(out) ? read(out) : "";
  if (current !== text) {
    console.error("docs/build/21-code-map.md is out of date. Run: node scripts/gen-codemap.mjs");
    process.exit(1);
  }
  console.info("code map is up to date");
} else {
  writeFileSync(out, text);
  console.info(`wrote ${rel(out)} (${lines.length} lines)`);
}
