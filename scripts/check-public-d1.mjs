#!/usr/bin/env node
// D1 gate for the public site (eventdesk.ro): the static export must not load anything from
// another origin and must not use cookies.
//
//   node scripts/check-public-d1.mjs [dir]        default dir: apps/public/out
//
// Fails (exit 1) on:
//   - <script src>, <link href> (except rel=canonical/alternate), <img|iframe|source|video|
//     audio|embed|track src>, <object data>, srcset — pointing at an absolute origin
//     (http://, https:// or //host)
//   - url(...) or @import pointing at an absolute origin, in CSS files, <style> blocks and
//     style attributes
//   - document.cookie, cookieStore or Set-Cookie anywhere in HTML/JS, and <meta http-equiv=set-cookie>
// Plain <a href="https://…"> navigation links are allowed (they load nothing).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(repoRoot, "apps/public/out"));

if (!existsSync(outDir)) {
  console.error(
    `check-public-d1: ${outDir} does not exist. Build first: pnpm --filter @ed/public build`,
  );
  process.exit(2);
}

const ABSOLUTE = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i; // scheme://host or //host
const isExternal = (url) => ABSOLUTE.test(url);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};

const problems = [];
const report = (file, what) => problems.push(`${relative(outDir, file)}: ${what}`);

function checkCss(file, css, where) {
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const url = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (isExternal(url)) report(file, `${where} url() loads external origin: ${url}`);
  }
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"');\s]+)/gi)) {
    if (isExternal(m[1])) report(file, `${where} @import loads external origin: ${m[1]}`);
  }
}

function checkCookies(file, text) {
  if (/document\s*\.\s*cookie/.test(text)) report(file, "uses document.cookie");
  if (/\bcookieStore\b/.test(text)) report(file, "uses cookieStore");
  if (/set-cookie/i.test(text)) report(file, "mentions Set-Cookie");
}

function checkHtml(file, html) {
  const SRC_TAGS = [
    "script",
    "img",
    "iframe",
    "source",
    "video",
    "audio",
    "embed",
    "track",
    "input",
  ];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const tag = m[0];
    const name = m[1].toLowerCase();
    if (SRC_TAGS.includes(name)) {
      const src = attr(tag, "src");
      if (src !== null && isExternal(src))
        report(file, `<${name} src> loads external origin: ${src}`);
    }
    if (name === "link") {
      const href = attr(tag, "href");
      const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
      const harmless = rel.some((r) =>
        ["canonical", "alternate", "me", "author", "license"].includes(r),
      );
      if (href !== null && isExternal(href) && !harmless) {
        report(file, `<link rel="${rel.join(" ")}" href> points at external origin: ${href}`);
      }
    }
    if (name === "object") {
      const data = attr(tag, "data");
      if (data !== null && isExternal(data))
        report(file, `<object data> loads external origin: ${data}`);
    }
    for (const a of ["srcset", "imagesrcset"]) {
      const srcset = attr(tag, a);
      if (srcset === null) continue;
      for (const candidate of srcset.split(",")) {
        const url = candidate.trim().split(/\s+/)[0] ?? "";
        if (isExternal(url)) report(file, `<${name} ${a}> loads external origin: ${url}`);
      }
    }
    const style = attr(tag, "style");
    if (style) checkCss(file, style, "style attribute");
    if (name === "meta" && /set-cookie/i.test(attr(tag, "http-equiv") ?? "")) {
      report(file, "<meta http-equiv=set-cookie>");
    }
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    checkCss(file, m[1], "<style>");
  checkCookies(file, html);
}

let scanned = 0;
for (const file of walk(outDir)) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    checkHtml(file, readFileSync(file, "utf8"));
  } else if (lower.endsWith(".css")) {
    checkCss(file, readFileSync(file, "utf8"), "stylesheet");
  } else if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    checkCookies(file, readFileSync(file, "utf8"));
  } else if (lower.endsWith(".svg")) {
    const svg = readFileSync(file, "utf8");
    checkCss(file, svg, "svg");
    for (const m of svg.matchAll(/<(?:script|image|use)\b[^>]*>/gi)) {
      const href = attr(m[0], "href") ?? attr(m[0], "xlink:href") ?? attr(m[0], "src");
      if (href !== null && isExternal(href)) report(file, `svg loads external origin: ${href}`);
    }
  } else {
    continue;
  }
  scanned++;
}

if (problems.length > 0) {
  console.error(`check-public-d1: FAILED — ${problems.length} problem(s) in ${outDir}`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.info(
  `check-public-d1: OK — ${scanned} files scanned, no external origins, no cookie usage.`,
);
